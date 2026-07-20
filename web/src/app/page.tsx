"use client";

import { useState, useEffect, useRef } from "react";

const MAX_RECORDING_SECONDS = 180; // 3 minutes hard limit

export default function DumpPage() {
  const [isRecording, setIsRecording] = useState(false);
  const [transcript, setTranscript] = useState("");
  const [recordingTime, setRecordingTime] = useState(0);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);

  useEffect(() => {
    let interval: NodeJS.Timeout;
    if (isRecording) {
      interval = setInterval(() => {
        setRecordingTime((prev) => {
          if (prev >= MAX_RECORDING_SECONDS - 1) {
            handleStopRecording();
            return MAX_RECORDING_SECONDS;
          }
          return prev + 1;
        });
      }, 1000);
    } else {
      setRecordingTime(0);
    }
    return () => clearInterval(interval);
  }, [isRecording]);

  const getSupportedMimeType = () => {
    const types = [
      'audio/webm',
      'audio/mp4', // iOS Safari fallback
      'audio/ogg',
      'audio/aac'
    ];
    for (const type of types) {
      if (typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported(type)) {
        return type;
      }
    }
    return ''; // Default to whatever the browser chooses if none explicitly match
  };

  const handleStartRecording = async () => {
    // 1. Offline Toast Warning
    if (!navigator.onLine) {
      alert("⚠️ You are currently offline. Please connect to the internet to use voice transcription, or type your notes manually.");
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mimeType = getSupportedMimeType();
      
      const options = mimeType ? { mimeType } : undefined;
      const mediaRecorder = new MediaRecorder(stream, options);
      
      mediaRecorderRef.current = mediaRecorder;
      audioChunksRef.current = [];

      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          audioChunksRef.current.push(event.data);
        }
      };

      mediaRecorder.onstop = () => {
        // Final audio blob combining all chunks using the correct MIME type
        const audioBlob = new Blob(audioChunksRef.current, { type: mimeType || 'audio/webm' });
        console.log("Captured audio blob:", audioBlob);
        
        // TODO: Send audioBlob to /api/transcribe
      };

      mediaRecorder.start();
      setIsRecording(true);
      setTranscript("");
    } catch (err) {
      console.error("Microphone access denied or failed:", err);
      alert("Could not access microphone. Please check your permissions.");
    }
  };

  const handleStopRecording = () => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state === "recording") {
      mediaRecorderRef.current.stop();
      // Stop all tracks to release microphone
      mediaRecorderRef.current.stream.getTracks().forEach(track => track.stop());
    }
    
    setIsRecording(false);
    
    if (recordingTime >= MAX_RECORDING_SECONDS - 1) {
      alert("Recording stopped: 3-minute hard limit reached to optimize processing.");
    }
    
    setTranscript(" (Processing audio transcript...) ");
  };

  const formatTime = (seconds: number) => {
    const m = Math.floor(seconds / 60).toString().padStart(2, '0');
    const s = (seconds % 60).toString().padStart(2, '0');
    return `${m}:${s}`;
  };

  return (
    <div className="animate-fade-in" style={{ display: "flex", flexDirection: "column", gap: "2rem", height: "100%" }}>
      <header>
        <h1 style={{ fontSize: "2.5rem", fontWeight: 700, marginBottom: "0.5rem", letterSpacing: "-0.03em" }}>Brain Dump</h1>
        <p style={{ color: "var(--text-secondary)", fontSize: "1.1rem" }}>
          Record your daily progress. Speak freely. (3-minute limit)
        </p>
      </header>

      <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: "1rem" }}>
        <textarea
          className="input-field"
          placeholder="Your transcript will appear here..."
          value={transcript}
          onChange={(e) => setTranscript(e.target.value)}
          style={{ 
            flex: 1, 
            minHeight: "300px", 
            resize: "none",
            fontSize: "1.1rem",
            lineHeight: 1.6
          }}
        />
        <div style={{ display: "flex", justifyContent: "flex-end" }}>
          <button className="btn-primary" style={{ padding: "0.5rem 1rem", fontSize: "0.9rem" }}>
            Save Dump
          </button>
        </div>
      </div>

      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", padding: "1rem 0" }}>
        <div style={{ 
          marginBottom: "1rem", 
          fontSize: "1.25rem", 
          fontWeight: 600, 
          fontVariantNumeric: "tabular-nums",
          color: isRecording ? "var(--danger)" : "var(--text-secondary)",
          transition: "color 0.3s ease"
        }}>
          {formatTime(recordingTime)} / 03:00
        </div>
        
        <button 
          onClick={isRecording ? handleStopRecording : handleStartRecording}
          style={{
            width: "80px",
            height: "80px",
            borderRadius: "50%",
            border: "none",
            backgroundColor: isRecording ? "var(--danger)" : "var(--accent)",
            color: "white",
            cursor: "pointer",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            boxShadow: isRecording 
              ? "0 0 30px rgba(239, 68, 68, 0.4)" 
              : "0 10px 25px var(--accent-glow)",
            transition: "all 0.3s cubic-bezier(0.16, 1, 0.3, 1)",
            transform: isRecording ? "scale(1.1)" : "scale(1)"
          }}
        >
          <div style={{
            width: isRecording ? "24px" : "32px",
            height: isRecording ? "24px" : "32px",
            backgroundColor: "currentColor",
            borderRadius: isRecording ? "4px" : "50%",
            transition: "all 0.3s ease"
          }} />
        </button>
      </div>
    </div>
  );
}
