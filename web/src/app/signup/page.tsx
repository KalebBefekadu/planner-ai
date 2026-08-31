import Link from 'next/link';
import { PerimeterMessage, PerimeterShell } from '@/components/perimeter-shell';
import { signup } from '../auth/actions';

export default async function SignupPage({
  searchParams,
}: {
  searchParams: Promise<{ message: string }>;
}) {
  const message = (await searchParams).message;

  return (
    <PerimeterShell>
      <div className="perimeter-form">
        <h1>Start your workspace</h1>
        <p className="perimeter-lede">
          One private workspace. Planner AI is currently open to invited testers.
        </p>

        {message && <PerimeterMessage message={message} tone="info" />}

        <form action={signup} className="perimeter-form">
          <label htmlFor="email">Email</label>
          <input
            id="email"
            name="email"
            type="email"
            required
            autoComplete="email"
            className="input-field"
            placeholder="you@example.com"
          />

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
            aria-describedby="password-hint"
          />
          <p className="perimeter-hint" id="password-hint">
            At least 12 characters. Use something you do not use anywhere else.
          </p>

          <label htmlFor="invite_code">Invite code</label>
          <input
            id="invite_code"
            name="invite_code"
            type="password"
            required
            className="input-field"
            autoComplete="off"
            aria-describedby="invite-hint"
          />
          <p className="perimeter-hint" id="invite-hint">
            From your invitation email.
          </p>

          <button type="submit" className="btn-primary">
            Create workspace
          </button>
        </form>

        <p className="perimeter-fine">
          We never train models on your material, and everything you write stays exportable as
          Markdown.
        </p>

        <p className="perimeter-switch">
          Already have an account? <Link href="/login">Sign in</Link>
        </p>
      </div>
    </PerimeterShell>
  );
}
