import { notFound } from 'next/navigation';
import { getWorkspacePreferences } from '@/app/onboarding/actions';
import { getActiveVision } from '@/app/actions';
import { OnboardingCenter } from '@/components/onboarding-center';
import { OnboardingWizard } from '@/components/onboarding-wizard';

export default async function OnboardingPage() {
  if (process.env.PLANNER_DATA_MODEL !== 'canonical') notFound();
  const preferences = await getWorkspacePreferences();
  const vision = preferences.onboardingCompletedAt ? await getActiveVision() : null;

  if (preferences.onboardingCompletedAt) {
    return (
      <div className="page onboarding-page">
        <OnboardingCenter hasVision={Boolean(vision)} />
      </div>
    );
  }

  return (
    <div className="page onboarding-page">
      <header className="onboarding-heading">
        <p className="eyebrow">Workspace setup</p>
        <h1>Set your direction</h1>
        <p>Start with as much or as little structure as you need.</p>
      </header>
      <OnboardingWizard initial={preferences} />
    </div>
  );
}
