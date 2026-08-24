import { NextResponse } from 'next/server';
import { postLoginPath } from '@/lib/auth/post-login';
import { createClient } from '@/lib/supabase/server';

function safeNextPath(value: string | null) {
  return value?.startsWith('/') && !value.startsWith('//') ? value : '/';
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get('code');
  const next = safeNextPath(url.searchParams.get('next'));

  if (code) {
    const supabase = await createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      const destination = user ? await postLoginPath(supabase, user.id, next) : next;
      return NextResponse.redirect(new URL(destination, url.origin));
    }
  }

  const loginUrl = new URL('/login', url.origin);
  loginUrl.searchParams.set(
    'message',
    'The authentication link is invalid or expired. Please try again.'
  );
  return NextResponse.redirect(loginUrl);
}
