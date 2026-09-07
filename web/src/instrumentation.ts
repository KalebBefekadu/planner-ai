// Runs once per server process, before any request is handled.
export async function register() {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return;
  const { installClientDisconnectGuard } = await import('@/lib/api/client-disconnect-guard');
  installClientDisconnectGuard();
}
