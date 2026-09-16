// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { NotificationsCenter } from '@/components/notifications-center';
import type { NotificationView } from '@/app/notifications/actions';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: vi.fn(), replace: vi.fn(), push: vi.fn() }),
}));

vi.mock('next/link', () => ({
  default: ({ children, href, ...rest }: { children: React.ReactNode; href: string }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

vi.mock('@/app/notifications/actions', () => ({
  markNotificationReadAction: vi.fn(async () => ({ ok: true })),
  dismissNotificationAction: vi.fn(async () => ({ ok: true })),
  refreshNotificationsAction: vi.fn(async () => ({ ok: true })),
}));

afterEach(cleanup);

function notification(id: string, kind: NotificationView['kind'], title: string): NotificationView {
  return {
    id,
    kind,
    title,
    body: `${title} body`,
    href: `/planner?n=${id}`,
    visibleAt: '2026-09-10T10:00:00.000Z',
    readAt: null,
    version: 1,
  };
}

const queue = [
  notification('a', 'overdue_actions', 'Two actions need a date'),
  notification('b', 'overdue_actions', 'One action slipped'),
  notification('c', 'weekly_review', 'Your weekly review is ready'),
];

describe('notification kinds', () => {
  it('narrows the queue to one kind and counts the whole queue, not the filter', () => {
    render(<NotificationsCenter initialNotifications={queue} inAppEnabled />);

    // Counts describe everything waiting, so a tab that would show nothing
    // says so before it is chosen.
    expect(screen.getByRole('tab', { name: 'All 3' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tab', { name: 'Planning 2' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'System 0' })).toBeInTheDocument();
    expect(screen.getAllByRole('article')).toHaveLength(3);

    fireEvent.click(screen.getByRole('tab', { name: 'Planning 2' }));

    expect(screen.getByRole('tab', { name: 'Planning 2' })).toHaveAttribute(
      'aria-selected',
      'true'
    );
    expect(screen.getAllByRole('article')).toHaveLength(2);
    expect(screen.queryByText('Your weekly review is ready')).not.toBeInTheDocument();
    // The count above the list is the queue, which the filter does not change.
    expect(screen.getByText('3 unread')).toBeInTheDocument();
  });

  it('offers the way back from a kind with nothing in it', () => {
    render(<NotificationsCenter initialNotifications={queue} inAppEnabled />);

    fireEvent.click(screen.getByRole('tab', { name: 'System 0' }));
    expect(screen.getByRole('heading', { name: 'Nothing here' })).toBeInTheDocument();
    expect(screen.queryByRole('article')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Show all 3' }));
    expect(screen.getAllByRole('article')).toHaveLength(3);
  });

  it('leaves an empty queue alone rather than offering a filter over nothing', () => {
    render(<NotificationsCenter initialNotifications={[]} inAppEnabled />);

    expect(screen.queryByRole('tablist')).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'You are caught up' })).toBeInTheDocument();
  });

  it('does not offer a filter when in-app notifications are switched off', () => {
    render(<NotificationsCenter initialNotifications={queue} inAppEnabled={false} />);

    expect(screen.queryByRole('tablist')).not.toBeInTheDocument();
    expect(
      screen.getByRole('heading', { name: 'In-app notifications are off' })
    ).toBeInTheDocument();
  });
});
