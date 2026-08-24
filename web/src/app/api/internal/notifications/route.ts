import { timingSafeEqual } from 'node:crypto';
import { NextResponse } from 'next/server';
import { Resend } from 'resend';
import { buildNotificationEmail } from '@/lib/notifications/email';
import { createAdminClient } from '@/lib/supabase/admin';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type DeliveryClaim = {
  delivery_id: string;
  workspace_id: string;
  user_id: string;
  email: string;
  notification_count: number;
  delivery_on: string;
  timezone: string;
};

function authorized(request: Request) {
  const configured = process.env.CRON_SECRET;
  const provided = request.headers.get('authorization')?.replace(/^Bearer\s+/i, '');
  if (!configured || !provided) return false;
  const left = Buffer.from(configured);
  const right = Buffer.from(provided);
  return left.length === right.length && timingSafeEqual(left, right);
}

function configuredDelivery() {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.NOTIFICATION_EMAIL_FROM;
  const rawSiteUrl = process.env.NEXT_PUBLIC_APP_URL;
  if (!apiKey || !from || !rawSiteUrl) return null;
  try {
    const siteUrl = new URL(rawSiteUrl);
    return { apiKey, from, notificationsUrl: new URL('/notifications', siteUrl).toString() };
  } catch {
    return null;
  }
}

export async function POST(request: Request) {
  if (!authorized(request)) {
    return NextResponse.json({ error: 'Not authorized.' }, { status: 401 });
  }
  const delivery = configuredDelivery();
  if (!delivery) {
    return NextResponse.json({ error: 'Reminder delivery is not configured.' }, { status: 503 });
  }

  const admin = createAdminClient();
  const { data, error } = await admin.rpc('claim_notification_email_batch', { p_limit: 50 });
  if (error) {
    return NextResponse.json({ error: 'Reminder queue unavailable.' }, { status: 503 });
  }

  const resend = new Resend(delivery.apiKey);
  const claims = (data ?? []) as DeliveryClaim[];
  let sent = 0;
  for (const claim of claims) {
    const content = buildNotificationEmail(claim.notification_count, delivery.notificationsUrl);
    const response = await resend.emails
      .send(
        {
          from: delivery.from,
          to: claim.email,
          subject: content.subject,
          text: content.text,
          html: content.html,
        },
        { idempotencyKey: `planner-notification-${claim.delivery_id}` }
      )
      .catch(() => null);
    if (!response || response.error || !response.data?.id) {
      await admin
        .from('notification_email_deliveries')
        .update({
          status: 'failed',
          error_code: 'provider_error',
          next_attempt_at: new Date(Date.now() + 15 * 60_000).toISOString(),
        })
        .eq('id', claim.delivery_id)
        .eq('status', 'sending');
      continue;
    }
    await admin
      .from('notification_email_deliveries')
      .update({
        status: 'sent',
        provider_message_id: response.data.id,
        error_code: null,
        sent_at: new Date().toISOString(),
      })
      .eq('id', claim.delivery_id)
      .eq('status', 'sending');
    sent += 1;
  }

  return NextResponse.json(
    { processed: claims.length, sent },
    { headers: { 'Cache-Control': 'no-store' } }
  );
}
