-- Shared org state table for the app (hierarchy + employee records as JSONB)
create table if not exists public.org_shared_state (
  id text primary key,
  data jsonb not null default '[]'::jsonb,
  updated_at timestamptz not null default timezone('utc', now())
);

-- Keep updated_at fresh on updates
create or replace function public.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = timezone('utc', now());
  return new;
end;
$$;

drop trigger if exists trg_org_shared_state_touch_updated_at on public.org_shared_state;
create trigger trg_org_shared_state_touch_updated_at
before update on public.org_shared_state
for each row
execute function public.touch_updated_at();

-- Seed single shared row if missing
insert into public.org_shared_state (id, data)
values ('employees', '[]'::jsonb)
on conflict (id) do nothing;

-- RLS policies (open for anon/auth so shared public org link can read/write)
alter table public.org_shared_state enable row level security;

drop policy if exists "org_shared_state_select_all" on public.org_shared_state;
create policy "org_shared_state_select_all"
on public.org_shared_state
for select
to anon, authenticated
using (true);

drop policy if exists "org_shared_state_insert_all" on public.org_shared_state;
create policy "org_shared_state_insert_all"
on public.org_shared_state
for insert
to anon, authenticated
with check (true);

drop policy if exists "org_shared_state_update_all" on public.org_shared_state;
create policy "org_shared_state_update_all"
on public.org_shared_state
for update
to anon, authenticated
using (true)
with check (true);

