import type { NextConfig } from 'next';

/* The app shipped with no security headers at all, on a surface that holds
   personal planning data, signs people in, and exposes an MCP endpoint.
   "Independent security review" is an open item on the release checklist in
   docs/implementation-status.md; these are the headers that can be set without
   a behaviour change to verify.

   Deliberately NOT set here:
   - Content-Security-Policy. Next.js inlines bootstrap scripts, so a real
     policy needs per-request nonces wired through the framework. Doing that
     blind — against authenticated screens that cannot be visually verified in
     this environment — risks a blank app. It is the right next step, but it
     needs a signed-in browser to confirm.
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

  // Do not advertise the framework on every response.
  poweredByHeader: false,
  async headers() {
    return [{ source: '/:path*', headers: securityHeaders }];
  },
};

export default nextConfig;
