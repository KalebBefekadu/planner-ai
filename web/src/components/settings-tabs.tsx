'use client';

import Link from 'next/link';
import {
  ArrowUpRight,
  Brain,
  Database,
  Gauge,
  KeyRound,
  PlugZap,
  ShieldAlert,
  SlidersHorizontal,
  UserRound,
} from 'lucide-react';
import { usePathname } from 'next/navigation';

const tabs = [
  { href: '/settings/account', label: 'Account', icon: UserRound },
  { href: '/settings/preferences', label: 'Preferences', icon: SlidersHorizontal },
  { href: '/settings/ai', label: 'AI usage', icon: Gauge },
  { href: '/settings/security', label: 'Security', icon: KeyRound },
  { href: '/settings/safety', label: 'Safety', icon: ShieldAlert },
  { href: '/settings/mcp', label: 'AI connections', icon: PlugZap },
  { href: '/settings/memory', label: 'Memory', icon: Brain },
  { href: '/settings/data', label: 'Data', icon: Database },
];

const legacyTabs = ['/settings/security', '/settings/safety'];

const tabLabels = new Map(tabs.map((tab) => [tab.href, tab.label]));

/* The tab bar already links to every section, so a bare list of the other
   sections would repeat it. What a tab bar cannot say is *why* two sections
   belong together — that the address you sign in with is changed under
   Security, or that a connected client obeys the Safety limits. Each entry
   below is that sentence, which is the part worth carrying over. */
const relatedSettings: Record<string, Array<{ href: string; reason: string }>> = {
  '/settings/account': [
    { href: '/settings/security', reason: 'Change how you sign in' },
    { href: '/settings/data', reason: 'Export or delete everything you own' },
  ],
  '/settings/preferences': [
    { href: '/settings/account', reason: 'See whose workspace these defaults shape' },
    { href: '/settings/memory', reason: 'Decide what the assistant keeps between sessions' },
  ],
  '/settings/ai': [
    { href: '/settings/safety', reason: 'Decide what the assistant may do unattended' },
    { href: '/settings/memory', reason: 'See what context each request is spending' },
  ],
  '/settings/security': [
    { href: '/settings/account', reason: 'See the identity these authenticators protect' },
    { href: '/settings/safety', reason: 'Require confirmation for irreversible actions' },
  ],
  '/settings/safety': [
    { href: '/settings/ai', reason: 'See how much budget the assistant has left' },
    { href: '/settings/security', reason: 'Add the authenticator a step-up prompt asks for' },
  ],
  '/settings/mcp': [
    { href: '/settings/safety', reason: 'Bound what a connected client is allowed to do' },
    { href: '/settings/security', reason: 'Protect the token with step-up authentication' },
  ],
  '/settings/memory': [
    { href: '/settings/ai', reason: 'See where remembered context is spent' },
    { href: '/settings/data', reason: 'Take a copy of what has been stored' },
  ],
  '/settings/data': [
    { href: '/settings/account', reason: 'Confirm whose records these are' },
    { href: '/settings/security', reason: 'Prove your identity before an export' },
  ],
};

export function SettingsTabs({ showCanonical = false }: { showCanonical?: boolean }) {
  const pathname = usePathname();
  const visibleTabs = showCanonical ? tabs : tabs.filter((tab) => legacyTabs.includes(tab.href));
  return (
    <nav className="settings-tabs" aria-label="Settings sections">
      {visibleTabs.map((tab) => {
        const Icon = tab.icon;
        return (
          <Link
            className={pathname === tab.href ? 'settings-tab settings-tab-active' : 'settings-tab'}
            href={tab.href}
            key={tab.href}
          >
            <Icon size={15} aria-hidden="true" />
            {tab.label}
          </Link>
        );
      })}
    </nav>
  );
}

export function settingsRelatedLinks(pathname: string, canonical: boolean) {
  return (relatedSettings[pathname] ?? [])
    .filter((link) => canonical || legacyTabs.includes(link.href))
    .map((link) => ({ ...link, label: tabLabels.get(link.href) ?? link.href }));
}

export function SettingsRelatedLinks({ canonical }: { canonical: boolean }) {
  const pathname = usePathname();
  const links = settingsRelatedLinks(pathname, canonical);
  if (!links.length) return null;
  return (
    <nav className="settings-related" aria-label="Related settings">
      <p>Related settings</p>
      <div>
        {links.map((link) => (
          <Link href={link.href} key={link.href}>
            <span>
              <strong>{link.label}</strong>
              <small>{link.reason}</small>
            </span>
            <ArrowUpRight size={15} aria-hidden="true" />
          </Link>
        ))}
      </div>
    </nav>
  );
}
