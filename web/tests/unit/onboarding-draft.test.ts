import { describe, expect, it } from 'vitest';

import {
  draftHasWrittenWork,
  draftStorageKey,
  parseDraft,
  type OnboardingDraft,
} from '@/app/onboarding/draft';

const fallback: OnboardingDraft = {
  step: 0,
  timezone: 'Europe/Berlin',
  weekStartsOn: 1,
  weeklyReviewDay: 5,
  coachingIntensity: 'direct',
  aiEnabled: true,
  visionText: '',
  goalTitle: '',
  actionTitle: '',
  captureText: '',
};

describe('onboarding draft scope', () => {
  // A shared device can hold two accounts. Scoping by owner is what stops the
  // second person meeting the first person's half-written Vision.
  it('gives each owner a distinct key', () => {
    expect(draftStorageKey('owner-a')).not.toEqual(draftStorageKey('owner-b'));
  });
});

describe('restoring an interrupted setup', () => {
  it('returns every word the person typed', () => {
    const raw = JSON.stringify({
      step: 2,
      timezone: 'America/Chicago',
      weekStartsOn: 0,
      weeklyReviewDay: 6,
      coachingIntensity: 'strict',
      aiEnabled: false,
      visionText: '  a life with room in it  ',
      goalTitle: 'ship the beta',
      actionTitle: 'write the guide',
      captureText: 'ask Dana about pricing',
    });

    // Whitespace is preserved exactly: the wizard restores a cursor position in
    // someone's unfinished sentence, not a cleaned-up value.
    expect(parseDraft(raw, fallback)).toEqual({
      step: 2,
      timezone: 'America/Chicago',
      weekStartsOn: 0,
      weeklyReviewDay: 6,
      coachingIntensity: 'strict',
      aiEnabled: false,
      visionText: '  a life with room in it  ',
      goalTitle: 'ship the beta',
      actionTitle: 'write the guide',
      captureText: 'ask Dana about pricing',
    });
  });

  it('starts fresh when there is no draft', () => {
    expect(parseDraft(null, fallback)).toEqual(fallback);
  });

  // A draft outlives deploys, so a newer wizard can be handed one written by an
  // older build. Degrading to the server's preferences beats throwing on the
  // first render of the page a person is stuck on.
  it('falls back field by field when a stored draft is damaged or stale', () => {
    expect(parseDraft('{not json', fallback)).toEqual(fallback);
    expect(parseDraft('"a string"', fallback)).toEqual(fallback);

    const partial = parseDraft(JSON.stringify({ visionText: 'kept', goalTitle: 7 }), fallback);
    expect(partial.visionText).toBe('kept');
    expect(partial.goalTitle).toBe('');
    expect(partial.timezone).toBe('Europe/Berlin');
    expect(partial.coachingIntensity).toBe('direct');
    expect(partial.aiEnabled).toBe(true);
  });

  // A step index out of range would render a blank wizard with no way forward.
  it('refuses a step that is not a real step', () => {
    expect(parseDraft(JSON.stringify({ step: 9 }), fallback).step).toBe(0);
    expect(parseDraft(JSON.stringify({ step: -1 }), fallback).step).toBe(0);
    expect(parseDraft(JSON.stringify({ step: 1.5 }), fallback).step).toBe(0);
  });

  it('refuses a weekday outside the week', () => {
    expect(parseDraft(JSON.stringify({ weekStartsOn: 12 }), fallback).weekStartsOn).toBe(1);
    expect(
      parseDraft(JSON.stringify({ weeklyReviewDay: 'friday' }), fallback).weeklyReviewDay
    ).toBe(5);
  });

  it('refuses a coaching intensity the product does not offer', () => {
    expect(
      parseDraft(JSON.stringify({ coachingIntensity: 'brutal' }), fallback).coachingIntensity
    ).toBe('direct');
  });
});

describe('announcing a restored draft', () => {
  // Preferences arrive pre-filled from the Workspace, so a draft carrying only
  // those looks identical to a fresh start. Saying "we kept your work" then
  // would be noise about work that does not exist.
  it('stays quiet when only preferences were stored', () => {
    expect(draftHasWrittenWork(fallback)).toBe(false);
    expect(draftHasWrittenWork({ ...fallback, aiEnabled: false, step: 2 })).toBe(false);
    expect(draftHasWrittenWork({ ...fallback, visionText: '   ' })).toBe(false);
  });

  it('speaks up when any written material was kept', () => {
    expect(draftHasWrittenWork({ ...fallback, visionText: 'a' })).toBe(true);
    expect(draftHasWrittenWork({ ...fallback, goalTitle: 'a' })).toBe(true);
    expect(draftHasWrittenWork({ ...fallback, actionTitle: 'a' })).toBe(true);
    expect(draftHasWrittenWork({ ...fallback, captureText: 'a' })).toBe(true);
  });
});
