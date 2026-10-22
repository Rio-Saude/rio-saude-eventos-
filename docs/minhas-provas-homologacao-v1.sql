-- RIO SAUDE | Minha Provas V1 | SOMENTE HOMOLOGACAO
-- Aplicar exclusivamente no projeto xiiudduncvcxcvbgbqpc.
-- Fonte de provas publicas: calendario existente; nenhum dado pessoal e copiado.
create extension if not exists pgcrypto;

create table if not exists public.events (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  event_date date not null,
  end_date date,
  city text,
  state text,
  country text,
  venue text,
  category text,
  distances text,
  distance_options text[] not null default '{}'::text[],
  allow_other_distance boolean not null default true,
  allow_ultra_distance boolean not null default true,
  series_name text,
  site_url text,
  coupon_code text,
  coupon_label text,
  group_status text not null default 'disabled' check(group_status in ('disabled','checking','collecting','confirmed','closed')),
  group_minimum integer not null default 10 check(group_minimum > 0),
  group_deadline date,
  featured boolean not null default false,
  featured_note text,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists events_active_date_idx on public.events(event_date) where active = true;

create table if not exists public.event_entry_windows (
  id uuid primary key default gen_random_uuid(),
  event_name text not null references public.events(name) on update cascade on delete cascade,
  label text not null,
  kind text not null default 'registration',
  start_date date,
  end_date date,
  url text,
  active boolean not null default true
);
create index if not exists event_entry_windows_event_name_idx on public.event_entry_windows(event_name);

create table if not exists public.race_participations (
  event_id uuid not null references public.events(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  status text not null check(status in ('interest','going')),
  distance text check(char_length(distance) <= 80),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key(event_id,user_id)
);
create index if not exists race_participations_user_idx on public.race_participations(user_id);

create table if not exists public.race_suggestions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null check(char_length(name) between 3 and 160),
  event_date date not null,
  city text check(char_length(city) <= 120),
  category text check(char_length(category) <= 80),
  distance text check(char_length(distance) <= 80),
  notes text check(char_length(notes) <= 600),
  status text not null default 'pending' check(status in ('pending','approved','rejected')),
  admin_note text,
  reviewed_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists race_suggestions_user_idx on public.race_suggestions(user_id);
create index if not exists race_suggestions_pending_idx on public.race_suggestions(created_at) where status='pending';

alter table public.events enable row level security;
alter table public.event_entry_windows enable row level security;
alter table public.race_participations enable row level security;
alter table public.race_suggestions enable row level security;

create policy "race_catalog_athletes_read" on public.events for select to authenticated using(active=true);
create policy "race_catalog_admin_all" on public.events for all to authenticated using((select public.is_admin())) with check((select public.is_admin()));
create policy "race_windows_athletes_read" on public.event_entry_windows for select to authenticated using(active=true);
create policy "race_windows_admin_all" on public.event_entry_windows for all to authenticated using((select public.is_admin())) with check((select public.is_admin()));

create policy "race_participations_own_read" on public.race_participations for select to authenticated using((select auth.uid()) = user_id);
create policy "race_participations_admin_read" on public.race_participations for select to authenticated using((select public.is_admin()));
create policy "race_participations_own_create" on public.race_participations for insert to authenticated with check((select auth.uid()) = user_id);
create policy "race_participations_own_edit" on public.race_participations for update to authenticated using((select auth.uid()) = user_id) with check((select auth.uid()) = user_id);
create policy "race_participations_own_delete" on public.race_participations for delete to authenticated using((select auth.uid()) = user_id);

create policy "race_suggestions_own_read" on public.race_suggestions for select to authenticated using((select auth.uid()) = user_id);
create policy "race_suggestions_admin_read" on public.race_suggestions for select to authenticated using((select public.is_admin()));
create policy "race_suggestions_own_create" on public.race_suggestions for insert to authenticated with check((select auth.uid()) = user_id and status='pending' and reviewed_at is null and admin_note is null);
create policy "race_suggestions_admin_edit" on public.race_suggestions for update to authenticated using((select public.is_admin())) with check((select public.is_admin()));

revoke all on table public.events, public.event_entry_windows, public.race_participations, public.race_suggestions from anon, authenticated;
grant select,insert,update,delete on public.events, public.event_entry_windows, public.race_participations, public.race_suggestions to authenticated;

-- Contagens agregadas: identidade do aluno e dados individuais nunca sao retornados.
-- Funcao privilegiada isolada em schema nao exposto, e RPC publica sem privilege escalado.
create schema if not exists race_private;
revoke all on schema race_private from public;
grant usage on schema race_private to authenticated;
create or replace function race_private.counts()
returns table(event_id uuid,interest_count bigint,going_count bigint)
language sql stable security definer set search_path='' as $$
  select p.event_id,
    count(*) filter(where p.status='interest') as interest_count,
    count(*) filter(where p.status='going') as going_count
  from public.race_participations p
  where (select auth.uid()) is not null
  group by p.event_id
$$;
revoke all on function race_private.counts() from public;
grant execute on function race_private.counts() to authenticated;
create or replace function public.race_counts()
returns table(event_id uuid,interest_count bigint,going_count bigint)
language sql stable security invoker set search_path='' as $$
  select * from race_private.counts()
$$;
revoke all on function public.race_counts() from public;
grant execute on function public.race_counts() to authenticated;

-- Aprovacao transacional na sessao autenticada de um administrador.
create or replace function public.approve_race_suggestion(p_id uuid)
returns uuid
language plpgsql security invoker set search_path='' as $$
declare
  suggestion public.race_suggestions%rowtype;
  added_id uuid;
begin
  if (select auth.uid()) is null or not (select public.is_admin()) then
    raise exception 'Acesso restrito a equipe';
  end if;
  select * into suggestion from public.race_suggestions
  where id=p_id and status='pending' for update;
  if not found then raise exception 'Sugestao indisponivel'; end if;
  insert into public.events(name,event_date,city,category,distances,distance_options,active)
  values(suggestion.name,suggestion.event_date,suggestion.city,suggestion.category,suggestion.distance,
         case when coalesce(suggestion.distance,'')='' then '{}'::text[] else array[suggestion.distance] end,true)
  on conflict(name) do update set active=true
  returning id into added_id;
  update public.race_suggestions
  set status='approved',reviewed_at=now()
  where id=suggestion.id;
  return added_id;
end $$;
revoke all on function public.approve_race_suggestion(uuid) from public,anon;
grant execute on function public.approve_race_suggestion(uuid) to authenticated;

notify pgrst,'reload schema';