'use client'

import { useState } from 'react'
import { Database } from '@/types/supabase'
import { Modal } from '@/components/modal'
import { Toast, ToastContainer } from '@/components/toast'

type YearlyGoal = Database['public']['Tables']['yearly_goals']['Row']
type QuarterlyGoal = Database['public']['Tables']['quarterly_goals']['Row']
type MonthlyTask = Database['public']['Tables']['monthly_tasks']['Row']
type WeeklyAction = Database['public']['Tables']['weekly_actions']['Row']

interface GoalsData {
  vision: Database['public']['Tables']['visions']['Row'] | null
  yearly: YearlyGoal[]
  quarterly: QuarterlyGoal[]
  monthly: MonthlyTask[]
  weekly: WeeklyAction[]
}

export function GoalsUI({ initialData }: { initialData: GoalsData | null }) {
  const [data, setData] = useState<GoalsData | null>(initialData)
  const [isDeleteModalOpen, setDeleteModalOpen] = useState(false)
  const [itemToDelete, setItemToDelete] = useState<{ id: string, type: string } | null>(null)
  
  const [toasts, setToasts] = useState<{id: number, message: string, type: 'success'|'error'|'info'}[]>([])
  const toastIdRef = { current: 0 }
  const addToast = (message: string, type: 'success'|'error'|'info' = 'info') => {
    const id = ++toastIdRef.current
    setToasts(prev => [...prev, { id, message, type }])
  }

  // Ensure data exists, otherwise render Empty State
  if (!data || !data.vision) {
    return (
      <div className="animate-fade-in" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', gap: '1rem', textAlign: 'center' }}>
        <h2 style={{ fontSize: '1.5rem', fontWeight: 600 }}>No Vision Found</h2>
        <p style={{ color: 'var(--text-secondary)' }}>You must define your Life Vision before setting goals.</p>
        <a href="/vision" className="btn-primary" style={{ textDecoration: 'none' }}>Draft Vision</a>
      </div>
    )
  }

  const handleStatusToggle = (id: string, type: string, currentStatus: string) => {
    // Mock UI update for MVP
    addToast(`Toggled status for ${type}`, 'success')
  }

  const requestDelete = (id: string, type: string) => {
    setItemToDelete({ id, type })
    setDeleteModalOpen(true)
  }

  const confirmDelete = () => {
    // Mock UI delete for MVP
    if (itemToDelete) {
      addToast(`Deleted ${itemToDelete.type}`, 'success')
    }
    setDeleteModalOpen(false)
    setItemToDelete(null)
  }

  // Helper to render a goal node
  const renderNode = (item: any, type: string, indent: number) => {
    const isDone = item.status === 'completed'
    return (
      <div key={item.id} style={{ 
        display: 'flex', 
        alignItems: 'flex-start', 
        gap: '1rem', 
        marginLeft: `${indent}px`,
        padding: '0.75rem',
        backgroundColor: 'rgba(255,255,255,0.03)',
        borderLeft: `2px solid var(--border)`,
        borderRadius: '0 8px 8px 0',
        marginBottom: '0.5rem',
        opacity: isDone ? 0.5 : 1,
        transition: 'all 0.2s ease'
      }}>
        <button 
          onClick={() => handleStatusToggle(item.id, type, item.status)}
          style={{ 
            width: '20px', height: '20px', borderRadius: '50%', 
            border: `2px solid ${isDone ? 'var(--accent)' : 'var(--text-secondary)'}`, 
            backgroundColor: isDone ? 'var(--accent)' : 'transparent',
            cursor: 'pointer', flexShrink: 0, marginTop: '2px'
          }}
        />
        <div style={{ flex: 1 }}>
          <div style={{ 
            fontSize: '1rem', 
            textDecoration: isDone ? 'line-through' : 'none',
            color: isDone ? 'var(--text-secondary)' : 'var(--text-primary)'
          }}>
            {item.content}
          </div>
          <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', marginTop: '0.25rem', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
            {type}
          </div>
        </div>
        <div style={{ display: 'flex', gap: '0.5rem' }}>
          <button className="btn-secondary" style={{ padding: '0.25rem 0.5rem', fontSize: '0.75rem' }}>Verify with AI</button>
          <button onClick={() => requestDelete(item.id, type)} style={{ background: 'none', border: 'none', color: 'var(--danger)', cursor: 'pointer', fontSize: '0.85rem' }}>Delete</button>
        </div>
      </div>
    )
  }

  return (
    <div className="animate-fade-in" style={{ display: "flex", flexDirection: "column", gap: "2rem" }}>
      <header>
        <h1 style={{ fontSize: "2.5rem", fontWeight: 700, marginBottom: "0.5rem" }}>Goals Hierarchy</h1>
        <p style={{ color: "var(--text-secondary)", fontSize: "1.1rem" }}>
          Break your vision down into actionable steps.
        </p>
      </header>

      {/* Vision Anchor */}
      <div className="card" style={{ padding: '1.5rem', borderLeft: '4px solid var(--accent)' }}>
        <h3 style={{ fontSize: '0.85rem', color: 'var(--accent)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '0.5rem' }}>
          Current Vision
        </h3>
        <p style={{ fontSize: '1.1rem', fontStyle: 'italic', color: 'var(--text-secondary)' }}>"{data.vision.content}"</p>
      </div>

      {/* Hierarchy Render (Simplified for MVP UI) */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h2 style={{ fontSize: '1.25rem', fontWeight: 600 }}>Action Plan</h2>
          <button className="btn-primary" style={{ fontSize: '0.85rem', padding: '0.5rem 1rem' }}>+ Add Yearly Goal</button>
        </div>

        {data.yearly.length === 0 ? (
          <div style={{ padding: '2rem', textAlign: 'center', backgroundColor: 'rgba(255,255,255,0.03)', borderRadius: '8px', color: 'var(--text-secondary)' }}>
            No goals set yet. Add a Yearly Goal to get started!
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            {data.yearly.map(yg => {
              const qs = data.quarterly.filter(q => q.yearly_id === yg.id)
              return (
                <div key={yg.id} style={{ marginBottom: '1rem' }}>
                  {renderNode(yg, 'Yearly Goal', 0)}
                  {qs.map(q => {
                    const ms = data.monthly.filter(m => m.quarterly_id === q.id)
                    return (
                      <div key={q.id}>
                        {renderNode(q, 'Quarterly Goal', 40)}
                        {ms.map(m => {
                          const ws = data.weekly.filter(w => w.monthly_id === m.id)
                          return (
                            <div key={m.id}>
                              {renderNode(m, 'Monthly Task', 80)}
                              {ws.map(w => renderNode(w, 'Weekly Action', 120))}
                            </div>
                          )
                        })}
                      </div>
                    )
                  })}
                </div>
              )
            })}
          </div>
        )}
      </div>

      <Modal 
        isOpen={isDeleteModalOpen} 
        onClose={() => setDeleteModalOpen(false)}
        title="Confirm Deletion"
        footer={
          <>
            <button className="btn-secondary" onClick={() => setDeleteModalOpen(false)}>Cancel</button>
            <button 
              className="btn-primary" 
              style={{ backgroundColor: 'var(--danger)', borderColor: 'var(--danger)' }} 
              onClick={confirmDelete}
            >
              Delete
            </button>
          </>
        }
      >
        <p>Are you sure you want to delete this {itemToDelete?.type}? This will also soft-delete all child nodes attached to it.</p>
      </Modal>

      <ToastContainer toasts={toasts} removeToast={(id) => setToasts(prev => prev.filter(t => t.id !== id))} />
    </div>
  )
}
