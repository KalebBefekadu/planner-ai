'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : 'Voice transcription failed. Please try again.';
}

function recordingMimeType() {
  return (
    ['audio/webm', 'audio/mp4', 'audio/ogg'].find((type) => MediaRecorder.isTypeSupported(type)) ??
    ''
  );
}

export function useVoiceTranscription({ onTranscript }: { onTranscript: (text: string) => void }) {
  const [isRecording, setIsRecording] = useState(false);
  const [isTranscribing, setIsTranscribing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);

  const stop = useCallback(() => {
    const recorder = recorderRef.current;
    if (recorder?.state === 'recording') {
      setIsTranscribing(true);
      recorder.stop();
      recorder.stream.getTracks().forEach((track) => track.stop());
    }
    setIsRecording(false);
  }, []);

  useEffect(() => () => stop(), [stop]);

  const start = useCallback(async () => {
    setError(null);
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
      setError('This browser does not support microphone recording. You can still type your note.');
      return;
    }

    let stream: MediaStream | null = null;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mimeType = recordingMimeType();
      const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
      recorderRef.current = recorder;
      chunksRef.current = [];

      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) chunksRef.current.push(event.data);
      };
      recorder.onstop = async () => {
        setIsTranscribing(true);
        try {
          const audio = new Blob(chunksRef.current, { type: mimeType || 'audio/webm' });
          const formData = new FormData();
          formData.append('audio', audio, 'note.webm');
          const response = await fetch('/api/transcribe', { method: 'POST', body: formData });
          const payload = (await response.json()) as { error?: string; transcript?: string };
          if (!response.ok || !payload.transcript) {
            throw new Error(payload.error ?? 'Voice transcription failed. Please try again.');
          }
          onTranscript(payload.transcript);
        } catch (caught) {
          setError(errorMessage(caught));
        } finally {
          recorderRef.current = null;
          setIsTranscribing(false);
        }
      };
      recorder.start();
      setIsRecording(true);
    } catch (caught) {
      stream?.getTracks().forEach((track) => track.stop());
      setError(errorMessage(caught));
    }
  }, [onTranscript]);

  return { error, isRecording, isTranscribing, start, stop };
}
