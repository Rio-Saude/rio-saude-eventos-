-- HOMOLOGATION ONLY. Replace the provisional JWT cron route with a dedicated
-- secret-authenticated worker. Secrets are read from Vault at every execution
-- and never interpolated into cron.job.command.

create or replace function public.invoke_homologation_billing_cron()
returns void language plpgsql security definer set search_path=pg_catalog, vault, net as $$
declare project_url text; schedule_secret text;
begin
  select decrypted_secret into project_url from vault.decrypted_secrets where name='rio_saude_hml_project_url';
  select decrypted_secret into schedule_secret from vault.decrypted_secrets where name='rio_saude_hml_billing_cron_secret';
  if project_url <> 'https://xiiudduncvcxcvbgbqpc.supabase.co' or schedule_secret is null then raise exception 'missing or invalid billing cron configuration'; end if;
  perform net.http_post(url:=project_url||'/functions/v1/efi-billing-cron',headers:=jsonb_build_object('Content-Type','application/json','x-rio-schedule-secret',schedule_secret),body:='{"action":"run_financial_followup"}'::jsonb,timeout_milliseconds:=30000);
end; $$;
revoke all on function public.invoke_homologation_billing_cron() from public, anon, authenticated;

create or replace function public.configure_homologation_billing_cron()
returns void language plpgsql security definer set search_path=pg_catalog, public, vault as $$
declare project_url text; schedule_secret text;
begin
  select decrypted_secret into project_url from vault.decrypted_secrets where name='rio_saude_hml_project_url';
  select decrypted_secret into schedule_secret from vault.decrypted_secrets where name='rio_saude_hml_billing_cron_secret';
  if project_url <> 'https://xiiudduncvcxcvbgbqpc.supabase.co' or schedule_secret is null then raise exception 'missing or invalid billing cron configuration'; end if;
  perform cron.unschedule(jobid) from cron.job where jobname='rio-saude-billing-boleto-daily';
  perform cron.schedule('rio-saude-billing-boleto-daily','10 11 * * *','select public.invoke_homologation_billing_cron()');
end; $$;
revoke all on function public.configure_homologation_billing_cron() from public, anon, authenticated;
