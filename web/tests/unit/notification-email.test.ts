import { describe, expect, it } from 'vitest';
import { buildNotificationEmail } from '@/lib/notifications/email';

describe('notification reminder email', () => {
  it('contains only a generic count and the configured Planner AI link', () => {
    const email = buildNotificationEmail(2, 'https://planner.example/notifications');
    expect(email).toEqual({
      subject: '2 planning notifications in Planner AI',
      text: 'You have 2 planning notifications. Open Planner AI to review them: https://planner.example/notifications',
      html: '<p>You have 2 planning notifications.</p><p><a href="https://planner.example/notifications">Open Planner AI</a></p>',
    });
    expect(JSON.stringify(email)).not.toContain('Action');
    expect(JSON.stringify(email)).not.toContain('Note');
    expect(JSON.stringify(email)).not.toContain('Goal');
  });

  it('rejects invalid counts and non-web links', () => {
    expect(() => buildNotificationEmail(0, 'https://planner.example/notifications')).toThrow();
    expect(() => buildNotificationEmail(1, 'javascript:alert(1)')).toThrow();
  });
});
