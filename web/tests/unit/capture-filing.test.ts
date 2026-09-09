import { describe, expect, it } from 'vitest';

import {
  ACTION_TITLE_LIMIT,
  CaptureFilingInputError,
  captureFilingKey,
  captureFilingTitle,
  NOTE_TITLE_LIMIT,
  planCaptureAction,
  planCaptureNote,
} from '@/lib/capture-filing';

// A Capture is the words a person actually recorded. Filing it into a Note or
// an Action is the first moment those words are copied anywhere, so these tests
// are about what survives that copy -- not about how the copy is made.

describe('filing a Capture into a Note', () => {
  it('stores the recorded words byte for byte, including the parts a title cannot show', () => {
    const raw = '  rewrite the pricing intro\n\nDana said the offer is buried\ttrailing  ';
    expect(planCaptureNote(raw).bodyMarkdown).toBe(raw);
  });

  it('labels the Note with its opening line, because that is where the thought is', () => {
    const plan = planCaptureNote('call the accountant\nask about mileage too');
    expect(plan.title).toBe('call the accountant');
  });

  it('files at the top level, so nothing is buried under a Note the person did not choose', () => {
    expect(planCaptureNote('a filed thought').parentNoteId).toBeNull();
  });

  it('refuses text that is too short to be a Capture at all', () => {
    // Reaching here means the row was read wrong rather than that a person
    // typed too little -- capture.create.v1 already enforces this floor.
    expect(() => planCaptureNote('  a  ')).toThrow(CaptureFilingInputError);
  });
});

describe('filing a Capture into an Action', () => {
  it('keeps the full thought in the description when the title cannot hold it', () => {
    const raw = `${'word '.repeat(400)}end`;
    const plan = planCaptureAction('11111111-1111-4111-8111-111111111111', raw, '2026-03-11', 1);
    expect(plan.title.length).toBeLessThanOrEqual(ACTION_TITLE_LIMIT);
    expect(plan.descriptionMarkdown).toBe(raw);
  });

  it('does not repeat a short thought in both the title and the description', () => {
    const plan = planCaptureAction(
      '11111111-1111-4111-8111-111111111111',
      'book the venue deposit',
      '2026-03-11',
      1
    );
    expect(plan.title).toBe('book the venue deposit');
    expect(plan.descriptionMarkdown).toBeNull();
  });

  it('files into the week the person is living in, not the server week', () => {
    // Wednesday 11 March 2026 in a Monday-start workspace.
    const monday = planCaptureAction(
      '11111111-1111-4111-8111-111111111111',
      'ship the beta',
      '2026-03-11',
      1
    );
    expect(monday.startsOn).toBe('2026-03-09');
    expect(monday.endsOn).toBe('2026-03-15');

    // The same day in a Sunday-start workspace belongs to a different week.
    const sunday = planCaptureAction(
      '11111111-1111-4111-8111-111111111111',
      'ship the beta',
      '2026-03-11',
      0
    );
    expect(sunday.startsOn).toBe('2026-03-08');
    expect(sunday.endsOn).toBe('2026-03-14');
  });

  it('carries the Capture, so the Action and its origin are written together', () => {
    // The Operation this plan feeds writes the Action and the link back to the
    // Capture in one transaction. If the plan could lose the Capture, an Action
    // with no recorded origin would become possible again -- which is the whole
    // defect this filing path exists to close.
    const plan = planCaptureAction(
      '11111111-1111-4111-8111-111111111111',
      'ship the beta',
      '2026-03-11',
      1
    );
    expect(plan.captureId).toBe('11111111-1111-4111-8111-111111111111');
  });
});

describe('the short label made from a Capture', () => {
  it('collapses the whitespace a spoken thought arrives with', () => {
    expect(captureFilingTitle('   ask   Dana\tabout   the   quote  ', NOTE_TITLE_LIMIT)).toBe(
      'ask Dana about the quote'
    );
  });

  it('breaks a long label at a word rather than mid-word', () => {
    const title = captureFilingTitle(`${'alpha '.repeat(80)}omega`, 20);
    expect(title).toBe('alpha alpha alpha');
  });

  it('still produces a label when the opening line is one unbroken run of text', () => {
    // No word boundary to prefer, so a hard cut is the only honest answer --
    // and an empty title would fail the Note contract outright.
    expect(captureFilingTitle('x'.repeat(50), 10)).toBe('x'.repeat(10));
  });

  it('skips blank opening lines instead of producing an empty label', () => {
    expect(captureFilingTitle('\n\n  the real first line\nmore', NOTE_TITLE_LIMIT)).toBe(
      'the real first line'
    );
  });
});

describe('retrying a filing', () => {
  it('derives the same key for the same Capture and step, so a retry replays', () => {
    const first = captureFilingKey('11111111-1111-4111-8111-111111111111', 'note');
    const second = captureFilingKey('11111111-1111-4111-8111-111111111111', 'note');
    expect(first).toBe(second);
  });

  it('separates the steps of one filing, so linking cannot replay the creation', () => {
    const id = '11111111-1111-4111-8111-111111111111';
    expect(captureFilingKey(id, 'note')).not.toBe(captureFilingKey(id, 'note-link'));
  });

  it('produces a key the Operation contract will accept', () => {
    const key = captureFilingKey('11111111-1111-4111-8111-111111111111', 'action');
    expect(key.length).toBeGreaterThanOrEqual(8);
    expect(key.length).toBeLessThanOrEqual(200);
  });
});
