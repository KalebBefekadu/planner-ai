// Supabase now provisions publishable keys. Keep the legacy anonymous-key
// fallback while existing deployments migrate their environment variables.
export function supabasePublicKey() {
  const key =
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!key) throw new Error('A Supabase publishable key is not configured.');
  return key;
}
