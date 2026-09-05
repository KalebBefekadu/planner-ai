import type { AssistantEvidence } from '@/lib/assistant/evidence';
import { parseGenUiSpec, type GenUiSpec } from '@/lib/genui/schema';

const evidenceTypeLabels: Record<AssistantEvidence['type'], string> = {
  vision: 'Vision',
  goal: 'Goal',
  action: 'Action',
  note: 'Note',
  memory: 'Memory',
};

export function buildReadOnlyAssistantGenUi(input: {
  reply: string;
  evidence: AssistantEvidence[];
}): GenUiSpec | null {
  if (input.evidence.length === 0) return null;

  const candidate = {
    schemaVersion: '1.0',
    id: 'assistant-workspace-evidence',
    title: 'Workspace evidence',
    fallbackText: input.reply.trim().slice(0, 2_000),
    components: [
      {
        id: 'workspace-records',
        kind: 'record_list',
        label: 'Records used',
        records: input.evidence.map((source) => ({
          id: `${source.type}-${source.id}`,
          title: source.label,
          subtitle: evidenceTypeLabels[source.type],
          href: source.href,
        })),
      },
    ],
  };
  const parsed = parseGenUiSpec(candidate);
  return parsed.ok ? parsed.spec : null;
}
