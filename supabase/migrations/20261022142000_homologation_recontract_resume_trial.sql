-- HOMOLOGATION ONLY. A re-contract during an already-consumed free period
-- preserves the original end date; it never grants another 30 days or creates
-- a provider charge while that period is still active.

alter table public.billing_subscriptions
  drop constraint if exists billing_subscriptions_checkout_kind_check;
alter table public.billing_subscriptions
  add constraint billing_subscriptions_checkout_kind_check check
    (checkout_kind in (
      'legacy', 'card_trial', 'card_standard', 'boleto_trial', 'boleto_standard',
      'card_hosted_trial', 'card_hosted_standard', 'card_hosted_resume', 'boleto_resume'
    ));

alter table public.billing_subscriptions
  drop constraint if exists billing_subscriptions_trial_dates_check;
alter table public.billing_subscriptions
  add constraint billing_subscriptions_trial_dates_check check (
    (free_trial_days = 0 and trial_ends_on is null) or
    (free_trial_days = 30 and trial_ends_on is not null) or
    (free_trial_days = 0 and checkout_kind in ('card_hosted_resume', 'boleto_resume') and trial_ends_on is not null)
  );

comment on column public.billing_subscriptions.trial_ends_on is
  'For a resume checkout with free_trial_days=0, this is the original already-consumed trial end date. It is not a new trial entitlement.';
