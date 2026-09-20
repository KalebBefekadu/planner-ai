'use client';

import { Eye, EyeOff } from 'lucide-react';
import { useState } from 'react';

export function PasswordField({ invalid = false }: { invalid?: boolean }) {
  const [visible, setVisible] = useState(false);

  return (
    <div className="password-field">
      <input
        id="password"
        name="password"
        type={visible ? 'text' : 'password'}
        required
        autoComplete="current-password"
        className="input-field"
        placeholder="Enter your password"
        aria-invalid={invalid || undefined}
      />
      <button
        type="button"
        className="password-visibility"
        onClick={() => setVisible((current) => !current)}
        aria-label={visible ? 'Hide entered value' : 'Show entered value'}
        aria-pressed={visible}
      >
        {visible ? <EyeOff size={18} aria-hidden="true" /> : <Eye size={18} aria-hidden="true" />}
      </button>
    </div>
  );
}
