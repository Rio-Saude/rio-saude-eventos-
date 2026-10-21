-- HOMOLOGATION ONLY. Do not apply to production.
-- Prices are the existing Rio Saúde monthly prices used by onboarding.js and
-- efi-create-subscription; this only initializes inactive sandbox mappings.
insert into public.billing_plans (code,name,price_cents,currency,interval_months,modality_tier,active)
values
  ('single_monthly','1 modalidade',39000,'BRL',1,'single',false),
  ('single_290_monthly','1 modalidade - tarifa reduzida',29000,'BRL',1,'single',false),
  ('multi_monthly','2 ou mais modalidades',49000,'BRL',1,'multi',false),
  ('multi_tri_u26_monthly','2+ modalidades - Triathlon até 25 anos',39000,'BRL',1,'multi',false)
on conflict (code) do update
  set name=excluded.name,
      price_cents=excluded.price_cents,
      currency=excluded.currency,
      interval_months=excluded.interval_months,
      modality_tier=excluded.modality_tier
  where public.billing_plans.efi_plan_id_homolog is null
    and public.billing_plans.active=false;
