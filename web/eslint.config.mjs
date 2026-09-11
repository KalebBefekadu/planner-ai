import { defineConfig, globalIgnores } from 'eslint/config';
import nextVitals from 'eslint-config-next/core-web-vitals';
import nextTs from 'eslint-config-next/typescript';

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    '.next/**',
    '.next-e2e/**',
    'out/**',
    'build/**',
    'next-env.d.ts',
    'supabase/.branches/**',
    'supabase/.temp/**',
  ]),

  /* The /preview route is a fixture-backed visual reference, not a source of
     production code. Shared frame components live in src/components/shell and
     src/lib/shell and take props only; Preview and the authenticated loaders
     are both callers of those, never of each other. Without this rule the
     boundary is a convention someone has to remember, and one import of a
     fixture would make the prototype a production dependency. */
  {
    files: ['src/**/*.{ts,tsx}'],
    ignores: ['src/app/preview/**'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['@/app/preview/*', '**/app/preview/*', './preview/*'],
              message:
                'The /preview route is a fixture-backed reference. Extract the shared part into src/components/shell or src/lib/shell and import that instead.',
            },
          ],
        },
      ],
    },
  },

  /* Shared frame components are data-agnostic: they may not reach for a
     fixture, a loader, or a Server Action. Mutation stays behind
     executeOperation in the authenticated routes that own it. */
  {
    files: ['src/components/shell/**/*.{ts,tsx}', 'src/lib/shell/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['@/app/**', '**/app/**'],
              message:
                'Shared shell components take props only. Let the route pass the data in rather than importing a loader, a Server Action or a fixture.',
            },
          ],
        },
      ],
    },
  },
]);

export default eslintConfig;
