'use client';

import Link from 'next/link';
import {
  Brain,
  Database,
  Gauge,
  KeyRound,
  PlugZap,
  ShieldAlert,
  SlidersHorizontal,
} from 'lucide-react';
import { usePathname } from 'next/navigation';

const tabs = [
  { href: '/settings/preferences', label: 'Preferences', icon: SlidersHorizontal },
  { href: '/settings/ai', label: 'AI usage', icon: Gauge },
  { href: '/settings/security', label: 'Security', icon: KeyRound },
  { href: '/settings/safety', label: 'Safety', icon: ShieldAlert },
  { href: '/settings/mcp', label: 'AI connections', icon: PlugZap },
  { href: '/settings/memory', label: 'Memory', icon: Brain },
  { href: '/settings/data', label: 'Data', icon: Database },
];

export function SettingsTabs({ showCanonical = false }: { showCanonical?: boolean }) {
  const pathname = usePathname();
  const visibleTabs = showCanonical
    ? tabs
    : tabs.filter((tab) => ['/settings/security', '/settings/safety'].includes(tab.href));
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
