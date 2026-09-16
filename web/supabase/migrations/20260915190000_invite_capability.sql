-- Signup stops holding a service-role key.
--
-- This is the one EH-01 exception where no caller identity exists yet: an
-- invite is claimed before the account it creates. There is no `auth.uid()` to
-- derive anything from, so the pattern used by the other capabilities does not
-- apply, and the register's alternative -- a restricted non-BYPASSRLS role --
-- would need a second production credential to be provisioned and signed.
--
-- The invite code is already a credential. `claim_beta_invite` matches on the
-- SHA-256 of that code, so a caller must present a value that hashes into the
-- table; guessing one means guessing a 256-bit digest, not a human-typed code.
-- Binding the capability to the narrow secret the operation is actually about
-- is the least-privilege answer here, and it is strictly narrower than binding
-- it to a key that can read and write every table in the database.
--
-- Nothing new becomes possible. Everything an anonymous caller can do with
-- these two functions, they could already do by submitting the signup form
-- with the same invite code.
--
-- `release_beta_invite` is a different matter and is fixed rather than moved.
-- It accepted a bare invite id -- not a secret -- and decremented the use
-- count, so it was a way to hand uses back to any invite whose id was known,
-- with no proof the caller had ever claimed it. It now requires the same token
-- hash that claimed the invite, which ties a release to a claim.

begin;

drop function if exists public.release_beta_invite(uuid);

create function public.release_beta_invite(p_invite_id uuid, p_token_hash text)
returns void
language sql
security definer
set search_path = pg_catalog, public
as $$
  update public.beta_invites
  set uses = greatest(uses - 1, 0)
  where id = p_invite_id and token_hash = p_token_hash;
$$;

-- The invite code is the credential. A signed-in person has no reason to claim
-- one, and no trusted role needs to any more.
revoke all on function public.claim_beta_invite(text, text)
from public, authenticated, service_role;
grant execute on function public.claim_beta_invite(text, text) to anon;

revoke all on function public.release_beta_invite(uuid, text)
from public, authenticated, service_role;
grant execute on function public.release_beta_invite(uuid, text) to anon;

commit;
