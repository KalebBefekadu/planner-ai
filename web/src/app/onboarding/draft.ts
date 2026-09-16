/* Onboarding is the one place a person writes real material -- a Vision, a
   Goal, an Action, a Capture -- before the Workspace exists to hold it. Until
   the wizard commits, none of it has been through an Operation, so an
   interruption used to discard every word.

   A draft is deliberately not a new persistence path: nothing here reaches the
   database. It is a device-local scratch copy that lets the person pick the
   wizard back up where they left it, and the finished setup is still written by
   `workspace.onboarding-complete.v1` exactly as before. The trade is that a
   draft does not follow the person to another device -- see the note on
   `draftStorageKey`. */

export type OnboardingDraft = {
  step: number;
  timezone: string;
  weekStartsOn: number;
  weeklyReviewDay: number;
  coachingIntensity: 'calm' | 'direct' | 'strict';
  aiEnabled: boolean;
  visionText: string;
  goalTitle: string;
  actionTitle: string;
  captureText: string;
};

/* Drafts are scoped to the owner. A shared or family device can hold more than
   one account, and the second person to sign up must never be shown the first
   person's half-written Vision. */
export function draftStorageKey(userId: string) {
  return `planner-ai.onboarding-draft.${userId}`;
}

const intensities = new Set(['calm', 'direct', 'strict']);

function dayNumber(value: unknown, fallback: number) {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= 6
    ? value
    : fallback;
}

function text(value: unknown) {
  return typeof value === 'string' ? value : '';
}

/* Stored drafts are parsed defensively rather than trusted. The value survives
   deploys, so a draft written by an older build can reach a newer wizard with
   fields missing or renamed; falling back to the server's preferences field by
   field means a stale draft degrades to a normal fresh start instead of
   throwing on the first render of the page. */
export function parseDraft(raw: string | null, fallback: OnboardingDraft): OnboardingDraft {
  if (!raw) return fallback;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return fallback;
  }
  if (!parsed || typeof parsed !== 'object') return fallback;
  const draft = parsed as Record<string, unknown>;
  const step = draft.step;
  return {
    step: typeof step === 'number' && Number.isInteger(step) && step >= 0 && step <= 2 ? step : 0,
    timezone:
      typeof draft.timezone === 'string' && draft.timezone ? draft.timezone : fallback.timezone,
    weekStartsOn: dayNumber(draft.weekStartsOn, fallback.weekStartsOn),
    weeklyReviewDay: dayNumber(draft.weeklyReviewDay, fallback.weeklyReviewDay),
    coachingIntensity: intensities.has(draft.coachingIntensity as string)
      ? (draft.coachingIntensity as OnboardingDraft['coachingIntensity'])
      : fallback.coachingIntensity,
    aiEnabled: typeof draft.aiEnabled === 'boolean' ? draft.aiEnabled : fallback.aiEnabled,
    visionText: text(draft.visionText),
    goalTitle: text(draft.goalTitle),
    actionTitle: text(draft.actionTitle),
    captureText: text(draft.captureText),
  };
}

/* Whether a restored draft is worth telling the person about. Preferences
   arrive pre-filled from the Workspace, so a draft that only carries those is
   indistinguishable from a fresh start and announcing it would be noise. Words
   the person typed are the thing worth confirming was kept. */
export function draftHasWrittenWork(draft: OnboardingDraft) {
  return Boolean(
    draft.visionText.trim() ||
    draft.goalTitle.trim() ||
    draft.actionTitle.trim() ||
    draft.captureText.trim()
  );
}
