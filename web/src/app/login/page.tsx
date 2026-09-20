import Link from 'next/link';
import { PasswordField } from '@/components/password-field';
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
      <section className="perimeter-form perimeter-card" aria-labelledby="login-heading">
        <p className="perimeter-mobile-brand" aria-hidden="true">
          <span className="perimeter-brand-mark">P</span>
          Planner AI
        </p>
        <h1 id="login-heading">Welcome back</h1>
        <p className="perimeter-lede">Continue planning your week.</p>

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
          <PasswordField invalid={Boolean(message)} />

          <button type="submit" className="btn-primary">
            Sign in to Planner AI
          </button>
        </form>

        <p className="perimeter-divider">
          <span>or</span>
        </p>

        <form action={loginWithGoogle}>
          <input type="hidden" name="returnTo" value={safeReturnTo} />
          <button type="submit" className="btn-secondary perimeter-provider">
            <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
              <path
                fill="currentColor"
                d="M21.6 12.23c0-.71-.06-1.23-.2-1.78H12v3.42h5.52a4.72 4.72 0 0 1-2.05 3.01l-.02.11 2.98 2.31.21.02c1.94-1.79 3.06-4.42 3.06-7.09Z"
              />
              <path
                fill="currentColor"
                opacity=".78"
                d="M12 22c2.7 0 4.97-.89 6.63-2.68l-3.17-2.44c-.85.57-1.97.97-3.46.97a6 6 0 0 1-5.67-4.15l-.1.01-3.1 2.4-.04.1A10 10 0 0 0 12 22Z"
              />
              <path
                fill="currentColor"
                opacity=".58"
                d="M6.33 13.7A6.16 6.16 0 0 1 6 11.73c0-.69.12-1.35.32-1.97v-.12L3.18 7.2l-.1.05a10 10 0 0 0 0 8.96l3.25-2.51Z"
              />
              <path
                fill="currentColor"
                opacity=".9"
                d="M12 5.61c1.88 0 3.15.81 3.88 1.48l2.82-2.76A9.58 9.58 0 0 0 12 1.73a10 10 0 0 0-8.91 5.52l3.24 2.51A6.03 6.03 0 0 1 12 5.61Z"
              />
            </svg>
            Continue with Google
          </button>
        </form>

        <p className="perimeter-switch">
          New here? <Link href="/signup">Create an account</Link>
        </p>
      </section>
    </PerimeterShell>
  );
}
