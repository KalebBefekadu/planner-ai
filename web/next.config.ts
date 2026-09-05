import type { NextConfig } from 'next';

/* The app shipped with no security headers at all, on a surface that holds
   personal planning data, signs people in, and exposes an MCP endpoint.
   "Independent security review" is an open item on the release checklist in
   docs/status.md; these are the headers that can be set without
   a behaviour change to verify.

   The Content Security Policy is set in proxy.ts instead of this static list:
   it uses a fresh request nonce so Next can safely authorize its own runtime
   scripts without permitting arbitrary inline scripts.

   Deliberately NOT set here:
   - Cross-Origin-Embedder-Policy, which would break third-party embeds and
     needs the same verification. */

const securityHeaders = [
  // Stop the browser second-guessing declared content types.
  { key: 'X-Content-Type-Options', value: 'nosniff' },

  // Authenticated planning surfaces should never be framed: a clickjacked
  // "Apply 4 changes" is a real risk given the proposal flow.
  { key: 'X-Frame-Options', value: 'DENY' },

  // Send the origin cross-site, never the full path — Planner AI paths carry
  // record identifiers.
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },

  /* Voice capture in dump-ui.tsx needs the microphone, so it is allowed for
     this origin and denied to embedded content. Everything the app does not
     use is switched off outright. */
  {
    key: 'Permissions-Policy',
    value: [
      'microphone=(self)',
      'camera=()',
      'geolocation=()',
      'payment=()',
      'usb=()',
      'interest-cohort=()',
    ].join(', '),
  },

  // Isolate the browsing context from cross-origin openers.
  { key: 'Cross-Origin-Opener-Policy', value: 'same-origin' },
];

const nextConfig: NextConfig = {
  allowedDevOrigins: ['127.0.0.1'],

  // Playwright starts its own isolated development server. Keeping its build
  // output separate means its server can run while a developer uses `npm run dev`.
  distDir: process.env.NEXT_DIST_DIR ?? '.next',

  // Do not advertise the framework on every response.
  poweredByHeader: false,
  async headers() {
    return [{ source: '/:path*', headers: securityHeaders }];
  },
};

export default nextConfig;
