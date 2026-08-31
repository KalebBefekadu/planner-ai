import Link from 'next/link';
import { PerimeterMessage, PerimeterShell } from '@/components/perimeter-shell';
import { login, loginWithGoogle } from '../auth/actions';

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ message?: string; returnTo?: string }>;
}) {
  const { message, returnTo } = await searchParams;
  const safeReturnTo = returnTo?.startsWith('/') && !returnTo.startsWith('//') ? returnTo : '/';

  return (
    <PerimeterShell>
      <div className="perimeter-form">
        <h1>Welcome back</h1>
        <p className="perimeter-lede">Pick up where you left off.</p>

        {message && <PerimeterMessage message={message} tone="error" />}

        <form action={login} className="perimeter-form">
          <input type="hidden" name="returnTo" value={safeReturnTo} />

          <label htmlFor="email">Email</label>
          <input
            id="email"
            name="email"
            type="email"
            required
            autoComplete="email"
            className="input-field"
            placeholder="you@example.com"
            aria-invalid={message ? true : undefined}
          />

          <div className="perimeter-label-row">
            <label htmlFor="password">Password</label>
            <Link href="/forgot-password">Forgot password?</Link>
          </div>
          <input
            id="password"
            name="password"
            type="password"
            required
            autoComplete="current-password"
            className="input-field"
            placeholder="••••••••••"
            aria-invalid={message ? true : undefined}
          />

          <button type="submit" className="btn-primary">
            Sign in
          </button>
        </form>

        <p className="perimeter-divider">
          <span>or</span>
        </p>

        <form action={loginWithGoogle}>
          <input type="hidden" name="returnTo" value={safeReturnTo} />
          <button type="submit" className="btn-secondary perimeter-provider">
            Continue with Google
          </button>
        </form>

        <p className="perimeter-switch">
          New here? <Link href="/signup">Create an account</Link>
        </p>
      </div>
    </PerimeterShell>
  );
}
