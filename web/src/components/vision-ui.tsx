'use client';

import { useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { saveVision, type VisionView } from '@/app/actions';

type Vision = VisionView;

function messageFor(error: unknown) {
  return error instanceof Error ? error.message : 'Something went wrong. Your draft is still here.';
}

export function VisionUI({ initialVision }: { initialVision: Vision | null }) {
  const [visionText, setVisionText] = useState(initialVision?.content ?? '');
  const [questions, setQuestions] = useState<string[]>([]);
  const [isSaving, setIsSaving] = useState(false);
  const [isThinking, setIsThinking] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [questionsError, setQuestionsError] = useState<string | null>(null);
  const saved = initialVision?.content ?? '';
  const unsaved = visionText.trim() !== saved.trim();

  async function askQuestions(text: string) {
    if (text.trim().length < 20) return;
    setIsThinking(true);
    setQuestionsError(null);
    try {
      const response = await fetch('/api/socratic', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ visionText: text }),
      });
      const data = (await response.json()) as { questions?: string[]; error?: string };
      if (!response.ok) throw new Error(data.error ?? 'Unable to generate questions.');
      setQuestions(Array.isArray(data.questions) ? data.questions : []);
    } catch (caught) {
      setQuestionsError(messageFor(caught));
    } finally {
      setIsThinking(false);
    }
  }

  /* Reflection used to fire on a 1.2s debounce as you typed. That sent the
     vision to the model without the screen ever saying so (§17, invisible
     context collection), and when AI is switched off every keystroke pause
     produced an error for a request the user never made. The explicit
     "Prompt reflection" button below was already the honest path. */

  async function handleSave() {
    setIsSaving(true);
    setError(null);
    setNotice(null);
    try {
      await saveVision(visionText);
      setNotice('Vision saved. Your plan will now use this as its North Star.');
    } catch (caught) {
      setError(messageFor(caught));
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <div className="page vision-page">
      <header className="page-heading">
        <div>
          <p className="eyebrow">North Star</p>
          <h1>Your life vision</h1>
          <p className="lede">
            Write the direction that makes your yearly, quarterly, and weekly choices coherent.
          </p>
        </div>
        <button
          className="btn-primary"
          type="button"
          onClick={() => void handleSave()}
          disabled={isSaving || visionText.trim().length < 3}
        >
          {isSaving ? 'Saving...' : 'Save vision'}
        </button>
      </header>

      {notice ? (
        <p className="status-message" role="status">
          {notice}
        </p>
      ) : null}
      {error ? (
        <p className="status-message status-message-error" role="alert">
          {error}
        </p>
      ) : null}

      <div className="vision-layout">
        <section className="card vision-editor">
          <label htmlFor="vision" className="editor-label">
            Vision draft
          </label>
          <textarea
            id="vision"
            className="vision-textarea"
            value={visionText}
            onChange={(event) => setVisionText(event.target.value)}
            placeholder="Five years from now, my life feels..."
          />
          <div className="editor-footer">
            <span>
              {visionText.trim().split(/\s+/).filter(Boolean).length} words
              {unsaved ? ' · unsaved' : saved ? ' · saved' : ''}
            </span>
            <button
              className="btn-secondary"
              type="button"
              onClick={() => void askQuestions(visionText)}
              disabled={isThinking || visionText.trim().length < 20}
            >
              {isThinking ? 'Reflecting...' : 'Prompt reflection'}
            </button>
          </div>
        </section>

        <aside className="card guide-panel">
          <div>
            <p className="eyebrow">Socratic guide</p>
            <h2>Make it more specific</h2>
          </div>
          <p className="guide-copy">
            Use these questions as a lens, not a test. The vision remains yours. Your draft is only
            sent to the model when you ask for a reflection.
          </p>
          <div className="question-list">
            {questions.length ? (
              questions.map((question, index) => (
                <p className="question" key={question}>
                  <span>{String(index + 1).padStart(2, '0')}</span>
                  {question}
                </p>
              ))
            ) : (
              <p className="guide-empty">
                Write a few sentences, then ask for a reflection when you are ready.
              </p>
            )}
          </div>
          {questionsError ? (
            <div className="guide-retry" role="alert">
              <p>{questionsError}</p>
              <button
                className="btn-secondary button-with-icon"
                type="button"
                disabled={isThinking}
                onClick={() => void askQuestions(visionText)}
              >
                <RefreshCw size={14} /> Retry reflection
              </button>
            </div>
          ) : null}
        </aside>
      </div>
    </div>
  );
}
