'use client';

import Image from 'next/image';
import { useState, useTransition } from 'react';
import { KeyRound, Plus, ShieldCheck, Trash2 } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';

type Enrollment = { factorId: string; qrCode: string; secret: string };

function qrCodeDataUrl(svg: string) {
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}

export function MfaSettings({
  factors,
  assuranceLevel,
}: {
  factors: Array<{ id: string; friendlyName: string }>;
  assuranceLevel: 'aal1' | 'aal2' | null;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [enrollment, setEnrollment] = useState<Enrollment | null>(null);
  const [code, setCode] = useState('');
  const [stepUpCode, setStepUpCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  async function enroll() {
    setError(null);
    const supabase = createClient();
    const { data, error: enrollError } = await supabase.auth.mfa.enroll({
      factorType: 'totp',
      friendlyName: factors.length
        ? `Backup authenticator ${factors.length + 1}`
        : 'Primary authenticator',
    });
    if (enrollError) {
      setError('Unable to start authenticator enrollment.');
      return;
    }
    setEnrollment({ factorId: data.id, qrCode: data.totp.qr_code, secret: data.totp.secret });
  }

  async function verifyEnrollment() {
    if (!enrollment || code.length !== 6) return;
    setError(null);
    const supabase = createClient();
    const { error: verifyError } = await supabase.auth.mfa.challengeAndVerify({
      factorId: enrollment.factorId,
      code,
    });
    if (verifyError) {
      setError('That code was not accepted. Check your authenticator and try again.');
      return;
    }
    setEnrollment(null);
    setCode('');
    setNotice('Authenticator added.');
    router.refresh();
  }

  async function cancelEnrollment() {
    if (!enrollment) return;
    const supabase = createClient();
    await supabase.auth.mfa.unenroll({ factorId: enrollment.factorId });
    setEnrollment(null);
    setCode('');
  }

  async function stepUp(factorId: string) {
    if (stepUpCode.length !== 6) return;
    setError(null);
    const supabase = createClient();
    const { error: verifyError } = await supabase.auth.mfa.challengeAndVerify({
      factorId,
      code: stepUpCode,
    });
    if (verifyError) {
      setError('That code was not accepted.');
      return;
    }
    setStepUpCode('');
    setNotice('Sensitive actions are unlocked for this session.');
    router.refresh();
  }

  function removeFactor(factorId: string) {
    if (!window.confirm('Remove this authenticator? Keep at least one factor you can access.'))
      return;
    startTransition(async () => {
      const supabase = createClient();
      const { error: removeError } = await supabase.auth.mfa.unenroll({ factorId });
      if (removeError) {
        setError('Verify this session with an authenticator before removing a factor.');
        return;
      }
      setNotice('Authenticator removed.');
      router.refresh();
    });
  }

  return (
    <div className="security-layout">
      {notice ? (
        <p className="status-message" role="status">
          {notice}
        </p>
      ) : null}
      {error ? (
        <p className="status-message status-message-error" role="alert">
          {error}
        </p>
      ) : null}

      <section className="settings-section">
        <div className="settings-section-heading">
          <div>
            <ShieldCheck size={20} aria-hidden="true" />
            <div>
              <h2>Two-factor authentication</h2>
              <p>
                {factors.length
                  ? `${factors.length} verified authenticator${factors.length === 1 ? '' : 's'}`
                  : 'No authenticator enrolled'}
              </p>
            </div>
          </div>
          <button
            className="btn-secondary button-with-icon"
            type="button"
            onClick={() => void enroll()}
            disabled={isPending || Boolean(enrollment)}
          >
            <Plus size={15} />
            Add authenticator
          </button>
        </div>

        {factors.map((factor) => (
          <div className="factor-row" key={factor.id}>
            <div>
              <KeyRound size={17} aria-hidden="true" />
              <div>
                <strong>{factor.friendlyName}</strong>
                <span>Time-based one-time password</span>
              </div>
            </div>
            <button
              className="icon-button"
              type="button"
              title="Remove authenticator"
              aria-label={`Remove ${factor.friendlyName}`}
              onClick={() => removeFactor(factor.id)}
              disabled={isPending}
            >
              <Trash2 size={16} />
            </button>
          </div>
        ))}

        {enrollment ? (
          <div className="mfa-enrollment">
            <Image
              src={qrCodeDataUrl(enrollment.qrCode)}
              alt="Authenticator QR code"
              width={180}
              height={180}
              unoptimized
            />
            <div>
              <h3>Scan with your authenticator app</h3>
              <p>Enter the six-digit code to finish enrollment.</p>
              <label htmlFor="totp-secret">Manual key</label>
              <input
                id="totp-secret"
                className="input-field secret-field"
                type="password"
                readOnly
                value={enrollment.secret}
              />
              <label htmlFor="totp-code">Verification code</label>
              <input
                id="totp-code"
                className="input-field code-field"
                inputMode="numeric"
                autoComplete="one-time-code"
                pattern="[0-9]{6}"
                maxLength={6}
                value={code}
                onChange={(event) => setCode(event.target.value.replace(/\D/g, ''))}
              />
              <div>
                <button
                  className="btn-secondary"
                  type="button"
                  onClick={() => void cancelEnrollment()}
                >
                  Cancel
                </button>
                <button
                  className="btn-primary"
                  type="button"
                  onClick={() => void verifyEnrollment()}
                  disabled={code.length !== 6}
                >
                  Verify
                </button>
              </div>
            </div>
          </div>
        ) : null}
      </section>

      {factors.length && assuranceLevel !== 'aal2' ? (
        <section className="settings-section step-up-section">
          <div>
            <h2>Unlock sensitive actions</h2>
            <p>Enter a current code before changing identity, export, MCP, or deletion settings.</p>
          </div>
          <div>
            <input
              className="input-field code-field"
              aria-label="Authenticator code"
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={6}
              value={stepUpCode}
              onChange={(event) => setStepUpCode(event.target.value.replace(/\D/g, ''))}
            />
            <button
              className="btn-primary"
              type="button"
              onClick={() => void stepUp(factors[0].id)}
              disabled={stepUpCode.length !== 6}
            >
              Verify session
            </button>
          </div>
        </section>
      ) : null}
    </div>
  );
}
