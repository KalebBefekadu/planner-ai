'use server';

import { createHash } from 'node:crypto';
import { headers } from 'next/headers';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { createAdminClient } from '@/lib/supabase/admin';
import { createClient } from '@/lib/supabase/server';
import { postLoginPath } from '@/lib/auth/post-login';

type CredentialPage = '/login' | '/signup' | '/forgot-password' | '/update-password';

function messageUrl(page: CredentialPage, message: string, returnTo?: string) {
  const params = new URLSearchParams({ message });
  if (returnTo && returnTo !== '/') params.set('returnTo', returnTo);
  return `${page}?${params.toString()}`;
}

function safeReturnTo(value: FormDataEntryValue | null) {
  return typeof value === 'string' && value.startsWith('/') && !value.startsWith('//')
    ? value
    : '/';
}

function readField(
  formData: FormData,
  key: string,
  page: CredentialPage,
  preserveWhitespace = false
) {
  const value = formData.get(key);
  if (typeof value !== 'string' || !value.trim()) {
    redirect(messageUrl(page, `Please provide your ${key.replace('_', ' ')}.`));
  }
  return preserveWhitespace ? value : value.trim();
}

function validatePassword(password: string, page: CredentialPage) {
  if (password.length < 12 || password.length > 128) {
    redirect(messageUrl(page, 'Use a password between 12 and 128 characters.'));
  }
}

async function appOrigin() {
  const configured = process.env.NEXT_PUBLIC_APP_URL;
  if (configured) return new URL(configured).origin;

  const requestHeaders = await headers();
  const origin = requestHeaders.get('origin');
  if (origin?.startsWith('http://localhost:')) return new URL(origin).origin;
  throw new Error('NEXT_PUBLIC_APP_URL must be configured.');
}

async function claimInvite(email: string, inviteCode: string) {
  const admin = createAdminClient();
  const tokenHash = createHash('sha256').update(inviteCode).digest('hex');
  const { data, error } = await admin.rpc('claim_beta_invite', {
    p_email: email.toLowerCase(),
    p_token_hash: tokenHash,
  });
  if (error || typeof data !== 'string') return null;
  return data;
}

async function releaseInvite(inviteId: string) {
  const admin = createAdminClient();
  await admin.rpc('release_beta_invite', { p_invite_id: inviteId });
}

export async function login(formData: FormData) {
  const supabase = await createClient();
  const returnTo = safeReturnTo(formData.get('returnTo'));
  const email = readField(formData, 'email', '/login').toLowerCase();
  const password = readField(formData, 'password', '/login', true);
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });

  if (error) {
    redirect(
      messageUrl(
        '/login',
        'The email or password is incorrect, or the account is not verified.',
        returnTo
      )
    );
  }

  revalidatePath('/', 'layout');
  redirect(await postLoginPath(supabase, data.user.id, returnTo));
}

export async function loginWithGoogle(formData: FormData) {
  const supabase = await createClient();
  const origin = await appOrigin();
  const returnTo = safeReturnTo(formData.get('returnTo'));
  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: 'google',
    options: {
      redirectTo: `${origin}/auth/callback?next=${encodeURIComponent(returnTo)}`,
    },
  });

  if (error || !data.url) {
    redirect(messageUrl('/login', 'Google sign-in is temporarily unavailable.', returnTo));
  }
  redirect(data.url);
}

export async function signup(formData: FormData) {
  const supabase = await createClient();
  const email = readField(formData, 'email', '/signup').toLowerCase();
  const password = readField(formData, 'password', '/signup', true);
  const inviteCode = readField(formData, 'invite_code', '/signup');
  validatePassword(password, '/signup');

  const inviteId = await claimInvite(email, inviteCode);
  if (!inviteId) {
    redirect(messageUrl('/signup', 'Signup is currently available by invitation only.'));
  }

  const origin = await appOrigin();
  const { error } = await supabase.auth.signUp({
    email,
    password,
    options: { emailRedirectTo: `${origin}/auth/callback` },
  });

  if (error) {
    await releaseInvite(inviteId);
    redirect(
      messageUrl(
        '/signup',
        'We could not create this account. Try signing in or request a new invitation.'
      )
    );
  }

  redirect(messageUrl('/login', 'Check your email to verify your account, then sign in.'));
}

export async function requestPasswordReset(formData: FormData) {
  const supabase = await createClient();
  const email = readField(formData, 'email', '/forgot-password').toLowerCase();
  const origin = await appOrigin();
  await supabase.auth.resetPasswordForEmail(email, {
    redirectTo: `${origin}/auth/callback?next=/update-password`,
  });
  redirect(
    messageUrl('/login', 'If an account exists for that email, reset instructions are on the way.')
  );
}

export async function updatePassword(formData: FormData) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect(messageUrl('/login', 'Open the password reset link again to continue.'));

  const password = readField(formData, 'password', '/update-password', true);
  const confirmation = readField(formData, 'password_confirmation', '/update-password', true);
  validatePassword(password, '/update-password');
  if (password !== confirmation) {
    redirect(messageUrl('/update-password', 'The passwords do not match.'));
  }

  const { error } = await supabase.auth.updateUser({ password });
  if (error) {
    redirect(
      messageUrl(
        '/update-password',
        'The password could not be updated. Request a new reset link and try again.'
      )
    );
  }
  redirect(messageUrl('/login', 'Password updated. Sign in with your new password.'));
}

export async function logout() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  revalidatePath('/', 'layout');
  redirect('/login');
}
