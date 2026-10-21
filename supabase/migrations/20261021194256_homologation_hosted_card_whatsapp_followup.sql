-- HOMOLOGATION ONLY. Persist the day-25 hosted-card follow-up independently
-- from provider state. This migration does not create a link, charge or message.

alter table public.athlete_profiles
  add column if not exists whatsapp_financial_contact_authorized boolean not null default false;

alter table public.billing_subscriptions
  add column if not exists checkout_link_on date,
  add column if not exists checkout_reminder_on date,
  add column if not exists checkout_link_created_at timestamptz;

create table if not exists public.billing_notification_attempts (
  id uuid primary key default gen_random_uuid(),
  subscription_id uuid not null references public.billing_subscriptions(id) on delete cascade,
  message_kind text not null check (message_kind in ('card_checkout_day_25','card_checkout_day_31')),
  channel text not null default 'whatsapp' check (channel='whatsapp'),
  status text not null default 'queued' check (status in ('queued','processing','sent','failed','blocked','cancelled')),
  attempts smallint not null default 0 check (attempts >= 0 and attempts <= 3),
  last_attempt_at timestamptz,
  sent_at timestamptz,
  provider_message_id text,
  failure_code text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(subscription_id,message_kind)
);

create index if not exists billing_notification_attempts_ready_idx
  on public.billing_notification_attempts(status, created_at)
  where status in ('queued','failed','blocked');

alter table public.billing_notification_attempts enable row level security;
revoke all on public.billing_notification_attempts from anon, authenticated;

-- All historic profiles remain opt-out until the athlete explicitly authorizes
-- financial contact in the onboarding. Browser RLS remains ownership-based.
comment on column public.athlete_profiles.whatsapp_financial_contact_authorized is
  'Explicit authorization for transactional financial WhatsApp contact. Defaults to false.';
comment on table public.billing_notification_attempts is
  'HML-only delivery ledger. No card data, message text, WhatsApp number or provider secret is stored.';

-- Keep the existing 08:10 America/Sao_Paulo job. Only its internal action is
-- expanded; secrets remain in Vault and are not persisted in cron.job.command.
create or replace function public.invoke_homologation_billing_cron()
returns void language plpgsql security definer set search_path=pg_catalog, vault, net as $$
declare project_url text; schedule_secret text;
begin
  select decrypted_secret into project_url from vault.decrypted_secrets where name='rio_saude_hml_project_url';
  select decrypted_secret into schedule_secret from vault.decrypted_secrets where name='rio_saude_hml_billing_cron_secret';
  if project_url <> 'https://xiiudduncvcxcvbgbqpc.supabase.co' or schedule_secret is null then
    raise exception 'missing or invalid billing cron configuration';
  end if;
  perform net.http_post(
    url:=project_url||'/functions/v1/efi-billing-cron',
    headers:=jsonb_build_object('Content-Type','application/json','x-rio-schedule-secret',schedule_secret),
    body:='{"action":"run_financial_followup"}'::jsonb,
    timeout_milliseconds:=30000
  );
end; $$;
revoke all on function public.invoke_homologation_billing_cron() from public, anon, authenticated;
