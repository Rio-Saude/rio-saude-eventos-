-- Do not inherit broad default grants on the health and registration tables.
-- RLS controls rows; these grants control which SQL operations can reach RLS.
revoke all privileges on table public.simplified_registration_states from public, anon, authenticated;
revoke all privileges on table public.simplified_health_screenings from public, anon, authenticated;

grant select, insert, update on table public.simplified_registration_states to authenticated;
grant select, insert on table public.simplified_health_screenings to authenticated;
