-- Rio Saúde • Central de Provas
-- Execute em um projeto Supabase e depois preencha config.js com Project URL + anon key.

create extension if not exists pgcrypto;

create table if not exists public.admin_emails (
  email text primary key,
  created_at timestamptz not null default now()
);

create table if not exists public.events (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  event_date date,
  end_date date,
  city text,
  state text default 'RJ',
  country text default 'Brasil',
  category text,
  site_url text,
  source_url text,
  coupon_code text,
  coupon_label text,
  group_status text not null default 'checking'
    check (group_status in ('disabled','checking','collecting','confirmed','closed')),
  group_minimum integer not null default 10 check (group_minimum > 0),
  group_deadline date,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.race_responses (
  id uuid primary key default gen_random_uuid(),
  event_name text not null,
  athlete_name text not null,
  athlete_email text not null,
  distance text,
  status text not null check (status in ('interest','going','group_interest')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists race_responses_event_email_unique
on public.race_responses ((lower(event_name)), (lower(athlete_email)));

create or replace function public.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists events_touch_updated_at on public.events;
create trigger events_touch_updated_at
before update on public.events
for each row execute function public.touch_updated_at();

drop trigger if exists responses_touch_updated_at on public.race_responses;
create trigger responses_touch_updated_at
before update on public.race_responses
for each row execute function public.touch_updated_at();

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.admin_emails a
    where lower(a.email) = lower(coalesce(auth.jwt()->>'email',''))
  );
$$;

revoke all on function public.is_admin() from public;
grant execute on function public.is_admin() to authenticated;

create or replace function public.submit_race_response(
  p_event_name text,
  p_athlete_name text,
  p_athlete_email text,
  p_distance text,
  p_status text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if trim(coalesce(p_event_name,'')) = '' then raise exception 'event required'; end if;
  if trim(coalesce(p_athlete_name,'')) = '' then raise exception 'name required'; end if;
  if trim(coalesce(p_athlete_email,'')) = '' then raise exception 'email required'; end if;
  if p_athlete_email !~* '^[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}$' then raise exception 'invalid email'; end if;
  if p_status not in ('interest','going','group_interest') then raise exception 'invalid status'; end if;

  insert into public.race_responses(event_name, athlete_name, athlete_email, distance, status)
  values(trim(p_event_name), trim(p_athlete_name), lower(trim(p_athlete_email)), nullif(trim(coalesce(p_distance,'')),''), p_status)
  on conflict ((lower(event_name)), (lower(athlete_email)))
  do update set
    athlete_name = excluded.athlete_name,
    distance = excluded.distance,
    status = excluded.status,
    updated_at = now();
end;
$$;

revoke all on function public.submit_race_response(text,text,text,text,text) from public;
grant execute on function public.submit_race_response(text,text,text,text,text) to anon, authenticated;

alter table public.admin_emails enable row level security;
alter table public.events enable row level security;
alter table public.race_responses enable row level security;

drop policy if exists "admins read events" on public.events;
create policy "admins read events" on public.events for select to authenticated using (public.is_admin());

drop policy if exists "admins write events" on public.events;
create policy "admins write events" on public.events for all to authenticated
using (public.is_admin()) with check (public.is_admin());

drop policy if exists "admins read responses" on public.race_responses;
create policy "admins read responses" on public.race_responses for select to authenticated using (public.is_admin());

drop policy if exists "admins manage responses" on public.race_responses;
create policy "admins manage responses" on public.race_responses for all to authenticated
using (public.is_admin()) with check (public.is_admin());

drop policy if exists "admins manage admin emails" on public.admin_emails;
create policy "admins manage admin emails" on public.admin_emails for all to authenticated
using (public.is_admin()) with check (public.is_admin());
