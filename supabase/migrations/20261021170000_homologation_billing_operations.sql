-- Rio Saúde: operational financial records for HOMOLOGATION.
-- This is schema/state only: it does not create an Efí charge, send a message,
-- or mark any payment as confirmed. Apply only after the sanitized base schema.

alter table public.billing_subscriptions
  add column if not exists free_trial_days smallint not null default 0 check (free_trial_days in (0,30)),
  add column if not exists trial_ends_on date,
  add column if not exists first_charge_on date,
  add column if not exists next_charge_on date,
  add column if not exists first_due_on date,
  add column if not exists cancel_requested_at timestamptz,
  add column if not exists cancellation_reason text,
  add column if not exists provider_cancelled_at timestamptz,
  add column if not exists provider_event_cursor bigint not null default 0,
  add constraint billing_subscriptions_trial_dates_check check (
    (free_trial_days = 0 and trial_ends_on is null) or
    (free_trial_days = 30 and trial_ends_on is not null)
  );

create table if not exists public.billing_charges (
  id uuid primary key default gen_random_uuid(),
  subscription_id uuid not null references public.billing_subscriptions(id) on delete cascade,
  efi_charge_id text unique,
  charge_kind text not null check (charge_kind in ('subscription','boleto')),
  status text not null check (status in ('new','waiting','approved','paid','unpaid','expired','cancelled','refunded','settled')),
  amount_cents integer not null check (amount_cents > 0),
  due_on date,
  paid_at timestamptz,
  cancelled_at timestamptz,
  billet_url text,
  provider_payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists billing_charges_one_first_boleto_per_subscription
  on public.billing_charges(subscription_id, charge_kind, due_on)
  where charge_kind='boleto';
create index if not exists billing_charges_subscription_idx on public.billing_charges(subscription_id, due_on desc);

-- A deduplicated outbox for the future official WhatsApp worker. The worker is
-- intentionally not implemented or granted here.
alter table public.commercial_events add column if not exists event_key text;
create unique index if not exists commercial_events_one_key_per_athlete
  on public.commercial_events(athlete_user_id,event_key) where event_key is not null;

alter table public.billing_charges enable row level security;
revoke all on public.billing_charges from anon, authenticated;
revoke insert, update, delete on public.billing_subscriptions from anon, authenticated;

create or replace function public.commercial_enqueue_event(
  p_athlete uuid, p_event_type text, p_event_key text, p_payload jsonb default '{}'::jsonb
) returns void language plpgsql security definer set search_path=public as $$
begin
  insert into public.commercial_events(athlete_user_id,event_type,event_key,payload)
  values(p_athlete,p_event_type,p_event_key,coalesce(p_payload,'{}'::jsonb))
  on conflict (athlete_user_id,event_key) where event_key is not null do nothing;
end; $$;
revoke all on function public.commercial_enqueue_event(uuid,text,text,jsonb) from public, anon, authenticated;

-- The free trial entitlement is checked by a trusted server using the existing
-- CPF field. It cannot be claimed by direct browser writes and is consumed only
-- when an Efí card subscription is actually prepared by that server.
create or replace function public.free_trial_available(p_profile_id uuid)
returns boolean language sql stable security definer set search_path=public as $$
  select exists(select 1 from public.athlete_profiles p where p.id=p_profile_id and p.cpf ~ '^[0-9]{11}$')
    and not exists (
      select 1 from public.billing_subscriptions b
      join public.athlete_profiles prior on prior.id=b.athlete_profile_id
      join public.athlete_profiles current_profile on current_profile.id=p_profile_id
      where b.free_trial_days=30 and prior.cpf=current_profile.cpf
    );
$$;
revoke all on function public.free_trial_available(uuid) from public, anon, authenticated;

-- Restricted data for the new simple admin screen. PAR-Q answers are never
-- selected. The result is deliberately not included either.
create or replace function public.admin_operations_dashboard()
returns table(
  athlete_user_id uuid, athlete_name text, athlete_email text, athlete_whatsapp text,
  modalities text[], base_preference text, running_experience text,
  training_days_available text, coach text, goal_events jsonb,
  onboarding_step integer, onboarding_completed_at timestamptz, trainingpeaks_status text,
  entry_kind text, lifecycle_status text, funnel_status text, next_action_on date,
  trial_ends_on date, open_tasks integer,
  plan_name text, price_cents integer, subscription_status text, payment_method text,
  free_trial_days smallint, subscription_trial_ends_on date, next_charge_on date,
  first_due_on date, cancellation_requested_at timestamptz, provider_cancelled_at timestamptz
) language sql stable security definer set search_path=public as $$
  select c.athlete_user_id, nullif(btrim(concat_ws(' ',p.first_name,p.last_name)),''),p.email,p.whatsapp,
    p.modalities,p.base_preference,p.running_experience,p.training_days_available,p.coach,p.goal_events,
    p.onboarding_step,p.onboarding_completed_at,p.trainingpeaks_status,
    c.entry_kind,c.lifecycle_status,c.funnel_status,c.next_action_on,c.trial_ends_on,
    count(t.id)::integer,
    bp.name,bs.price_cents,bs.status,bs.payment_method,bs.free_trial_days,bs.trial_ends_on,
    bs.next_charge_on,bs.first_due_on,bs.cancel_requested_at,bs.provider_cancelled_at
  from public.commercial_cases c
  join public.athlete_profiles p on p.user_id=c.athlete_user_id
  left join public.commercial_tasks t on t.athlete_user_id=c.athlete_user_id and t.status='open'
  left join lateral (
    select s.* from public.billing_subscriptions s
    where s.athlete_profile_id=p.id order by s.created_at desc limit 1
  ) bs on true
  left join public.billing_plans bp on bp.id=bs.billing_plan_id
  where auth.uid() is not null and public.is_admin()
  group by c.athlete_user_id,p.first_name,p.last_name,p.email,p.whatsapp,p.modalities,p.base_preference,
    p.running_experience,p.training_days_available,p.coach,p.goal_events,p.onboarding_step,p.onboarding_completed_at,
    p.trainingpeaks_status,c.entry_kind,c.lifecycle_status,c.funnel_status,c.next_action_on,c.trial_ends_on,
    bp.name,bs.price_cents,bs.status,bs.payment_method,bs.free_trial_days,bs.trial_ends_on,bs.next_charge_on,
    bs.first_due_on,bs.cancel_requested_at,bs.provider_cancelled_at;
$$;
revoke all on function public.admin_operations_dashboard() from public, anon;
grant execute on function public.admin_operations_dashboard() to authenticated;

create or replace function public.process_commercial_tasks(p_today date default (now() at time zone 'America/Sao_Paulo')::date)
returns void language plpgsql security definer set search_path=public as $$
begin
  insert into public.commercial_cases(athlete_user_id,entry_kind,lifecycle_status,funnel_status)
  select p.user_id,'normal','incomplete','contact_pending' from public.athlete_profiles p
  where p.onboarding_completed_at is null and p.commercial_started_at <= now()-interval '24 hours'
  on conflict (athlete_user_id) do update set lifecycle_status='incomplete'
  where public.commercial_cases.entry_kind='normal' and public.commercial_cases.lifecycle_status='started';

  update public.commercial_cases c set lifecycle_status='awaiting_contract'
  from public.athlete_profiles p where c.athlete_user_id=p.user_id and c.entry_kind='normal'
    and p.onboarding_completed_at is not null and c.lifecycle_status not in ('converted','lost');

  insert into public.commercial_tasks(athlete_user_id,task_key,task_type,priority,due_on)
  select c.athlete_user_id,'incomplete_onboarding','incomplete_onboarding',2,p_today from public.commercial_cases c
  where c.lifecycle_status='incomplete'
  on conflict (athlete_user_id,task_key) do update set status='open',due_on=excluded.due_on,resolved_at=null,resolved_by=null,resolution_note=null;

  insert into public.commercial_tasks(athlete_user_id,task_key,task_type,priority,due_on)
  select p.user_id,'financial_followup','financial_followup',3,p_today from public.athlete_profiles p
  where p.onboarding_completed_at is not null and (p.payment_followup_needed or p.payment_status <> 'confirmed')
  on conflict (athlete_user_id,task_key) do update set status='open',due_on=excluded.due_on,resolved_at=null,resolved_by=null,resolution_note=null;

  update public.commercial_tasks t set status='resolved',resolved_at=now(),resolved_by=null,resolution_note='payment confirmed by trusted backend'
  from public.athlete_profiles p where t.athlete_user_id=p.user_id and t.task_key='financial_followup'
    and t.status='open' and p.payment_status='confirmed';

  update public.commercial_cases set lifecycle_status=case when trial_ends_on<p_today then 'trial_expired_decision_pending' when trial_ends_on<=p_today+7 then 'trial_expiring' else 'trial_active' end
  where entry_kind='trial' and lifecycle_status not in ('converted','lost');

  insert into public.commercial_tasks(athlete_user_id,task_key,task_type,priority,due_on)
  select athlete_user_id,'trial_7_days','trial_conversion_7_days',2,trial_ends_on-7 from public.commercial_cases
  where entry_kind='trial' and trial_ends_on=p_today+7 and lifecycle_status not in ('converted','lost')
  on conflict (athlete_user_id,task_key) do update set status='open',due_on=excluded.due_on,resolved_at=null,resolved_by=null,resolution_note=null;
  insert into public.commercial_tasks(athlete_user_id,task_key,task_type,priority,due_on)
  select athlete_user_id,'trial_3_days','trial_conversion_3_days',3,trial_ends_on-3 from public.commercial_cases
  where entry_kind='trial' and trial_ends_on=p_today+3 and lifecycle_status not in ('converted','lost')
  on conflict (athlete_user_id,task_key) do update set status='open',due_on=excluded.due_on,resolved_at=null,resolved_by=null,resolution_note=null;
  insert into public.commercial_tasks(athlete_user_id,task_key,task_type,priority,due_on)
  select athlete_user_id,'trial_expired_decision','trial_expired_decision',3,trial_ends_on from public.commercial_cases
  where entry_kind='trial' and trial_ends_on<=p_today and lifecycle_status not in ('converted','lost')
  on conflict (athlete_user_id,task_key) do update set status='open',due_on=excluded.due_on,resolved_at=null,resolved_by=null,resolution_note=null;
  update public.commercial_tasks set status='resolved',resolved_at=now(),resolved_by=null,resolution_note='superseded by expiry decision'
  where task_type in ('trial_conversion_7_days','trial_conversion_3_days') and status='open'
    and athlete_user_id in (select athlete_user_id from public.commercial_cases where entry_kind='trial' and trial_ends_on<=p_today);

  -- Stable keys mean the daily job remains safe after retries or a partial failure.
  perform public.commercial_enqueue_event(c.athlete_user_id,'commercial.onboarding_abandoned','onboarding_abandoned',jsonb_build_object('due_on',p_today))
  from public.commercial_cases c where c.lifecycle_status='incomplete';
  perform public.commercial_enqueue_event(c.athlete_user_id,'commercial.trial_expiring_7_days','trial_7_days:'||c.trial_ends_on,jsonb_build_object('ends_on',c.trial_ends_on))
  from public.commercial_cases c where c.entry_kind='trial' and c.trial_ends_on=p_today+7;
  perform public.commercial_enqueue_event(c.athlete_user_id,'commercial.trial_expiring_3_days','trial_3_days:'||c.trial_ends_on,jsonb_build_object('ends_on',c.trial_ends_on))
  from public.commercial_cases c where c.entry_kind='trial' and c.trial_ends_on=p_today+3;
  perform public.commercial_enqueue_event(c.athlete_user_id,'commercial.trial_expired','trial_expired:'||c.trial_ends_on,jsonb_build_object('ends_on',c.trial_ends_on))
  from public.commercial_cases c where c.entry_kind='trial' and c.trial_ends_on<=p_today and c.lifecycle_status='trial_expired_decision_pending';
end; $$;
revoke all on function public.process_commercial_tasks(date) from public, anon, authenticated;
