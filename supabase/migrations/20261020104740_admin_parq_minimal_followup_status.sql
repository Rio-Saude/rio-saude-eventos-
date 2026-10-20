-- Admins receive only screening status, never the answers or signed declaration.
-- Admin access is checked inside the SECURITY DEFINER function.
create or replace function public.admin_parq_status()
returns table(athlete_name text, athlete_email text, signed_at timestamptz, triage_status text)
language sql stable security definer
set search_path = public
as $$
  select
    btrim(concat_ws(' ',p.first_name,p.last_name))::text,
    p.email::text,
    h.signed_at,
    case
      when h.signed_at is null then 'not_submitted'
      when h.signed_at <= now() - interval '365 days' then 'expired'
      else h.screening_result
    end::text
  from public.athlete_profiles p
  left join lateral (
    select s.signed_at,s.screening_result
    from public.health_screenings s
    where s.user_id=p.user_id
    order by s.signed_at desc
    limit 1
  ) h on true
  where auth.uid() is not null and public.is_admin();
$$;
revoke all on function public.admin_parq_status() from public,anon;
grant execute on function public.admin_parq_status() to authenticated;
comment on function public.admin_parq_status() is
  'Only users included in admin_emails see latest PAR-Q state per athlete; no raw answers disclosed.';
