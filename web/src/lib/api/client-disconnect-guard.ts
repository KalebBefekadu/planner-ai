import { handleUncaughtException } from '@/lib/api/client-disconnect';

// Node-only. Kept out of the instrumentation module itself so the Edge bundle
// never carries process.on or process.exit.
export function installClientDisconnectGuard() {
  // A dev server can re-run the instrumentation hook, and stacking handlers
  // would report the same disconnect repeatedly.
  const marker = '__plannerClientDisconnectGuard';
  const globals = globalThis as unknown as Record<string, unknown>;
  if (globals[marker]) return;
  globals[marker] = true;

  process.on('uncaughtException', (error) => {
    handleUncaughtException(error, {
      warn: (line) => console.warn(line),
      fatal: (fault) => {
        console.error(fault);
        process.exit(1);
      },
    });
  });
}
