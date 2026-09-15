import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  test: {
    environment: 'node',
    include: ['tests/unit/**/*.test.ts', 'src/**/*.test.tsx'],
    /* A floor on one path, deliberately, rather than a number over the whole
       repository. A global threshold gets optimised around -- people write
       tests for whatever is cheapest to cover until the number goes green --
       and it says nothing about whether the code that matters is tested.

       `src/lib/operations` is where every durable mutation in the product goes
       through: idempotency, optimistic concurrency, receipts, undo, and the
       message a person is shown when any of it fails. A regression here is
       silent and corrupts data rather than breaking a screen.

       The floors are set just under what the suite achieves today, so they
       ratchet rather than describe an aspiration. Raise them when the real
       figure moves; do not lower them to make a change fit. */
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json-summary'],
      include: ['src/lib/operations/**'],
      thresholds: {
        'src/lib/operations/**': {
          statements: 90,
          branches: 85,
          functions: 95,
          lines: 90,
        },
      },
    },
  },
});
