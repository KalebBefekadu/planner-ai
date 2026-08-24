'use server';

import { randomUUID } from 'node:crypto';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { executeOperation, type OperationInput } from '@/lib/operations';
import { createClient } from '@/lib/supabase/server';

export type NotificationView = {
  id: string;
  kind: 'overdue_actions' | 'weekly_review' | 'recurring_actions' | 'system';
  title: string;
  body: string;
  href: string;
  visibleAt: string;
  readAt: string | null;
  version: number;
};

export type NotificationPreferences = {
  inAppEnabled: boolean;
  emailEnabled: boolean;
  emailHour: number;
  quietHoursStart: string;
  quietHoursEnd: string;
};

export type NotificationActionResult = { ok: boolean; error?: string };

function ensureCanonical() {
  if (process.env.PLANNER_DATA_MODEL !== 'canonical') {
    throw new Error('Notifications require the canonical data model.');
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

function shortTime(value: unknown) {
  return String(value ?? '').slice(0, 5);
}

export async function getNotificationCenter(): Promise<{
  notifications: NotificationView[];
  preferences: NotificationPreferences;
}> {
  const { supabase, user } = await authenticatedClient();
  const { data: workspace, error: workspaceError } = await supabase
    .from('workspaces')
    .select(
      'id,in_app_notifications_enabled,email_reminders_enabled,reminder_email_hour,quiet_hours_start,quiet_hours_end'
    )
    .eq('owner_user_id', user.id)
    .single();
  if (workspaceError || !workspace) throw new Error('Unable to load notification preferences.');
  const { data, error } = await supabase
    .from('notifications')
    .select('id,kind,title,body,href,visible_at,read_at,version')
    .eq('workspace_id', workspace.id)
    .is('dismissed_at', null)
    .lte('visible_at', new Date().toISOString())
    .order('visible_at', { ascending: false })
    .limit(100);
  if (error) throw new Error('Unable to load notifications.');

  return {
    notifications: (data ?? []).map((notification) => ({
      id: String(notification.id),
      kind: notification.kind as NotificationView['kind'],
      title: String(notification.title),
      body: String(notification.body),
      href: String(notification.href),
      visibleAt: String(notification.visible_at),
      readAt: notification.read_at ? String(notification.read_at) : null,
      version: Number(notification.version),
    })),
    preferences: {
      inAppEnabled: Boolean(workspace.in_app_notifications_enabled),
      emailEnabled: Boolean(workspace.email_reminders_enabled),
      emailHour: Number(workspace.reminder_email_hour),
      quietHoursStart: shortTime(workspace.quiet_hours_start),
      quietHoursEnd: shortTime(workspace.quiet_hours_end),
    },
  };
}

function refreshNotificationViews() {
  revalidatePath('/', 'layout');
  revalidatePath('/notifications');
  revalidatePath('/activity');
}

export async function refreshNotificationsAction(): Promise<NotificationActionResult> {
  try {
    const { supabase } = await authenticatedClient();
    await executeOperation(
      supabase,
      'notification.refresh.v1',
      {},
      {
        idempotencyKey: randomUUID(),
        surface: 'ui',
      }
    );
    refreshNotificationViews();
    return { ok: true };
  } catch {
    return { ok: false, error: 'Planner AI could not refresh notifications.' };
  }
}

async function changeNotification(
  operationId: 'notification.read.v1' | 'notification.dismiss.v1',
  id: string,
  expectedVersion: number
): Promise<NotificationActionResult> {
  const parsed = z
    .object({ id: z.uuid(), expectedVersion: z.number().int().positive() })
    .safeParse({
      id,
      expectedVersion,
    });
  if (!parsed.success) return { ok: false, error: 'This notification is no longer valid.' };
  try {
    const { supabase } = await authenticatedClient();
    await executeOperation(supabase, operationId, parsed.data, {
      idempotencyKey: randomUUID(),
      surface: 'ui',
    });
    refreshNotificationViews();
    return { ok: true };
  } catch {
    return { ok: false, error: 'The notification changed. Refresh and try again.' };
  }
}

export async function markNotificationReadAction(id: string, expectedVersion: number) {
  return changeNotification('notification.read.v1', id, expectedVersion);
}

export async function dismissNotificationAction(id: string, expectedVersion: number) {
  return changeNotification('notification.dismiss.v1', id, expectedVersion);
}

export async function saveNotificationPreferences(
  input: OperationInput<'notification.preferences.v1'>
): Promise<NotificationActionResult> {
  try {
    const { supabase } = await authenticatedClient();
    await executeOperation(supabase, 'notification.preferences.v1', input, {
      idempotencyKey: randomUUID(),
      surface: 'ui',
    });
    refreshNotificationViews();
    revalidatePath('/settings/preferences');
    return { ok: true };
  } catch {
    return { ok: false, error: 'Notification preferences could not be saved.' };
  }
}
