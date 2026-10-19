-- Add self-reported training injury history to the athlete onboarding profile.
-- Keep protected by existing athlete_profiles RLS (athlete owner + authorized team).
alter table public.athlete_profiles
  add column if not exists had_training_injury boolean,
  add column if not exists training_injury_details text;
alter table public.athlete_profiles
  drop constraint if exists athlete_profiles_training_injury_details_length;
alter table public.athlete_profiles
  add constraint athlete_profiles_training_injury_details_length
  check (training_injury_details is null or length(training_injury_details) <= 1000);
comment on column public.athlete_profiles.training_injury_details is
  'Self-reported prior training injury details; restricted by athlete_profiles RLS.';
