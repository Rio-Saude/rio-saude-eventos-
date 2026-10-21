-- Rio Saúde commercial onboarding: schema only. Do not schedule cron from this migration.
-- All dates are date-only business dates in America/Sao_Paulo.
alter table public.athlete_profiles
  add column if not exists selected_plan_code text,
  add column if not exists commercial_started_at timestamptz not null default now();

create table if not exists public.trial_invitations (
  id uuid primary key default gen_random_uuid(),
  token_hash text not null unique,
  invited_email text not null,
  starts_on date not null,
  ends_on date not null,
  expires_at timestamptz not null,
  claimed_at timestamptz,
  claimed_by uuid references auth.users(id) on delete set null,
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  revoked_at timestamptz,
  check (ends_on = starts_on + 29),
  check (lower(invited_email) = invited_email)
);
create index if not exists trial_invitations_claimed_by_idx on public.trial_invitations(claimed_by);

create table if not exists public.commercial_cases (
  athlete_user_id uuid primary key references auth.users(id) on delete cascade,
  trial_invitation_id uuid unique references public.trial_invitations(id) on delete set null,
  entry_kind text not null default 'normal' check (entry_kind in ('normal','trial')),
  lifecycle_status text not null default 'started' check (lifecycle_status in ('started','incomplete','trial_active','trial_expiring','trial_expired_decision_pending','awaiting_contract','converted','lost')),
  funnel_status text not null default 'contact_pending' check (funnel_status in ('not_converted','contact_pending','negotiating','converted','lost')),
  owner_user_id uuid references auth.users(id) on delete set null,
  next_action_on date,
  trial_starts_on date,
  trial_ends_on date,
  converted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((entry_kind = 'normal' and trial_starts_on is null and trial_ends_on is null) or
         (entry_kind = 'trial' and trial_starts_on is not null and trial_ends_on is not null))
);
create index if not exists commercial_cases_queue_idx on public.commercial_cases(lifecycle_status, next_action_on);

