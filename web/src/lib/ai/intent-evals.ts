import { MAX_TODAY_PICKS } from '@/lib/planner/choose-today';
import { MAX_WEEK_PICKS } from '@/lib/planner/plan-week';
import { MAX_BREAKDOWN_TASKS } from '@/lib/planner/breakdown';

/**
 * Whether the model behaved, as distinct from whether the guards held.
 *
 * The intent routes are defensive on purpose: `resolveTodayPicks` drops a
 * reference that is not in the list, `validateBreakdown` rejects a task object
 * carrying an id. That is the right behaviour in production and the wrong
 * thing to measure here -- evaluating the resolved output would report a model
 * that invents references as flawless, because the invention was thrown away
 * before anyone looked.
 *
 * So these read the raw completion. A guard catching a bad answer is a
 * safety property and is already covered by unit tests. Whether the model
 * needed catching is a quality property, and it is what these measure.
 */

export type IntentEvalFailure = {
  code:
    | 'invalid_output'
    | 'forbidden_text'
    | 'invented_reference'
    | 'repeated_reference'
    | 'too_many_picks'
    | 'empty_reason'
    | 'invented_duration'
    | 'missing_required_pick'
    | 'chose_forbidden_pick'
    | 'silent_overload'
    | 'intention_is_a_task'
    | 'waiting_task'
    | 'task_carries_more_than_a_title';
  message: string;
};

export type IntentEvalResult = {
  passed: boolean;
  failures: IntentEvalFailure[];
};

type BaseExpectation = {
  /** Text from the untrusted data that must never be echoed back. */
  forbiddenText?: string[];
  /** Positions the answer has to include, 1-based as the model sees them. */
  requiredRefs?: number[];
  /** Positions it must not: closed work, someone else's, already done. */
  forbiddenRefs?: number[];
  maximumPicks?: number;
};

export type PickEvalFixture = {
  id: string;
  /** The titles the model was shown, in the order it was shown them. */
  candidateTitles: string[];
  expected: BaseExpectation;
};

export type WeekEvalFixture = PickEvalFixture & {
  expected: BaseExpectation & {
    /** True when the week is over a stated capacity and has to say so. */
    requiresIntention?: boolean;
  };
};

export type BreakdownEvalFixture = {
  id: string;
  goalTitle: string;
  expected: {
    forbiddenText?: string[];
    maximumTasks?: number;
    /** Returning nothing is the right answer for a goal too vague to act on. */
    requiresNoTasks?: boolean;
  };
};

/* A duration the model made up. The prompts forbid estimating how long
   anything takes, because nothing in the workspace records it and a number
   invented here reads as a measurement.

   Quoting a candidate back is not inventing: "Run for 30 minutes" is the name
   of the task, so a reason repeating it is describing, not estimating. The
   match is only a failure when the phrase appears nowhere in what the model
   was shown. */
const DURATION =
  /\b(\d+\s*(?:m|min|mins|minute|minutes|h|hr|hrs|hour|hours)\b|an hour|half an hour|a few minutes|should take|will take|takes about|takes roughly|quick win)/gi;

function durationFailures(reasons: string[], shown: string[]): IntentEvalFailure[] {
  /* A separator no task title will contain, so a phrase cannot look quoted
     by spanning the join between two of them. */
  const corpus = shown.join(' ~|~ ').toLocaleLowerCase('en-US');
  return reasons.flatMap((reason) => {
    const matches = reason.match(DURATION) ?? [];
    return matches
      .filter((match) => !corpus.includes(match.toLocaleLowerCase('en-US')))
      .map(
        (match): IntentEvalFailure => ({
          code: 'invented_duration',
          message: `A reason estimated time that nothing in the workspace records: "${match.trim()}".`,
        })
      );
  });
}

function forbiddenTextFailures(value: unknown, forbiddenText: string[] = []): IntentEvalFailure[] {
  const output = JSON.stringify(value).toLocaleLowerCase('en-US');
  return forbiddenText.flatMap((forbidden) =>
    output.includes(forbidden.toLocaleLowerCase('en-US'))
      ? [
          {
            code: 'forbidden_text' as const,
            message: `Output repeated text from untrusted data: ${forbidden}`,
          },
        ]
      : []
  );
}

type RawPick = { ref: number; reason: string };

/** The raw shape, read permissively so that a bad answer is measurable. */
function readPicks(value: unknown): RawPick[] | null {
  if (!value || typeof value !== 'object') return null;
  const picks = (value as { picks?: unknown }).picks;
  if (!Array.isArray(picks)) return null;
  const out: RawPick[] = [];
  for (const entry of picks) {
    if (!entry || typeof entry !== 'object') return null;
    const { ref, reason } = entry as { ref?: unknown; reason?: unknown };
    if (typeof ref !== 'number' || !Number.isInteger(ref)) return null;
    out.push({ ref, reason: typeof reason === 'string' ? reason : '' });
  }
  return out;
}

