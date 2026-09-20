import { notFound, redirect } from 'next/navigation';
import { getOnboardingProfile, getWorkspacePreferences } from '@/app/onboarding/actions';
import { OnboardingWizard } from '@/components/onboarding-wizard';

export default async function OnboardingPage() {
  if (process.env.PLANNER_DATA_MODEL !== 'canonical') notFound();
  const preferences = await getWorkspacePreferences();
  if (preferences.onboardingCompletedAt) redirect('/');
  const profile = await getOnboardingProfile();

  return (
    <div className="page onboarding-page">
      <header className="onboarding-heading">
        <p className="eyebrow">Welcome to Planner AI</p>
        <h1>A one-minute setup, then you&rsquo;re in.</h1>
        <p>Your direction, goals, and first actions belong inside the product—not in setup.</p>
      </header>
      <OnboardingWizard initial={preferences} profile={profile} />
    </div>
  );
}
