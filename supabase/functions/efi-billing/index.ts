import { createClient } from 'npm:@supabase/supabase-js@2.117.2';

const URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const db = createClient(URL, SERVICE, { auth: { persistSession: false, autoRefreshToken: false } });
const EFI = 'https://cobrancas-h.api.efipay.com.br';
const origins = new Set([
  'http://127.0.0.1:4173', 'http://localhost:4173',
  'https://rio-saude-homologacao-20261021.balmypuppy7.chatgpt.site'
]);
const prices: Record<string, number> = { single_monthly: 39000, single_290_monthly: 29000, multi_monthly: 49000, multi_tri_u26_monthly: 39000 };

function headers(req: Request) {
  const origin = req.headers.get('origin') || '';
  const h: Record<string, string> = { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'Vary': 'Origin',
    'Access-Control-Allow-Headers': 'authorization, apikey, x-client-info, content-type', 'Access-Control-Allow-Methods': 'POST, OPTIONS' };
  if (origins.has(origin)) h['Access-Control-Allow-Origin'] = origin;
  return h;
}
function json(req: Request, status: number, body: Record<string, unknown>) { return new Response(JSON.stringify(body), { status, headers: headers(req) }); }
function spDate(now = new Date()) { return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(now); }
function addDays(day: string, days: number) { const d = new Date(`${day}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + days); return d.toISOString().slice(0, 10); }
function digits(v: unknown) { return String(v || '').replace(/\D/g, ''); }
function cpfOk(cpf: string) { if (!/^\d{11}$/.test(cpf) || /^(\d)\1{10}$/.test(cpf)) return false; for (let n=9;n<=10;n++) { let s=0; for(let i=0;i<n;i++)s+=+cpf[i]*(n+1-i); if ((s*10)%11%10 !== +cpf[n]) return false; } return true; }
function validAddress(a: any) { return a && /^[0-9]{8}$/.test(a.zipcode || '') && /^[A-Z]{2}$/.test(a.state || '') && [a.street,a.number,a.neighborhood,a.city].every((x: unknown) => typeof x === 'string' && x.trim().length > 0); }
async function secureEquals(a: string | null, b: string | undefined) {
  if (!a || !b) return false;
  const encoder = new TextEncoder();
  const [ah,bh] = await Promise.all([crypto.subtle.digest('SHA-256',encoder.encode(a)),crypto.subtle.digest('SHA-256',encoder.encode(b))]);
  const av=new Uint8Array(ah), bv=new Uint8Array(bh); if(av.length!==bv.length) return false;
  let different=0; for(let i=0;i<av.length;i++) different|=av[i]^bv[i]; return different===0;
}

async function userFor(req: Request) {
  const auth = req.headers.get('authorization') || '';
  if (!auth.startsWith('Bearer ')) return null;
  const { data, error } = await db.auth.getUser(auth.slice(7)); return error ? null : data.user;
}
async function oauth() {
  const id=Deno.env.get('EFI_CLIENT_ID_HOMOLOG'), secret=Deno.env.get('EFI_CLIENT_SECRET_HOMOLOG');
  if (Deno.env.get('EFI_ENV') !== 'homologation' || !id || !secret) throw new Error('homologation_credentials_missing');
  const r=await fetch(`${EFI}/v1/authorize`, {method:'POST',headers:{Authorization:`Basic ${btoa(`${id}:${secret}`)}`,'Content-Type':'application/json'},body:JSON.stringify({grant_type:'client_credentials'}),signal:AbortSignal.timeout(15000)});
  const d=await r.json().catch(()=>null); if(!r.ok || !d?.access_token) throw new Error('efi_auth_failed'); return String(d.access_token);
}
async function context(req: Request, planCode: string) {
  const user=await userFor(req); if(!user?.id || !user.email) throw new Error('authentication_required');
  const {data:profile,error:pe}=await db.from('athlete_profiles').select('id,first_name,last_name,email,cpf,birth_date,whatsapp').eq('user_id',user.id).maybeSingle();
  if(pe) throw pe; if(!profile) throw new Error('profile_missing');
  if(!profile.first_name?.trim() || !profile.last_name?.trim() || !cpfOk(digits(profile.cpf)) || profile.email?.toLowerCase()!==user.email.toLowerCase()) throw new Error('profile_incomplete');
  const {data:plan,error}=await db.from('billing_plans').select('id,code,name,price_cents,currency,interval_months,active,efi_plan_id_homolog').eq('code',planCode).maybeSingle();
  if(error) throw error;
  if(!plan?.active || plan.price_cents!==prices[planCode] || plan.currency!=='BRL' || plan.interval_months!==1 || !/^\d+$/.test(plan.efi_plan_id_homolog || '')) throw new Error('plan_unavailable');
  const {data:addr,error:ae}=await db.from('billing_customer_profiles').select('*').eq('athlete_profile_id',profile.id).maybeSingle(); if(ae) throw ae;
  return {user,profile,plan,addr};
}
async function trialAvailable(profileId: string) { const {data,error}=await db.rpc('free_trial_available',{p_profile_id:profileId}); if(error) throw error; return data===true; }
async function existing(profileId: string) { const {data,error}=await db.from('billing_subscriptions').select('*').eq('athlete_profile_id',profileId).eq('environment','homologation').in('status',['pending','active','past_due']).order('created_at',{ascending:false}).limit(1).maybeSingle(); if(error) throw error; return data; }
async function cancelledTrialStillActive(profileId: string) {
  const today=spDate();
  const {data,error}=await db.from('billing_subscriptions').select('*')
    .eq('athlete_profile_id',profileId).eq('environment','homologation').eq('status','cancelled')
    .eq('free_trial_days',30).gte('trial_ends_on',today).order('trial_ends_on',{ascending:false}).limit(1).maybeSingle();
  if(error) throw error;
  return data;
}
async function cardCheckoutMode(profileId: string) {
  // UX hint only: creation recalculates eligibility, so the browser cannot
  // grant itself either a trial or an immediate checkout.
  const [open, cancelledTrial, trialAvailableNow] = await Promise.all([
    existing(profileId), cancelledTrialStillActive(profileId), trialAvailable(profileId)
  ]);
  if (open) return open.payment_method === 'card' && open.creation_state === 'ready' &&
    typeof open.payment_url === 'string' && open.payment_url.startsWith('https://') ? 'immediate' : 'deferred';
  return !cancelledTrial && !trialAvailableNow ? 'immediate' : 'deferred';
}
async function saveAddress(profileId: string, source: any) {
  if(!validAddress(source)) throw new Error('billing_address_required');
  const a={athlete_profile_id:profileId,street:source.street.trim(),number:source.number.trim(),complement:source.complement?.trim()||null,neighborhood:source.neighborhood.trim(),city:source.city.trim(),state:source.state,zipcode:source.zipcode};
  const {error}=await db.from('billing_customer_profiles').upsert(a,{onConflict:'athlete_profile_id'}); if(error) throw error; return a;
}
async function reserve(profile: any, plan: any, method: string, kind: string, useTrial: boolean) {
  const open=await existing(profile.id); if(open) return {row:open,reused:true};
  const start=spDate(), ends=useTrial ? addDays(start,29) : null;
  const {data,error}=await db.from('billing_subscriptions').insert({athlete_profile_id:profile.id,billing_plan_id:plan.id,environment:'homologation',status:'pending',creation_state:'reserved',payment_method:method,price_cents:plan.price_cents,checkout_kind:kind,free_trial_days:useTrial?30:0,trial_ends_on:ends,first_charge_on:useTrial?addDays(start,30):start,next_charge_on:useTrial?addDays(start,30):start,first_due_on:method==='boleto'?(useTrial?ends:start):null,boleto_issue_on:method==='boleto'&&useTrial?addDays(start,19):null,checkout_link_on:kind==='card_hosted_trial'?addDays(start,24):null,checkout_reminder_on:kind==='card_hosted_trial'?addDays(start,30):null}).select('*').single();
  if(!error) return {row:data,reused:false};
  if(error.code==='23505') { const current=await existing(profile.id); if(current) return {row:current,reused:true}; }
  throw error;
}
async function reserveResume(profile: any, plan: any, method: string, prior: any) {
  const open=await existing(profile.id); if(open) return {row:open,reused:true};
  const checkoutOn=addDays(prior.trial_ends_on,1);
  const kind=method==='boleto'?'boleto_resume':'card_hosted_resume';
  const dueOn=method==='boleto'?addDays(prior.trial_ends_on,10):null;
  const {data,error}=await db.from('billing_subscriptions').insert({
    athlete_profile_id:profile.id,billing_plan_id:plan.id,environment:'homologation',status:'pending',creation_state:'scheduled',
    payment_method:method,price_cents:plan.price_cents,checkout_kind:kind,free_trial_days:0,
    trial_ends_on:prior.trial_ends_on,first_charge_on:checkoutOn,next_charge_on:checkoutOn,
    first_due_on:dueOn,boleto_issue_on:method==='boleto'?checkoutOn:null,
    checkout_link_on:method==='card'?checkoutOn:null,checkout_reminder_on:method==='card'?addDays(checkoutOn,6):null
  }).select('*').single();
  if(!error) return {row:data,reused:false};
  if(error.code==='23505') { const current=await existing(profile.id); if(current) return {row:current,reused:true}; }
  throw error;
}
async function reviveUnprovisionedTrial(profile: any, plan: any, method: string, prior: any) {
  const kind=method==='boleto'?'boleto_trial':'card_hosted_trial';
  const {data,error}=await db.from('billing_subscriptions').update({
    billing_plan_id:plan.id,payment_method:method,price_cents:plan.price_cents,checkout_kind:kind,
    status:'pending',creation_state:'scheduled',cancel_requested_at:null,provider_cancelled_at:null,cancelled_at:null,cancelled_effective_on:null,
    first_charge_on:addDays(prior.trial_ends_on,1),next_charge_on:addDays(prior.trial_ends_on,1),
    first_due_on:method==='boleto'?prior.trial_ends_on:null,boleto_issue_on:method==='boleto'?addDays(prior.trial_ends_on,-10):null,
    checkout_link_on:method==='card'?addDays(prior.trial_ends_on,-5):null,checkout_reminder_on:method==='card'?addDays(prior.trial_ends_on,1):null
  }).eq('id',prior.id).eq('status','cancelled').is('efi_subscription_id',null).select('*').maybeSingle();
  if(error) throw error;
  if(data) return {row:data,reused:false};
  const open=await existing(profile.id); if(open) return {row:open,reused:true};
  return null;
}
function customer(profile:any, address:any) { return {name:`${profile.first_name} ${profile.last_name}`.trim(),cpf:digits(profile.cpf),email:profile.email,phone_number:digits(profile.whatsapp)}; }
function billAddress(a:any) { return {street:a.street,number:a.number,neighborhood:a.neighborhood,zipcode:a.zipcode,city:a.city,state:a.state,complement:a.complement || undefined}; }
async function createHostedCardLink(sub: any) {
  const [{data:plan},{data:profile}]=await Promise.all([
    db.from('billing_plans').select('name,efi_plan_id_homolog').eq('id',sub.billing_plan_id).single(),
    db.from('athlete_profiles').select('user_id').eq('id',sub.athlete_profile_id).single()
  ]);
  if (!plan || !profile || !/^\d+$/.test(plan.efi_plan_id_homolog || '')) throw new Error('plan_unavailable');
  const {data:locked}=await db.from('billing_subscriptions').update({creation_state:'requested'}).eq('id',sub.id).eq('creation_state','scheduled').select('id').maybeSingle();
  if (!locked) return false;
  let requested=false;
  try {
    const access=await oauth(); requested=true;
    const expires=addDays(spDate(),7);
    const response=await fetch(`${EFI}/v1/plan/${plan.efi_plan_id_homolog}/subscription/one-step/link`,{
      method:'POST',headers:{Authorization:`Bearer ${access}`,'Content-Type':'application/json'},
      body:JSON.stringify({
        items:[{name:`Rio Saúde - ${plan.name} - Mensal`,value:sub.price_cents,amount:1}],
        metadata:{custom_id:sub.id,notification_url:`${URL.replace('.supabase.co','.functions.supabase.co')}/efi-webhook`},
        settings:{payment_method:'credit_card',expire_at:expires,request_delivery_address:false}
      }),signal:AbortSignal.timeout(25000)
    });
    const out=await response.json().catch(()=>null), data=out?.data;
    if(!response.ok || !data?.subscription_id || !data?.payment_url) throw new Error('efi_checkout_link_failed');
    const {error}=await db.from('billing_subscriptions').update({
      efi_subscription_id:String(data.subscription_id),efi_charge_id:data.charge?.id?String(data.charge.id):null,
      efi_status:String(data.status||'new'),payment_url:String(data.payment_url),payment_expires_at:expires,
      creation_state:'ready',status:'pending'
    }).eq('id',sub.id);
    if(error) throw error;
    if(data.charge?.id) await db.from('billing_charges').upsert({subscription_id:sub.id,efi_charge_id:String(data.charge.id),charge_kind:'subscription',status:'new',amount_cents:sub.price_cents,due_on:sub.first_charge_on},{onConflict:'efi_charge_id'});
    return true;
  } catch (e) {
    await db.from('billing_subscriptions').update(requested?{creation_state:'review'}:{creation_state:'scheduled'}).eq('id',sub.id);
    throw e;
  }
}

Deno.serve(async req => {
  const h=headers(req), origin=req.headers.get('origin')||'';
  if(origin && !origins.has(origin)) return json(req,403,{error:'origin_not_allowed'});
  if(req.method==='OPTIONS') return new Response(null,{status:204,headers:h});
  if(req.method!=='POST') return json(req,405,{error:'method_not_allowed'});
  try {
    const body=await req.json().catch(()=>null); if(!body || typeof body!=='object') return json(req,400,{error:'invalid_request'});
    const scheduledWorker=body.action==='run_due_boleto' && await secureEquals(req.headers.get('x-rio-schedule-secret'),Deno.env.get('BILLING_CRON_SECRET_HOMOLOG'));
    const user=scheduledWorker ? null : await userFor(req); if(!scheduledWorker && !user) return json(req,401,{error:'authentication_required'});
    if(!['card_hosted','boleto','cancel','run_due_boleto','payment_mode'].includes(body.action)) return json(req,400,{error:'invalid_action'});
    if(body.action==='payment_mode') {
      const {data:profile,error}=await db.from('athlete_profiles').select('id').eq('user_id',user!.id).maybeSingle();
      if(error) throw error;
      if(!profile) throw new Error('profile_missing');
      return json(req,200,{environment:'homologation',card_checkout:await cardCheckoutMode(profile.id)});
    }
    if(body.action==='run_due_boleto') {
      if (!scheduledWorker) {
        const {data:adminRole}=await db.from('admin_emails').select('email').eq('email',user!.email!.toLowerCase()).maybeSingle();
        if(!adminRole) return json(req,403,{error:'admin_required'});
      }
      const today=spDate(); const {data:due,error:de}=await db.from('billing_subscriptions').select('id,athlete_profile_id,billing_plan_id,first_due_on,price_cents').eq('environment','homologation').eq('payment_method','boleto').eq('creation_state','scheduled').eq('status','pending').lte('boleto_issue_on',today); if(de) throw de;
      let issued=0; for(const sub of due||[]) {
        const [{data:plan},{data:profile},{data:address}]=await Promise.all([db.from('billing_plans').select('name,efi_plan_id_homolog').eq('id',sub.billing_plan_id).single(),db.from('athlete_profiles').select('first_name,last_name,email,cpf,whatsapp').eq('id',sub.athlete_profile_id).single(),db.from('billing_customer_profiles').select('*').eq('athlete_profile_id',sub.athlete_profile_id).maybeSingle()]);
        if(!plan || !profile || !validAddress(address)) { await db.from('billing_subscriptions').update({creation_state:'review'}).eq('id',sub.id); continue; }
        const {data:locked}=await db.from('billing_subscriptions').update({creation_state:'requested'}).eq('id',sub.id).eq('creation_state','scheduled').select('id').maybeSingle();
        if (!locked) continue; let requested=false;
        try { const access=await oauth(); requested=true; const r=await fetch(`${EFI}/v1/plan/${plan.efi_plan_id_homolog}/subscription/one-step`,{method:'POST',headers:{Authorization:`Bearer ${access}`,'Content-Type':'application/json'},body:JSON.stringify({items:[{name:`Rio Saúde - ${plan.name} - Mensal`,value:sub.price_cents,amount:1}],metadata:{custom_id:sub.id,notification_url:`${URL.replace('.supabase.co','.functions.supabase.co')}/efi-webhook`},payment:{banking_billet:{customer:customer(profile,address),billing_address:billAddress(address),expire_at:sub.first_due_on}}}),signal:AbortSignal.timeout(25000)}); const out=await r.json().catch(()=>null),data=out?.data;if(!r.ok||!data?.subscription_id)throw new Error('efi_boleto_failed');await db.from('billing_subscriptions').update({efi_subscription_id:String(data.subscription_id),efi_charge_id:data.charge?.id?String(data.charge.id):null,efi_status:String(data.status||'new'),creation_state:'ready'}).eq('id',sub.id);if(data.charge?.id)await db.from('billing_charges').upsert({subscription_id:sub.id,efi_charge_id:String(data.charge.id),charge_kind:'boleto',status:'waiting',amount_cents:sub.price_cents,due_on:sub.first_due_on,billet_url:data.charge?.billet_link||null},{onConflict:'efi_charge_id'});issued++; } catch { await db.from('billing_subscriptions').update(requested?{creation_state:'review'}:{creation_state:'scheduled'}).eq('id',sub.id); }
      }
      const {data:upcoming,error:ue}=await db.from('billing_subscriptions').select('id,athlete_profile_id,checkout_link_on').eq('environment','homologation').eq('checkout_kind','card_hosted_trial').eq('creation_state','scheduled').eq('status','pending').eq('checkout_link_on',today);
      if(ue) throw ue;
      for(const sub of upcoming||[]) {
        const {data:profile}=await db.from('athlete_profiles').select('user_id').eq('id',sub.athlete_profile_id).maybeSingle();
        if(profile?.user_id) await db.from('commercial_events').upsert({athlete_user_id:profile.user_id,event_type:'financial.card_checkout_coming',event_key:`card_checkout_coming:${sub.id}`,payload:{checkout_available_on:sub.checkout_link_on}},{onConflict:'athlete_user_id,event_key'});
      }
      const {data:hostedDue,error:he}=await db.from('billing_subscriptions').select('id,athlete_profile_id,billing_plan_id,price_cents,first_charge_on,checkout_link_on').eq('environment','homologation').in('checkout_kind',['card_hosted_trial','card_hosted_resume']).eq('creation_state','scheduled').eq('status','pending').lte('checkout_link_on',today);
      if(he) throw he;
      let hosted=0; for(const sub of hostedDue||[]) { try { if(await createHostedCardLink(sub)) hosted++; } catch { /* state is safely scheduled or review */ } }
      return json(req,200,{environment:'homologation',issued,hosted});
    }
    if(body.action==='cancel') {
      const {data:p,error}=await db.from('athlete_profiles').select('id').eq('user_id',user.id).maybeSingle(); if(error||!p) throw new Error('profile_missing');
      const sub=await existing(p.id); if(!sub) return json(req,404,{error:'subscription_not_found'}); if(sub.status==='cancelled') return json(req,200,{cancelled:true,reused:true,effective_on:sub.cancelled_effective_on});
      if(!sub.efi_subscription_id) { const {error:e}=await db.from('billing_subscriptions').update({status:'cancelled',creation_state:'cancelled',cancel_requested_at:new Date().toISOString(),provider_cancelled_at:new Date().toISOString(),cancelled_at:new Date().toISOString(),cancelled_effective_on:sub.trial_ends_on || spDate()}).eq('id',sub.id); if(e) throw e; return json(req,200,{cancelled:true,effective_on:sub.trial_ends_on || spDate()}); }
      const token=await oauth(); const r=await fetch(`${EFI}/v1/subscription/${encodeURIComponent(sub.efi_subscription_id)}/cancel`,{method:'PUT',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:'{}',signal:AbortSignal.timeout(20000)}); if(!r.ok) throw new Error('efi_cancel_failed');
      const effective=sub.trial_ends_on && sub.trial_ends_on>=spDate()?sub.trial_ends_on:spDate();
      const {error:e}=await db.from('billing_subscriptions').update({status:'cancelled',creation_state:'cancelled',cancel_requested_at:new Date().toISOString(),provider_cancelled_at:new Date().toISOString(),cancelled_at:new Date().toISOString(),cancelled_effective_on:effective}).eq('id',sub.id); if(e) throw e;
      return json(req,200,{cancelled:true,effective_on:effective});
    }
    if(typeof body.plan_code!=='string' || !prices[body.plan_code]) return json(req,400,{error:'invalid_plan'});
    const c=await context(req,body.plan_code);
    const address=body.action==='boleto'?await saveAddress(c.profile.id,body.billing_address || c.addr):null;
    // The browser cannot choose or waive the benefit. Eligibility comes only
    // from the CPF-backed financial history on the server.
    const eligible=await trialAvailable(c.profile.id);
    const activeCancelledTrial=eligible?null:await cancelledTrialStillActive(c.profile.id);
    if(activeCancelledTrial) {
      const method=body.action==='boleto'?'boleto':'card';
      const revived=!activeCancelledTrial.efi_subscription_id
        ? await reviveUnprovisionedTrial(c.profile,c.plan,method,activeCancelledTrial)
        : null;
      const resumed=revived || await reserveResume(c.profile,c.plan,method,activeCancelledTrial);
      await db.from('athlete_profiles').update({payment_status:'pending',payment_followup_needed:true}).eq('id',c.profile.id);
      return json(req,200,{environment:'homologation',subscription_id:resumed.row.id,reused:resumed.reused,resumed_trial:true,checkout_deferred:true,trial_ends_on:activeCancelledTrial.trial_ends_on,first_charge_on:resumed.row.first_charge_on,first_due_on:resumed.row.first_due_on,boleto_issue_on:resumed.row.boleto_issue_on});
    }
    if(body.action==='boleto') {
      const r=await reserve(c.profile,c.plan,'boleto',eligible?'boleto_trial':'boleto_standard',eligible);
      if(r.reused) return json(req,200,{environment:'homologation',subscription_id:r.row.id,reused:true,trial_ends_on:r.row.trial_ends_on,first_due_on:r.row.first_due_on});
      // Boleto is deliberately not sent to Efí on the first day of the trial.
      // The server-side runner may create it only from the 20th day onward.
      const {error:scheduled}=await db.from('billing_subscriptions').update({creation_state:'scheduled'}).eq('id',r.row.id);
      if (scheduled) throw scheduled;
      await db.from('athlete_profiles').update({payment_status:'pending',payment_followup_needed:true}).eq('id',c.profile.id);
      return json(req,200,{environment:'homologation',subscription_id:r.row.id,reused:false,trial_ends_on:r.row.trial_ends_on,first_due_on:r.row.first_due_on,boleto_issue_on:r.row.boleto_issue_on});
    }
    const r=await reserve(c.profile,c.plan,'card',eligible?'card_hosted_trial':'card_hosted_standard',eligible);
    if(r.reused) return json(req,200,{environment:'homologation',subscription_id:r.row.id,reused:true,trial_ends_on:r.row.trial_ends_on,first_charge_on:r.row.first_charge_on,payment_url:r.row.payment_url || null});
    await db.from('athlete_profiles').update({payment_status:'pending',payment_followup_needed:true}).eq('id',c.profile.id);
    if(eligible) {
      const {error:scheduled}=await db.from('billing_subscriptions').update({creation_state:'scheduled'}).eq('id',r.row.id);
      if(scheduled) throw scheduled;
      return json(req,200,{environment:'homologation',subscription_id:r.row.id,reused:false,trial_ends_on:r.row.trial_ends_on,first_charge_on:r.row.first_charge_on,checkout_deferred:true});
    }
    const {error:scheduled}=await db.from('billing_subscriptions').update({creation_state:'scheduled'}).eq('id',r.row.id);
    if(scheduled) throw scheduled;
    await createHostedCardLink({...r.row,creation_state:'scheduled'});
    const {data:ready,error:re}=await db.from('billing_subscriptions').select('payment_url,payment_expires_at').eq('id',r.row.id).single();
    if(re || !ready?.payment_url) throw new Error('efi_checkout_link_failed');
    return json(req,200,{environment:'homologation',subscription_id:r.row.id,reused:false,payment_url:ready.payment_url,payment_expires_at:ready.payment_expires_at});
  } catch(e) {
    const msg=e instanceof Error?e.message:'billing_unavailable'; const allowed=['authentication_required','profile_missing','profile_incomplete','plan_unavailable','billing_address_required','trial_not_available','subscription_not_found','efi_cancel_failed','homologation_credentials_missing','efi_checkout_link_failed'];
    return json(req,allowed.includes(msg)?(msg==='trial_not_available'?409:msg==='subscription_not_found'?404:msg==='authentication_required'?401:422):502,{error:allowed.includes(msg)?msg:'billing_unavailable'});
  }
});
