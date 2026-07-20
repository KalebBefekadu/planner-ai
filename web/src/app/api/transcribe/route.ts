import { NextResponse } from 'next/server';
import Groq from 'groq-sdk';

// explicitly configure maxDuration for Vercel to prevent Whisper API timeouts
// 60 seconds gives plenty of time for a 3-minute audio file to transcribe
export const maxDuration = 60; 

const groq = new Groq({
  apiKey: process.env.GROQ_API_KEY
});

export async function POST(request: Request) {
  try {
    const formData = await request.formData();
    const audioBlob = formData.get('audio') as Blob;
    
    if (!audioBlob) {
      return NextResponse.json({ error: "No audio file provided" }, { status: 400 });
    }

    // Limit to 25MB (Whisper limit)
    if (audioBlob.size > 25 * 1024 * 1024) {
      return NextResponse.json({ error: "Audio file exceeds 25MB limit" }, { status: 400 });
    }

    // Limit to > 100 bytes (to prevent empty/silent blobs)
    if (audioBlob.size < 100) {
      return NextResponse.json({ error: "Audio file too short or empty" }, { status: 400 });
    }

    // Convert Blob to a File object which the Groq SDK expects
    const file = new File([audioBlob], "audio.webm", { type: audioBlob.type || "audio/webm" });

    // Send to Groq Whisper
    const transcription = await groq.audio.transcriptions.create({
      file,
      model: "whisper-large-v3-turbo",
    });

    return NextResponse.json({ transcript: transcription.text });

  } catch (error: any) {
    console.error("Transcription error:", error);
    return NextResponse.json({ error: error.message || "Internal server error during transcription." }, { status: 500 });
  }
}
