'use server';

import { randomUUID } from 'node:crypto';
import { revalidatePath } from 'next/cache';
import { executeOperation, type OperationInput } from '@/lib/operations';
import { createClient } from '@/lib/supabase/server';

export type WorkspacePreferences = {
  timezone: string;
  weekStartsOn: number;
  coachingIntensity: 'calm' | 'direct' | 'strict';
  aiEnabled: boolean;
  weeklyReviewDay: number;
  onboardingCompletedAt: string | null;
};

function ensureCanonical() {
  if (process.env.PLANNER_DATA_MODEL !== 'canonical') {
    throw new Error('Workspace preferences require the canonical data model.');
  }
}

async function authenticatedClient() {
  ensureCanonical();
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error('Please sign in to continue.');
  return { supabase, user };
}

export async function getWorkspacePreferences(): Promise<WorkspacePreferences> {
  const { supabase, user } = await authenticatedClient();
  const { data, error } = await supabase
    .from('workspaces')
    .select(
      'timezone,week_starts_on,coaching_intensity,ai_enabled,weekly_review_day,onboarding_completed_at'
    )
    .eq('owner_user_id', user.id)
    .single();
  if (error || !data) throw new Error('Unable to load Workspace preferences.');
  return {
    timezone: data.timezone as string,
    weekStartsOn: Number(data.week_starts_on),
    coachingIntensity: data.coaching_intensity as WorkspacePreferences['coachingIntensity'],
    aiEnabled: Boolean(data.ai_enabled),
    weeklyReviewDay: Number(data.weekly_review_day),
    onboardingCompletedAt: data.onboarding_completed_at as string | null,
  };
}

export async function saveWorkspacePreferences(input: OperationInput<'workspace.preferences.v1'>) {
  const { supabase } = await authenticatedClient();
  const result = await executeOperation(supabase, 'workspace.preferences.v1', input, {
    idempotencyKey: randomUUID(),
    surface: 'ui',
  });
  revalidatePath('/', 'layout');
  revalidatePath('/onboarding');
  revalidatePath('/settings/preferences');
  return result;
}

export async function completeGuidedOnboarding(
  input: OperationInput<'workspace.onboarding-complete.v1'>
) {
  const { supabase } = await authenticatedClient();
  const result = await executeOperation(supabase, 'workspace.onboarding-complete.v1', input, {
    idempotencyKey: randomUUID(),
    surface: 'ui',
  });
  revalidatePath('/', 'layout');
  revalidatePath('/onboarding');
  revalidatePath('/vision');
  revalidatePath('/goals');
  revalidatePath('/today');
  revalidatePath('/inbox');
  return result;
}
