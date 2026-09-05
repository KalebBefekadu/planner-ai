import { describe, expect, it } from 'vitest';
import { GENUI_MAX_BYTES, parseGenUiSpec } from '@/lib/genui/schema';
import { buildReadOnlyAssistantGenUi } from '@/lib/genui/assistant';

function validSpec() {
  return {
    schemaVersion: '1.0',
    id: 'today-summary',
    title: 'Today at a glance',
    fallbackText: 'You have one priority and two open actions today.',
    components: [
      {
        id: 'summary',
        kind: 'metric_group',
        metrics: [
          { label: 'Priorities', value: 1 },
          { label: 'Open actions', value: 2 },
        ],
      },
      {
        id: 'actions',
        kind: 'record_list',
        label: 'Open actions',
        records: [{ id: 'action-1', title: 'Draft the release note', href: '/plan' }],
      },
    ],
  };
}

describe('trusted GenUI schema', () => {
  it('accepts a bounded surface made from registered components', () => {
    const result = parseGenUiSpec(validSpec());
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.spec.components).toHaveLength(2);
  });

  it('rejects unknown components with source-preserving fallback text', () => {
    const result = parseGenUiSpec({
      ...validSpec(),
      components: [{ id: 'unsafe', kind: 'arbitrary_html', html: '<script />' }],
    });
    expect(result).toEqual({
      ok: false,
      fallback: {
        title: 'Interactive result unavailable',
        message: validSpec().fallbackText,
        reason: 'unknown_component',
      },
    });
  });

  it('rejects external links', () => {
    const spec = validSpec();
    spec.components[1] = {
      id: 'actions',
      kind: 'record_list',
      label: 'Open actions',
      records: [{ id: 'action-1', title: 'Unsafe destination', href: 'https://example.com/phish' }],
    } as never;
    const result = parseGenUiSpec(spec);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.fallback.reason).toBe('invalid_schema');
  });

  it('rejects duplicate component and record identities', () => {
    const duplicateComponents = validSpec();
    duplicateComponents.components.push({ ...duplicateComponents.components[0] });
    expect(parseGenUiSpec(duplicateComponents).ok).toBe(false);

    const duplicateRecords = validSpec();
    const list = duplicateRecords.components[1];
    if (list.kind !== 'record_list' || !('records' in list) || !Array.isArray(list.records)) {
      throw new Error('Fixture must contain a record list.');
    }
    list.records.push({ ...list.records[0] });
    expect(parseGenUiSpec(duplicateRecords).ok).toBe(false);
  });

  it('rejects oversized payloads before component validation', () => {
    const result = parseGenUiSpec({
      ...validSpec(),
      padding: 'x'.repeat(GENUI_MAX_BYTES),
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.fallback.reason).toBe('payload_too_large');
  });

  it('rejects unknown Operations', () => {
    const result = parseGenUiSpec({
      ...validSpec(),
      components: [
        {
          id: 'proposal',
          kind: 'operation_proposal',
          operationId: 'shell.execute.v1',
          input: { command: 'rm -rf /' },
          summary: 'Run a command',
          risk: 'high',
        },
      ],
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.fallback.reason).toBe('unknown_operation');
  });

  it('rejects registered Operations that are not exposed to assistant chat', () => {
    const result = parseGenUiSpec({
      ...validSpec(),
      components: [
        {
          id: 'proposal',
          kind: 'operation_proposal',
          operationId: 'workspace.onboarding-complete.v1',
          input: {},
          summary: 'Complete onboarding',
          risk: 'medium',
        },
      ],
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.fallback.reason).toBe('operation_not_available');
  });

  it('rejects an AI attempt to downgrade Operation risk', () => {
    const result = parseGenUiSpec({
      ...validSpec(),
      components: [
        {
          id: 'proposal',
          kind: 'operation_proposal',
          operationId: 'capture.create.v1',
          input: { rawText: 'Preserve this', source: 'typed' },
          summary: 'Save a capture',
          risk: 'read',
        },
      ],
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.fallback.reason).toBe('risk_mismatch');
  });

  it('validates proposed input with the real Operation schema', () => {
    const result = parseGenUiSpec({
      ...validSpec(),
      components: [
        {
          id: 'proposal',
          kind: 'operation_proposal',
          operationId: 'capture.create.v1',
          input: { rawText: '', source: 'typed', forgedWorkspaceId: 'workspace-1' },
          summary: 'Save a capture',
          risk: 'low',
        },
      ],
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.fallback.reason).toBe('invalid_operation_input');
  });

  it('accepts a valid Operation proposal without executing it', () => {
    const result = parseGenUiSpec({
      ...validSpec(),
      components: [
        {
          id: 'proposal',
          kind: 'operation_proposal',
          operationId: 'capture.create.v1',
          input: { rawText: 'Preserve this exactly', source: 'typed' },
          summary: 'Save this thought to the Inbox',
          risk: 'low',
        },
      ],
    });
    expect(result.ok).toBe(true);
  });

  it('uses a safe generic fallback when model text is absent or unbounded', () => {
    const result = parseGenUiSpec({ schemaVersion: 'future', fallbackText: 'x'.repeat(2_001) });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.fallback.message).toContain('No changes were made');
      expect(result.fallback.reason).toBe('invalid_schema');
    }
  });
});

describe('assistant read-only GenUI', () => {
  it('builds a trusted record list from resolved internal evidence', () => {
    const spec = buildReadOnlyAssistantGenUi({
      reply: 'Your weekly goal is supported by this note.',
      evidence: [
        {
          type: 'note',
          id: '123e4567-e89b-42d3-a456-426614174000',
          label: 'Weekly reflection',
          href: '/notes?note=123e4567-e89b-42d3-a456-426614174000',
        },
      ],
    });

    expect(spec).toMatchObject({
      schemaVersion: '1.0',
      components: [
        {
          kind: 'record_list',
          records: [{ title: 'Weekly reflection', subtitle: 'Note' }],
        },
      ],
    });
  });

  it('does not render GenUI without grounded evidence', () => {
    expect(buildReadOnlyAssistantGenUi({ reply: 'I need more context.', evidence: [] })).toBeNull();
  });

  it('fails closed when evidence contains an external destination', () => {
    expect(
      buildReadOnlyAssistantGenUi({
        reply: 'Source found.',
        evidence: [
          {
            type: 'note',
            id: '123e4567-e89b-42d3-a456-426614174000',
            label: 'Unsafe note',
            href: 'https://example.com',
          },
        ],
      })
    ).toBeNull();
  });
});
