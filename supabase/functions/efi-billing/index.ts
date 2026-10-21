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
async function saveAddress(profileId: string, source: any) {
  if(!validAddress(source)) throw new Error('billing_address_required');
  const a={athlete_profile_id:profileId,street:source.street.trim(),number:source.number.trim(),complement:source.complement?.trim()||null,neighborhood:source.neighborhood.trim(),city:source.city.trim(),state:source.state,zipcode:source.zipcode};
  const {error}=await db.from('billing_customer_profiles').upsert(a,{onConflict:'athlete_profile_id'}); if(error) throw error; return a;
}
async function reserve(profile: any, plan: any, method: string, kind: string, useTrial: boolean) {
  const open=await existing(profile.id); if(open) return {row:open,reused:true};
  const start=spDate(), ends=useTrial ? addDays(start,29) : null;
  const {data,error}=await db.from('billing_subscriptions').insert({athlete_profile_id:profile.id,billing_plan_id:plan.id,environment:'homologation',status:'pending',creation_state:'reserved',payment_method:method,price_cents:plan.price_cents,checkout_kind:kind,free_trial_days:useTrial?30:0,trial_ends_on:ends,first_charge_on:useTrial?addDays(start,30):start,next_charge_on:useTrial?addDays(start,30):start,first_due_on:method==='boleto'?(useTrial?ends:start):null,boleto_issue_on:method==='boleto'&&useTrial?addDays(start,19):null}).select('*').single();
  if(!error) return {row:data,reused:false};
  if(error.code==='23505') { const current=await existing(profile.id); if(current) return {row:current,reused:true}; }
  throw error;
}
function customer(profile:any, address:any) { return {name:`${profile.first_name} ${profile.last_name}`.trim(),cpf:digits(profile.cpf),email:profile.email,phone_number:digits(profile.whatsapp)}; }
function billAddress(a:any) { return {street:a.street,number:a.number,neighborhood:a.neighborhood,zipcode:a.zipcode,city:a.city,state:a.state,complement:a.complement || undefined}; }

