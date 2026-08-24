import { describe, expect, it } from 'vitest';
import { buildAssistantSystemPrompt } from '@/lib/assistant/policy';
import { assistantSafetyIntercept } from '@/lib/assistant/safety';

describe('assistant safety boundary', () => {
  it('intercepts direct self-harm intent without requiring a provider', () => {
    const result = assistantSafetyIntercept('I am going to kill myself tonight.');
    expect(result).toMatchObject({ category: 'crisis' });
    expect(result?.reply).toContain('988');
    expect(result?.reply).toContain('local emergency services');
  });

  it('does not intercept ordinary planning or technical language', () => {
    expect(assistantSafetyIntercept('Help me plan my quarterly review.')).toBeNull();
    expect(assistantSafetyIntercept('Kill the stuck process and restart the server.')).toBeNull();
  });

  it('constrains professional-domain guidance in the provider policy', () => {
    const prompt = buildAssistantSystemPrompt({
      canonical: true,
      route: '/today',
      productContext: {},
      evidenceCatalog: [],
    });
    expect(prompt).toContain('not medical, legal, financial, diagnostic, or crisis care');
    expect(prompt).toContain('Do not diagnose, prescribe, guarantee outcomes');
  });
});
