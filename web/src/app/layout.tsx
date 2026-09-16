import type { Metadata } from 'next';
import { headers } from 'next/headers';
import './globals.css';
import { createClient } from '@/lib/supabase/server';
import { ServiceWorkerRegistration } from '@/components/service-worker-registration';
import { ExperienceShell } from '@/components/experience-shell';

export const metadata: Metadata = {
  title: 'Planner AI',
  description: 'A calm, voice-first workspace for your plans and progress.',
  applicationName: 'Planner AI',
  manifest: '/manifest.json',
  icons: { icon: '/planner-icon.svg', apple: '/planner-icon.svg' },
};

export default async function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  // proxy.ts mints a per-request nonce and the CSP is nonce-based, so an
  // un-nonced inline script is blocked outright. Without this the pre-paint
  // stamp below never ran and every load flashed the wrong theme before
  // hydration corrected it.
  const nonce = (await headers()).get('x-nonce') ?? undefined;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  let unreadNotifications = 0;
  if (user && process.env.PLANNER_DATA_MODEL === 'canonical') {
    const { count } = await supabase
      .from('notifications')
      .select('id', { count: 'exact', head: true })
      .is('read_at', null)
      .is('dismissed_at', null)
      .lte('visible_at', new Date().toISOString());
    unreadNotifications = count ?? 0;
  }
  const canonical = process.env.PLANNER_DATA_MODEL === 'canonical';

  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        {/* Applies an explicit theme choice before first paint. With no stored
            choice the stamp is absent and prefers-color-scheme decides, so the
            default costs nothing and there is no flash either way. */}
        <script
          nonce={nonce}
          dangerouslySetInnerHTML={{
            __html:
              "try{var t=localStorage.getItem('planner-theme');if(t==='dark'||t==='light')document.documentElement.dataset.theme=t}catch(e){}",
          }}
        />
      </head>
      <body>
        <ServiceWorkerRegistration />
        {user ? (
          <ExperienceShell
            canonical={canonical}
            email={user.email ?? ''}
            unreadNotifications={unreadNotifications}
          >
            {children}
          </ExperienceShell>
        ) : (
          children
        )}
      </body>
    </html>
  );
}
