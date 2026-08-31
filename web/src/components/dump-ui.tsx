'use client';

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { CloudOff, RefreshCw, Trash2 } from 'lucide-react';
import { saveTranscript, syncTranscript, type CaptureView } from '@/app/actions';
import { CoachingCue } from '@/components/coaching-cue';
import {
  applyQueuedCaptureJournalEvents,
  captureMatchesJournal,
  deferQueuedCapture,
  listFailedVoices,
  listQueuedCaptures,
  loadCaptureDraft,
  queueCapture,
  queueCaptureOperation,
  readFailedVoice,
  removeFailedVoice,
  removeQueuedCapture,
  retainFailedVoice,
  saveCaptureDraft,
  type FailedVoice,
  type QueuedCapture,
} from '@/lib/capture-queue';
import { inboxCoachingCue, type CoachingIntensity } from '@/lib/coaching';
import { classifyOperationRejection } from '@/lib/operations/journal';
import { AnalyzeCaptureButton, CaptureProposalQueue } from '@/components/capture-proposal-queue';
import type { CaptureAnalysisJobView, CaptureProposalBatchView } from '@/app/inbox/actions';

type Transcript = CaptureView;
type SpeechRecognitionInstance = {
  continuous: boolean;
  interimResults: boolean;
  onresult: ((event: SpeechRecognitionEvent) => void) | null;
  onerror: (() => void) | null;
  start: () => void;
  stop: () => void;
};
type SpeechRecognitionConstructor = new () => SpeechRecognitionInstance;
type SpeechRecognitionEvent = {
  resultIndex: number;
  results: ArrayLike<{ isFinal: boolean; 0: { transcript: string } }>;
};

const MAX_RECORDING_SECONDS = 180;

function subscribeToNetworkState(onStoreChange: () => void) {
  window.addEventListener('online', onStoreChange);
  window.addEventListener('offline', onStoreChange);
  return () => {
    window.removeEventListener('online', onStoreChange);
    window.removeEventListener('offline', onStoreChange);
  };
}

function browserIsOnline() {
  return navigator.onLine;
}

function serverIsOnline() {
  return true;
}

function messageFor(error: unknown) {
  return error instanceof Error
    ? error.message
    : 'Something went wrong. Your draft is still available.';
}

