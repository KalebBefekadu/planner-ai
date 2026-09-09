// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, fireEvent, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { AssistantDock } from '@/components/assistant-dock';

vi.mock('next/navigation', () => ({
  usePathname: () => '/notes',
  useRouter: () => ({ refresh: vi.fn(), replace: vi.fn(), push: vi.fn() }),
}));

vi.mock('next/link', () => ({
  default: ({ children, href, ...rest }: { children: React.ReactNode; href: string }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

// jsdom does not implement scrollIntoView; the component calls it on every
// message/proposal update to keep the transcript scrolled to the bottom.
if (!window.HTMLElement.prototype.scrollIntoView) {
  window.HTMLElement.prototype.scrollIntoView = vi.fn();
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

// Regression test for #171: while a proposal-bearing reply has been received
// but the trailing conversation-index refresh (part of the same in-flight
// request) has not settled, `pending` is still true. Approve/Dismiss must be
// disabled and marked busy during that window, matching Undo's existing
// treatment — not merely ignore a click that still looks live.
describe('AssistantDock proposal controls while pending', () => {
  it('disables and marks Approve/Dismiss busy while their mutation is still in flight', async () => {
    const indexGetDeferred = deferred<Response>();
    let indexGetCalls = 0;

    const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input.toString();
      const method = init?.method ?? 'GET';

      if (method === 'GET' && url.startsWith('/api/assistant')) {
        indexGetCalls += 1;
        if (indexGetCalls === 1) {
          // Initial conversation-index load when the dock opens.
          return Promise.resolve(
            new Response(JSON.stringify({ conversations: [] }), { status: 200 })
          );
        }
        // The follow-up index refresh triggered from inside callAssistant.
        // Kept pending on purpose so we can inspect the DOM while `pending`
        // is still true even though the proposal has already arrived.
        return indexGetDeferred.promise;
      }

      if (method === 'POST' && url.startsWith('/api/assistant')) {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              reply: 'Here is a proposed change.',
              proposal: {
                id: 'proposal-1',
                operationId: 'note.update',
                input: {},
                summary: 'Update the note',
                risk: 'low',
              },
            }),
            { status: 200 }
          )
        );
      }

      throw new Error(`Unexpected fetch call: ${method} ${url}`);
    });

    vi.stubGlobal('fetch', fetchMock);

    render(<AssistantDock />);

    fireEvent.click(screen.getByRole('button', { name: /ask planner ai/i }));

    const textbox = await screen.findByRole('textbox', { name: /message planner ai/i });
    fireEvent.change(textbox, { target: { value: 'draft a note' } });
    fireEvent.click(screen.getByRole('button', { name: /send message/i }));

    const approveButton = await screen.findByRole('button', { name: /approv/i });
    const dismissButton = screen.getByRole('button', { name: /dismiss/i });

    // The proposal is rendered, but the request that produced it hasn't
    // finished (the index refresh is still pending), so `pending` is true.
    await waitFor(() => {
      expect(approveButton).toBeDisabled();
      expect(dismissButton).toBeDisabled();
    });
    expect(approveButton).toHaveAttribute('aria-busy', 'true');
    expect(dismissButton).toHaveAttribute('aria-busy', 'true');

    // Let the in-flight request settle.
    indexGetDeferred.resolve(new Response(JSON.stringify({ conversations: [] }), { status: 200 }));

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /^approve$/i })).not.toBeDisabled();
    });
    expect(screen.getByRole('button', { name: /dismiss/i })).not.toBeDisabled();
  });
});
