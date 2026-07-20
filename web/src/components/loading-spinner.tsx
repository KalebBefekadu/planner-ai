export function LoadingSpinner({ size = 'md' }: { size?: 'sm' | 'md' | 'lg' }) {
  const sizeMap = {
    sm: '1rem',
    md: '2rem',
    lg: '3rem'
  }

  return (
    <div style={{
      display: 'inline-block',
      width: sizeMap[size],
      height: sizeMap[size],
      border: '3px solid rgba(255,255,255,0.1)',
      borderTopColor: 'var(--accent)',
      borderRadius: '50%',
      animation: 'spin 1s ease-in-out infinite'
    }}>
      <style>{`
        @keyframes spin {
          to { transform: rotate(360deg); }
        }
      `}</style>
    </div>
  )
}
