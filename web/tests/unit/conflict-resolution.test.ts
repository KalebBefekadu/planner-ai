import { describe, expect, it } from 'vitest';

import {
  conflictSummary,
  describeNoteConflict,
  resolveWith,
} from '@/lib/notes/conflict-resolution';

/* The comparison shown when a Note was saved somewhere else while someone was
   writing. What is being protected here is the person's ability to *check*:
   every assertion is about them being able to see what actually differs and
   choose knowingly, rather than being told to refresh. */

const mine = { title: 'Retrieval rewrite', bodyMarkdown: 'One\nTwo\nThree' };

describe('describing what differs', () => {
  it('says nothing differs when both sides hold the same text', () => {
    const conflict = describeNoteConflict(mine, { ...mine });
    expect(conflict.bodyDiffers).toBe(false);
    expect(conflict.titleDiffers).toBe(false);
    expect(conflict.changedLineCount).toBe(0);
  });

  it('keeps the lines both sides agree on, so the change is readable in context', () => {
    const conflict = describeNoteConflict(mine, {
      title: 'Retrieval rewrite',
      bodyMarkdown: 'One\nTwo changed\nThree',
    });
    expect(conflict.lines.filter((line) => line.kind === 'same').map((line) => line.text)).toEqual([
      'One',
      'Three',
    ]);
    // The altered line appears as one line from each side, not as a deletion.
    expect(conflict.lines.filter((line) => line.kind === 'mine')).toHaveLength(1);
    expect(conflict.lines.filter((line) => line.kind === 'theirs')).toHaveLength(1);
  });

  it('reports a line added on one side without claiming anything was removed', () => {
    const conflict = describeNoteConflict(mine, {
      title: mine.title,
      bodyMarkdown: 'One\nTwo\nThree\nFour',
    });
    expect(conflict.lines.filter((line) => line.kind === 'mine')).toHaveLength(0);
    expect(conflict.lines.filter((line) => line.kind === 'theirs').map((l) => l.text)).toEqual([
      'Four',
    ]);
  });

  it('does not misread a moved line as a rewrite', () => {
    /* The reason this uses a real diff rather than a positional comparison. A
       line-by-line index match would report every line after the move as
       changed, which tells someone their Note was rewritten when one paragraph
       was dragged. */
    const conflict = describeNoteConflict(
      { title: mine.title, bodyMarkdown: 'A\nB\nC\nD' },
      { title: mine.title, bodyMarkdown: 'B\nC\nD\nA' }
    );
    const shared = conflict.lines.filter((line) => line.kind === 'same').map((line) => line.text);
    expect(shared).toEqual(['B', 'C', 'D']);
    // One line moved, so one line differs -- not two, which is what counting
    // both sides of the same change would report.
    expect(conflict.changedLineCount).toBe(1);
  });

  it('notices a title change even when the body is untouched', () => {
    const conflict = describeNoteConflict(mine, {
      title: 'Retrieval rewrite, revised',
      bodyMarkdown: mine.bodyMarkdown,
    });
    expect(conflict.titleDiffers).toBe(true);
    expect(conflict.bodyDiffers).toBe(false);
  });

  it('carries line numbers from both sides, so each half can be shown against its own text', () => {
    const conflict = describeNoteConflict(mine, {
      title: mine.title,
      bodyMarkdown: 'Zero\nOne\nTwo\nThree',
    });
    const first = conflict.lines.find((line) => line.kind === 'theirs');
    expect(first).toMatchObject({ text: 'Zero', theirsLine: 1 });
    const shared = conflict.lines.find((line) => line.kind === 'same');
    expect(shared).toMatchObject({ text: 'One', mineLine: 1, theirsLine: 2 });
  });
});

describe('choosing a side', () => {
  const theirs = { title: 'Theirs', bodyMarkdown: 'Different entirely' };

  it('keeps exactly what was written, when the person keeps their own', () => {
    expect(resolveWith('mine', mine, theirs)).toEqual({
      title: mine.title,
      bodyMarkdown: mine.bodyMarkdown,
    });
  });

  it('returns the stored text rather than expecting a refresh', () => {
    /* Refreshing is what this surface exists to avoid: it is the action that
       throws away the draft. Taking the stored side has to hand back the text
       so the editor is replaced deliberately. */
    expect(resolveWith('theirs', mine, theirs)).toEqual(theirs);
  });

  it('never invents a version neither side wrote', () => {
    for (const side of ['mine', 'theirs'] as const) {
      const resolved = resolveWith(side, mine, theirs);
      expect([mine.bodyMarkdown, theirs.bodyMarkdown]).toContain(resolved.bodyMarkdown);
      expect([mine.title, theirs.title]).toContain(resolved.title);
    }
  });
});

describe('what the person is told', () => {
  it('does not claim a change when both versions are identical', () => {
    const summary = conflictSummary(describeNoteConflict(mine, { ...mine }));
    expect(summary).toContain('identical');
  });

  it('counts an edited line once, not once per side', () => {
    const summary = conflictSummary(
      describeNoteConflict(mine, { title: mine.title, bodyMarkdown: 'One\nTwo changed\nThree' })
    );
    expect(summary).toContain('1 line differs');
  });

  it('agrees its verb with a plural count', () => {
    const summary = conflictSummary(
      describeNoteConflict(mine, { title: mine.title, bodyMarkdown: 'One\nTwo\nThree\nFour\nFive' })
    );
    expect(summary).toContain('2 lines differ.');
  });

  it('counts one differing line in the singular', () => {
    const summary = conflictSummary(
      describeNoteConflict(mine, { title: mine.title, bodyMarkdown: 'One\nTwo\nThree\nFour' })
    );
    expect(summary).toContain('1 line differs');
  });

  it('names both the title and the body when both moved', () => {
    const summary = conflictSummary(
      describeNoteConflict(mine, { title: 'Other', bodyMarkdown: 'One\nTwo\nThree\nFour' })
    );
    expect(summary).toContain('the title');
    expect(summary).toContain('1 line');
  });
});
