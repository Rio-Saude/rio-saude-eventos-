-- Prepare discounted plans without enabling billing until Efí homologation IDs exist.
insert into public.billing_plans (code,name,price_cents,currency,interval_months,modality_tier,active)
values ('single_290_monthly','1 modalidade - tarifa reduzida',29000,'BRL',1,'single',false),('multi_tri_u26_monthly','2+ modalidades - Triathlon até 25 anos',39000,'BRL',1,'multi',false)
on conflict (code) do nothing;
