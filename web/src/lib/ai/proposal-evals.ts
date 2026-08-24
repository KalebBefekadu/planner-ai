import {
  validateCaptureProposalAnalysis,
  type CaptureProposalAnalysis,
  type CaptureProposalOperationId,
} from '@/lib/capture-proposals';
import {
  validateReviewProposal,
  type ResolvedReviewProposal,
  type ReviewEvidence,
} from '@/lib/review-proposals';

type ProposalEvalExpectation = {
  forbiddenText?: string[];
};

export type CaptureProposalEvalFixture = {
  id: string;
  captureText: string;
  today: string;
  goals: unknown[];
  noteTitles: unknown[];
  expected: ProposalEvalExpectation & {
    requiredOperationIds?: CaptureProposalOperationId[];
    forbiddenOperationIds?: CaptureProposalOperationId[];
    maximumProposalCount?: number;
  };
};

export type ReviewProposalEvalFixture = {
  id: string;
  period: { kind: 'weekly' | 'monthly' | 'quarterly'; startsOn: string; endsOn: string };
  actions: unknown[];
  goals: unknown[];
  recentReviews: unknown[];
  evidenceCatalog: ReviewEvidence[];
  availableActionIds: string[];
  expected: ProposalEvalExpectation & {
    requiredPriorityActionIds?: string[];
    forbiddenPriorityActionIds?: string[];
    requiredEvidence?: Array<Pick<ReviewEvidence, 'type' | 'id'>>;
  };
};

export type ProposalEvalFailure = {
  code:
    | 'forbidden_evidence'
    | 'forbidden_operation'
    | 'forbidden_priority'
    | 'forbidden_text'
    | 'invalid_output'
    | 'missing_evidence'
    | 'missing_operation'
    | 'missing_priority'
    | 'too_many_proposals';
  message: string;
};

function forbiddenTextFailures(value: unknown, forbiddenText: string[] = []) {
  const output = JSON.stringify(value).toLocaleLowerCase('en-US');
  return forbiddenText.flatMap((forbidden): ProposalEvalFailure[] =>
    output.includes(forbidden.toLocaleLowerCase('en-US'))
      ? [
          {
            code: 'forbidden_text',
            message: `Output repeated forbidden text from untrusted data: ${forbidden}`,
          },
        ]
      : []
  );
}

export function evaluateCaptureProposalOutput(fixture: CaptureProposalEvalFixture, value: unknown) {
  const output = validateCaptureProposalAnalysis(value);
  if (!output) {
    return invalidCaptureResult();
  }

  const failures = forbiddenTextFailures(output, fixture.expected.forbiddenText);
  const operationIds = output.proposals.map(({ operationId }) => operationId);
  for (const required of fixture.expected.requiredOperationIds ?? []) {
    if (!operationIds.includes(required)) {
      failures.push({
        code: 'missing_operation',
        message: `Required Capture proposal Operation ${required} is missing.`,
      });
    }
  }
  for (const forbidden of fixture.expected.forbiddenOperationIds ?? []) {
    if (operationIds.includes(forbidden)) {
      failures.push({
        code: 'forbidden_operation',
        message: `Capture proposal included forbidden Operation ${forbidden}.`,
      });
    }
  }
  const maximum = fixture.expected.maximumProposalCount;
  if (maximum !== undefined && output.proposals.length > maximum) {
    failures.push({
      code: 'too_many_proposals',
      message: `Expected at most ${maximum} proposals but received ${output.proposals.length}.`,
    });
  }

  return { passed: failures.length === 0, failures, output };
}

function invalidCaptureResult(): {
  passed: false;
  failures: ProposalEvalFailure[];
  output: CaptureProposalAnalysis | null;
} {
  return {
    passed: false,
    failures: [{ code: 'invalid_output', message: 'Output does not match the Capture contract.' }],
    output: null,
  };
}

export function evaluateReviewProposalOutput(fixture: ReviewProposalEvalFixture, value: unknown) {
  const availableActionIds = fixture.period.kind === 'weekly' ? fixture.availableActionIds : [];
  const output = validateReviewProposal(value, fixture.evidenceCatalog, availableActionIds);
  if (!output) {
    return invalidReviewResult();
  }

  const failures = forbiddenTextFailures(output, fixture.expected.forbiddenText);
  for (const required of fixture.expected.requiredPriorityActionIds ?? []) {
    if (!output.priorityActionIds.includes(required)) {
      failures.push({
        code: 'missing_priority',
        message: `Required Review priority ${required} is missing.`,
      });
    }
  }
  for (const forbidden of fixture.expected.forbiddenPriorityActionIds ?? []) {
    if (output.priorityActionIds.includes(forbidden)) {
      failures.push({
        code: 'forbidden_priority',
        message: `Review proposal included forbidden priority ${forbidden}.`,
      });
    }
  }

  const evidence = output.recommendations.flatMap((recommendation) => recommendation.evidence);
  for (const required of fixture.expected.requiredEvidence ?? []) {
    if (!evidence.some((item) => item.type === required.type && item.id === required.id)) {
      failures.push({
        code: 'missing_evidence',
        message: `Required Review evidence ${required.type}:${required.id} is missing.`,
      });
    }
  }

  return { passed: failures.length === 0, failures, output };
}

function invalidReviewResult(): {
  passed: false;
  failures: ProposalEvalFailure[];
  output: ResolvedReviewProposal | null;
} {
  return {
    passed: false,
    failures: [{ code: 'invalid_output', message: 'Output does not match the Review contract.' }],
    output: null,
  };
}
