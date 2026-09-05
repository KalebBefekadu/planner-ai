import { DumpUI } from '@/components/dump-ui';
import { getTranscripts } from '@/app/actions';
import { getWorkspacePreferences } from '@/app/onboarding/actions';
import { getCaptureAnalysisJobs, getCaptureProposalQueue } from '@/app/inbox/actions';

export default async function InboxPage() {
  const [initialTranscripts, preferences, proposalBatches, analysisJobs] = await Promise.all([
    getTranscripts(20),
    process.env.PLANNER_DATA_MODEL === 'canonical' ? getWorkspacePreferences() : null,
    getCaptureProposalQueue(),
    getCaptureAnalysisJobs(),
  ]);
  return (
    <DumpUI
      initialTranscripts={initialTranscripts}
      coachingIntensity={preferences?.coachingIntensity ?? null}
      initialProposalBatches={proposalBatches}
      captureProposalsEnabled={process.env.PLANNER_DATA_MODEL === 'canonical'}
      operationJournalEnabled={
        process.env.PLANNER_DATA_MODEL === 'canonical' &&
        process.env.PLANNER_OPERATION_JOURNAL_CAPTURE === 'enabled'
      }
      initialAnalysisJobs={analysisJobs}
    />
  );
}
