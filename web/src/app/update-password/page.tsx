import { updatePassword } from '@/app/auth/actions';
import { PerimeterMessage, PerimeterShell } from '@/components/perimeter-shell';

export default async function UpdatePasswordPage({
  searchParams,
}: {
  searchParams: Promise<{ message?: string }>;
}) {
  const message = (await searchParams).message;

  return (
    <PerimeterShell>
      <div className="perimeter-form">
        <h1>Choose a new password</h1>
        <p className="perimeter-lede">
          This link works once. Once you save, you stay signed in on this device and are signed out
          everywhere else.
        </p>

        {message ? <PerimeterMessage message={message} tone="error" /> : null}

        <form action={updatePassword} className="perimeter-form">
          <label htmlFor="password">New password</label>
          <input
            id="password"
            name="password"
            type="password"
            minLength={12}
            maxLength={128}
            autoComplete="new-password"
            required
            className="input-field"
            aria-describedby="new-password-hint"
          />
          <p className="perimeter-hint" id="new-password-hint">
            At least 12 characters. Use something you do not use anywhere else.
          </p>

          <label htmlFor="password_confirmation">Confirm password</label>
          <input
            id="password_confirmation"
            name="password_confirmation"
            type="password"
            minLength={12}
            maxLength={128}
            autoComplete="new-password"
            required
            className="input-field"
          />

          <button type="submit" className="btn-primary">
            Update password
          </button>
        </form>
      </div>
    </PerimeterShell>
  );
}
