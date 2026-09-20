import 'server-only';

import { OperationFailure } from '@/lib/operations';
import { createClient } from '@/lib/supabase/server';

export async function requireAuthenticatedUser() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new OperationFailure('authentication_required', 'Please sign in to continue.');
  return { supabase, user };
}

export async function requireOwnedWorkspaceId() {
  const { supabase, user } = await requireAuthenticatedUser();
  const { data, error } = await supabase
    .from('workspaces')
    .select('id')
    .eq('owner_user_id', user.id)
    .single();
  if (error || !data) throw new Error('Unable to load your workspace.');
  return { supabase, workspaceId: data.id as string };
}
