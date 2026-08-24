import Link from 'next/link';
import { requestPasswordReset } from '../auth/actions';

export default async function ForgotPasswordPage({
  searchParams,
}: {
  searchParams: Promise<{ message?: string }>;
}) {
  const message = (await searchParams).message;
  return (
    <div className="auth-page">
      <div className="card auth-card">
        <p className="eyebrow">Account recovery</p>
        <h1>Reset password</h1>
        <p className="lede">
          Enter your email address and we&apos;ll send you a link to reset your password.
        </p>

        {message ? (
          <p className="status-message status-message-error" role="alert">
            {message}
          </p>
        ) : null}
        <form action={requestPasswordReset} className="auth-form">
          <div>
            <label htmlFor="email">Email</label>
            <input
              id="email"
              name="email"
              type="email"
              required
              className="input-field"
              placeholder="you@example.com"
            />
          </div>

          <button type="submit" className="btn-primary">
            Send Reset Link
          </button>
        </form>

        <div className="auth-switch">
          Remembered your password? <Link href="/login">Sign in</Link>
        </div>
      </div>
    </div>
  );
}
