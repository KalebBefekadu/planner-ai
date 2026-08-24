import { signup } from '../auth/actions';
import Link from 'next/link';

export default async function SignupPage({
  searchParams,
}: {
  searchParams: Promise<{ message: string }>;
}) {
  const message = (await searchParams).message;

  return (
    <div className="auth-page">
      <div className="card auth-card">
        <p className="eyebrow">A clearer way forward</p>
        <h1>Create your workspace</h1>
        <p className="lede">Planner AI is currently available to invited testers.</p>

        {message && (
          <div className="status-message" role="status">
            {message}
          </div>
        )}

        <form action={signup} className="auth-form">
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
            <label htmlFor="password">Password</label>
            <input
              id="password"
              name="password"
              type="password"
              required
              className="input-field"
              autoComplete="new-password"
              minLength={12}
              maxLength={128}
            />
          </div>

          <div>
            <label htmlFor="invite_code">Invite code</label>
            <input
              id="invite_code"
              name="invite_code"
              type="password"
              required
              className="input-field"
              autoComplete="off"
            />
          </div>

          <button type="submit" className="btn-primary">
            Sign Up
          </button>
        </form>

        <div className="auth-switch">
          Already have an account? <Link href="/login">Sign in</Link>
        </div>
      </div>
    </div>
  );
}
