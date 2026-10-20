-- Prevent forged self-signatures on adult PAR-Q submissions.
create or replace function public.validate_health_screening_signer()
returns trigger language plpgsql security invoker
set search_path=public
as $$
declare dob date; fname text; lname text; age_on_submission int;
begin
  select p.birth_date,p.first_name,p.last_name
    into dob,fname,lname from public.athlete_profiles p where p.user_id=new.user_id;
  if dob is null then
    raise exception 'birth date required' using errcode='23514';
  end if;
  age_on_submission=extract(year from age(new.signed_at::date,dob));
  if age_on_submission<18 then
    if new.signer_role<>'guardian' or not new.guardian_authorization_accepted or
       lower(btrim(new.signed_name))<>lower(btrim(new.guardian_name)) then
      raise exception 'guardian signature and authorization required' using errcode='23514';
    end if;
  else
    if new.signer_role<>'athlete' or
       lower(btrim(new.signed_name))<>lower(btrim(concat_ws(' ',fname,lname))) then
      raise exception 'athlete signature must match registered full name' using errcode='23514';
    end if;
  end if;
  return new;
end;
$$;
revoke all on function public.validate_health_screening_signer() from public,anon,authenticated;
