import { timingSafeEqual } from 'node:crypto';

export function isAuthorizedCronRequest(request: Request) {
  const configured = process.env.CRON_SECRET;
  const provided = request.headers.get('authorization')?.replace(/^Bearer\s+/i, '');
  if (!configured || !provided) return false;

  const expected = Buffer.from(configured);
  const actual = Buffer.from(provided);
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}
