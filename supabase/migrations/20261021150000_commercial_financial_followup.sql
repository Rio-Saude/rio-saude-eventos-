-- Keep commercial state aligned with a completed onboarding and a pending financial follow-up.
-- This migration is safe to run more than once and never changes payment_status to confirmed.

create or replace function public.sync_commercial_profile_completion()
returns trigger language plpgsql security definer set search_path=public as $$
begin
  if new.onboarding_completed_at is not null and old.onboarding_completed_at is null then
    update public.commercial_cases
      set lifecycle_status='awaiting_contract'
      where athlete_user_id=new.user_id
        and entry_kind='normal'
        and lifecycle_status not in ('converted','lost');
    update public.commercial_tasks
      set status='resolved',resolved_at=now(),resolved_by=null,resolution_note='onboarding completed'
      where athlete_user_id=new.user_id and task_key='incomplete_onboarding' and status='open';
  end if;
  return new;
end; $$;
revoke all on function public.sync_commercial_profile_completion() from public, anon, authenticated;

create or replace function public.process_commercial_tasks(p_today date default (now() at time zone 'America/Sao_Paulo')::date)
returns void language plpgsql security definer set search_path=public as $$
begin
  insert into public.commercial_cases(athlete_user_id,entry_kind,lifecycle_status,funnel_status)
  select p.user_id,'normal','incomplete','contact_pending' from public.athlete_profiles p
  where p.onboarding_completed_at is null and p.commercial_started_at <= now()-interval '24 hours'
  on conflict (athlete_user_id) do update set lifecycle_status='incomplete'
  where public.commercial_cases.entry_kind='normal' and public.commercial_cases.lifecycle_status='started';

  update public.commercial_cases c set lifecycle_status='awaiting_contract'
  from public.athlete_profiles p
  where c.athlete_user_id=p.user_id and c.entry_kind='normal'
    and p.onboarding_completed_at is not null and c.lifecycle_status not in ('converted','lost');

  insert into public.commercial_tasks(athlete_user_id,task_key,task_type,priority,due_on)
  select c.athlete_user_id,'incomplete_onboarding','incomplete_onboarding',2,p_today from public.commercial_cases c
  where c.lifecycle_status='incomplete'
  on conflict (athlete_user_id,task_key) do update set status='open',due_on=excluded.due_on,resolved_at=null,resolved_by=null,resolution_note=null;

  -- A deferred or unconfirmed completed onboarding stays visible until a trusted backend confirms payment.
  insert into public.commercial_tasks(athlete_user_id,task_key,task_type,priority,due_on)
  select p.user_id,'financial_followup','financial_followup',3,p_today
  from public.athlete_profiles p
  where p.onboarding_completed_at is not null
    and (p.payment_followup_needed or p.payment_status <> 'confirmed')
  on conflict (athlete_user_id,task_key) do update set status='open',due_on=excluded.due_on,resolved_at=null,resolved_by=null,resolution_note=null;

  update public.commercial_tasks t set status='resolved',resolved_at=now(),resolved_by=null,resolution_note='payment confirmed by trusted backend'
  from public.athlete_profiles p
  where t.athlete_user_id=p.user_id and t.task_key='financial_followup'
    and t.status='open' and p.payment_status='confirmed';

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
