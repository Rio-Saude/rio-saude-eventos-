-- HOMOLOGATION ONLY: hosted Efí checkout after the Rio Saúde free trial.
-- This migration changes state constraints only. It never creates a provider
-- subscription, payment link, charge, or notification.

alter table public.billing_subscriptions
  drop constraint if exists billing_subscriptions_checkout_kind_check;
alter table public.billing_subscriptions
  add constraint billing_subscriptions_checkout_kind_check check
    (checkout_kind in (
      'legacy', 'card_trial', 'card_standard', 'boleto_trial', 'boleto_standard',
      'card_hosted_trial', 'card_hosted_standard'
    ));

comment on column public.billing_subscriptions.payment_url is
  'Hosted Efí checkout. For card_hosted_trial, it is persisted only on/after first_charge_on; card data is never collected or stored by Rio Saúde.';
