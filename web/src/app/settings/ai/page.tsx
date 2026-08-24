import { notFound } from 'next/navigation';
import { SettingsTabs } from '@/components/settings-tabs';
import { AiUsageDashboard, type AiUsageDashboardData } from '@/components/ai-usage-dashboard';
import { createClient } from '@/lib/supabase/server';

export default async function AiUsageSettingsPage() {
  if (process.env.PLANNER_DATA_MODEL !== 'canonical') notFound();
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) notFound();

  const { data: workspace, error: workspaceError } = await supabase
    .from('workspaces')
    .select('id,ai_soft_budget_cents')
    .eq('owner_user_id', user.id)
    .single();
  if (workspaceError || !workspace) throw new Error('Unable to load AI usage settings.');

  const now = new Date();
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const { data: events, error: eventsError } = await supabase
    .from('ai_usage_events')
    .select(
      'operation,provider_role,model_id,outcome,latency_ms,input_tokens,output_tokens,audio_seconds,estimated_cost_micros,created_at'
    )
    .eq('workspace_id', workspace.id)
    .gte('created_at', monthStart.toISOString())
    .order('created_at');
  if (eventsError) throw new Error('Unable to load AI usage history.');

  const rows = events ?? [];
  const operationNames = [
    'assistant',
    'smart_goal',
    'socratic',
    'transcribe',
    'capture_analysis',
    'review_analysis',
  ] as const;
  const data: AiUsageDashboardData = {
    softBudgetCents: Number(workspace.ai_soft_budget_cents),
    hardCapCents: 2000,
    monthStartedAt: monthStart.toISOString(),
    requests: rows.length,
    succeeded: rows.filter((event) => event.outcome === 'succeeded').length,
    estimatedCostMicros: rows.reduce(
      (total, event) => total + Number(event.estimated_cost_micros),
      0
    ),
    inputTokens: rows.reduce((total, event) => total + Number(event.input_tokens ?? 0), 0),
    outputTokens: rows.reduce((total, event) => total + Number(event.output_tokens ?? 0), 0),
    audioSeconds: rows.reduce((total, event) => total + Number(event.audio_seconds ?? 0), 0),
    operations: operationNames.map((operation) => {
      const operationRows = rows.filter((event) => event.operation === operation);
      return {
        operation,
        requests: operationRows.length,
        failures: operationRows.filter((event) => event.outcome === 'failed').length,
        averageLatencyMs: operationRows.length
          ? Math.round(
              operationRows.reduce((total, event) => total + Number(event.latency_ms), 0) /
                operationRows.length
            )
          : 0,
        estimatedCostMicros: operationRows.reduce(
          (total, event) => total + Number(event.estimated_cost_micros),
          0
        ),
      };
    }),
    days: Array.from({ length: 14 }, (_, offset) => {
      const date = new Date(now);
      date.setUTCDate(date.getUTCDate() - (13 - offset));
      const key = date.toISOString().slice(0, 10);
      const dayRows = rows.filter((event) => String(event.created_at).slice(0, 10) === key);
      return {
        date: key,
        requests: dayRows.length,
        estimatedCostMicros: dayRows.reduce(
          (total, event) => total + Number(event.estimated_cost_micros),
          0
        ),
      };
    }),
  };

  return (
    <div className="page settings-page">
      <header className="page-heading">
        <div>
          <p className="eyebrow">Settings</p>
          <h1>AI usage</h1>
          <p className="lede">See provider consumption, reliability, and spending boundaries.</p>
        </div>
      </header>
      <SettingsTabs showCanonical />
      <AiUsageDashboard initial={data} />
    </div>
  );
}
