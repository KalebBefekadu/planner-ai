import { describe, expect, it } from 'vitest';
import {
  changeKind,
  distinctObjects,
  highestRisk,
  operationLabel,
  proposedFields,
  type ProposalLike,
} from '@/lib/proposal-anatomy';

function proposal(
  partial: Partial<ProposalLike> & Pick<ProposalLike, 'operationId'>
): ProposalLike {
  return { id: crypto.randomUUID(), input: {}, risk: 'low', ...partial };
}

describe('changeKind', () => {
  it.each([
    ['goal.create.v1', 'create'],
    ['vision.upsert.v1', 'create'],
    ['action-template.materialize.v1', 'create'],
    ['action.move.v1', 'move'],
    ['capture.file-to-note.v1', 'move'],
    ['goal.archive.v1', 'remove'],
    ['capture-proposal.dismiss.v1', 'remove'],
    ['note.unlink.v1', 'remove'],
    ['note.link.v1', 'link'],
    ['note.goal-link.v1', 'link'],
    ['action.update.v1', 'update'],
    ['goal.status.v1', 'update'],
  ])('reads %s as a %s', (operationId, expected) => {
    expect(changeKind(operationId)).toBe(expected);
  });

  it('falls back to update for an operation it has never seen', () => {
    expect(changeKind('something.entirely-new.v3')).toBe('update');
  });

  it('does not mistake unlink for link', () => {
    expect(changeKind('note.unlink.v1')).not.toBe(changeKind('note.link.v1'));
  });
});

describe('highestRisk', () => {
  it('reports the most severe risk in the batch, not an average', () => {
    const items = [
      proposal({ operationId: 'a.create.v1', risk: 'low' }),
      proposal({ operationId: 'b.update.v1', risk: 'high' }),
      proposal({ operationId: 'c.update.v1', risk: 'low' }),
    ];
    expect(highestRisk(items)).toBe('high');
  });

  it('treats an empty batch as low risk', () => {
    expect(highestRisk([])).toBe('low');
  });

  it('prefers medium over low', () => {
    expect(
      highestRisk([
        proposal({ operationId: 'a.update.v1', risk: 'low' }),
        proposal({ operationId: 'b.update.v1', risk: 'medium' }),
      ])
    ).toBe('medium');
  });
});

describe('distinctObjects', () => {
  it('counts two changes to the same record once', () => {
    const items = [
      proposal({ operationId: 'goal.update.v1', input: { goalId: 'g1', title: 'A' } }),
      proposal({ operationId: 'goal.status.v1', input: { goalId: 'g1', status: 'active' } }),
    ];
    expect(distinctObjects(items)).toBe(1);
  });

  it('keeps the same id under different record types apart', () => {
    const items = [
      proposal({ operationId: 'goal.update.v1', input: { id: 'shared' } }),
      proposal({ operationId: 'note.update.v1', input: { id: 'shared' } }),
    ];
    expect(distinctObjects(items)).toBe(2);
  });

  it('treats creates with no target id as separate objects', () => {
    const items = [
      proposal({ operationId: 'action.create.v1', input: { title: 'One' } }),
      proposal({ operationId: 'action.create.v1', input: { title: 'Two' } }),
    ];
    expect(distinctObjects(items)).toBe(2);
  });
});

describe('proposedFields', () => {
  it('labels the values a person recognises', () => {
    expect(proposedFields({ title: 'Renew passport', scheduledOn: '2026-09-05' })).toEqual([
      { label: 'Title', value: 'Renew passport' },
      { label: 'Scheduled', value: '2026-09-05' },
    ]);
  });

  it('joins tag arrays rather than printing an object', () => {
    expect(proposedFields({ tags: ['home', 'admin'] })).toEqual([
      { label: 'Tags', value: 'home, admin' },
    ]);
  });

  it('leaves out empty and null values', () => {
    expect(proposedFields({ title: '', scheduledOn: null, status: 'done' })).toEqual([
      { label: 'Status', value: 'done' },
    ]);
  });

  it('omits a long note body — a proposal row is a summary, not the editor', () => {
    expect(proposedFields({ bodyMarkdown: 'x'.repeat(400) })).toEqual([]);
  });

  it('ignores keys it has no label for, rather than dumping raw json', () => {
    expect(proposedFields({ internalCursor: 'abc', title: 'Kept' })).toEqual([
      { label: 'Title', value: 'Kept' },
    ]);
  });
});

describe('operationLabel', () => {
  it('reads an operation id back as words without its version', () => {
    expect(operationLabel('action-template.materialize.v1')).toBe('Action-template Materialize');
  });
});