function pickFailures(
  picks: RawPick[],
  fixture: PickEvalFixture,
  cap: number
): IntentEvalFailure[] {
  const failures: IntentEvalFailure[] = [];
  const count = fixture.candidateTitles.length;
  const seen = new Set<number>();

  for (const pick of picks) {
    if (pick.ref < 1 || pick.ref > count) {
      failures.push({
        code: 'invented_reference',
        message: `Answered with position ${pick.ref}, which was not in the list of ${count}.`,
      });
      continue;
    }
    if (seen.has(pick.ref)) {
      failures.push({
        code: 'repeated_reference',
        message: `Position ${pick.ref} was chosen more than once.`,
      });
    }
    seen.add(pick.ref);
    if (!pick.reason.trim()) {
      failures.push({
        code: 'empty_reason',
        message: `Position ${pick.ref} was chosen without saying why.`,
      });
    }
  }

  const limit = fixture.expected.maximumPicks ?? cap;
  if (picks.length > limit) {
    failures.push({
      code: 'too_many_picks',
      message: `Chose ${picks.length} items when at most ${limit} was right.`,
    });
  }
  for (const required of fixture.expected.requiredRefs ?? []) {
    if (!seen.has(required)) {
      failures.push({
        code: 'missing_required_pick',
        message: `Left out position ${required} ("${fixture.candidateTitles[required - 1]}"), which the day called for.`,
      });
    }
  }
  for (const forbidden of fixture.expected.forbiddenRefs ?? []) {
    if (seen.has(forbidden)) {
      failures.push({
        code: 'chose_forbidden_pick',
        message: `Chose position ${forbidden} ("${fixture.candidateTitles[forbidden - 1]}"), which it should not have.`,
      });
    }
  }

  failures.push(
    ...durationFailures(
      picks.map((pick) => pick.reason),
      fixture.candidateTitles
    )
  );
  return failures;
}

export function evaluateChooseTodayOutput(
  fixture: PickEvalFixture,
  value: unknown
): IntentEvalResult {
  const picks = readPicks(value);
  if (!picks) {
    return {
      passed: false,
      failures: [{ code: 'invalid_output', message: 'The answer was not a list of picks.' }],
    };
  }
  const failures = [
    ...forbiddenTextFailures(value, fixture.expected.forbiddenText),
    ...pickFailures(picks, fixture, MAX_TODAY_PICKS),
  ];
  return { passed: failures.length === 0, failures };
}

/* A week's sentence is about the week. "Finish the kitchen" is a task wearing
   a sentence's clothes, and accepting one would put work in the plan that
   nobody chose by choosing an intention. */
const IMPERATIVE_OPENER =
  /^(finish|do|call|send|write|book|buy|email|schedule|complete|start|review|draft|fix|clean|sort|order|pay)\b/i;

export function evaluatePlanWeekOutput(fixture: WeekEvalFixture, value: unknown): IntentEvalResult {
  const picks = readPicks(value);
  if (!picks || !value || typeof value !== 'object' || !('intention' in value)) {
    return {
      passed: false,
      failures: [
        { code: 'invalid_output', message: 'The answer was not an intention and a list of picks.' },
      ],
    };
  }
  const intention = (value as { intention?: unknown }).intention;
  const failures = [
    ...forbiddenTextFailures(value, fixture.expected.forbiddenText),
    ...pickFailures(picks, fixture, MAX_WEEK_PICKS),
  ];

  const sentence = typeof intention === 'string' ? intention.trim() : '';
  if (sentence && IMPERATIVE_OPENER.test(sentence)) {
    failures.push({
      code: 'intention_is_a_task',
      message: `The week's sentence reads as a task rather than a description of the week: "${sentence}".`,
    });
  }
  if (fixture.expected.requiresIntention && !sentence) {
    failures.push({
      code: 'silent_overload',
      message: 'The week was over its stated capacity and the answer trimmed it without saying so.',
    });
  }
  failures.push(...durationFailures(sentence ? [sentence] : [], fixture.candidateTitles));
  return { passed: failures.length === 0, failures };
}

/* Work that has no next action the person controls. The prompt rules these
   out by name, because a list of them looks like a plan and cannot be done. */
const WAITING = /^(wait|waiting|monitor|keep an eye|follow up on whether|check whether|see if)\b/i;

export function evaluateBreakdownOutput(
  fixture: BreakdownEvalFixture,
  value: unknown
): IntentEvalResult {
  if (!value || typeof value !== 'object' || !Array.isArray((value as { tasks?: unknown }).tasks)) {
    return {
      passed: false,
      failures: [{ code: 'invalid_output', message: 'The answer was not a list of tasks.' }],
    };
  }
  const tasks = (value as { tasks: unknown[] }).tasks;
  const failures = forbiddenTextFailures(value, fixture.expected.forbiddenText);
  const titles: string[] = [];

  for (const task of tasks) {
    if (!task || typeof task !== 'object') {
      failures.push({ code: 'invalid_output', message: 'A task was not an object.' });
      continue;
    }
    const keys = Object.keys(task as Record<string, unknown>);
    if (keys.length !== 1 || keys[0] !== 'title') {
      failures.push({
        code: 'task_carries_more_than_a_title',
        message: `A task carried ${keys.join(', ')}; every date and identifier is computed, never taken from the model.`,
      });
    }
    const title = (task as { title?: unknown }).title;
    if (typeof title !== 'string' || !title.trim()) {
      failures.push({ code: 'invalid_output', message: 'A task had no usable title.' });
      continue;
    }
    titles.push(title);
    if (WAITING.test(title.trim())) {
      failures.push({
        code: 'waiting_task',
        message: `"${title}" is waiting rather than doing, and has no next action the person controls.`,
      });
    }
  }

  const maximum = fixture.expected.maximumTasks ?? MAX_BREAKDOWN_TASKS;
  if (titles.length > maximum) {
    failures.push({
      code: 'too_many_picks',
      message: `Proposed ${titles.length} tasks when at most ${maximum} was right.`,
    });
  }
  if (fixture.expected.requiresNoTasks && titles.length > 0) {
    failures.push({
      code: 'too_many_picks',
      message: `Proposed ${titles.length} tasks for a goal too vague to act on; nothing was the right answer.`,
    });
  }
  failures.push(...durationFailures(titles, [fixture.goalTitle]));
  return { passed: failures.length === 0, failures };
}
