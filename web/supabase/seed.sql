-- Local-only fixture. The token is the SHA-256 hash of "planner-local-invite".
insert into public.beta_invites (token_hash, intended_email, expires_at, max_uses)
values (
  '10c7e27568cc1050656eb8e55c7108d182f255c7291747646d42d15ddcaa57ac',
  null,
  now() + interval '30 days',
  20
)
on conflict (token_hash) do nothing;
