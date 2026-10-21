-- HOMOLOGATION ONLY. Never apply this file to production.
-- The sanitized homologation schema intentionally has no public.events table.
-- These are clearly-labelled, non-personal fixtures for validating onboarding search.
create table if not exists public.onboarding_race_catalog (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(btrim(name)) between 3 and 180),
  event_date date not null,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (name, event_date)
);

alter table public.onboarding_race_catalog enable row level security;
revoke all on public.onboarding_race_catalog from anon;
grant select on public.onboarding_race_catalog to authenticated;

drop policy if exists "authenticated users read active onboarding test races" on public.onboarding_race_catalog;
create policy "authenticated users read active onboarding test races"
  on public.onboarding_race_catalog for select to authenticated using (active = true);

insert into public.onboarding_race_catalog(name,event_date,active) values
  ('Prova de teste Rio Saúde — 5 km',date '2027-01-17',true),
  ('Prova de teste Rio Saúde — 10 km',date '2027-02-14',true),
  ('Prova de teste Rio Saúde — Meia Maratona',date '2027-03-21',true)
on conflict (name,event_date) do update set active=excluded.active;
