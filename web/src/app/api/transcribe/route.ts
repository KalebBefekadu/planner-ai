import { NextResponse } from 'next/server';

// explicitly configure maxDuration for Vercel to prevent Whisper API timeouts
// 60 seconds gives plenty of time for a 3-minute audio file to transcribe
export const maxDuration = 60; 

export async function POST(request: Request) {
  try {
    const formData = await request.formData();
    const audioFile = formData.get('audio') as Blob;
    
    if (!audioFile) {
      return NextResponse.json({ error: "No audio file provided" }, { status: 400 });
    }

    // TODO: Forward audioFile to OpenAI Whisper API
    // const transcript = await openAi.transcribe(audioFile);

    return NextResponse.json({ transcript: "This is a mock transcription because the OpenAI keys are not set up yet." });

  } catch (error) {
    console.error("Transcription error:", error);
    return NextResponse.json({ error: "Internal server error during transcription." }, { status: 500 });
  }
}
