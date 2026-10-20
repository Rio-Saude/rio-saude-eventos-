-- Archive the locality required by Annex II alongside server-recorded signature time.
alter table public.health_screenings
  add column if not exists signed_city text not null default 'Rio de Janeiro';
alter table public.health_screenings
  add constraint health_screenings_signed_city_valid
  check (length(btrim(signed_city)) between 2 and 120);
alter table public.health_screenings alter column signed_city drop default;
grant insert (signed_city) on public.health_screenings to authenticated;
