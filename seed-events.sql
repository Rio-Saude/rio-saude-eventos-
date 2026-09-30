-- Carga inicial gerada do calendário público atual.
insert into public.events
(name,event_date,category,site_url,coupon_code,coupon_label,group_status,group_minimum,active)
values

on conflict (name) do update set
  event_date=excluded.event_date,
  category=excluded.category,
  site_url=excluded.site_url,
  coupon_code=coalesce(excluded.coupon_code, public.events.coupon_code),
  coupon_label=coalesce(excluded.coupon_label, public.events.coupon_label),
  updated_at=now();
