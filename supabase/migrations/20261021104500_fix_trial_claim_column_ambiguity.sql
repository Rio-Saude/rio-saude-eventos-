-- Safe repair for homologation databases that received the original CRM migration.
create or replace function public.claim_trial_invitation(p_token text)
returns table(starts_on date, ends_on date)
language plpgsql security definer set search_path=public, extensions as $$
declare v_invite public.trial_invitations; v_email text;
begin
  if auth.uid() is null then raise exception 'authentication required' using errcode='42501'; end if;
  select lower(email) into v_email from auth.users where id=auth.uid();
  select * into v_invite from public.trial_invitations
   where token_hash=encode(extensions.digest(p_token,'sha256'),'hex') and revoked_at is null
     and expires_at>now() and trial_invitations.starts_on <= (now() at time zone 'America/Sao_Paulo')::date
     and lower(invited_email)=v_email for update;
  if not found then raise exception 'invalid or expired invitation' using errcode='42501'; end if;
  if v_invite.claimed_at is not null then raise exception 'invitation already used' using errcode='42501'; end if;
  update public.trial_invitations set claimed_by=auth.uid(), claimed_at=now() where id=v_invite.id;
  insert into public.commercial_cases(athlete_user_id,trial_invitation_id,entry_kind,lifecycle_status,funnel_status,trial_starts_on,trial_ends_on)
  values(auth.uid(),v_invite.id,'trial','trial_active','contact_pending',v_invite.starts_on,v_invite.ends_on)
  on conflict (athlete_user_id) do update set trial_invitation_id=excluded.trial_invitation_id,entry_kind='trial',lifecycle_status='trial_active',trial_starts_on=excluded.trial_starts_on,trial_ends_on=excluded.trial_ends_on;
  insert into public.commercial_history(athlete_user_id,event_type,detail,performed_by) values(auth.uid(),'trial_invitation_claimed',jsonb_build_object('starts_on',v_invite.starts_on,'ends_on',v_invite.ends_on),auth.uid());
  return query select v_invite.starts_on,v_invite.ends_on;
end; $$;
revoke all on function public.claim_trial_invitation(text) from public, anon;
grant execute on function public.claim_trial_invitation(text) to authenticated;
