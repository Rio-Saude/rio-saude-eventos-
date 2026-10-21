# Ativação da rotina comercial

A migração `20261021093000_onboarding_experimental_crm.sql` cria a função idempotente `public.process_commercial_tasks(date)`, mas não cria um agendamento. Isso é intencional: a ativação de `pg_cron` é uma mudança operacional no projeto Supabase e aguarda autorização.

Após aplicar a migração em ambiente autorizado, confirme que `pg_cron` está habilitado e agende uma única execução diária às 08:05 de São Paulo (11:05 UTC enquanto BRT estiver em UTC-3):

```sql
select cron.schedule(
  'rio-saude-commercial-daily',
  '5 11 * * *',
  $$select public.process_commercial_tasks((now() at time zone 'America/Sao_Paulo')::date)$$
);
```

Antes de ativar, execute uma vez `select public.process_commercial_tasks((now() at time zone 'America/Sao_Paulo')::date);`, confira as pendências criadas e verifique o histórico do job em `cron.job_run_details`. Reexecutar a função não duplica pendências por causa da chave única `(athlete_user_id, task_key)`.

O job não envia WhatsApp. A tabela `commercial_events` é apenas a fila de eventos para uma integração futura.
