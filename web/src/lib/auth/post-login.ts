import type { SupabaseClient } from '@supabase/supabase-js';

export async function postLoginPath(
  client: Pick<SupabaseClient, 'from'>,
  userId: string,
  requestedPath: string
) {
  if (requestedPath !== '/' || process.env.PLANNER_DATA_MODEL !== 'canonical') {
    return requestedPath;
  }

  const { data, error } = await client
    .from('workspaces')
    .select('onboarding_completed_at')
    .eq('owner_user_id', userId)
    .maybeSingle();

  // Authentication should remain usable while a pending database migration is deployed.
  if (error || !data) return requestedPath;
  return data.onboarding_completed_at ? requestedPath : '/onboarding';
}
