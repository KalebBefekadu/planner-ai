export type CoachingIntensity = 'calm' | 'direct' | 'strict';

export type CoachingCue = {
  label: string;
  message: string;
};

const labels: Record<CoachingIntensity, string> = {
  calm: 'Gentle prompt',
  direct: 'Recommended next move',
  strict: 'Do this next',
};

function cue(intensity: CoachingIntensity, message: string): CoachingCue {
  return { label: labels[intensity], message };
}

export function todayCoachingCue(
  intensity: CoachingIntensity,
  state: { focusCount: number; overdueCount: number; blockedCount: number }
) {
  if (state.blockedCount > 0) {
    return cue(intensity, 'Name the blocker on one Action and decide who or what can clear it.');
  }
  if (state.overdueCount > 0) {
    return cue(intensity, 'Decide the fate of one overdue Action before adding more work.');
  }
  if (state.focusCount === 0) {
    return cue(intensity, 'Choose one Action that would make today feel meaningfully complete.');
  }
  if (state.focusCount > 3) {
    return cue(
      intensity,
      'Reduce the focus list to the three Actions most likely to change the day.'
    );
  }
  return cue(intensity, 'Start the first focused Action before reconsidering the list.');
}

export function inboxCoachingCue(intensity: CoachingIntensity, captureCount: number) {
  return cue(
    intensity,
    captureCount > 0
      ? 'Turn one recent Capture into an Action or Note while its meaning is still clear.'
      : 'Capture the thought exactly as it arrived; organize it only after it is safe.'
  );
}

export function weeklyReviewCoachingCue(
  intensity: CoachingIntensity,
  state: { actionCount: number; blockedCount: number }
) {
  if (state.blockedCount > 0) {
    return cue(
      intensity,
      'Give every blocked Action a concrete reason before carrying it forward.'
    );
  }
  if (state.actionCount > 0) {
    return cue(intensity, 'Resolve every unfinished Action before choosing next week priorities.');
  }
  return cue(intensity, 'Use the quiet week to record what worked and protect it next week.');
}

export function periodReviewCoachingCue(
  intensity: CoachingIntensity,
  state: { planned: number; completed: number; blocked: number }
) {
  if (state.blocked > 0) {
    return cue(
      intensity,
      'Look for the repeated constraint behind blocked work, not just each symptom.'
    );
  }
  if (state.planned > 0 && state.completed * 2 < state.planned) {
    return cue(
      intensity,
      'Reduce the next period commitment until planned work matches real capacity.'
    );
  }
  return cue(intensity, 'Name the pattern worth repeating before setting the next target.');
}
