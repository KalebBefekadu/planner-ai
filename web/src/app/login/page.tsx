import { login, loginWithGoogle } from '../auth/actions';
import Link from 'next/link';

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ message?: string; returnTo?: string }>;
}) {
  const { message, returnTo } = await searchParams;
  const safeReturnTo = returnTo?.startsWith('/') && !returnTo.startsWith('//') ? returnTo : '/';

  return (
    <div className="auth-page">
      <div className="card auth-card">
        <p className="eyebrow">Welcome back</p>
        <h1>Continue planning</h1>
        <p className="lede">Your goals, captures, and progress are waiting for you.</p>

        {message && (
          <div className="status-message status-message-error" role="alert">
            {message}
          </div>
        )}

        <form action={login} className="auth-form">
          <input type="hidden" name="returnTo" value={safeReturnTo} />
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

          <div>
            <div className="password-label">
              <label htmlFor="password">Password</label>
              <Link href="/forgot-password">Forgot Password?</Link>
            </div>
            <input
              id="password"
              name="password"
              type="password"
              required
              className="input-field"
              placeholder="••••••••"
            />
          </div>

          <button type="submit" className="btn-primary">
            Sign In
          </button>
        </form>

        <div className="auth-divider">
          <span>or</span>
        </div>
        <form action={loginWithGoogle}>
          <input type="hidden" name="returnTo" value={safeReturnTo} />
          <button type="submit" className="btn-secondary auth-provider">
            Continue with Google
          </button>
        </form>

        <div className="auth-switch">
          Don&apos;t have an account? <Link href="/signup">Sign up</Link>
        </div>
      </div>
    </div>
  );
}