export function DumpUI({
  initialTranscripts,
  coachingIntensity,
  initialProposalBatches,
  captureProposalsEnabled,
  operationJournalEnabled,
  initialAnalysisJobs,
}: {
  initialTranscripts: Transcript[];
  coachingIntensity?: CoachingIntensity | null;
  initialProposalBatches: CaptureProposalBatchView[];
  captureProposalsEnabled: boolean;
  operationJournalEnabled: boolean;
  initialAnalysisJobs: CaptureAnalysisJobView[];
}) {
  const [transcripts, setTranscripts] = useState(initialTranscripts);
  const [isRecording, setIsRecording] = useState(false);
  const [transcriptText, setTranscriptText] = useState('');
  const [captureSource, setCaptureSource] = useState<CaptureView['source']>('typed');
  const [interimText, setInterimText] = useState('');
  const [recordingTime, setRecordingTime] = useState(0);
  const [isTranscribing, setIsTranscribing] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);
  const isOnline = useSyncExternalStore(subscribeToNetworkState, browserIsOnline, serverIsOnline);
  const [storageReady, setStorageReady] = useState(false);
  const [queuedCaptures, setQueuedCaptures] = useState<QueuedCapture[]>([]);
  const [failedVoices, setFailedVoices] = useState<FailedVoice[]>([]);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const recognitionRef = useRef<SpeechRecognitionInstance | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const syncingRef = useRef(false);

  const refreshLocalState = useCallback(async () => {
    const [captures, voices] = await Promise.all([listQueuedCaptures(), listFailedVoices()]);
    setQueuedCaptures(captures);
    setFailedVoices(voices);
  }, []);

  const syncQueuedCaptures = useCallback(
    async (force = false) => {
      if (!navigator.onLine || syncingRef.current) return;
      syncingRef.current = true;
      setIsSyncing(true);
      try {
        const queued = await listQueuedCaptures();
        for (const capture of queued) {
          if (!force && capture.nextRetryAt > new Date().toISOString()) continue;
          let journal = capture.journal;
          try {
            if (journal?.status === 'accepted' || journal?.status === 'duplicate_accepted') {
              await removeQueuedCapture(capture.id);
              continue;
            }
            if (
              journal?.status === 'preserved_private_copy' ||
              journal?.status === 'needs_upgrade'
            ) {
              continue;
            }
            if (journal && !captureMatchesJournal(journal, capture.rawText, capture.source)) {
              await applyQueuedCaptureJournalEvents(capture.id, [
                { type: 'preserve_private_copy' },
              ]);
              setError(
                'A local Capture failed its integrity check. Its private recovery copy was preserved.'
              );
              continue;
            }
            if (journal?.status === 'retryable_rejection') {
              journal = await applyQueuedCaptureJournalEvents(capture.id, [{ type: 'retry' }]);
            }
            if (journal?.status === 'queued') {
              journal = await applyQueuedCaptureJournalEvents(capture.id, [{ type: 'send' }]);
            }
            const syncResult = journal
              ? await syncTranscript(capture.rawText, capture.source, capture.id)
              : {
                  ok: true as const,
                  capture: await saveTranscript(capture.rawText, capture.source, capture.id),
                };
            if (!syncResult.ok) {
              const rejection = classifyOperationRejection({ code: syncResult.code });
              if (journal?.status === 'sent') {
                if (rejection === 'retryable') {
                  await applyQueuedCaptureJournalEvents(capture.id, [
                    { type: 'reject', kind: rejection, code: syncResult.code },
                  ]);
                  await deferQueuedCapture(capture.id, capture.attempts + 1);
                } else if (rejection === 'obsolete_schema') {
                  await applyQueuedCaptureJournalEvents(capture.id, [
                    { type: 'reject', kind: rejection, code: syncResult.code },
                    { type: 'require_upgrade' },
                  ]);
                  setError('Planner AI must be upgraded before this Capture can sync.');
                } else {
                  await applyQueuedCaptureJournalEvents(capture.id, [
                    { type: 'reject', kind: rejection, code: syncResult.code },
                    { type: 'preserve_private_copy' },
                  ]);
                  setError(
                    rejection === 'policy'
                      ? 'This Capture cannot sync with the current access. Its private copy was preserved.'
                      : 'This Capture conflicts with the server. Its private copy was preserved.'
                  );
                }
              } else {
                await deferQueuedCapture(capture.id, capture.attempts + 1);
              }
              continue;
            }
            const saved = syncResult.capture;
            if (journal?.status === 'sent') {
              if (!saved.operation_receipt_id) {
                throw new Error('The server did not return an Operation receipt.');
              }
              if (saved.raw_text !== capture.rawText || saved.source !== capture.source) {
                await applyQueuedCaptureJournalEvents(capture.id, [
                  { type: 'reject', kind: 'conflict', code: 'idempotency_payload_mismatch' },
                  { type: 'preserve_private_copy' },
                ]);
                setError(
                  'The server acknowledged different Capture content. Your private copy was preserved.'
                );
                continue;
              }
              await applyQueuedCaptureJournalEvents(capture.id, [
                { type: 'accept', receiptId: saved.operation_receipt_id },
              ]);
            }
            await removeQueuedCapture(capture.id);
            setTranscripts((current) => [saved, ...current.filter((item) => item.id !== saved.id)]);
          } catch {
            if (journal?.status === 'sent') {
              await applyQueuedCaptureJournalEvents(capture.id, [
                { type: 'reject', kind: 'retryable', code: 'network_error' },
              ]).catch(() => undefined);
            }
            await deferQueuedCapture(capture.id, capture.attempts + 1);
          }
        }
        await refreshLocalState();
      } finally {
        syncingRef.current = false;
        setIsSyncing(false);
      }
    },
    [refreshLocalState]
  );

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const draft = await loadCaptureDraft();
        if (!active) return;
        if (draft) {
          setTranscriptText(draft.rawText);
          setCaptureSource(draft.source);
          setNotice('Your unsent capture was restored.');
        }
        await refreshLocalState();
        if (active) setStorageReady(true);
        await syncQueuedCaptures();
      } catch {
        if (active) setError('Private offline storage is unavailable in this browser.');
      }
    })();
    return () => {
      active = false;
    };
  }, [refreshLocalState, syncQueuedCaptures]);

  useEffect(() => {
    if (!storageReady) return;
    const timeout = window.setTimeout(() => {
      void saveCaptureDraft(
        transcriptText,
        captureSource === 'import' ? 'typed' : captureSource
      ).catch(() => setError('Planner AI could not preserve this draft locally.'));
    }, 300);
    return () => window.clearTimeout(timeout);
  }, [captureSource, storageReady, transcriptText]);

  useEffect(() => {
    const online = () => {
      void syncQueuedCaptures();
    };
    window.addEventListener('online', online);
    const interval = window.setInterval(() => void syncQueuedCaptures(), 30_000);
    return () => {
      window.removeEventListener('online', online);
      window.clearInterval(interval);
    };
  }, [syncQueuedCaptures]);

  useEffect(() => {
    if (!isRecording) return;
    const interval = window.setInterval(() => {
      setRecordingTime((seconds) => {
        if (seconds + 1 >= MAX_RECORDING_SECONDS) {
          window.setTimeout(() => stopRecording(), 0);
          return MAX_RECORDING_SECONDS;
        }
        return seconds + 1;
      });
    }, 1_000);
    return () => window.clearInterval(interval);
  }, [isRecording]);

  function getMimeType() {
    return (
      ['audio/webm', 'audio/mp4', 'audio/ogg'].find((type) =>
        MediaRecorder.isTypeSupported(type)
      ) ?? ''
    );
  }

  function stopRecording() {
    const recorder = mediaRecorderRef.current;
    if (recorder?.state === 'recording') {
      recorder.stop();
      recorder.stream.getTracks().forEach((track) => track.stop());
    }
    try {
      recognitionRef.current?.stop();
    } catch {
      /* Browser speech recognition may have already stopped. */
    }
    setInterimText('');
    setIsRecording(false);
    setRecordingTime(0);
  }

  async function transcribeRetainedVoice(retainedId: string, audio?: Blob) {
    const retainedAudio = audio ?? (await readFailedVoice(retainedId));
    if (!retainedAudio) throw new Error('This recording expired or is no longer available.');
    const formData = new FormData();
    formData.append('audio', retainedAudio, 'capture.webm');
    const response = await fetch('/api/transcribe', { method: 'POST', body: formData });
    const data = (await response.json()) as { transcript?: string; error?: string };
    if (!response.ok || !data.transcript) throw new Error(data.error ?? 'Transcription failed.');
    setTranscriptText((current) =>
      current ? `${current} ${data.transcript}` : (data.transcript ?? '')
    );
    setCaptureSource('voice');
    await removeFailedVoice(retainedId);
    await refreshLocalState();
    setNotice('Transcription added. Review it, then save the exact text to your inbox.');
  }

  async function startRecording() {
    setError(null);
    setNotice(null);
    if (!navigator.mediaDevices?.getUserMedia) {
      setError(
        'This browser does not support microphone recording. You can still type your capture.'
      );
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mimeType = getMimeType();
      const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
      mediaRecorderRef.current = recorder;
      audioChunksRef.current = [];

      const recognitionWindow = window as typeof window & {
        SpeechRecognition?: SpeechRecognitionConstructor;
        webkitSpeechRecognition?: SpeechRecognitionConstructor;
      };
      const Recognition =
        recognitionWindow.SpeechRecognition ?? recognitionWindow.webkitSpeechRecognition;
      if (Recognition) {
        const recognition = new Recognition();
        recognition.continuous = true;
        recognition.interimResults = true;
        recognition.onresult = (event) => {
          let interim = '';
          for (let index = event.resultIndex; index < event.results.length; index += 1) {
            if (!event.results[index].isFinal) interim += event.results[index][0].transcript;
          }
          setInterimText(interim);
        };
        recognition.onerror = () => undefined;
        recognitionRef.current = recognition;
        try {
          recognition.start();
        } catch {
          /* Live captions are optional. */
        }
      }

      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) audioChunksRef.current.push(event.data);
      };
      recorder.onstop = async () => {
        setIsTranscribing(true);
        const audio = new Blob(audioChunksRef.current, { type: mimeType || 'audio/webm' });
        try {
          const retainedId = await retainFailedVoice(audio);
          await refreshLocalState();
          if (!navigator.onLine) {
            setNotice('Recording encrypted locally. It will remain available for seven days.');
          } else {
            await transcribeRetainedVoice(retainedId, audio);
          }
        } catch (caught) {
          setError(messageFor(caught));
        } finally {
          setIsTranscribing(false);
        }
      };
      recorder.start();
      setRecordingTime(0);
      setIsRecording(true);
    } catch (caught) {
      setError(messageFor(caught));
    }
  }

  async function retryVoice(id: string) {
    setError(null);
    setIsTranscribing(true);
    try {
      if (!navigator.onLine) throw new Error('Reconnect before retrying transcription.');
      await transcribeRetainedVoice(id);
    } catch (caught) {
      setError(messageFor(caught));
    } finally {
      setIsTranscribing(false);
    }
  }

  async function deleteVoice(id: string) {
    await removeFailedVoice(id);
    await refreshLocalState();
    setNotice('Local recording deleted.');
  }

  async function saveCapture() {
    setError(null);
    const idempotencyKey = crypto.randomUUID();
    const localSource = captureSource === 'import' ? 'typed' : captureSource;
    if (operationJournalEnabled) {
      try {
        await queueCaptureOperation(idempotencyKey, transcriptText, localSource);
        setTranscriptText('');
        setCaptureSource('typed');
        await refreshLocalState();
        setNotice('Capture committed on this device and queued for sync.');
        if (navigator.onLine) {
          await syncQueuedCaptures(true);
          const remaining = await listQueuedCaptures();
          if (!remaining.some((capture) => capture.id === idempotencyKey)) {
            setNotice('Capture saved to your inbox.');
          }
        }
      } catch (caught) {
        setError(messageFor(caught));
      }
      return;
    }
    try {
      if (!navigator.onLine) throw new Error('offline');
      const saved = await saveTranscript(transcriptText, captureSource, idempotencyKey);
      setTranscripts((current) => [saved, ...current]);
      setTranscriptText('');
      setCaptureSource('typed');
      await saveCaptureDraft('', 'typed');
      setNotice('Capture saved to your inbox.');
    } catch {
      try {
        await queueCapture(idempotencyKey, transcriptText, localSource);
        setTranscriptText('');
        setCaptureSource('typed');
        await refreshLocalState();
        setNotice('Capture encrypted on this device and queued for sync.');
      } catch (caught) {
        setError(messageFor(caught));
      }
    }
  }

  const minutes = String(Math.floor(recordingTime / 60)).padStart(2, '0');
  const seconds = String(recordingTime % 60).padStart(2, '0');

  return (
    <div className="page capture-page">
      <header className="page-heading">
        <div>
          <p className="eyebrow">Capture inbox</p>
          <h1>What is on your mind?</h1>
          <p className="lede">
            Speak freely or type a note. Planner AI keeps the raw thought intact before anything is
            organized.
          </p>
        </div>
      </header>
      {coachingIntensity ? (
        <CoachingCue cue={inboxCoachingCue(coachingIntensity, transcripts.length)} />
      ) : null}
      {!isOnline ? (
        <p className="status-message" role="status">
          Offline. New captures will remain encrypted on this device until you reconnect.
        </p>
      ) : null}
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
      <div className="capture-layout">
        <section className="card capture-editor">
          <div className="capture-toolbar">
            <span id="capture-editor-label">Unstructured capture</span>
            <span>{isTranscribing ? 'Transcribing...' : `${minutes}:${seconds} / 03:00`}</span>
          </div>
          <textarea
            aria-labelledby="capture-editor-label"
            className="capture-textarea"
            value={transcriptText}
            maxLength={60_000}
            onChange={(event) => {
              setTranscriptText(event.target.value);
              if (!event.target.value) setCaptureSource('typed');
            }}
            placeholder="Start with the thought exactly as it arrives..."
          />
          {isRecording && interimText ? <p className="live-caption">{interimText}</p> : null}
          <div className="capture-actions">
            <button
              className="btn-secondary"
              type="button"
              onClick={() => {
                setTranscriptText('');
                setCaptureSource('typed');
              }}
              disabled={!transcriptText || isRecording}
            >
              Clear
            </button>
            <div className="record-actions">
              <button
                className={`record-button${isRecording ? ' record-button-active' : ''}`}
                type="button"
                onClick={isRecording ? stopRecording : () => void startRecording()}
                disabled={isTranscribing}
                aria-label={isRecording ? 'Stop recording' : 'Start recording'}
              >
                <span aria-hidden="true" />
              </button>
              <button
                className="btn-primary"
                type="button"
                onClick={() => void saveCapture()}
                disabled={isRecording || isTranscribing || transcriptText.trim().length < 3}
              >
                Save capture
              </button>
            </div>
          </div>
        </section>
        <aside className="card capture-history">
          <div>
            <p className="eyebrow">Recent</p>
            <h2>Inbox history</h2>
          </div>
          <div className="history-list">
            {transcripts.length ? (
              transcripts.map((transcript) => (
                <article className="history-item" key={transcript.id}>
                  <time dateTime={transcript.created_at}>
                    {new Intl.DateTimeFormat(undefined, {
                      month: 'short',
                      day: 'numeric',
                      hour: 'numeric',
                      minute: '2-digit',
                    }).format(new Date(transcript.created_at))}
                  </time>
                  <p>{transcript.raw_text}</p>
                  {captureProposalsEnabled ? (
                    <AnalyzeCaptureButton
                      captureId={transcript.id}
                      job={initialAnalysisJobs.find((job) => job.captureId === transcript.id)}
                    />
                  ) : null}
                </article>
              ))
            ) : (
              <p className="guide-empty">Your saved voice and typed captures will appear here.</p>
            )}
          </div>
        </aside>
        <CaptureProposalQueue batches={initialProposalBatches} captures={transcripts} />
        {queuedCaptures.length || failedVoices.length ? (
          <section className="local-recovery" aria-label="Local recovery queue">
            <div className="local-recovery-heading">
              <div>
                <CloudOff size={18} aria-hidden="true" />
                <div>
                  <h2>Waiting on this device</h2>
                  <p>Encrypted locally until sync or deletion.</p>
                </div>
              </div>
              <button
                className="icon-button"
                type="button"
                title="Retry pending captures"
                aria-label="Retry pending captures"
                disabled={isSyncing || !isOnline}
                onClick={() => void syncQueuedCaptures(true)}
              >
                <RefreshCw size={16} className={isSyncing ? 'spin-icon' : ''} />
              </button>
            </div>
            {queuedCaptures.map((capture) => (
              <div className="recovery-row" key={capture.id}>
                <div>
                  <strong>
                    {capture.journal?.status === 'preserved_private_copy'
                      ? 'Private recovery copy'
                      : capture.journal?.status === 'needs_upgrade'
                        ? 'Capture needs an upgrade'
                        : `Pending ${capture.source} capture`}
                  </strong>
                  <span>{capture.rawText}</span>
                  <small>
                    {capture.journal?.status === 'preserved_private_copy'
                      ? 'Needs review; automatic sync stopped'
                      : capture.journal?.status === 'needs_upgrade'
                        ? 'Update Planner AI before retrying'
                        : capture.attempts
                          ? `Retry ${capture.attempts} failed`
                          : 'Ready to sync'}
                  </small>
                </div>
                <button
                  className="icon-button"
                  type="button"
                  title="Delete pending capture"
                  aria-label="Delete pending capture"
                  onClick={() =>
                    void removeQueuedCapture(capture.id).then(() => refreshLocalState())
                  }
                >
                  <Trash2 size={16} />
                </button>
              </div>
            ))}
            {failedVoices.map((voice) => (
              <div className="recovery-row" key={voice.id}>
                <div>
                  <strong>Recording awaiting transcription</strong>
                  <span>
                    Retained until{' '}
                    {new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' }).format(
                      new Date(voice.expiresAt)
                    )}
                  </span>
                </div>
                <div className="recovery-actions">
                  <button
                    className="icon-button"
                    type="button"
                    title="Retry transcription"
                    aria-label="Retry transcription"
                    disabled={isTranscribing || !isOnline}
                    onClick={() => void retryVoice(voice.id)}
                  >
                    <RefreshCw size={16} />
                  </button>
                  <button
                    className="icon-button"
                    type="button"
                    title="Delete recording"
                    aria-label="Delete recording"
                    onClick={() => void deleteVoice(voice.id)}
                  >
                    <Trash2 size={16} />
                  </button>
                </div>
              </div>
            ))}
          </section>
        ) : null}
      </div>
    </div>
  );
}
