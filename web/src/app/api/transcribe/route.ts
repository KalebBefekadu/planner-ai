import { z } from 'zod';
import {
  ApiProblem,
  aiError,
  aiSuccess,
  authorizeAiRequest,
  recordAiUsage,
  stableAiErrorCode,
  type RequestContext,
} from '@/lib/api/ai-route';
import {
  createManagedGroqClient,
  estimateTranscriptionCostMicros,
  GROQ_PRICING_VERSION,
  GROQ_PROVIDER,
  GROQ_TRANSCRIPTION_MODEL,
} from '@/lib/ai/provider';

export const maxDuration = 60;

const MAX_AUDIO_BYTES = 25 * 1024 * 1024;
const MAX_MULTIPART_BYTES = MAX_AUDIO_BYTES + 64 * 1024;
const allowedAudioTypes = new Set([
  'audio/mp4',
  'audio/mpeg',
  'audio/ogg',
  'audio/wav',
  'audio/webm',
  'video/webm',
]);
const outputSchema = z.object({ transcript: z.string().trim().min(1).max(60_000) }).strict();

export async function POST(request: Request) {
  let context: RequestContext | undefined;
  try {
    context = await authorizeAiRequest(request, 'transcribe', MAX_MULTIPART_BYTES);
    const contentType = request.headers.get('content-type') ?? '';
    if (!contentType.toLowerCase().startsWith('multipart/form-data;')) {
      throw new ApiProblem(415, 'unsupported_media_type', 'Send audio as multipart form data.');
    }

    const formData = await request.formData();
    const audio = formData.get('audio');
    if (!(audio instanceof File)) {
      throw new ApiProblem(400, 'audio_required', 'Choose an audio recording to transcribe.');
    }
    if (audio.size < 100 || audio.size > MAX_AUDIO_BYTES) {
      throw new ApiProblem(400, 'invalid_audio_size', 'Audio must be between 100 bytes and 25 MB.');
    }
    if (!allowedAudioTypes.has(audio.type.toLowerCase())) {
      throw new ApiProblem(415, 'unsupported_audio_type', 'This audio format is not supported.');
    }

    const extension = audio.type.includes('mp4')
      ? 'mp4'
      : audio.type.includes('ogg')
        ? 'ogg'
        : audio.type.includes('wav')
          ? 'wav'
          : audio.type.includes('mpeg')
            ? 'mp3'
            : 'webm';
    const providerFile = new File([audio], `capture.${extension}`, { type: audio.type });
    const transcription = await createManagedGroqClient(
      'transcription'
    ).audio.transcriptions.create({
      file: providerFile,
      model: GROQ_TRANSCRIPTION_MODEL,
      response_format: 'verbose_json',
      timestamp_granularities: ['segment'],
    });
    const output = outputSchema.parse({ transcript: transcription.text });
    const verbose = transcription as typeof transcription & {
      duration?: number;
      segments?: Array<{ end?: number }>;
    };
    const audioSeconds = Math.max(
      10,
      verbose.duration ?? 0,
      ...(verbose.segments ?? []).map((segment) => segment.end ?? 0)
    );
    await recordAiUsage(context, {
      providerRole: 'transcription',
      provider: GROQ_PROVIDER,
      modelId: GROQ_TRANSCRIPTION_MODEL,
      pricingVersion: GROQ_PRICING_VERSION,
      outcome: 'succeeded',
      audioSeconds,
      estimatedCostMicros: estimateTranscriptionCostMicros(audioSeconds),
    });
    return aiSuccess(output, context);
  } catch (error) {
    if (context) {
      await recordAiUsage(context, {
        providerRole: 'transcription',
        provider: GROQ_PROVIDER,
        modelId: GROQ_TRANSCRIPTION_MODEL,
        pricingVersion: GROQ_PRICING_VERSION,
        outcome: 'failed',
        errorCode: stableAiErrorCode(error),
      });
    }
    return aiError(error, 'transcribe');
  }
}
