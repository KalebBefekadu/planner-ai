import { describe, expect, it } from 'vitest';
import {
  evaluateBreakdownOutput,
  evaluateChooseTodayOutput,
  evaluatePlanWeekOutput,
} from '@/lib/ai/intent-evals';
import { completeManagedText } from '@/lib/ai/provider';
import { buildChooseTodayMessages } from '@/lib/planner/choose-today';
import { buildPlanWeekMessages } from '@/lib/planner/plan-week';
import { buildBreakdownMessages } from '@/lib/planner/breakdown';
import { providerErrorLabel, wait } from './live-eval-helpers';
import {
  breakdownEvalCorpus,
  chooseTodayEvalCorpus,
  planWeekEvalCorpus,
} from './intent-red-team-corpus';

/* The contextual intents, against a real provider.
 *
 * Everything else about these three is verified without one: the resolvers
 * drop an invented reference, the routes write nothing on arrival, the browser
 * journeys prove the manual path survives an outage. All of that is evidence
 * they are safe. None of it is evidence they are any good, because no other
 * environment has a provider key and a suggestion nobody has seen is a
 * suggestion nobody can judge.
 *
 * This is the gate that produces that evidence. It is opt-in and costs money,
 * so it is not in `npm test`; run it with `npm run test:ai:live`. */

const configuredRequestInterval = Number(process.env.AI_EVAL_REQUEST_INTERVAL_MS ?? 32_000);
const REQUEST_INTERVAL_MS = Number.isFinite(configuredRequestInterval)
  ? Math.max(0, configuredRequestInterval)
  : 32_000;

type Case = {
  id: string;
  messages: ReturnType<typeof buildChooseTodayMessages>;
  maxTokens: number;
  evaluate: (value: unknown) => { passed: boolean; failures: Array<{ message: string }> };
};

function cases(): Case[] {
  const filter = process.env.INTENT_EVAL_FIXTURE;
  const all: Case[] = [
    ...chooseTodayEvalCorpus.map((fixture) => ({
      id: fixture.id,
      messages: buildChooseTodayMessages({
        candidates: fixture.candidates,
        today: fixture.today,
        capacityNote: fixture.capacityNote,
      }),
      maxTokens: 400,
      evaluate: (value: unknown) => evaluateChooseTodayOutput(fixture, value),
    })),
    ...planWeekEvalCorpus.map((fixture) => ({
      id: fixture.id,
      messages: buildPlanWeekMessages({
        candidates: fixture.candidates,
        startsOn: fixture.startsOn,
        endsOn: fixture.endsOn,
        capacityHours: fixture.capacityHours,
      }),
      maxTokens: 700,
      evaluate: (value: unknown) => evaluatePlanWeekOutput(fixture, value),
    })),
    ...breakdownEvalCorpus.map((fixture) => ({
      id: fixture.id,
      messages: buildBreakdownMessages({
        title: fixture.goalTitle,
        definitionOfDone: fixture.definitionOfDone,
        kind: fixture.kind,
        dueOn: fixture.dueOn,
      }),
      maxTokens: 500,
      evaluate: (value: unknown) => evaluateBreakdownOutput(fixture, value),
    })),
  ];
  const selected = all.filter((entry) => !filter || entry.id === filter);
  if (!selected.length) throw new Error(`Unknown intent eval fixture: ${filter}`);
  return selected;
}

describe('live contextual intent behavioral gate', () => {
  it('passes the maintained intent corpus', async () => {
    if (!process.env.GROQ_API_KEY) {
      throw new Error('GROQ_API_KEY is required for the opt-in live intent eval.');
    }
    const failures: string[] = [];

    for (const [index, entry] of cases().entries()) {
      if (index > 0) await wait(REQUEST_INTERVAL_MS);
      let value: unknown = null;
      try {
        const { completion } = await completeManagedText('structured_analysis', {
          response_format: { type: 'json_object' },
          temperature: 0,
          max_completion_tokens: entry.maxTokens,
          messages: entry.messages,
        });
        value = JSON.parse(completion.choices[0]?.message?.content ?? '{}');
      } catch (error) {
        failures.push(`${entry.id}: provider_error (${providerErrorLabel(error)})`);
        continue;
      }
      const result = entry.evaluate(value);
      if (!result.passed) {
        for (const failure of result.failures) {
          failures.push(`${entry.id}: ${failure.message}`);
        }
      }
    }

    expect(failures, failures.join('\n')).toEqual([]);
  }, 600_000);
});
