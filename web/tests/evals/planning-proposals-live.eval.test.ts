import { describe, expect, it } from 'vitest';
import {
  evaluateCaptureProposalOutput,
  evaluateReviewProposalOutput,
} from '@/lib/ai/proposal-evals';
import { completeManagedText } from '@/lib/ai/provider';
import { buildCaptureProposalMessages } from '@/lib/capture-proposals';
import { buildReviewProposalMessages } from '@/lib/review-proposals';
import { providerErrorLabel, wait } from './live-eval-helpers';
import { captureProposalEvalCorpus, reviewProposalEvalCorpus } from './proposal-red-team-corpus';

const configuredRequestInterval = Number(process.env.AI_EVAL_REQUEST_INTERVAL_MS ?? 32_000);
const REQUEST_INTERVAL_MS = Number.isFinite(configuredRequestInterval)
  ? Math.max(0, configuredRequestInterval)
  : 32_000;

describe('live planning proposal behavioral gate', () => {
  it('passes the maintained Capture and Review corpus', async () => {
    if (!process.env.GROQ_API_KEY) {
      throw new Error('GROQ_API_KEY is required for the opt-in live proposal eval.');
    }
    const failures: string[] = [];
    const fixtureFilter = process.env.PROPOSAL_EVAL_FIXTURE;
    const fixtures = [
      ...captureProposalEvalCorpus.map((fixture) => ({ kind: 'capture' as const, fixture })),
      ...reviewProposalEvalCorpus.map((fixture) => ({ kind: 'review' as const, fixture })),
    ].filter(({ fixture }) => !fixtureFilter || fixture.id === fixtureFilter);
    if (!fixtures.length) throw new Error(`Unknown proposal eval fixture: ${fixtureFilter}`);

    for (const [index, entry] of fixtures.entries()) {
      if (index > 0) await wait(REQUEST_INTERVAL_MS);
      let value: unknown = null;
      try {
        const { completion } = await completeManagedText('structured_analysis', {
          response_format: { type: 'json_object' },
          temperature: 0,
          max_completion_tokens: 2_000,
          messages:
            entry.kind === 'capture'
              ? buildCaptureProposalMessages(entry.fixture)
              : buildReviewProposalMessages(entry.fixture),
        });
        value = JSON.parse(completion.choices[0]?.message?.content ?? '{}');
      } catch (error) {
        failures.push(`${entry.fixture.id}: provider_error (${providerErrorLabel(error)})`);
        continue;
      }
      const result =
        entry.kind === 'capture'
          ? evaluateCaptureProposalOutput(entry.fixture, value)
          : evaluateReviewProposalOutput(entry.fixture, value);
      if (!result.passed) {
        failures.push(
          `${entry.fixture.id}: ${result.failures.map(({ code, message }) => `${code} (${message})`).join(', ')}`
        );
      }
    }

    expect(failures, failures.join('\n')).toEqual([]);
  }, 600_000);
});
