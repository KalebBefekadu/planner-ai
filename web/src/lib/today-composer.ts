import { addCalendarDays, plannerWeekStart } from '@/lib/planner-calendar';

// Creating an Action from Today has to decide two separate things: which
// planning horizon the Action belongs to, and whether it may join today's
// focus. Both depend on the workspace's local date rather than the server's,
// and both have to behave the same way when a request is retried across a
// midnight or week boundary. Keeping the decision here makes those boundaries
// testable without a database.

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;
const REQUEST_KEY = /^[A-Za-z0-9-]{8,150}$/;

export type TodayComposerInput = {
  title: string;
  goalId: string | null;
  scheduledOn: string;
  focus: boolean;
  requestKey: string;
};

export type TodayFocusIntent = 'commit' | 'other-day' | 'not-requested';

export type TodayComposerPlan = {
  create: {
    title: string;
    horizonKind: 'week';
    startsOn: string;
    endsOn: string;
    goalId: string | null;
    parentActionId: null;
    scheduledOn: string;
  };
  focusIntent: TodayFocusIntent;
  idempotencyKey: string;
};

export class TodayComposerInputError extends Error {}

export function planTodayAction(input: TodayComposerInput, localDate: string): TodayComposerPlan {
  const title = input.title.trim();
  if (title.length < 3) {
    throw new TodayComposerInputError('Give this Action a title of at least three characters.');
  }
  if (title.length > 1_000) {
    throw new TodayComposerInputError('This title is too long to save.');
  }
  if (!DATE_ONLY.test(input.scheduledOn)) {
    throw new TodayComposerInputError('Choose a date for this Action.');
  }
  if (!REQUEST_KEY.test(input.requestKey)) {
    throw new TodayComposerInputError('This request cannot be retried safely.');
  }

  // Throws on a date that matches the shape but is not a real calendar day.
  const startsOn = plannerWeekStart(input.scheduledOn);

  return {
    create: {
      title,
      horizonKind: 'week',
      startsOn,
      endsOn: addCalendarDays(startsOn, 6),
      goalId: input.goalId || null,
      parentActionId: null,
      scheduledOn: input.scheduledOn,
    },
    // Focus is a commitment about one specific day. An Action scheduled for
    // another day is created and left in the open list rather than quietly
    // joining a focus list it does not belong to.
    focusIntent: !input.focus
      ? 'not-requested'
      : input.scheduledOn === localDate
        ? 'commit'
        : 'other-day',
    idempotencyKey: `today-create:${input.requestKey}`,
  };
}

export const TODAY_FOCUS_CAPACITY = 5;

export type TodayFocusOutcome =
  | 'committed'
  | 'already-committed'
  | 'not-requested'
  | 'other-day'
  | 'full'
  | 'failed';

export function nextFocusIds(current: string[], actionId: string): string[] | 'full' | 'present' {
  if (current.includes(actionId)) return 'present';
  if (current.length >= TODAY_FOCUS_CAPACITY) return 'full';
  return [...current, actionId];
}
