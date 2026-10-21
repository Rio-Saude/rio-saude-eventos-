-- HOMOLOGATION ONLY. Reconstructed from production metadata on 2026-10-21.
-- Contains no production rows, credentials, or external payment configuration.
create table public.admin_emails (email text primary key, created_at timestamptz not null default now());
create table public.athlete_profiles (
  id uuid primary key default gen_random_uuid(), user_id uuid not null unique references auth.users(id), email text not null,
  first_name text, last_name text, whatsapp text, birth_date date, city text, modalities text[] not null default '{}',
  running_experience text, current_level text, training_days_current text, training_days_available text, base_preference text,
  primary_goal text, goal_event_name text, goal_event_date date, coach text, payment_provider text not null default 'efi',
  payment_status text not null default 'pending' check(payment_status in ('pending','submitted','confirmed')),
  trainingpeaks_status text not null default 'pending' check(trainingpeaks_status in ('pending','completed')),
  watch_brand text, watch_connected boolean not null default false, whatsapp_group_status text not null default 'pending' check(whatsapp_group_status in ('pending','completed')),
  onboarding_step smallint not null default 1 check(onboarding_step between 1 and 5), onboarding_completed_at timestamptz,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(), cpf text check(cpf is null or cpf ~ '^[0-9]{11}$'),
  had_training_injury boolean, training_injury_details text check(training_injury_details is null or length(training_injury_details)<=1000),
  goal_events jsonb not null default '[]'::jsonb check(jsonb_typeof(goal_events)='array' and jsonb_array_length(goal_events)<=15 and length(goal_events::text)<=12000),
  training_goals text[] not null default '{}', payment_followup_needed boolean not null default false, trainingpeaks_step_seen boolean not null default false
);
create table public.billing_plans (
 id uuid primary key default gen_random_uuid(), code text not null unique, name text not null, price_cents integer not null check(price_cents>0),
 currency text not null default 'BRL' check(currency='BRL'), interval_months smallint not null default 1 check(interval_months>0),
 modality_tier text not null check(modality_tier in ('single','multi')), active boolean not null default true,
 efi_plan_id_homolog text unique, efi_plan_id_prod text unique, created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table public.billing_subscriptions (
 id uuid primary key default gen_random_uuid(), athlete_profile_id uuid not null references public.athlete_profiles(id), billing_plan_id uuid not null references public.billing_plans(id),
 efi_subscription_id text unique, status text not null default 'pending' check(status in ('pending','active','past_due','cancelled','expired','failed')),
 payment_method text check(payment_method is null or payment_method in ('card','bolix','boleto','other')), started_at timestamptz, cancelled_at timestamptz,
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(), environment text not null default 'homologation' check(environment in ('homologation','production')),
 creation_state text not null default 'reserved' check(creation_state in ('reserved','requested','ready','review','failed')), payment_url text, payment_expires_at date, efi_charge_id text, efi_status text, price_cents integer check(price_cents>0)
);
create unique index billing_subscriptions_one_open_per_environment on public.billing_subscriptions(athlete_profile_id,environment) where status in ('pending','active','past_due');
create table public.health_screenings (
 id uuid primary key default gen_random_uuid(), user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
 form_version text not null default 'rj_6765_2014_annex_i_v1' check(form_version='rj_6765_2014_annex_i_v1'),
 q1 boolean not null,q2 boolean not null,q3 boolean not null,q4 boolean not null,q5 boolean not null,q6 boolean not null,q7 boolean not null,q8 boolean not null,q9 boolean not null,q10 boolean not null,
 signed_name text not null check(length(btrim(signed_name)) between 3 and 160), declaration_accepted boolean not null check(declaration_accepted=true), signed_at timestamptz not null default now(),
 screening_result text generated always as (case when q1 or q2 or q3 or q4 or q5 or q6 or q7 or q8 or q9 or q10 then 'medical_review_required' else 'no_positive_responses' end) stored,
 signer_role text not null default 'athlete' check(signer_role in ('athlete','guardian')), guardian_name text, guardian_authorization_accepted boolean not null default false,
 signed_city text not null check(length(btrim(signed_city)) between 2 and 120),
 check(signer_role='athlete' or (length(btrim(coalesce(guardian_name,''))) between 3 and 160 and guardian_authorization_accepted=true and lower(btrim(signed_name))=lower(btrim(guardian_name))))
);
create index health_screenings_user_signed_idx on public.health_screenings(user_id,signed_at desc);
create or replace function public.is_admin() returns boolean language sql stable security definer set search_path=public as $$select exists(select 1 from public.admin_emails a where lower(a.email)=lower(coalesce(auth.jwt()->>'email','')))$$;
create or replace function public.touch_updated_at() returns trigger language plpgsql set search_path=public as $$begin new.updated_at=now();return new;end$$;
create or replace function public.protect_athlete_payment_status() returns trigger language plpgsql set search_path=public as $$begin if auth.role()='authenticated' and not coalesce(public.is_admin(),false) then if new.payment_status='confirmed' and old.payment_status is distinct from 'confirmed' then raise exception 'financial confirmation requires trusted backend' using errcode='42501'; end if; if old.payment_status='confirmed' and new.payment_status is distinct from 'confirmed' then raise exception 'confirmed payment cannot be changed by athlete' using errcode='42501'; end if; end if; return new;end$$;
create or replace function public.validate_health_screening_signer() returns trigger language plpgsql set search_path=public as $$declare dob date;fname text;lname text;age_on_submission int;begin select p.birth_date,p.first_name,p.last_name into dob,fname,lname from public.athlete_profiles p where p.user_id=new.user_id;if dob is null then raise exception 'birth date required' using errcode='23514';end if;age_on_submission=extract(year from age(new.signed_at::date,dob));if age_on_submission<18 then if new.signer_role<>'guardian' or not new.guardian_authorization_accepted or lower(btrim(new.signed_name))<>lower(btrim(new.guardian_name)) then raise exception 'guardian signature and authorization required' using errcode='23514';end if;else if new.signer_role<>'athlete' or lower(btrim(new.signed_name))<>lower(btrim(concat_ws(' ',fname,lname))) then raise exception 'athlete signature must match registered full name' using errcode='23514';end if;end if;return new;end$$;
create trigger athlete_profiles_touch_updated_at before update on public.athlete_profiles for each row execute function public.touch_updated_at();
create trigger athlete_profiles_protect_financial_status before update of payment_status on public.athlete_profiles for each row execute function public.protect_athlete_payment_status();
create trigger health_screenings_validate_signer before insert on public.health_screenings for each row execute function public.validate_health_screening_signer();
alter table public.admin_emails enable row level security; alter table public.athlete_profiles enable row level security; alter table public.billing_plans enable row level security; alter table public.billing_subscriptions enable row level security; alter table public.health_screenings enable row level security; alter table public.health_screenings force row level security;
create policy "admins manage admin emails" on public.admin_emails for all to authenticated using(public.is_admin()) with check(public.is_admin());
create policy "admins manage athlete profiles" on public.athlete_profiles for all to authenticated using(public.is_admin()) with check(public.is_admin());
create policy "athletes create own profile" on public.athlete_profiles for insert to authenticated with check((select auth.uid())=user_id and lower(email)=lower(coalesce((select auth.jwt()->>'email'),'')));
create policy "athletes read own profile" on public.athlete_profiles for select to authenticated using((select auth.uid())=user_id);
create policy "athletes update own profile" on public.athlete_profiles for update to authenticated using((select auth.uid())=user_id) with check((select auth.uid())=user_id and lower(email)=lower(coalesce((select auth.jwt()->>'email'),'')));
create policy "billing_plans_read_active" on public.billing_plans for select to authenticated using(active=true);
create policy "billing_subscriptions_read_own" on public.billing_subscriptions for select to authenticated using(exists(select 1 from public.athlete_profiles ap where ap.id=billing_subscriptions.athlete_profile_id and ap.user_id=(select auth.uid())));
create policy "athlete reads own health screening" on public.health_screenings for select to authenticated using(user_id=(select auth.uid()));
create policy "athlete submits own health screening" on public.health_screenings for insert to authenticated with check(user_id=(select auth.uid()) and exists(select 1 from public.athlete_profiles p where p.user_id=(select auth.uid())));
revoke all on public.admin_emails,public.athlete_profiles,public.billing_plans,public.billing_subscriptions,public.health_screenings from anon;
grant select,insert,update,delete on public.admin_emails,public.athlete_profiles to authenticated;
grant select on public.billing_plans,public.billing_subscriptions,public.health_screenings to authenticated;
grant insert(q1,q2,q3,q4,q5,q6,q7,q8,q9,q10,signed_name,declaration_accepted,signer_role,guardian_name,guardian_authorization_accepted,signed_city) on public.health_screenings to authenticated;
revoke all on function public.is_admin() from public,anon; grant execute on function public.is_admin() to authenticated;
revoke all on function public.protect_athlete_payment_status(),public.validate_health_screening_signer() from public,anon,authenticated;
