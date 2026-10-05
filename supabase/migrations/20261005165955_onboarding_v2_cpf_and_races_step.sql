-- V2: additive CPF and a separate races step. Existing data and RLS are preserved.
alter table public.athlete_profiles add column if not exists cpf text;
alter table public.athlete_profiles add constraint athlete_profiles_cpf_normalized
  check (cpf is null or cpf ~ '^[0-9]{11}$');

alter table public.athlete_profiles drop constraint athlete_profiles_onboarding_step_check;
alter table public.athlete_profiles add constraint athlete_profiles_onboarding_step_check
  check (onboarding_step between 1 and 6);

-- Old step 4 = TrainingPeaks; old step 5 = finalization. Run once via migration history.
update public.athlete_profiles set onboarding_step = onboarding_step + 1
where onboarding_step in (4, 5);

comment on column public.athlete_profiles.cpf is
  'Optional normalized Brazilian CPF (11 digits), reserved for future financial integration. Email remains the portal login.';
