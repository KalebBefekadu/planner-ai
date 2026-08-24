'use client';

import { logout } from '@/app/auth/actions';

export default function AuthButton({ email }: { email: string }) {
  return (
    <div className="account">
      <span className="account-email">{email}</span>
      <form action={logout}>
        <button type="submit" className="sign-out">
          Sign Out
        </button>
      </form>
    </div>
  );
}
