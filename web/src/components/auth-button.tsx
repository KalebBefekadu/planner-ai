'use client'

import { logout } from '@/app/auth/actions'

export default function AuthButton({ email }: { email: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
      <span style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>{email}</span>
      <form action={logout}>
        <button type="submit" style={{ 
          background: 'transparent',
          border: '1px solid var(--border)',
          color: 'var(--text-primary)',
          padding: '0.4rem 0.75rem', 
          fontSize: '0.85rem',
          borderRadius: '6px',
          cursor: 'pointer'
        }}>
          Sign Out
        </button>
      </form>
    </div>
  )
}
