-- Security fix: remove privileges capable of bypassing RLS.
-- Neither clients nor public visitors should truncate tables, manage triggers,
-- or create foreign keys. No effect on CRUD guarded by RLS.
REVOKE TRUNCATE, TRIGGER, REFERENCES ON ALL TABLES IN SCHEMA public FROM anon, authenticated;
-- These data sets must only be exposed to authenticated athletes through RLS.
REVOKE ALL PRIVILEGES ON TABLE public.athlete_profiles FROM anon;
REVOKE ALL PRIVILEGES ON TABLE public.billing_subscriptions FROM anon;
REVOKE ALL PRIVILEGES ON TABLE public.billing_plans FROM anon;
