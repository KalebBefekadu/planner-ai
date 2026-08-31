import type { Metadata } from 'next';
import Link from 'next/link';
import './globals.css';
import { createClient } from '@/lib/supabase/server';
import AuthButton from '@/components/auth-button';
import { ThemeToggle } from '@/components/theme-toggle';
import { NavLinks } from '@/components/nav-links';
import { AssistantDock } from '@/components/assistant-dock';
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
  const experienceV2 = process.env.PLANNER_UI_V2 === 'enabled';

  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        {/* Applies an explicit theme choice before first paint. With no stored
            choice the stamp is absent and prefers-color-scheme decides, so the
            default costs nothing and there is no flash either way. */}
        <script
          dangerouslySetInnerHTML={{
            __html:
              "try{var t=localStorage.getItem('planner-theme');if(t==='dark'||t==='light')document.documentElement.dataset.theme=t}catch(e){}",
          }}
        />
      </head>
      <body>
        <ServiceWorkerRegistration />
        {user && experienceV2 ? (
          <ExperienceShell
            canonical={canonical}
            email={user.email ?? ''}
            unreadNotifications={unreadNotifications}
          >
            {children}
          </ExperienceShell>
        ) : user ? (
          <div className="app-shell">
            <aside className="app-sidebar">
              <Link className="brand" href="/" aria-label="Planner AI home">
                <span className="brand-mark" aria-hidden="true">
                  P
                </span>
                <span>Planner AI</span>
              </Link>
              <NavLinks showNotes={canonical} unreadNotifications={unreadNotifications} />
              <AssistantDock />
              <div className="sidebar-footer">
                <ThemeToggle />
                <AuthButton email={user.email ?? ''} />
              </div>
            </aside>
            <main className="app-main">{children}</main>
          </div>
        ) : (
          children
        )}
      </body>
    </html>
  );
}
