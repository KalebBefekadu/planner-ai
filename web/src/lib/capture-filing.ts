import { addCalendarDays, plannerWeekStart } from '@/lib/planner-calendar';

// Filing a Capture by hand has to answer one awkward question: a Capture is
// whatever a person said, at whatever length, while a Note title and an Action
// title are short fields. The rule this module encodes is that shortening only
// ever happens to the label. The words themselves are copied into a field that
// can hold them -- a Note body, or an Action description -- and the Capture row
// itself is never touched, so the original recording of the thought survives
// even if the record made from it is later edited or deleted.

export const NOTE_TITLE_LIMIT = 300;
export const ACTION_TITLE_LIMIT = 1_000;
export const ACTION_DESCRIPTION_LIMIT = 50_000;

export class CaptureFilingInputError extends Error {}

export type CaptureFilingTarget = 'note' | 'action';

export type CaptureNotePlan = {
  title: string;
  bodyMarkdown: string;
  parentNoteId: null;
};

export type CaptureActionPlan = {
  create: {
    title: string;
    horizonKind: 'week';
    startsOn: string;
    endsOn: string;
    goalId: null;
    parentActionId: null;
    scheduledOn: null;
  };
  descriptionMarkdown: string | null;
};

/**
 * Derive the short label for a record made from a Capture.
 *
 * The first line is used because that is how people write: the thought leads,
 * the qualifications follow. Interior newlines and runs of whitespace collapse
 * because a title is a single line by definition, and a truncated title breaks
 * at the last word boundary so the label reads as words rather than as a word
 * cut in half. None of this touches the text that gets stored.
 */
export function captureFilingTitle(rawText: string, limit: number): string {
  const firstLine =
    rawText
      .split('\n')
      .map((line) => line.trim())
      .find((line) => line.length > 0) ?? '';
  const collapsed = firstLine.replace(/\s+/g, ' ');
  if (collapsed.length <= limit) return collapsed;
  const clipped = collapsed.slice(0, limit);
  const lastSpace = clipped.lastIndexOf(' ');
  // Only prefer the word boundary when it leaves a label worth reading. A
  // single very long word would otherwise collapse to almost nothing.
  return lastSpace > limit / 2 ? clipped.slice(0, lastSpace) : clipped;
}

function requireFileableText(rawText: string) {
  // The same floor the capture.create.v1 contract uses. A Capture below it
  // cannot exist, so reaching this branch means the row was read wrong rather
  // than that the person typed too little.
  if (rawText.trim().length < 3) {
    throw new CaptureFilingInputError('This Capture has no text to file.');
  }
}

export function planCaptureNote(rawText: string): CaptureNotePlan {
  requireFileableText(rawText);
  return {
    title: captureFilingTitle(rawText, NOTE_TITLE_LIMIT),
    // Verbatim, including leading whitespace and trailing lines. A Note made
    // from a Capture is the Capture, in a place it can be worked on.
    bodyMarkdown: rawText,
    parentNoteId: null,
  };
}

export function planCaptureAction(
  rawText: string,
  localDate: string,
  weekStartsOn: number
): CaptureActionPlan {
  requireFileableText(rawText);
  const title = captureFilingTitle(rawText, ACTION_TITLE_LIMIT);
  const startsOn = plannerWeekStart(localDate, weekStartsOn);
  return {
    create: {
      title,
      // The current week, because a thought filed today is a thought about
      // now. It is deliberately left unscheduled and unattached to a Goal:
      // deciding the day and the reason is planning work, and guessing at it
      // here would put words in the person's mouth.
      horizonKind: 'week',
      startsOn,
      endsOn: addCalendarDays(startsOn, 6),
      goalId: null,
      parentActionId: null,
      scheduledOn: null,
    },
    // A description is only worth writing when the title is not already the
    // whole thought; repeating the same sentence twice is noise.
    descriptionMarkdown:
      title === rawText.trim() ? null : rawText.slice(0, ACTION_DESCRIPTION_LIMIT),
  };
}

/**
 * A retry has to land on the record the first attempt made.
 *
 * Filing is one click on a page a person may reload, double-tap or leave
 * mid-request. Deriving the key from the Capture and the target rather than
 * from a fresh random value means the second attempt replays the first
 * Operation's receipt instead of creating a second Note or Action.
 */
export function captureFilingKey(captureId: string, step: string): string {
  return `capture-file:${step}:${captureId}`;
}
