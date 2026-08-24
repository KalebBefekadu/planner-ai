import React from 'react';

interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  error?: string;
}

export function TextInput({ label, error, className, ...props }: InputProps) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem', width: '100%' }}>
      {label && (
        <label style={{ fontSize: '0.9rem', color: 'var(--text-secondary)' }}>{label}</label>
      )}
      <input
        className={`input-field ${className || ''}`}
        style={{ borderColor: error ? 'var(--danger)' : undefined }}
        {...props}
      />
      {error && <span style={{ fontSize: '0.8rem', color: 'var(--danger)' }}>{error}</span>}
    </div>
  );
}

interface TextAreaProps extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {
  label?: string;
  error?: string;
}

export function TextArea({ label, error, className, ...props }: TextAreaProps) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem', width: '100%' }}>
      {label && (
        <label style={{ fontSize: '0.9rem', color: 'var(--text-secondary)' }}>{label}</label>
      )}
      <textarea
        className={`input-field ${className || ''}`}
        style={{ borderColor: error ? 'var(--danger)' : undefined, resize: 'vertical' }}
        {...props}
      />
      {error && <span style={{ fontSize: '0.8rem', color: 'var(--danger)' }}>{error}</span>}
    </div>
  );
}
