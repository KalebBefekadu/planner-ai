'use client'

import { useState } from 'react'
import { Toast, ToastContainer } from '@/components/toast'
import { Database } from '@/types/supabase'
import { createClient } from '@/lib/supabase/client'

type Vision = Database['public']['Tables']['visions']['Row']

export function VisionUI({ initialVision }: { initialVision: Vision | null }) {
  const [visionText, setVisionText] = useState(initialVision?.content || '')
  const [isExpanded, setIsExpanded] = useState(false)
  const [isSaving, setIsSaving] = useState(false)
  const [toasts, setToasts] = useState<{id: number, message: string, type: 'success'|'error'|'info'}[]>([])
  
  const toastIdRef = { current: 0 }
  const addToast = (message: string, type: 'success'|'error'|'info' = 'info') => {
    const id = ++toastIdRef.current
    setToasts(prev => [...prev, { id, message, type }])
  }

  const handleSave = async () => {
    setIsSaving(true)
    try {
      const supabase = createClient()
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) throw new Error('Not authenticated')

      // Insert new vision (acts as version history since we fetch the newest)
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
        height: isExpanded ? "calc(100vh - 120px)" : "100%", // 120px accounts for header/padding
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
            onChange={(e) => setVisionText(e.target.value)}
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
            <h3 style={{ fontSize: '1.1rem', fontWeight: 600, borderBottom: '1px solid var(--border)', paddingBottom: '0.5rem' }}>
              Socratic Guide (AI)
            </h3>
            <p style={{ fontSize: '0.9rem', color: 'var(--text-secondary)' }}>
              Based on your vision, consider these questions:
            </p>
            
            <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem', marginTop: '1rem' }}>
              {/* MOCK QUESTIONS FOR MVP UNTIL OPENAI IS WIRED */}
              <div style={{ padding: '1rem', backgroundColor: 'rgba(255,255,255,0.05)', borderRadius: '8px', fontSize: '0.9rem', borderLeft: '3px solid var(--accent)' }}>
                "If you achieved this tomorrow, what would you immediately miss about your current struggles?"
              </div>
              <div style={{ padding: '1rem', backgroundColor: 'rgba(255,255,255,0.05)', borderRadius: '8px', fontSize: '0.9rem', borderLeft: '3px solid var(--accent)' }}>
                "What is the underlying core value driving this desire? Are there other ways to satisfy it?"
              </div>
            </div>

            <button className="btn-secondary" style={{ marginTop: 'auto' }}>
              Generate New Questions
            </button>
          </div>
        )}
      </div>

      <ToastContainer toasts={toasts} removeToast={(id) => setToasts(prev => prev.filter(t => t.id !== id))} />
    </div>
  )
}
