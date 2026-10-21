-- HOMOLOGATION ONLY (xiiudduncvcxcvbgbqpc).
-- This does not schedule anything on its own. It installs the restricted
-- activator; run it once after the three Vault values and Edge secret exist.

create or replace function public.configure_homologation_billing_cron()
returns void language plpgsql security definer set search_path=pg_catalog, public, vault, net as $$
declare
  project_url text;
  publishable_key text;
  schedule_secret text;
begin
  select decrypted_secret into project_url from vault.decrypted_secrets where name='rio_saude_hml_project_url';
  select decrypted_secret into publishable_key from vault.decrypted_secrets where name='rio_saude_hml_publishable_key';
  select decrypted_secret into schedule_secret from vault.decrypted_secrets where name='rio_saude_hml_billing_cron_secret';
  if project_url is null or publishable_key is null or schedule_secret is null then
    raise exception 'missing Vault configuration for homologation billing cron';
  end if;
  if project_url <> 'https://xiiudduncvcxcvbgbqpc.supabase.co' then
    raise exception 'unexpected project URL';
  end if;
  perform cron.unschedule(jobid) from cron.job where jobname='rio-saude-billing-boleto-daily';
  perform cron.schedule(
    'rio-saude-billing-boleto-daily', '10 11 * * *',
    format($cmd$
      select net.http_post(
        url := %L,
        headers := jsonb_build_object('Content-Type','application/json','Authorization','Bearer ' || %L,'apikey',%L,'x-rio-schedule-secret',%L),
        body := '{"action":"run_due_boleto"}'::jsonb,
        timeout_milliseconds := 30000
      )
    $cmd$, project_url || '/functions/v1/efi-billing', publishable_key, publishable_key, schedule_secret)
  );
end; $$;
revoke all on function public.configure_homologation_billing_cron() from public, anon, authenticated;
comment on function public.configure_homologation_billing_cron() is 'HML only. Uses pg_net and Vault to invoke efi-billing at 08:10 America/Sao_Paulo (11:10 UTC).';
