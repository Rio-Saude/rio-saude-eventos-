-- Enable Rio de Janeiro PAR-Q workflow as step 3/5.
-- Existing unfinished enrollments: Finance 3->4 and TrainingPeaks 4->5.
-- Preserve completed enrollments; they may complete PAR-Q on edit.
alter table public.athlete_profiles drop constraint if exists athlete_profiles_onboarding_step_check;
alter table public.athlete_profiles
 add constraint athlete_profiles_onboarding_step_check check(onboarding_step between 1 and 5);
update public.athlete_profiles
set onboarding_step = case when onboarding_step=3 then 4 when onboarding_step=4 then 5 else onboarding_step end
where onboarding_completed_at is null and onboarding_step in (3,4);
-- Minor's responsible adult is explicitly recorded and must accept authorization.
alter table public.health_screenings
 add column if not exists signer_role text not null default 'athlete',
 add column if not exists guardian_name text,
 add column if not exists guardian_authorization_accepted boolean not null default false;
alter table public.health_screenings
 add constraint health_screenings_signer_role_check check (signer_role in ('athlete','guardian'));
alter table public.health_screenings
 add constraint health_screenings_guardian_fields_check check (
   signer_role = 'athlete' or (
     length(btrim(coalesce(guardian_name,''))) between 3 and 160
     and guardian_authorization_accepted = true
     and lower(btrim(signed_name)) = lower(btrim(guardian_name))
   )
 );
grant insert (signer_role,guardian_name,guardian_authorization_accepted) on public.health_screenings to authenticated;
-- Guardian validation is server-side, based on the athlete's birth date.
create or replace function public.validate_health_screening_signer()
returns trigger
language plpgsql
security invoker
set search_path=public
as $$
declare
  dob date;
  age_at_submission integer;
begin
  select p.birth_date into dob
  from public.athlete_profiles p
  where p.user_id = new.user_id;
  if dob is null then
    raise exception 'birth date required for health screening' using errcode='23514';
  end if;
  age_at_submission = extract(year from age(new.signed_at::date,dob));
  if age_at_submission < 18 and
     (new.signer_role <> 'guardian' or not new.guardian_authorization_accepted) then
    raise exception 'guardian signature and authorization required for minors' using errcode='23514';
  end if;
  if age_at_submission >= 18 and new.signer_role <> 'athlete' then
    raise exception 'adult must sign own questionnaire' using errcode='23514';
  end if;
  return new;
end;
$$;
revoke all on function public.validate_health_screening_signer() from public,anon,authenticated;
drop trigger if exists health_screenings_validate_signer on public.health_screenings;
create trigger health_screenings_validate_signer
before insert on public.health_screenings
for each row execute function public.validate_health_screening_signer();
