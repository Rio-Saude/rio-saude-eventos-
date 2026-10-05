-- Add checkout metadata; no existing rows or profile fields are removed.
alter table public.billing_subscriptions
  add column environment text not null default 'homologation'
    check (environment in ('homologation', 'production')),
  add column creation_state text not null default 'reserved'
    check (creation_state in ('reserved', 'requested', 'ready', 'review', 'failed')),
  add column payment_url text,
  add column payment_expires_at date,
  add column efi_charge_id text,
  add column efi_status text,
  add column price_cents integer check (price_cents > 0);

-- Reservation happens before the external POST. This covers concurrent tabs too.
create unique index billing_subscriptions_one_open_per_environment
  on public.billing_subscriptions (athlete_profile_id, environment)
  where status in ('pending', 'active', 'past_due');

alter table public.billing_plans enable row level security;
alter table public.billing_subscriptions enable row level security;
-- Preserve existing SELECT ownership policies. Only the server writes billing.
revoke insert, update, delete on public.billing_subscriptions from anon, authenticated;
revoke insert, update, delete on public.billing_plans from anon, authenticated;

comment on column public.billing_subscriptions.creation_state is
  'reserved/requested lock creation; ready reuses the link; review requires manual reconciliation by custom_id=id; failed is safe to retry before external creation.';
comment on column public.billing_subscriptions.payment_url is
  'Hosted Efi checkout; restricted by the existing read-own RLS policy. Never store card data.';
