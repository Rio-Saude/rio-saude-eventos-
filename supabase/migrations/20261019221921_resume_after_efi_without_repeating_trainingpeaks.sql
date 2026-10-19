alter table public.athlete_profiles
  add column if not exists trainingpeaks_step_seen boolean not null default false;
-- Existing athletes who finished onboarding or already moved beyond TrainingPeaks have seen this step.
update public.athlete_profiles
set trainingpeaks_step_seen = true
where onboarding_completed_at is not null or onboarding_step = 5;
comment on column public.athlete_profiles.trainingpeaks_step_seen is
  'Tracks whether the TrainingPeaks onboarding screen was visited, independently of connection status.';
