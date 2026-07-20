'use client'

import { useState, useRef, useEffect } from 'react'
import { Toast, ToastContainer } from '@/components/toast'
import { Database } from '@/types/supabase'
import { createClient } from '@/lib/supabase/client'

type Vision = Database['public']['Tables']['visions']['Row']

export function VisionUI({ initialVision }: { initialVision: Vision | null }) {
  const [visionText, setVisionText] = useState(initialVision?.content || '')
  const [isExpanded, setIsExpanded] = useState(false)
  const [isSaving, setIsSaving] = useState(false)
  
  // Socratic Questions State
  const [questions, setQuestions] = useState<string[]>([])
  const [isGenerating, setIsGenerating] = useState(false)
  const typingTimeoutRef = useRef<NodeJS.Timeout | null>(null)

  const [toasts, setToasts] = useState<{id: number, message: string, type: 'success'|'error'|'info'}[]>([])
  
  const toastIdRef = { current: 0 }
  const addToast = (message: string, type: 'success'|'error'|'info' = 'info') => {
    const id = ++toastIdRef.current
    setToasts(prev => [...prev, { id, message, type }])
  }

  // Fetch Questions from Groq API
  const fetchSocraticQuestions = async (textToAnalyze: string) => {
    if (textToAnalyze.trim().length < 20) return
    setIsGenerating(true)
    try {
      const res = await fetch('/api/socratic', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ visionText: textToAnalyze })
      })
      const data = await res.json()
      if (data.questions && data.questions.length > 0) {
        setQuestions(data.questions)
      }
    } catch (error) {
      console.error("Failed to generate questions")
    } finally {
      setIsGenerating(false)
    }
  }

  // Handle Text Changes & Debounce
  const handleTextChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const newText = e.target.value
    setVisionText(newText)

    if (typingTimeoutRef.current) {
      clearTimeout(typingTimeoutRef.current)
    }

    typingTimeoutRef.current = setTimeout(() => {
      fetchSocraticQuestions(newText)
    }, 5000) // 5 seconds of inactivity
  }

  // Run once on load if there's initial text
  useEffect(() => {
    if (initialVision?.content) {
      fetchSocraticQuestions(initialVision.content)
    }
  }, [initialVision])

  const handleSave = async () => {
    setIsSaving(true)
    try {
      const supabase = createClient()
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) throw new Error('Not authenticated')

      const { error } = await supabase.from('visions').insert({
        user_id: user.id,
        content: visionText
      })

      if (error) throw error
      addToast('Vision saved successfully!', 'success')
    } catch (error) {
      addToast('Failed to save vision', 'error')
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <div 
      className="animate-fade-in" 
      style={{ 
        display: "flex", 
        flexDirection: "column", 
        gap: "2rem",
        height: isExpanded ? "calc(100vh - 120px)" : "100%",
        transition: "height 0.3s ease"
      }}
    >
      {!isExpanded && (
        <header>
          <h1 style={{ fontSize: "2.5rem", fontWeight: 700, marginBottom: "0.5rem" }}>Life Vision</h1>
          <p style={{ color: "var(--text-secondary)", fontSize: "1.1rem" }}>
            Draft your ultimate North Star. What does your ideal life look like?
          </p>
        </header>
      )}

      <div style={{ flex: 1, display: "flex", gap: "2rem" }}>
        {/* Editor Area */}
        <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: "1rem" }}>
          {initialVision === null && visionText === '' && !isExpanded && (
            <div style={{ padding: '1rem', backgroundColor: 'rgba(255,255,255,0.05)', borderRadius: '8px', color: 'var(--accent)' }}>
              Welcome! You haven't written a vision yet. Start typing below to create your first North Star.
            </div>
          )}
          
          <textarea
            className="input-field"
            placeholder="In 5 years, my ideal life looks like..."
            value={visionText}
            onChange={handleTextChange}
            style={{ 
              flex: 1, 
              minHeight: isExpanded ? "100%" : "400px", 
              resize: "none",
              fontSize: "1.1rem",
              lineHeight: 1.6,
              transition: "all 0.3s ease"
            }}
          />
          
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <button 
              onClick={() => setIsExpanded(!isExpanded)}
              style={{ background: 'none', border: 'none', color: 'var(--text-secondary)', cursor: 'pointer' }}
            >
              {isExpanded ? 'Exit Focus Mode' : 'Enter Focus Mode'}
            </button>
            <button 
              onClick={handleSave} 
              className="btn-primary" 
              disabled={isSaving || !visionText.trim()}
            >
              {isSaving ? 'Saving...' : 'Save Vision'}
            </button>
          </div>
        </div>

        {/* AI Questions Sidebar */}
        {!isExpanded && (
          <div className="card" style={{ width: '300px', padding: '1.5rem', display: 'flex', flexDirection: 'column', gap: '1rem' }}>
            <h3 style={{ fontSize: '1.1rem', fontWeight: 600, borderBottom: '1px solid var(--border)', paddingBottom: '0.5rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              Socratic Guide 
              {isGenerating && <span style={{ fontSize: '0.8rem', color: 'var(--accent)', fontWeight: 400 }}>Thinking...</span>}
            </h3>
            <p style={{ fontSize: '0.9rem', color: 'var(--text-secondary)' }}>
              Based on your vision, consider these questions:
            </p>
            
            <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem', marginTop: '1rem' }}>
              {questions.length === 0 && !isGenerating && (
                <div style={{ padding: '1rem', color: 'var(--text-secondary)', fontSize: '0.9rem', textAlign: 'center' }}>
                  Write a bit more to generate deep questions.
                </div>
              )}
              
              {questions.map((q, idx) => (
                <div key={idx} className="animate-fade-in" style={{ padding: '1rem', backgroundColor: 'rgba(255,255,255,0.05)', borderRadius: '8px', fontSize: '0.9rem', borderLeft: '3px solid var(--accent)' }}>
                  "{q}"
                </div>
              ))}
            </div>

            <button 
              onClick={() => fetchSocraticQuestions(visionText)} 
              className="btn-secondary" 
              style={{ marginTop: 'auto' }}
              disabled={isGenerating || visionText.trim().length < 20}
            >
              Generate New Questions
            </button>
          </div>
        )}
      </div>

      <ToastContainer toasts={toasts} removeToast={(id) => setToasts(prev => prev.filter(t => t.id !== id))} />
    </div>
  )
}
