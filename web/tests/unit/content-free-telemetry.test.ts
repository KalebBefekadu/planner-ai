import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { errorClassOf } from '@/lib/api/telemetry';
import { clientDisconnectSignature, handleUncaughtException } from '@/lib/api/client-disconnect';

/* EH-06's gate is that a production failure can be located by a stable id
   without Note, Capture, prompt, transcript, filename or secret content
   reaching telemetry.

   That held before this file existed, but it held because a handful of call
   sites were each written carefully. These assertions are what make it hold by
   construction: one emitter, a closed set of fields, and a frozen list of the
   places allowed to write a log line at all. */

const sourceRoot = path.resolve('src');
const emitter = 'src/lib/api/telemetry.ts';

/* The error boundary is a client component: its `console.error` runs in the
   person's own browser, showing them their own error, and never reaches a
   server log drain. It is listed rather than excluded by a rule about "use
   client", so adding a second one is a decision somebody makes on purpose. */
const clientSideOnly = ['src/app/error.tsx'];

/* The one place content can still reach stderr, and deliberately so.
   `installClientDisconnectGuard` prints the whole error before ending the
   process on a fault it does not recognise. A crash is exactly when the stack
   is worth having, a content-free line would destroy the only diagnosis
   available, and Node prints an uncaught exception to stderr anyway -- removing
   this would not close the hole, only the usefulness.

   What it does mean: whatever collects stderr in production can receive a raw
   error on a crash. That is a fact to weigh when choosing a log drain, not a
   thing this list can fix, so it is written down rather than quietly allowed. */
const crashDiagnostics = ['src/lib/api/client-disconnect-guard.ts'];

async function sourceFiles(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = await Promise.all(
    entries.map(async (entry) => {
      const absolute = path.join(directory, entry.name);
      if (entry.isDirectory()) return sourceFiles(absolute);
      return /\.tsx?$/.test(entry.name) ? [absolute] : [];
    })
  );
  return files.flat();
}

function relative(absolute: string) {
  return path.relative(process.cwd(), absolute).split(path.sep).join('/');
}

async function filesWritingLogLines() {
  const matches: string[] = [];
  for (const file of await sourceFiles(sourceRoot)) {
    const text = await readFile(file, 'utf8');
    if (/\bconsole\.(log|info|warn|error|debug|trace)\s*\(/.test(text)) {
      matches.push(relative(file));
    }
  }
  return matches.sort();
}

describe('what the server is allowed to write about itself', () => {
  it('writes every server log line through the one emitter', async () => {
    expect(await filesWritingLogLines()).toEqual(
      [...clientSideOnly, ...crashDiagnostics, emitter].sort()
    );
  });

  /* A message is whatever the thrower put there. On the AI paths that can be a
     provider quoting the prompt back, and on a database path it can be a row
     value. The class name is a type, so it cannot carry either. */
  it('takes an error class rather than an error message', () => {
    expect(errorClassOf(new TypeError('the note body was "Dinner with Ana"'))).toBe('TypeError');
    expect(errorClassOf(new Error('secret-token-abc123'))).toBe('Error');
    expect(errorClassOf('a bare string')).toBe('UnknownError');
    expect(errorClassOf(null)).toBe('UnknownError');
  });

  it('never reads an error message anywhere in the emitter', async () => {
    const text = await readFile(path.resolve(emitter), 'utf8');
    // In a comment explaining why, yes. In an expression, no.
    const code = text
      .split('\n')
      .filter((line) => !line.trimStart().startsWith('*') && !line.trimStart().startsWith('//'))
      .join('\n');
    expect(code).not.toMatch(/\.message\b/);
    expect(code).not.toMatch(/String\(\s*error\s*\)/);
  });
});

describe('the crash diagnostic exception', () => {
  it('covers only the fatal branch, not the ordinary disconnect path', async () => {
    const text = await readFile(path.resolve(crashDiagnostics[0]), 'utf8');
    // The non-fatal path emits a structured event; only `fatal` prints raw.
    expect(text).toContain('recordServerEvent(');
    const rawPrints = [...text.matchAll(/console\.\w+\s*\(/g)];
    expect(rawPrints).toHaveLength(1);
    expect(text).toMatch(/fatal:[\s\S]*console\.error\(fault\)/);
  });
});

describe('a client that goes away', () => {
  /* This one used to log `error.message` verbatim. The predicate only admits a
     fixed set of signatures, so it was bounded in practice -- but bounded by a
     predicate somebody could widen, not by the shape of what is logged. */
  it('reports which signature matched, not what the error said', () => {
    const lines: string[] = [];
    const socketClosed = Object.assign(new Error('read ECONNRESET on 10.0.0.4:54321'), {
      code: 'ECONNRESET',
    });
    const absorbed = handleUncaughtException(socketClosed, {
      warn: (signature) => lines.push(signature),
      fatal: () => expect.unreachable('a disconnect must not be fatal'),
    });
    expect(absorbed).toBe(true);
    expect(lines).toEqual(['ECONNRESET']);
    expect(lines[0]).not.toContain('10.0.0.4');
  });

  it('names each signature it knows', () => {
    expect(clientDisconnectSignature(Object.assign(new Error('x'), { code: 'EPIPE' }))).toBe(
      'EPIPE'
    );
    expect(clientDisconnectSignature(Object.assign(new Error('x'), { name: 'AbortError' }))).toBe(
      'AbortError'
    );
    expect(clientDisconnectSignature(new Error('The destination stream closed early.'))).toBe(
      'the destination stream closed early.'
    );
  });

  /* Absorbing an unknown fault would hide a real defect behind a server that
     only looks healthy, so anything unrecognised still ends the process. */
  it('still treats an unrecognised fault as fatal', () => {
    let fatal = false;
    const absorbed = handleUncaughtException(new Error('something genuinely wrong'), {
      warn: () => expect.unreachable('an unknown fault is not a disconnect'),
      fatal: () => {
        fatal = true;
      },
    });
    expect(absorbed).toBe(false);
    expect(fatal).toBe(true);
    expect(clientDisconnectSignature(new Error('something genuinely wrong'))).toBeNull();
  });
});
