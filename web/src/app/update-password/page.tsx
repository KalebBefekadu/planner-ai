import { updatePassword } from '@/app/auth/actions';

export default async function UpdatePasswordPage({
  searchParams,
}: {
  searchParams: Promise<{ message?: string }>;
}) {
  const message = (await searchParams).message;

  return (
    <div className="auth-page">
      <div className="card auth-card">
        <p className="eyebrow">Account security</p>
        <h1>Choose a new password</h1>
        <p className="lede">Use at least 12 characters and avoid a password you use elsewhere.</p>

        {message ? (
          <p className="status-message status-message-error" role="alert">
            {message}
          </p>
        ) : null}
        <form action={updatePassword} className="auth-form">
          <div>
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
            />
          </div>
          <div>
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
          </div>
          <button type="submit" className="btn-primary">
            Update password
          </button>
        </form>
      </div>
    </div>
  );
}
