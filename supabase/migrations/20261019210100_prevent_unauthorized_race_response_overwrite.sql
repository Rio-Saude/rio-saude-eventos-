-- Maintain public new event responses but prevent anonymous overwrites.
-- Verified account email is required to edit a response to the same event.
CREATE OR REPLACE FUNCTION public.submit_race_response(p_event_name text, p_athlete_name text, p_athlete_email text, p_distance text, p_status text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_group_status text;
  v_distance_options text[];
  v_allow_other boolean;
  v_allow_ultra boolean;
  v_distance text;
  v_custom_km numeric;
begin
  -- Usuários autenticados só podem usar o e-mail verificado na sessão.
  if auth.uid() is not null and lower(trim(coalesce(p_athlete_email,''))) is distinct from lower(coalesce(auth.jwt()->>'email','')) then
    raise exception 'verified email required' using errcode = '42501';
  end if;

  if length(trim(coalesce(p_event_name,''))) = 0 or length(p_event_name) > 160 then
    raise exception 'invalid event';
  end if;
  if length(trim(coalesce(p_athlete_name,''))) < 2 or length(p_athlete_name) > 120 then
    raise exception 'invalid name';
  end if;
  if length(trim(coalesce(p_athlete_email,''))) = 0 or length(p_athlete_email) > 320 then
    raise exception 'invalid email';
  end if;
  if p_athlete_email !~* '^[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}$' then
    raise exception 'invalid email';
  end if;
  if length(coalesce(p_distance,'')) > 80 then
    raise exception 'invalid distance';
  end if;
  if p_status not in ('interest','going','group_interest') then
    raise exception 'invalid status';
  end if;

  select group_status, distance_options, allow_other_distance, allow_ultra_distance
    into v_group_status, v_distance_options, v_allow_other, v_allow_ultra
  from public.events
  where lower(name)=lower(trim(p_event_name))
    and active=true;

  if not found then
    raise exception 'event not available';
  end if;

  if p_status='group_interest' and v_group_status not in ('collecting','confirmed') then
    raise exception 'group registration unavailable';
  end if;

  v_distance := nullif(trim(coalesce(p_distance,'')),'');

  if v_distance is not null then
    if v_distance = any(v_distance_options) then
      null;
    elsif v_allow_other and v_distance ~* '^Outra: [0-9]+([.,][0-9]+)?K$' then
      null;
    elsif v_allow_ultra and v_distance ~* '^Ultra: [0-9]+([.,][0-9]+)?K$' then
      v_custom_km := replace(
        regexp_replace(v_distance, '^Ultra: ([0-9]+([.,][0-9]+)?)K$', '\1', 'i'),
        ',', '.'
      )::numeric;
      if v_custom_km <= 42.195 then
        raise exception 'ultra distance must be greater than marathon';
      end if;
    elsif cardinality(v_distance_options) > 0 or v_allow_other or v_allow_ultra then
      raise exception 'distance not available for event';
    end if;
  elsif p_status in ('going','group_interest')
        and (cardinality(v_distance_options) > 0 or v_allow_other or v_allow_ultra) then
    raise exception 'distance required';
  end if;

  insert into public.race_responses(event_name,athlete_name,athlete_email,distance,status)
  values(
    trim(p_event_name),
    trim(p_athlete_name),
    lower(trim(p_athlete_email)),
    v_distance,
    p_status
  )
  on conflict ((lower(event_name)),(lower(athlete_email)))
  do update set
    athlete_name=excluded.athlete_name,
    distance=excluded.distance,
    status=excluded.status,
    updated_at=now()
  -- Visitantes podem se inscrever, mas não sobrescrever a resposta de outra pessoa.
  where auth.uid() is not null
    and lower(coalesce(auth.jwt()->>'email','')) = excluded.athlete_email;

  if not found then
    raise exception 'existing response requires verified account email' using errcode = '42501';
  end if;

  return jsonb_build_object('ok',true,'event',trim(p_event_name),'status',p_status,'distance',v_distance);
end;
$function$
