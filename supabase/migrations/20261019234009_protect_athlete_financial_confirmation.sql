-- Financial confirmation must never be client-authoritative.
-- Users can report checkout submitted, but only a trusted backend/admin may confirm.
create or replace function public.protect_athlete_payment_status()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
begin
  if auth.role() = 'authenticated' and not coalesce(public.is_admin(), false) then
    if new.payment_status = 'confirmed' and old.payment_status is distinct from 'confirmed' then
      raise exception 'financial confirmation requires trusted backend' using errcode = '42501';
    end if;
    if old.payment_status = 'confirmed' and new.payment_status is distinct from 'confirmed' then
      raise exception 'confirmed payment cannot be changed by athlete' using errcode = '42501';
    end if;
  end if;
  return new;
end;
$$;
drop trigger if exists athlete_profiles_protect_financial_status on public.athlete_profiles;
create trigger athlete_profiles_protect_financial_status
before update of payment_status on public.athlete_profiles
for each row execute function public.protect_athlete_payment_status();
