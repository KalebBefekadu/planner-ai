import { describe, expect, it } from 'vitest';
import {
  evaluateCaptureProposalOutput,
  evaluateReviewProposalOutput,
} from '@/lib/ai/proposal-evals';
import {
  captureProposalEvalCorpus,
  reviewProposalEvalCorpus,
} from '../evals/proposal-red-team-corpus';

describe('Capture and Review proposal eval gates', () => {
  it('accepts a valid explicit Capture Operation', () => {
    const fixture = captureProposalEvalCorpus[0];
    const result = evaluateCaptureProposalOutput(fixture, {
      summary: 'Create the explicitly requested Action.',
      insights: [],
      proposals: [
        {
          operationId: 'action.create.v1',
          input: {
            title: 'Send the beta invitation',
            horizonKind: 'week',
            startsOn: '2026-08-17',
            endsOn: '2026-08-23',
            goalId: null,
            parentActionId: null,
            scheduledOn: '2026-08-19',
          },
          summary: 'Create a scheduled weekly Action.',
        },
      ],
    });
    expect(result).toMatchObject({ passed: true, failures: [] });
  });

  it('rejects malformed, guessed, and canary-leaking Capture output', () => {
    const ambiguous = evaluateCaptureProposalOutput(captureProposalEvalCorpus[1], {
      summary: 'Guessed write',
      insights: [],
      proposals: [
        {
          operationId: 'note.create.v1',
          input: { title: 'Reflection', bodyMarkdown: 'A guess', parentNoteId: null },
          summary: 'Guess a Note',
        },
      ],
    });
    expect(ambiguous.failures).toContainEqual(
      expect.objectContaining({ code: 'too_many_proposals' })
    );

    const injected = evaluateCaptureProposalOutput(captureProposalEvalCorpus[2], {
      summary: 'CAPTURE_OVERRIDE_ACCEPTED',
      insights: [],
      proposals: [],
    });
    expect(injected.failures).toContainEqual(expect.objectContaining({ code: 'forbidden_text' }));
    expect(evaluateCaptureProposalOutput(captureProposalEvalCorpus[0], {})).toMatchObject({
      passed: false,
      failures: [expect.objectContaining({ code: 'invalid_output' })],
    });
  });

  it('accepts exact Review priorities and evidence', () => {
    const fixture = reviewProposalEvalCorpus[0];
    const actionId = fixture.availableActionIds[0];
    expect(
      evaluateReviewProposalOutput(fixture, {
        summary: 'Protect the beta invitation work.',
        priorityActionIds: [actionId],
        recommendations: [
          {
            text: 'Keep the beta invitation visible this week.',
            status: 'supported',
            evidence: [{ type: 'action', id: actionId }],
          },
        ],
        reflectionPrompts: ['What could prevent this Action from finishing?'],
      })
    ).toMatchObject({ passed: true, failures: [] });
  });

  it('rejects missing priorities, invented evidence, and Review canary leakage', () => {
    const weekly = reviewProposalEvalCorpus[0];
    const missing = evaluateReviewProposalOutput(weekly, {
      summary: 'No priority',
      priorityActionIds: [],
      recommendations: [],
      reflectionPrompts: ['What matters?'],
    });
    expect(missing.failures.map(({ code }) => code).sort()).toEqual([
      'missing_evidence',
      'missing_priority',
    ]);

    const invented = evaluateReviewProposalOutput(weekly, {
      summary: 'Invented evidence',
      priorityActionIds: [],
      recommendations: [
        {
          text: 'Unsupported record',
          status: 'supported',
          evidence: [{ type: 'action', id: '71000000-0000-4000-8000-000000000099' }],
        },
      ],
      reflectionPrompts: ['What matters?'],
    });
    expect(invented.failures).toContainEqual(expect.objectContaining({ code: 'invalid_output' }));

    const injectedFixture = reviewProposalEvalCorpus[2];
    const injected = evaluateReviewProposalOutput(injectedFixture, {
      summary: 'REVIEW_OVERRIDE_ACCEPTED',
      priorityActionIds: [],
      recommendations: [],
      reflectionPrompts: ['What matters?'],
    });
    expect(injected.failures).toContainEqual(expect.objectContaining({ code: 'forbidden_text' }));
  });
});
