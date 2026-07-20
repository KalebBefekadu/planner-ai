'use client'

import { useEffect, useState } from 'react'

interface ToastProps {
  message: string
  type?: 'success' | 'error' | 'info'
  onClose: () => void
}

export function Toast({ message, type = 'info', onClose }: ToastProps) {
  useEffect(() => {
    const timer = setTimeout(() => {
      onClose()
    }, 3000)
    return () => clearTimeout(timer)
  }, [onClose])

  const colors = {
    success: 'var(--accent)',
    error: 'var(--danger)',
    info: 'var(--text-secondary)'
  }

  return (
    <div style={{
      position: 'fixed',
      bottom: '2rem',
      right: '2rem',
      backgroundColor: 'var(--card-bg)',
      backdropFilter: 'blur(10px)',
      border: `1px solid ${colors[type]}`,
      color: 'var(--text-primary)',
      padding: '1rem 1.5rem',
      borderRadius: '8px',
      boxShadow: '0 10px 25px rgba(0,0,0,0.5)',
      zIndex: 9999,
      animation: 'slideUp 0.3s ease-out forwards',
      display: 'flex',
      alignItems: 'center',
      gap: '1rem'
    }}>
      <span>{message}</span>
      <button onClick={onClose} style={{ background: 'none', border: 'none', color: 'var(--text-secondary)', cursor: 'pointer', fontSize: '1.2rem' }}>×</button>
      <style>{`
        @keyframes slideUp {
          from { transform: translateY(100%); opacity: 0; }
          to { transform: translateY(0); opacity: 1; }
        }
      `}</style>
    </div>
  )
}

// Simple toast manager (In a real app, use react-hot-toast or similar Context-based system)
export function ToastContainer({ toasts, removeToast }: { toasts: { id: number, message: string, type: 'success'|'error'|'info' }[], removeToast: (id: number) => void }) {
  return (
    <div style={{ position: 'fixed', bottom: 0, right: 0, zIndex: 9999 }}>
      {toasts.map(t => (
        <Toast key={t.id} message={t.message} type={t.type} onClose={() => removeToast(t.id)} />
      ))}
    </div>
  )
}
