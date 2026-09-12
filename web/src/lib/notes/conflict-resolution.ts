/* A version conflict is the one failure where the product currently asks the
   person to destroy their own work to recover from it.
 *
 * The save is refused because the Note changed elsewhere, and the only thing
 * said is "Refresh and try again". Refreshing is precisely what discards the
 * words just typed. The draft is kept locally (see rememberNoteDraft), so
 * nothing is actually lost -- but the person cannot see what differs, cannot
 * tell whether the other change matters, and has no way to choose. They are
 * holding two real versions of their own writing and being offered no way to
 * look at either.
 *
 * This module is the comparison, kept away from React so it can be reasoned
 * about and tested on its own. It answers two questions: what differs, and
 * what are the honest ways out.
 */

export type ConflictSide = 'mine' | 'theirs';

export type ConflictLine =
  /** Present in both versions, unchanged. */
  | { kind: 'same'; text: string; mineLine: number; theirsLine: number }
  /** Only in the draft that was refused. */
  | { kind: 'mine'; text: string; mineLine: number }
  /** Only in the version that is currently stored. */
  | { kind: 'theirs'; text: string; theirsLine: number };

export type NoteConflict = {
  titleDiffers: boolean;
  bodyDiffers: boolean;
  /** Line-by-line comparison of the body. Empty when the bodies agree. */
  lines: ConflictLine[];
  /** The headline number: how many lines of the Note differ.
   *
   * The larger of the two sides, not their sum. A line someone edited appears
   * once on each side of the comparison, and reporting that as "2 lines" tells
   * a person two lines moved when one did. Taking the larger side counts an
   * edit as one line and still counts three added lines as three. */
  changedLineCount: number;
};

export type ConflictVersion = {
  title: string;
  bodyMarkdown: string;
};

/* Longest common subsequence over lines.
 *
 * Lines rather than characters because a Note is Markdown that a person wrote
 * in paragraphs, and a character diff of prose produces something nobody can
 * read. Lines are also what the editor shows, so the comparison matches what
 * they are looking at.
 *
 * The table is O(n*m). Notes are bounded well below the size where that
 * matters, and the alternative -- a heuristic diff -- can misalign, which in
 * this surface means telling someone a line was deleted when it was moved.
 * Being slow on a Note nobody has is better than being wrong on a Note
 * somebody is trying to rescue. */
function commonSubsequence(mine: string[], theirs: string[]): number[][] {
  const table: number[][] = Array.from({ length: mine.length + 1 }, () =>
    new Array<number>(theirs.length + 1).fill(0)
  );
  for (let i = mine.length - 1; i >= 0; i -= 1) {
    for (let j = theirs.length - 1; j >= 0; j -= 1) {
      table[i][j] =
        mine[i] === theirs[j]
          ? table[i + 1][j + 1] + 1
          : Math.max(table[i + 1][j], table[i][j + 1]);
    }
  }
  return table;
}

function diffLines(mineText: string, theirsText: string): ConflictLine[] {
  const mine = mineText.split('\n');
  const theirs = theirsText.split('\n');
  const table = commonSubsequence(mine, theirs);
  const lines: ConflictLine[] = [];

  let i = 0;
  let j = 0;
  while (i < mine.length && j < theirs.length) {
    if (mine[i] === theirs[j]) {
      lines.push({ kind: 'same', text: mine[i], mineLine: i + 1, theirsLine: j + 1 });
      i += 1;
      j += 1;
    } else if (table[i + 1][j] >= table[i][j + 1]) {
      lines.push({ kind: 'mine', text: mine[i], mineLine: i + 1 });
      i += 1;
    } else {
      lines.push({ kind: 'theirs', text: theirs[j], theirsLine: j + 1 });
      j += 1;
    }
  }
  while (i < mine.length) {
    lines.push({ kind: 'mine', text: mine[i], mineLine: i + 1 });
    i += 1;
  }
  while (j < theirs.length) {
    lines.push({ kind: 'theirs', text: theirs[j], theirsLine: j + 1 });
    j += 1;
  }
  return lines;
}

export function describeNoteConflict(mine: ConflictVersion, theirs: ConflictVersion): NoteConflict {
  const bodyDiffers = mine.bodyMarkdown !== theirs.bodyMarkdown;
  const lines = bodyDiffers ? diffLines(mine.bodyMarkdown, theirs.bodyMarkdown) : [];
  return {
    titleDiffers: mine.title !== theirs.title,
    bodyDiffers,
    lines,
    changedLineCount: Math.max(
      lines.filter((line) => line.kind === 'mine').length,
      lines.filter((line) => line.kind === 'theirs').length
    ),
  };
}

/* Taking one whole side.
 *
 * Deliberately not a merge. A three-way merge needs the common ancestor, which
 * is the version the draft was based on -- and once a save has been refused
 * that version is no longer what the server holds. Producing a merge from two
 * sides alone means guessing, and guessing here silently invents a version of
 * someone's writing that neither person wrote. Choosing a side is a decision a
 * person can actually check.
 *
 * Keeping the stored version still returns the text rather than doing nothing,
 * so the caller replaces the editor contents explicitly instead of relying on
 * a refresh -- the refresh is what this whole surface exists to avoid. */
export function resolveWith(
  side: ConflictSide,
  mine: ConflictVersion,
  theirs: ConflictVersion
): ConflictVersion {
  return side === 'mine'
    ? { title: mine.title, bodyMarkdown: mine.bodyMarkdown }
    : { title: theirs.title, bodyMarkdown: theirs.bodyMarkdown };
}

/* What to say above the comparison.
 *
 * The count is the point: "3 lines differ" tells someone whether to read
 * carefully or just keep their own. A conflict where nothing differs is a real
 * case -- two saves of identical text -- and saying "changed elsewhere" there
 * would be a lie about their own writing. */
export function conflictSummary(conflict: NoteConflict): string {
  if (!conflict.bodyDiffers && !conflict.titleDiffers) {
    return 'This Note was saved elsewhere, but the text is identical. Keeping either is the same.';
  }
  const parts: string[] = [];
  if (conflict.titleDiffers) parts.push('the title');
  if (conflict.changedLineCount === 1) parts.push('1 line');
  else if (conflict.changedLineCount > 1) parts.push(`${conflict.changedLineCount} lines`);
  // One subject takes "differs", two take "differ", and so does a plural count
  // of lines. Getting this wrong is small, but it appears on a screen someone
  // reads carefully while deciding what to do with their own writing.
  const subject = parts.length === 2 ? `${parts[0]} and ${parts[1]}` : parts[0];
  const verb = parts.length === 2 || conflict.changedLineCount > 1 ? 'differ' : 'differs';
  return `This Note was saved somewhere else while you were writing. ${subject} ${verb}.`;
}
