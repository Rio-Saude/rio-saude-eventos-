alter table public.athlete_profiles
  add column if not exists goal_events jsonb not null default '[]'::jsonb,
  add column if not exists training_goals text[] not null default '{}'::text[],
  add column if not exists payment_followup_needed boolean not null default false;
alter table public.athlete_profiles
  add constraint goal_events_simple_array
  check (jsonb_typeof(goal_events) = 'array' and jsonb_array_length(goal_events) <= 15 and length(goal_events::text) <= 12000);
update public.athlete_profiles
set goal_events = jsonb_build_array(jsonb_build_object(
  'name',trim(goal_event_name),
  'event_date',goal_event_date,
  'custom',true
))
where goal_event_name is not null and btrim(goal_event_name) <> ''
  and goal_events = '[]'::jsonb;
-- Preserve old "Suas Provas" step 4 as the new TrainingPeaks step 4.
update public.athlete_profiles
set onboarding_step = case
  when onboarding_step = 5 then 4
  when onboarding_step = 6 then 5
  else onboarding_step end
where onboarding_step in (5,6);
alter table public.athlete_profiles
  drop constraint if exists athlete_profiles_onboarding_step_check;
alter table public.athlete_profiles
  add constraint athlete_profiles_onboarding_step_check
  check (onboarding_step between 1 and 5);
comment on column public.athlete_profiles.goal_events is
  'Array of planned races with name, custom flag and optional date; private to athlete and authorized staff.';
comment on column public.athlete_profiles.payment_followup_needed is
  'TrainingPeaks may be completed while Efí checkout is pending; return to financial step afterward.';
