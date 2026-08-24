'use client';

import Link from 'next/link';
import {
  Activity,
  Bell,
  CalendarCheck2,
  Compass,
  FileText,
  History,
  Inbox,
  ListChecks,
  Settings,
  Target,
  Trash2,
} from 'lucide-react';
import { usePathname } from 'next/navigation';

const links = [
  { name: 'Today', href: '/', icon: CalendarCheck2 },
  { name: 'Inbox', href: '/inbox', icon: Inbox },
  { name: 'Vision', href: '/vision', icon: Compass },
  { name: 'Plan', href: '/goals', icon: Target },
  { name: 'Settings', href: '/settings/security', icon: Settings },
];

export function NavLinks({
  showNotes = false,
  unreadNotifications = 0,
}: {
  showNotes?: boolean;
  unreadNotifications?: number;
}) {
  const pathname = usePathname();
  const visibleLinks = showNotes
    ? [
        ...links.slice(0, 4),
        { name: 'Notes', href: '/notes', icon: FileText },
        { name: 'Conversations', href: '/conversations', icon: History },
        { name: 'Notifications', href: '/notifications', icon: Bell },
        { name: 'Review', href: '/review', icon: ListChecks },
        { name: 'Activity', href: '/activity', icon: Activity },
        { name: 'Trash', href: '/trash', icon: Trash2 },
        ...links.slice(4),
      ]
    : links;

  return (
    <nav className="app-nav" aria-label="Primary navigation">
      <p className="nav-label">Workspace</p>
      {visibleLinks.map((link) => {
        const Icon = link.icon;
        const isActive =
          pathname === link.href ||
          (link.href === '/settings/security' && pathname.startsWith('/settings/'));
        return (
          <Link
            key={link.href}
            href={link.href}
            className={`nav-link${isActive ? ' nav-link-active' : ''}`}
          >
            <Icon className="nav-icon" size={17} strokeWidth={1.8} aria-hidden="true" />
            <span>{link.name}</span>
            {link.href === '/notifications' && unreadNotifications > 0 ? (
              <span
                className="nav-badge"
                aria-label={`${unreadNotifications} unread notifications`}
              >
                {unreadNotifications > 99 ? '99+' : unreadNotifications}
              </span>
            ) : null}
          </Link>
        );
      })}
    </nav>
  );
}
