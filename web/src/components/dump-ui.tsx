'use client'

import { useState, useRef, useEffect } from 'react'
import { saveTranscript } from '@/app/actions'
import { Toast, ToastContainer } from '@/components/toast'
import { Database } from '@/types/supabase'

type Transcript = Database['public']['Tables']['transcripts']['Row']

export function DumpUI({ initialTranscripts }: { initialTranscripts: Transcript[] }) {
  const [transcripts, setTranscripts] = useState<Transcript[]>(initialTranscripts)
  const [isRecording, setIsRecording] = useState(false)
  const [transcriptText, setTranscriptText] = useState('')
  const [recordingTime, setRecordingTime] = useState(0)
  const [toasts, setToasts] = useState<{id: number, message: string, type: 'success'|'error'|'info'}[]>([])
  
  const MAX_RECORDING_SECONDS = 180
  const mediaRecorderRef = useRef<MediaRecorder | null>(null)
  const audioChunksRef = useRef<Blob[]>([])
  const toastIdRef = useRef(0)

  const addToast = (message: string, type: 'success'|'error'|'info' = 'info') => {
    const id = ++toastIdRef.current
    setToasts(prev => [...prev, { id, message, type }])
  }

  useEffect(() => {
    let interval: NodeJS.Timeout
    if (isRecording) {
      interval = setInterval(() => {
        setRecordingTime(prev => {
          if (prev >= MAX_RECORDING_SECONDS - 1) {
            handleStopRecording()
            return MAX_RECORDING_SECONDS
          }
          return prev + 1
        })
      }, 1000)
    } else {
      setRecordingTime(0)
    }
    return () => clearInterval(interval)
  }, [isRecording])

  const getSupportedMimeType = () => {
    const types = ['audio/webm', 'audio/mp4', 'audio/ogg', 'audio/aac']
    for (const type of types) {
      if (typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported(type)) return type
    }
    return ''
  }

  const handleStartRecording = async () => {
    if (!navigator.onLine) {
      addToast('You are currently offline. Please connect to the internet to use voice transcription.', 'error')
      return
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      const mimeType = getSupportedMimeType()
      const options = mimeType ? { mimeType } : undefined
      const mediaRecorder = new MediaRecorder(stream, options)
      
      mediaRecorderRef.current = mediaRecorder
      audioChunksRef.current = []

      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) audioChunksRef.current.push(event.data)
      }

      mediaRecorder.onstop = async () => {
        const audioBlob = new Blob(audioChunksRef.current, { type: mimeType || 'audio/webm' })
        addToast('Transcribing audio...', 'info')
        
        try {
          const formData = new FormData()
          formData.append('audio', audioBlob)
          
          const res = await fetch('/api/transcribe', { method: 'POST', body: formData })
          const data = await res.json()
          
          if (data.error) throw new Error(data.error)
          setTranscriptText(prev => prev ? prev + ' ' + data.transcript : data.transcript)
          addToast('Transcription complete', 'success')
        } catch (error: any) {
          addToast(error.message || 'Transcription failed', 'error')
        }
      }

      mediaRecorder.start()
      setIsRecording(true)
    } catch (err) {
      addToast('Could not access microphone.', 'error')
    }
  }

  const handleStopRecording = () => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state === "recording") {
      mediaRecorderRef.current.stop()
      mediaRecorderRef.current.stream.getTracks().forEach(track => track.stop())
    }
    setIsRecording(false)
  }

  const handleSave = async () => {
    if (!transcriptText.trim()) return
    try {
      const saved = await saveTranscript(transcriptText)
      setTranscripts(prev => [saved, ...prev])
      setTranscriptText('')
      addToast('Saved successfully', 'success')
    } catch (error) {
      addToast('Failed to save', 'error')
    }
  }

  const formatTime = (seconds: number) => {
    const m = Math.floor(seconds / 60).toString().padStart(2, '0')
    const s = (seconds % 60).toString().padStart(2, '0')
    return `${m}:${s}`
  }

  return (
    <div className="animate-fade-in" style={{ display: "flex", gap: "2rem", height: "100%" }}>
      {/* Main Content */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '2rem' }}>
        <header>
          <h1 style={{ fontSize: "2.5rem", fontWeight: 700, marginBottom: "0.5rem" }}>Brain Dump</h1>
          <p style={{ color: "var(--text-secondary)", fontSize: "1.1rem" }}>
            Record your daily progress. Speak freely. (3-minute limit)
          </p>
        </header>

        <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: "1rem" }}>
          <textarea
            className="input-field"
            placeholder="Your transcript will appear here... (You can also type manually)"
            value={transcriptText}
            onChange={(e) => setTranscriptText(e.target.value)}
            style={{ flex: 1, minHeight: "300px", resize: "none", fontSize: "1.1rem", lineHeight: 1.6 }}
          />
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <button 
              onClick={() => setTranscriptText('')}
              style={{ background: 'none', border: 'none', color: 'var(--text-secondary)', cursor: 'pointer' }}
            >
              Clear
            </button>
            <button onClick={handleSave} className="btn-primary" disabled={!transcriptText.trim()}>
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
              width: "80px", height: "80px", borderRadius: "50%", border: "none",
              backgroundColor: isRecording ? "var(--danger)" : "var(--accent)",
              color: "white", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center",
              boxShadow: isRecording ? "0 0 30px rgba(239, 68, 68, 0.4)" : "0 10px 25px var(--accent-glow)",
              transition: "all 0.3s cubic-bezier(0.16, 1, 0.3, 1)",
              transform: isRecording ? "scale(1.1)" : "scale(1)"
            }}
          >
            <div style={{
              width: isRecording ? "24px" : "32px", height: isRecording ? "24px" : "32px",
              backgroundColor: "currentColor", borderRadius: isRecording ? "4px" : "50%",
              transition: "all 0.3s ease"
            }} />
          </button>
        </div>
      </div>

      {/* Sidebar for Past Dumps */}
      <div className="card" style={{ width: '300px', padding: '1.5rem', display: 'flex', flexDirection: 'column', gap: '1rem', overflowY: 'auto' }}>
        <h3 style={{ fontSize: '1.1rem', fontWeight: 600, borderBottom: '1px solid var(--border)', paddingBottom: '0.5rem' }}>
          Recent Dumps
        </h3>
        
        {transcripts.length === 0 ? (
          <div style={{ color: 'var(--text-secondary)', fontSize: '0.9rem', textAlign: 'center', marginTop: '2rem' }}>
            No dumps yet. Start talking!
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
            {transcripts.map(t => (
              <div key={t.id} style={{ padding: '1rem', backgroundColor: 'rgba(255,255,255,0.05)', borderRadius: '8px' }}>
                <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', marginBottom: '0.5rem' }}>
                  {new Date(t.created_at).toLocaleDateString()} at {new Date(t.created_at).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}
                </div>
                <div style={{ fontSize: '0.9rem', display: '-webkit-box', WebkitLineClamp: 3, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
                  {t.raw_text}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <ToastContainer toasts={toasts} removeToast={(id) => setToasts(prev => prev.filter(t => t.id !== id))} />
    </div>
  )
}
