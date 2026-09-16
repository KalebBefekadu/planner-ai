// The one way the server writes a line about itself.
//
// Deliberately without `import 'server-only'`. That guard would make this
// module unimportable from a unit test, and `errorClassOf` is a pure function
// whose behaviour is the whole point. What keeps logging server-side is the
// boundary test in `tests/unit/content-free-telemetry.test.ts`, which freezes
// the list of files allowed to write a log line at all -- a stronger guarantee
// than an import that only fails in a browser bundle.
//
// EH-06 asks that every production failure be locatable by a stable id without
// Note, Capture, prompt, transcript, filename or secret content reaching
// telemetry. Today that holds because the handful of call sites were each
// written carefully. It is not enforced anywhere, so it holds by care rather
// than by construction, and the next `console.error('Could not save', note.title)`
// would be the end of it.
//
// So there is one emitter, and its input is a closed set of fields. Every one
// of them is an identifier, an enum, a stable code or a number. There is no
// free-form string field to put content into: that is the guarantee, expressed
// as a type rather than as a convention.
//
// What this deliberately is not: a tracing client. Spans, exporters and SLO
// dashboards are the rest of EH-06 and want a running system with real traffic
// to be worth anything. This is the boundary they will have to respect when
// they arrive.

/** A fixed vocabulary, so a grep for an event name finds every place it fires. */
export type TelemetryEvent =
  | 'ai_request_failed'
  | 'ai_usage_record_failed'
  | 'client_disconnected'
  | 'lifecycle_job_start_unrecorded'
  | 'lifecycle_job_outcome_unrecorded';

export type ServerEvent = {
  event: TelemetryEvent;
  /** The Operation or job this concerns. An identifier, never a title. */
  subject?: string;
  /** Browser-safe request id, which is what correlates a report to a trace. */
  requestId?: string;
  /** A stable code from a known set -- never a provider or database message. */
  errorCode?: string;
  /**
   * The error's class name. `error.name`, never `error.message`: the name is a
   * type, the message is whatever the thrower put there, and on the AI paths
   * that can be a provider echoing the prompt back.
   */
  errorClass?: string;
  /** Measures. Numbers cannot carry content. */
  durationMs?: number;
  count?: number;
};

/**
 * `error.name` and nothing else. Anything that is not an Error has no name to
 * take, and stringifying it could pull in whatever it holds.
 */
export function errorClassOf(error: unknown): string {
  return error instanceof Error ? error.name : 'UnknownError';
}

export function recordServerEvent(details: ServerEvent): void {
  // One line of JSON per event, so a log drain can parse it without a grammar.
  // Undefined fields are dropped rather than written as null, which keeps the
  // line short and makes a missing field obviously absent.
  const line: Record<string, string | number> = { event: details.event };
  if (details.subject !== undefined) line.subject = details.subject;
  if (details.requestId !== undefined) line.requestId = details.requestId;
  if (details.errorCode !== undefined) line.errorCode = details.errorCode;
  if (details.errorClass !== undefined) line.errorClass = details.errorClass;
  if (details.durationMs !== undefined) line.durationMs = details.durationMs;
  if (details.count !== undefined) line.count = details.count;

  console.error(JSON.stringify(line));
}
