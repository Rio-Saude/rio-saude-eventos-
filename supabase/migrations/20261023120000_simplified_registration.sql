-- Isolated initial-registration state. It intentionally does not mark the formal onboarding complete.
create table if not exists public.simplified_registration_states (
  user_id uuid primary key references auth.users(id) on delete cascade,
  stage smallint not null default 3 check (stage between 3 and 6),
  completed_at timestamptz,
  health_triage_positive boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.simplified_health_screenings (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  answers jsonb not null,
  medical_review_recommended boolean not null default false,
  created_at timestamptz not null default now(),
  constraint simplified_health_screenings_answers_object check (jsonb_typeof(answers) = 'object')
);

comment on table public.simplified_health_screenings is 'Initial health triage only; not a signed PAR-Q or medical clearance.';
create index if not exists simplified_health_screenings_user_created_idx on public.simplified_health_screenings(user_id, created_at desc);
alter table public.simplified_registration_states enable row level security;
alter table public.simplified_health_screenings enable row level security;
create policy "athlete manages own simplified registration state" on public.simplified_registration_states for all to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy "athlete reads own simplified health triage" on public.simplified_health_screenings for select to authenticated using (user_id = (select auth.uid()));
create policy "athlete inserts own simplified health triage" on public.simplified_health_screenings for insert to authenticated with check (user_id = (select auth.uid()));
create policy "admins read simplified health triage" on public.simplified_health_screenings for select to authenticated using (public.is_admin());
grant select, insert, update on public.simplified_registration_states to authenticated;
grant select, insert on public.simplified_health_screenings to authenticated;
