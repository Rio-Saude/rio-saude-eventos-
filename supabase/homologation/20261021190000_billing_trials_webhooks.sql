-- HOMOLOGATION ONLY (xiiudduncvcxcvbgbqpc).
-- Adds the minimum persistent state for Efí trials, scheduled boletos and
-- verified provider notifications. It never creates a provider charge.

alter table public.billing_subscriptions
  drop constraint if exists billing_subscriptions_creation_state_check;
alter table public.billing_subscriptions
  add constraint billing_subscriptions_creation_state_check check
    (creation_state in ('reserved','requested','ready','review','failed','scheduled','cancel_requested','cancelled'));

alter table public.billing_subscriptions
  add column if not exists checkout_kind text not null default 'legacy'
    check (checkout_kind in ('legacy','card_trial','card_standard','boleto_trial','boleto_standard')),
  add column if not exists boleto_issue_on date,
  add column if not exists cancelled_effective_on date;

create table if not exists public.billing_customer_profiles (
  athlete_profile_id uuid primary key references public.athlete_profiles(id) on delete cascade,
  street text not null check (length(btrim(street)) between 2 and 120),
  number text not null check (length(btrim(number)) between 1 and 20),
  complement text,
  neighborhood text not null check (length(btrim(neighborhood)) between 2 and 80),
  city text not null check (length(btrim(city)) between 2 and 80),
  state char(2) not null check (state ~ '^[A-Z]{2}$'),
  zipcode char(8) not null check (zipcode ~ '^[0-9]{8}$'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.billing_customer_profiles enable row level security;
revoke all on public.billing_customer_profiles from anon;
grant select, insert, update on public.billing_customer_profiles to authenticated;
drop policy if exists billing_customer_profiles_own on public.billing_customer_profiles;
create policy billing_customer_profiles_own on public.billing_customer_profiles for all to authenticated
  using (exists (select 1 from public.athlete_profiles p where p.id=billing_customer_profiles.athlete_profile_id and p.user_id=auth.uid()))
  with check (exists (select 1 from public.athlete_profiles p where p.id=billing_customer_profiles.athlete_profile_id and p.user_id=auth.uid()));

create table if not exists public.billing_webhook_events (
  id uuid primary key default gen_random_uuid(),
  notification_token_hash text not null,
  provider_event_id text not null,
  subscription_id uuid references public.billing_subscriptions(id) on delete set null,
  event_type text not null,
  processed_at timestamptz not null default now(),
  unique(notification_token_hash, provider_event_id)
);
alter table public.billing_webhook_events enable row level security;
revoke all on public.billing_webhook_events from anon, authenticated;

drop policy if exists billing_charges_read_own on public.billing_charges;
create policy billing_charges_read_own on public.billing_charges for select to authenticated
  using (exists (
    select 1 from public.billing_subscriptions s join public.athlete_profiles p on p.id=s.athlete_profile_id
    where s.id=billing_charges.subscription_id and p.user_id=auth.uid()
  ));
grant select on public.billing_charges to authenticated;

create or replace function public.billing_touch_customer_profile()
returns trigger language plpgsql set search_path=public as $$ begin new.updated_at=now(); return new; end $$;
revoke all on function public.billing_touch_customer_profile() from public, anon, authenticated;
drop trigger if exists billing_customer_profiles_touch on public.billing_customer_profiles;
create trigger billing_customer_profiles_touch before update on public.billing_customer_profiles
for each row execute function public.billing_touch_customer_profile();

-- The database routine is deliberately provider-free. An authenticated server
-- worker may issue only the due items; no browser role can run this function.
create or replace function public.due_boleto_trials(p_today date default (now() at time zone 'America/Sao_Paulo')::date)
returns table(subscription_id uuid) language sql stable security definer set search_path=public as $$
  select s.id from public.billing_subscriptions s
  where s.environment='homologation' and s.payment_method in ('boleto','bolix')
    and s.creation_state='scheduled' and s.boleto_issue_on <= p_today and s.status='pending';
$$;
revoke all on function public.due_boleto_trials(date) from public, anon, authenticated;

comment on table public.billing_customer_profiles is 'Billing address; browser users may read/write only their own profile. Not selected by commercial dashboards.';
comment on table public.billing_webhook_events is 'Deduplication ledger. Raw provider notification payloads are intentionally not retained.';