Deno.serve(async req => {
  const h=headers(req), origin=req.headers.get('origin')||'';
  if(origin && !origins.has(origin)) return json(req,403,{error:'origin_not_allowed'});
  if(req.method==='OPTIONS') return new Response(null,{status:204,headers:h});
  if(req.method!=='POST') return json(req,405,{error:'method_not_allowed'});
  try {
    const user=await userFor(req); if(!user) return json(req,401,{error:'authentication_required'});
    const body=await req.json().catch(()=>null); if(!body || typeof body!=='object') return json(req,400,{error:'invalid_request'});
    if(body.action==='config') {
      const code=Deno.env.get('EFI_PAYEE_CODE_HOMOLOG');
      if(Deno.env.get('EFI_ENV')!=='homologation' || !Deno.env.get('EFI_CLIENT_ID_HOMOLOG') || !Deno.env.get('EFI_CLIENT_SECRET_HOMOLOG') || !code) return json(req,503,{error:'homologation_credentials_missing'});
      return json(req,200,{environment:'homologation',payee_code:code,tokenization_url:'https://cdn.jsdelivr.net/gh/efipay/js-payment-token-efi/dist/payment-token-efi-umd.min.js'});
    }
    if(!['card','boleto','cancel','run_due_boleto'].includes(body.action)) return json(req,400,{error:'invalid_action'});
    if(body.action==='run_due_boleto') {
      const {data:adminRole}=await db.from('admin_emails').select('email').eq('email',user.email.toLowerCase()).maybeSingle();
      if(!adminRole) return json(req,403,{error:'admin_required'});
      const today=spDate(); const {data:due,error:de}=await db.from('billing_subscriptions').select('id,athlete_profile_id,billing_plan_id,first_due_on,price_cents').eq('environment','homologation').eq('creation_state','scheduled').eq('status','pending').lte('boleto_issue_on',today); if(de) throw de;
      let issued=0; for(const sub of due||[]) {
        const [{data:plan},{data:profile},{data:address}]=await Promise.all([db.from('billing_plans').select('name,efi_plan_id_homolog').eq('id',sub.billing_plan_id).single(),db.from('athlete_profiles').select('first_name,last_name,email,cpf,whatsapp').eq('id',sub.athlete_profile_id).single(),db.from('billing_customer_profiles').select('*').eq('athlete_profile_id',sub.athlete_profile_id).maybeSingle()]);
        if(!plan || !profile || !validAddress(address)) { await db.from('billing_subscriptions').update({creation_state:'review'}).eq('id',sub.id); continue; }
        await db.from('billing_subscriptions').update({creation_state:'requested'}).eq('id',sub.id); let requested=false;
        try { const access=await oauth(); requested=true; const r=await fetch(`${EFI}/v1/plan/${plan.efi_plan_id_homolog}/subscription/one-step`,{method:'POST',headers:{Authorization:`Bearer ${access}`,'Content-Type':'application/json'},body:JSON.stringify({items:[{name:`Rio Saúde - ${plan.name} - Mensal`,value:sub.price_cents,amount:1}],metadata:{custom_id:sub.id,notification_url:`${URL.replace('.supabase.co','.functions.supabase.co')}/efi-webhook`},payment:{banking_billet:{customer:customer(profile,address),billing_address:billAddress(address),expire_at:sub.first_due_on}}}),signal:AbortSignal.timeout(25000)}); const out=await r.json().catch(()=>null),data=out?.data;if(!r.ok||!data?.subscription_id)throw new Error('efi_boleto_failed');await db.from('billing_subscriptions').update({efi_subscription_id:String(data.subscription_id),efi_charge_id:data.charge?.id?String(data.charge.id):null,efi_status:String(data.status||'new'),creation_state:'ready'}).eq('id',sub.id);if(data.charge?.id)await db.from('billing_charges').upsert({subscription_id:sub.id,efi_charge_id:String(data.charge.id),charge_kind:'boleto',status:'waiting',amount_cents:sub.price_cents,due_on:sub.first_due_on,billet_url:data.charge?.billet_link||null},{onConflict:'efi_charge_id'});issued++; } catch { await db.from('billing_subscriptions').update(requested?{creation_state:'review'}:{creation_state:'scheduled'}).eq('id',sub.id); }
      }
      return json(req,200,{environment:'homologation',issued});
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
    const c=await context(req,body.plan_code); const requestedTrial=body.offer==='trial'; const eligible=requestedTrial && await trialAvailable(c.profile.id); if(requestedTrial && !eligible) return json(req,409,{error:'trial_not_available'});
    const address=await saveAddress(c.profile.id,body.billing_address || c.addr);
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
    if(typeof body.payment_token!=='string' || body.payment_token.length<20 || body.payment_token.length>4096) return json(req,400,{error:'payment_token_required'});
    const r=await reserve(c.profile,c.plan,'card',eligible?'card_trial':'card_standard',eligible); if(r.reused) return json(req,200,{environment:'homologation',subscription_id:r.row.id,reused:true,trial_ends_on:r.row.trial_ends_on,first_charge_on:r.row.first_charge_on});
    await db.from('billing_subscriptions').update({creation_state:'requested'}).eq('id',r.row.id);
    let external=false;
    try {
      const token=await oauth(); external=true;
      const payload={items:[{name:`Rio Saúde - ${c.plan.name} - Mensal`,value:c.plan.price_cents,amount:1}],metadata:{custom_id:r.row.id,notification_url:`${URL.replace('.supabase.co','.functions.supabase.co')}/efi-webhook`},payment:{credit_card:{customer:customer(c.profile,address),billing_address:billAddress(address),payment_token:body.payment_token,trial_days:eligible?30:undefined}}};
      const response=await fetch(`${EFI}/v1/plan/${c.plan.efi_plan_id_homolog}/subscription/one-step`,{method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify(payload),signal:AbortSignal.timeout(25000)});
      const result=await response.json().catch(()=>null), data=result?.data; if(!response.ok || !data?.subscription_id) throw new Error('efi_subscription_failed');
      const {error}=await db.from('billing_subscriptions').update({efi_subscription_id:String(data.subscription_id),efi_charge_id:data.charge?.id?String(data.charge.id):null,efi_status:String(data.status||'new'),creation_state:'ready',status:'pending'}).eq('id',r.row.id); if(error) throw error;
      if (data.charge?.id) await db.from('billing_charges').upsert({subscription_id:r.row.id,efi_charge_id:String(data.charge.id),charge_kind:'subscription',status:'new',amount_cents:c.plan.price_cents,due_on:r.row.first_charge_on},{onConflict:'efi_charge_id'});
      await db.from('athlete_profiles').update({payment_status:'pending',payment_followup_needed:true}).eq('id',c.profile.id);
      return json(req,200,{environment:'homologation',subscription_id:r.row.id,reused:false,trial_ends_on:r.row.trial_ends_on,first_charge_on:r.row.first_charge_on});
    } catch (e) { await db.from('billing_subscriptions').update(external?{creation_state:'review'}:{creation_state:'failed',status:'failed'}).eq('id',r.row.id); throw e; }
  } catch(e) {
    const msg=e instanceof Error?e.message:'billing_unavailable'; const allowed=['authentication_required','profile_missing','profile_incomplete','plan_unavailable','billing_address_required','payment_token_required','trial_not_available','subscription_not_found','efi_cancel_failed','homologation_credentials_missing'];
    return json(req,allowed.includes(msg)?(msg==='trial_not_available'?409:msg==='subscription_not_found'?404:msg==='authentication_required'?401:422):502,{error:allowed.includes(msg)?msg:'billing_unavailable'});
  }
});
