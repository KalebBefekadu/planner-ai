begin;

alter table public.operation_contracts enable row level security;
alter table public.operation_contracts force row level security;

create policy operation_contracts_select_authenticated
on public.operation_contracts
for select
to authenticated
using (true);

commit;
