import { notFound } from 'next/navigation';
import type { ReactNode } from 'react';

/* /preview is the internal design reference. It carries fixture content, it is
   listed as a public route in the auth middleware, and it was shipping in the
   production build — so anyone could read the team's in-progress design, and
   the Settings mock was serving a real name and email address to the open
   internet.

   It stays reachable wherever it is explicitly switched on, and returns 404
   everywhere else. This is a server component so the check happens before any
   of the preview is sent to the browser. */
export default function PreviewLayout({ children }: { children: ReactNode }) {
  if (process.env.PLANNER_UI_PREVIEW !== 'enabled') notFound();
  return children;
}
