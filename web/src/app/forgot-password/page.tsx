import Link from 'next/link';
import { PerimeterMessage, PerimeterShell } from '@/components/perimeter-shell';
import { requestPasswordReset } from '../auth/actions';

export default async function ForgotPasswordPage({
  searchParams,
}: {
  searchParams: Promise<{ message?: string }>;
}) {
  const message = (await searchParams).message;

  return (
    <PerimeterShell>
      <div className="perimeter-form">
        <p className="perimeter-back">
          <Link href="/login">← Back to sign in</Link>
        </p>

        <h1>Reset your password</h1>
        <p className="perimeter-lede">
          Enter the email you signed up with and we&rsquo;ll send a link that works once.
        </p>

        {message ? <PerimeterMessage message={message} tone="error" /> : null}

        <form action={requestPasswordReset} className="perimeter-form">
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

          <button type="submit" className="btn-primary">
            Send reset link
          </button>
        </form>

        <p className="perimeter-fine">
          If an account exists for that address, the link arrives within a minute. It works once and
          expires in an hour.
        </p>
      </div>
    </PerimeterShell>
  );
}
