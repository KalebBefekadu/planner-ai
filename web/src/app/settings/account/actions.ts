'use server';

import { createClient } from '@/lib/supabase/server';

export type AccountOverview = {
  email: string;
  displayName: string;
  avatarUrl: string | null;
  avatarColor: string;
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

  const metadata = user.user_metadata as Record<string, unknown>;
  const name = [metadata.display_name, metadata.full_name, metadata.name].find(
    (value): value is string => typeof value === 'string' && Boolean(value.trim())
  );
  const avatar = [metadata.avatar_url, metadata.picture].find(
    (value): value is string => typeof value === 'string' && value.startsWith('https://')
  );
  const allowedAvatarColors = new Set(['emerald', 'blue', 'violet', 'amber', 'rose']);
  const avatarColor =
    typeof metadata.avatar_color === 'string' && allowedAvatarColors.has(metadata.avatar_color)
      ? metadata.avatar_color
      : 'emerald';

  return {
    email: user.email ?? '',
    displayName: name?.trim() ?? '',
    avatarUrl: avatar ?? null,
    avatarColor,
    workspaceName: data.name as string,
    timezone: data.timezone as string,
    createdAt: data.created_at as string,
  };
}
