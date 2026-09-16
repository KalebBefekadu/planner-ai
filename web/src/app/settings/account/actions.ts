'use server';

import { createClient } from '@/lib/supabase/server';

export type AccountOverview = {
  email: string;
  workspaceName: string;
  timezone: string;
  createdAt: string;
};

/* The Account section only ever reports what is already true of the signed-in
   owner. It writes nothing, so it needs no Operation: every field here is
   changed somewhere that already owns it — the address in Security, the time
   zone in Preferences, the whole record in Data. */
export async function getAccountOverview(): Promise<AccountOverview> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error('Please sign in to continue.');

  const { data, error } = await supabase
    .from('workspaces')
    .select('name,timezone,created_at')
    .eq('owner_user_id', user.id)
    .single();
  if (error || !data) throw new Error('Unable to load your account.');

  return {
    email: user.email ?? '',
    workspaceName: data.name as string,
    timezone: data.timezone as string,
    createdAt: data.created_at as string,
  };
}
