-- Staged only: no user-facing health questionnaire is enabled by this migration.
-- Versioned Rio de Janeiro State Law 6.765/2014 Annex I (10 questions).
create table if not exists public.health_screenings (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  form_version text not null default 'rj_6765_2014_annex_i_v1'
    check (form_version = 'rj_6765_2014_annex_i_v1'),
  q1 boolean not null,
  q2 boolean not null,
  q3 boolean not null,
  q4 boolean not null,
  q5 boolean not null,
  q6 boolean not null,
  q7 boolean not null,
  q8 boolean not null,
  q9 boolean not null,
  q10 boolean not null,
  signed_name text not null check (length(btrim(signed_name)) between 3 and 160),
  declaration_accepted boolean not null check (declaration_accepted = true),
  signed_at timestamptz not null default now(),
  screening_result text generated always as (
    case when q1 or q2 or q3 or q4 or q5 or q6 or q7 or q8 or q9 or q10 then 'medical_review_required'
    else 'no_positive_responses' end
  ) stored
);
comment on table public.health_screenings is 'Sensitive self-reported health answers. Append-only per athlete; not training clearance.';
create index if not exists health_screenings_user_signed_idx
  on public.health_screenings(user_id, signed_at desc);
alter table public.health_screenings enable row level security;
alter table public.health_screenings force row level security;
revoke all on public.health_screenings from public, anon, authenticated;
grant select on public.health_screenings to authenticated;
grant insert (q1,q2,q3,q4,q5,q6,q7,q8,q9,q10,signed_name,declaration_accepted)
  on public.health_screenings to authenticated;
create policy "athlete reads own health screening"
  on public.health_screenings for select to authenticated
  using (user_id = (select auth.uid()));
create policy "athlete submits own health screening"
  on public.health_screenings for insert to authenticated
  with check (
    user_id = (select auth.uid()) and
    exists(select 1 from public.athlete_profiles p where p.user_id = (select auth.uid()))
  );
-- No authenticated UPDATE or DELETE: signed entries remain historical.