create table if not exists public.commercial_history (
  id uuid primary key default gen_random_uuid(),
  athlete_user_id uuid not null references auth.users(id) on delete cascade,
  event_type text not null,
  detail jsonb not null default '{}'::jsonb,
  performed_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists commercial_history_athlete_idx on public.commercial_history(athlete_user_id, created_at desc);

create table if not exists public.commercial_tasks (
  id uuid primary key default gen_random_uuid(),
  athlete_user_id uuid not null references auth.users(id) on delete cascade,
  task_key text not null,
  task_type text not null,
  priority smallint not null default 2 check (priority between 1 and 3),
  owner_user_id uuid references auth.users(id) on delete set null,
  due_on date not null,
  status text not null default 'open' check (status in ('open','resolved','cancelled')),
  resolution_note text,
  resolved_at timestamptz,
  resolved_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (athlete_user_id, task_key)
);
create index if not exists commercial_tasks_open_idx on public.commercial_tasks(status, due_on);

-- Future WhatsApp/internal notification workers consume these events. No sender is implemented.
create table if not exists public.commercial_events (
  id uuid primary key default gen_random_uuid(),
  athlete_user_id uuid not null references auth.users(id) on delete cascade,
  event_type text not null,
  payload jsonb not null default '{}'::jsonb,
  occurred_at timestamptz not null default now(),
  delivered_at timestamptz
);

create or replace function public.commercial_touch_updated_at()
returns trigger language plpgsql security invoker set search_path=public as $$
begin new.updated_at=now(); return new; end; $$;
revoke all on function public.commercial_touch_updated_at() from public, anon, authenticated;
drop trigger if exists commercial_cases_touch_updated_at on public.commercial_cases;
create trigger commercial_cases_touch_updated_at before update on public.commercial_cases for each row execute function public.commercial_touch_updated_at();
drop trigger if exists commercial_tasks_touch_updated_at on public.commercial_tasks;
create trigger commercial_tasks_touch_updated_at before update on public.commercial_tasks for each row execute function public.commercial_touch_updated_at();

alter table public.trial_invitations enable row level security;
alter table public.commercial_cases enable row level security;
alter table public.commercial_history enable row level security;
alter table public.commercial_tasks enable row level security;
alter table public.commercial_events enable row level security;
revoke all on public.trial_invitations, public.commercial_cases, public.commercial_history, public.commercial_tasks, public.commercial_events from anon, authenticated;

-- Every new profile gets a case without granting clients access to CRM tables.
create or replace function public.initialize_commercial_case()
returns trigger language plpgsql security definer set search_path=public as $$
begin
  insert into public.commercial_cases(athlete_user_id,entry_kind,lifecycle_status,funnel_status)
  values(new.user_id,'normal','started','contact_pending') on conflict (athlete_user_id) do nothing;
  return new;
end; $$;
revoke all on function public.initialize_commercial_case() from public, anon, authenticated;
drop trigger if exists athlete_profiles_initialize_commercial_case on public.athlete_profiles;
create trigger athlete_profiles_initialize_commercial_case after insert on public.athlete_profiles
for each row execute function public.initialize_commercial_case();

-- Completing onboarding closes only the stale interrupted-registration task.
-- It never changes payment status or marks an athlete financially regular.
create or replace function public.sync_commercial_profile_completion()
returns trigger language plpgsql security definer set search_path=public as $$
begin
  if new.onboarding_completed_at is not null and old.onboarding_completed_at is null then
    update public.commercial_cases
      set lifecycle_status='awaiting_contract'
      where athlete_user_id=new.user_id and entry_kind='normal' and lifecycle_status='incomplete';
    update public.commercial_tasks
      set status='resolved',resolved_at=now(),resolved_by=null,resolution_note='onboarding completed'
      where athlete_user_id=new.user_id and task_key='incomplete_onboarding' and status='open';
  end if;
  return new;
end; $$;
revoke all on function public.sync_commercial_profile_completion() from public, anon, authenticated;
drop trigger if exists athlete_profiles_sync_commercial_completion on public.athlete_profiles;
create trigger athlete_profiles_sync_commercial_completion after update of onboarding_completed_at on public.athlete_profiles
for each row execute function public.sync_commercial_profile_completion();

-- These functions use elevated access only after checking both identity and authorization.
create or replace function public.claim_trial_invitation(p_token text)
returns table(starts_on date, ends_on date)
language plpgsql security definer set search_path=public, extensions as $$
declare v_invite public.trial_invitations; v_email text;
begin
  if auth.uid() is null then raise exception 'authentication required' using errcode='42501'; end if;
  select lower(email) into v_email from auth.users where id=auth.uid();
  select * into v_invite from public.trial_invitations
   where token_hash=encode(extensions.digest(p_token,'sha256'),'hex') and revoked_at is null
     and expires_at>now() and trial_invitations.starts_on <= (now() at time zone 'America/Sao_Paulo')::date
     and lower(invited_email)=v_email for update;
  if not found then raise exception 'invalid or expired invitation' using errcode='42501'; end if;
  if v_invite.claimed_at is not null then raise exception 'invitation already used' using errcode='42501'; end if;
  update public.trial_invitations set claimed_by=auth.uid(), claimed_at=coalesce(claimed_at,now()) where id=v_invite.id;
  insert into public.commercial_cases(athlete_user_id,trial_invitation_id,entry_kind,lifecycle_status,funnel_status,trial_starts_on,trial_ends_on)
  values(auth.uid(),v_invite.id,'trial','trial_active','contact_pending',v_invite.starts_on,v_invite.ends_on)
  on conflict (athlete_user_id) do update set trial_invitation_id=excluded.trial_invitation_id, entry_kind='trial', lifecycle_status='trial_active', trial_starts_on=excluded.trial_starts_on, trial_ends_on=excluded.trial_ends_on;
  insert into public.commercial_history(athlete_user_id,event_type,detail,performed_by) values(auth.uid(),'trial_invitation_claimed',jsonb_build_object('starts_on',v_invite.starts_on,'ends_on',v_invite.ends_on),auth.uid());
  return query select v_invite.starts_on,v_invite.ends_on;
end; $$;
revoke all on function public.claim_trial_invitation(text) from public, anon;
grant execute on function public.claim_trial_invitation(text) to authenticated;

create or replace function public.my_trial_access()
returns table(is_trial boolean, starts_on date, ends_on date, lifecycle_status text)
language sql stable security definer set search_path=public as $$
  select true,c.trial_starts_on,c.trial_ends_on,c.lifecycle_status from public.commercial_cases c
  where c.athlete_user_id=auth.uid() and c.entry_kind='trial';
$$;
revoke all on function public.my_trial_access() from public, anon;
grant execute on function public.my_trial_access() to authenticated;

create or replace function public.admin_create_trial_invitation(p_email text,p_starts_on date)
returns table(token text, starts_on date, ends_on date, expires_at timestamptz)
language plpgsql security definer set search_path=public, extensions as $$
declare v_token text; v_email text;
begin
  if auth.uid() is null or not public.is_admin() then raise exception 'admin required' using errcode='42501'; end if;
  v_email=lower(btrim(p_email));
  if v_email !~* '^[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}$' or p_starts_on is null or p_starts_on < (now() at time zone 'America/Sao_Paulo')::date then raise exception 'invalid invitation data' using errcode='22023'; end if;
  v_token=encode(extensions.gen_random_bytes(32),'hex');
  insert into public.trial_invitations(token_hash,invited_email,starts_on,ends_on,expires_at,created_by)
  values(encode(extensions.digest(v_token,'sha256'),'hex'),v_email,p_starts_on,p_starts_on+29,(p_starts_on+30)::timestamp at time zone 'America/Sao_Paulo',auth.uid());
  return query select v_token,p_starts_on,p_starts_on+29,(p_starts_on+30)::timestamptz;
end; $$;
revoke all on function public.admin_create_trial_invitation(text,date) from public, anon;
grant execute on function public.admin_create_trial_invitation(text,date) to authenticated;

create or replace function public.process_commercial_tasks(p_today date default (now() at time zone 'America/Sao_Paulo')::date)
returns void language plpgsql security definer set search_path=public as $$
begin
  -- Normal registrations left at an unfinished onboarding step for 24h.
  insert into public.commercial_cases(athlete_user_id,entry_kind,lifecycle_status,funnel_status)
  select p.user_id,'normal','incomplete','contact_pending' from public.athlete_profiles p
  where p.onboarding_completed_at is null and p.commercial_started_at <= now()-interval '24 hours'
  on conflict (athlete_user_id) do update set lifecycle_status='incomplete'
  where public.commercial_cases.entry_kind='normal' and public.commercial_cases.lifecycle_status='started';
  insert into public.commercial_tasks(athlete_user_id,task_key,task_type,priority,due_on)
  select c.athlete_user_id,'incomplete_onboarding','incomplete_onboarding',2,p_today from public.commercial_cases c
  where c.lifecycle_status='incomplete'
  on conflict (athlete_user_id,task_key) do update set status='open',due_on=excluded.due_on,resolved_at=null,resolved_by=null,resolution_note=null;
  -- Trial lifecycle is driven by São Paulo business dates and stable keys prevent duplicates.
  update public.commercial_cases set lifecycle_status=case when trial_ends_on<p_today then 'trial_expired_decision_pending' when trial_ends_on<=p_today+7 then 'trial_expiring' else 'trial_active' end
  where entry_kind='trial' and lifecycle_status not in ('converted','lost');
  insert into public.commercial_tasks(athlete_user_id,task_key,task_type,priority,due_on)
  select athlete_user_id,'trial_7_days','trial_conversion_7_days',2,trial_ends_on-7 from public.commercial_cases where entry_kind='trial' and trial_ends_on=p_today+7 and lifecycle_status not in ('converted','lost')
  on conflict (athlete_user_id,task_key) do update set status='open',due_on=excluded.due_on,resolved_at=null,resolved_by=null,resolution_note=null;
  insert into public.commercial_tasks(athlete_user_id,task_key,task_type,priority,due_on)
  select athlete_user_id,'trial_3_days','trial_conversion_3_days',3,trial_ends_on-3 from public.commercial_cases where entry_kind='trial' and trial_ends_on=p_today+3 and lifecycle_status not in ('converted','lost')
  on conflict (athlete_user_id,task_key) do update set status='open',due_on=excluded.due_on,resolved_at=null,resolved_by=null,resolution_note=null;
  insert into public.commercial_tasks(athlete_user_id,task_key,task_type,priority,due_on)
  select athlete_user_id,'trial_expired_decision','trial_expired_decision',3,trial_ends_on from public.commercial_cases where entry_kind='trial' and trial_ends_on<=p_today and lifecycle_status not in ('converted','lost')
  on conflict (athlete_user_id,task_key) do update set status='open',due_on=excluded.due_on,resolved_at=null,resolved_by=null,resolution_note=null;
  update public.commercial_tasks set status='resolved',resolved_at=now(),resolved_by=null,resolution_note='superseded by expiry decision'
  where task_type in ('trial_conversion_7_days','trial_conversion_3_days') and status='open'
    and athlete_user_id in (select athlete_user_id from public.commercial_cases where entry_kind='trial' and trial_ends_on<=p_today);
end; $$;
revoke all on function public.process_commercial_tasks(date) from public, anon, authenticated;

create or replace function public.admin_commercial_dashboard()
returns table(athlete_user_id uuid, athlete_name text, athlete_email text, entry_kind text, lifecycle_status text, funnel_status text, owner_user_id uuid, owner_email text, next_action_on date, trial_starts_on date, trial_ends_on date, onboarding_step integer, onboarding_completed_at timestamptz, open_tasks integer)
language sql stable security definer set search_path=public as $$
 select c.athlete_user_id, nullif(btrim(concat_ws(' ',p.first_name,p.last_name)),''),p.email,c.entry_kind,c.lifecycle_status,c.funnel_status,c.owner_user_id,au.email,c.next_action_on,c.trial_starts_on,c.trial_ends_on,p.onboarding_step,p.onboarding_completed_at,count(t.id)::integer
 from public.commercial_cases c join public.athlete_profiles p on p.user_id=c.athlete_user_id
 left join auth.users au on au.id=c.owner_user_id
 left join public.commercial_tasks t on t.athlete_user_id=c.athlete_user_id and t.status='open'
 where auth.uid() is not null and public.is_admin()
 group by c.athlete_user_id,p.first_name,p.last_name,p.email,c.entry_kind,c.lifecycle_status,c.funnel_status,c.owner_user_id,au.email,c.next_action_on,c.trial_starts_on,c.trial_ends_on,p.onboarding_step,p.onboarding_completed_at;
$$;
revoke all on function public.admin_commercial_dashboard() from public, anon;
grant execute on function public.admin_commercial_dashboard() to authenticated;

create or replace function public.admin_update_commercial_case(p_athlete uuid,p_action text,p_funnel_status text default null,p_next_action_on date default null,p_trial_ends_on date default null,p_note text default null)
returns void language plpgsql security definer set search_path=public as $$
declare v_case public.commercial_cases;
begin
 if auth.uid() is null or not public.is_admin() then raise exception 'admin required' using errcode='42501'; end if;
 select * into v_case from public.commercial_cases where athlete_user_id=p_athlete for update; if not found then raise exception 'case not found'; end if;
 if p_action='assign_self' then
   update public.commercial_cases set owner_user_id=auth.uid(),next_action_on=coalesce(p_next_action_on,next_action_on) where athlete_user_id=p_athlete;
 elsif p_action='extend_trial' then
   if v_case.entry_kind<>'trial' or p_trial_ends_on is null or p_trial_ends_on<=v_case.trial_ends_on then raise exception 'invalid trial extension' using errcode='22023'; end if;
   update public.commercial_cases set trial_ends_on=p_trial_ends_on,lifecycle_status='trial_active',next_action_on=p_next_action_on where athlete_user_id=p_athlete;
   update public.commercial_tasks set status='resolved',resolved_at=now(),resolved_by=auth.uid(),resolution_note='trial extended' where athlete_user_id=p_athlete and status='open' and task_type like 'trial_%';
 elsif p_action='closed_plan' then
   if v_case.lifecycle_status<>'trial_expired_decision_pending' then raise exception 'trial decision required' using errcode='22023'; end if;
   update public.commercial_cases set lifecycle_status='awaiting_contract',funnel_status='negotiating',next_action_on=p_next_action_on where athlete_user_id=p_athlete;
   update public.commercial_tasks set status='resolved',resolved_at=now(),resolved_by=auth.uid(),resolution_note='contracting started' where athlete_user_id=p_athlete and status='open' and task_type like 'trial_%';
   insert into public.commercial_tasks(athlete_user_id,task_key,task_type,priority,due_on) values(p_athlete,'contract_pending','contract_pending',3,coalesce(p_next_action_on,(now() at time zone 'America/Sao_Paulo')::date)) on conflict(athlete_user_id,task_key) do update set status='open',due_on=excluded.due_on,resolved_at=null,resolved_by=null,resolution_note=null;
 elsif p_action='not_contracted' then
   if v_case.lifecycle_status<>'trial_expired_decision_pending' then raise exception 'trial decision required' using errcode='22023'; end if;
   update public.commercial_cases set lifecycle_status='awaiting_contract',funnel_status=coalesce(p_funnel_status,'not_converted'),next_action_on=p_next_action_on where athlete_user_id=p_athlete;
   update public.commercial_tasks set status='resolved',resolved_at=now(),resolved_by=auth.uid(),resolution_note='moved to commercial funnel' where athlete_user_id=p_athlete and status='open' and task_type like 'trial_%';
   insert into public.commercial_tasks(athlete_user_id,task_key,task_type,priority,due_on) values(p_athlete,'commercial_contact','commercial_contact',2,coalesce(p_next_action_on,(now() at time zone 'America/Sao_Paulo')::date)) on conflict(athlete_user_id,task_key) do update set status='open',due_on=excluded.due_on,resolved_at=null,resolved_by=null,resolution_note=null;
 elsif p_action='update_funnel' then
   if p_funnel_status not in ('not_converted','contact_pending','negotiating','lost') then raise exception 'invalid funnel status'; end if;
   update public.commercial_cases set funnel_status=p_funnel_status,lifecycle_status=case when p_funnel_status='lost' then 'lost' else lifecycle_status end,next_action_on=p_next_action_on where athlete_user_id=p_athlete;
   if p_funnel_status='lost' then update public.commercial_tasks set status='resolved',resolved_at=now(),resolved_by=auth.uid(),resolution_note='commercial case closed as lost' where athlete_user_id=p_athlete and status='open'; end if;
 else raise exception 'invalid action'; end if;
 insert into public.commercial_history(athlete_user_id,event_type,detail,performed_by) values(p_athlete,p_action,jsonb_strip_nulls(jsonb_build_object('funnel_status',p_funnel_status,'next_action_on',p_next_action_on,'trial_ends_on',p_trial_ends_on,'note',p_note)),auth.uid());
 insert into public.commercial_events(athlete_user_id,event_type,payload) values(p_athlete,'commercial.'||p_action,jsonb_build_object('source','admin'));
end; $$;
revoke all on function public.admin_update_commercial_case(uuid,text,text,date,date,text) from public, anon;
grant execute on function public.admin_update_commercial_case(uuid,text,text,date,date,text) to authenticated;

create or replace function public.admin_commercial_history(p_athlete uuid)
returns table(event_type text, detail jsonb, performed_by_email text, created_at timestamptz)
language sql stable security definer set search_path=public as $$
 select h.event_type,h.detail,u.email,h.created_at from public.commercial_history h
 left join auth.users u on u.id=h.performed_by
 where h.athlete_user_id=p_athlete and auth.uid() is not null and public.is_admin()
 order by h.created_at desc limit 100;
$$;
revoke all on function public.admin_commercial_history(uuid) from public, anon;
grant execute on function public.admin_commercial_history(uuid) to authenticated;
