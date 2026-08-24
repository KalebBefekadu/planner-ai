export function buildNotificationEmail(count: number, notificationsUrl: string) {
  if (!Number.isInteger(count) || count < 1 || count > 10_000) {
    throw new Error('Invalid notification count.');
  }
  const url = new URL(notificationsUrl);
  if (!['http:', 'https:'].includes(url.protocol)) {
    throw new Error('Invalid notifications URL.');
  }
  const label = `${count} planning notification${count === 1 ? '' : 's'}`;
  const href = url
    .toString()
    .replaceAll('&', '&amp;')
    .replaceAll('"', '&quot;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;');
  return {
    subject: `${label} in Planner AI`,
    text: `You have ${label}. Open Planner AI to review them: ${url.toString()}`,
    html: `<p>You have ${label}.</p><p><a href="${href}">Open Planner AI</a></p>`,
  };
}
