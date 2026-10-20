import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.117.2";

// Administrative, idempotent setup of the two DISCOUNTED homologation plans.
// It does not create athlete subscriptions, charges or production plans.
const BASE = "https://cobrancas-h.api.efipay.com.br";
const ORIGIN = "https://rio-saude.github.io";
const TARGETS = [
  { code: "single_290_monthly", name: "Rio Saúde - 1 modalidade R$290 - Mensal - Homologação", price: 29000 },
  { code: "multi_tri_u26_monthly", name: "Rio Saúde - 2+ modalidades até 25 anos R$390 - Mensal - Homologação", price: 39000 }
] as const;
const URL = Deno.env.get("SUPABASE_URL") || "";
const KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const db = createClient(URL, KEY, { auth: { persistSession: false, autoRefreshToken: false } });

Deno.serve(async (req: Request) => {
  const origin = req.headers.get("origin");
  const headers: Record<string,string> = {
    "Content-Type": "application/json",
    "Cache-Control": "no-store",
    "Vary": "Origin",
    "Access-Control-Allow-Headers": "authorization, apikey, x-client-info, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS"
  };
  if (origin === ORIGIN) headers["Access-Control-Allow-Origin"] = ORIGIN;
  const reply = (status: number, data: unknown) =>
    new Response(JSON.stringify(data), { status, headers });
  if (origin && origin !== ORIGIN) return reply(403, { error: "origin_not_allowed" });
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers });
  if (req.method !== "POST") return reply(405, { error: "method_not_allowed" });
  if (Deno.env.get("EFI_ENV") !== "homologation") return reply(503, { error: "homologation_only" });
  const auth = req.headers.get("authorization") || "";
  if (!auth.startsWith("Bearer ")) return reply(401, { error: "sign_in_required" });
  const { data: identity, error: identityError } = await db.auth.getUser(auth.slice(7));
  if (identityError || !identity?.user?.id || !identity.user.email)
    return reply(401, { error: "sign_in_required" });
  const { data: admins, error: adminError } = await db.from("admin_emails").select("email");
  if (adminError || !admins?.some(a => String(a.email || "").toLowerCase() === identity.user.email!.toLowerCase()))
    return reply(403, { error: "admin_only" });

  const clientId = Deno.env.get("EFI_CLIENT_ID_HOMOLOG");
  const clientSecret = Deno.env.get("EFI_CLIENT_SECRET_HOMOLOG");
  if (!clientId || !clientSecret) return reply(503, { error: "homologation_credentials_missing" });

  try {
    const plans = [];
    // Validate every plan in our database before changing anything in Efi.
    for (const target of TARGETS) {
      const {data,error} = await db.from("billing_plans")
        .select("id,code,name,price_cents,currency,interval_months,active,efi_plan_id_homolog")
        .eq("code",target.code).maybeSingle();
      if (error || !data || data.price_cents !== target.price ||
        data.currency !== "BRL" || data.interval_months !== 1)
        return reply(409, { error: "plan_definition_mismatch", code: target.code });
      plans.push({target,data});
    }

    // Already provisioned: nothing to mutate.
    if (plans.every(({data}) => data.active && /^\\d+$/.test(data.efi_plan_id_homolog || "")))
      return reply(200, {ok:true,environment:"homologation",plans:plans.map(({target})=>({code:target.code,ready:true,reused:true}))});

    const authResponse = await fetch(`${BASE}/v1/authorize`,{
      method:"POST",
      headers:{Authorization:`Basic ${btoa(`${clientId}:${clientSecret}`)}`,"Content-Type":"application/json"},
      body:JSON.stringify({grant_type:"client_credentials"}),
      signal:AbortSignal.timeout(12000)
    });
    const tokenData=await authResponse.json();
    if(!authResponse.ok || typeof tokenData?.access_token!=="string")
      return reply(502,{error:"efi_auth_unavailable"});
    const headersEfi={Authorization:`Bearer ${tokenData.access_token}`,"Content-Type":"application/json"};
    const output=[];

    for (const {target,data} of plans) {
      if (/^\\d+$/.test(data.efi_plan_id_homolog || "")) {
        // Reuse a previously linked plan. Do not silently overwrite external IDs.
        if (!data.active) {
          const result=await db.from("billing_plans").update({active:true})
            .eq("id",data.id).eq("price_cents",target.price).eq("active",false)
            .select("id").maybeSingle();
          if(result.error) throw new Error("cannot_activate_existing_plan");
        }
        output.push({code:target.code,ready:true,reused:true});
        continue;
      }

      // Search by exact, versioned name first. Failure must NOT create a duplicate.
      const searchUrl=new URL(`${BASE}/v1/plans`);
      searchUrl.searchParams.set("name",target.name);
      searchUrl.searchParams.set("limit","100");
      searchUrl.searchParams.set("offset","0");
      const found=await fetch(searchUrl,{headers:headersEfi,signal:AbortSignal.timeout(15000)});
      if(!found.ok) throw new Error("efi_plan_lookup_failed");
      const foundData=await found.json();
      if(!Array.isArray(foundData?.data)) throw new Error("efi_plan_lookup_invalid");
      const match=foundData.data.find((x:Record<string,unknown>)=>x.name===target.name);
      let planId=match?.plan_id;
      let reused=Boolean(match);
      if (!/^\\d+$/.test(String(planId||""))) {
        const created=await fetch(`${BASE}/v1/plan`,{
          method:"POST",headers:headersEfi,
          body:JSON.stringify({name:target.name,interval:1,repeats:null}),
          signal:AbortSignal.timeout(20000)
        });
        const createdData=await created.json();
        if(!created.ok || !/^\\d+$/.test(String(createdData?.data?.plan_id||"")))
          throw new Error("efi_plan_creation_unconfirmed");
        planId=createdData.data.plan_id;
        reused=false;
      }
      const update=await db.from("billing_plans").update({efi_plan_id_homolog:String(planId),active:true})
        .eq("id",data.id).eq("price_cents",target.price)
        .is("efi_plan_id_homolog",null).select("id").maybeSingle();
      if(update.error) throw new Error("could_not_save_efi_plan_id");
      if(!update.data) {
        // Concurrent provisioning must not overwrite any existing provider ID.
        const recheck=await db.from("billing_plans").select("efi_plan_id_homolog,active").eq("id",data.id).single();
        if(recheck.error || !recheck.data.active || !/^\\d+$/.test(recheck.data.efi_plan_id_homolog||""))
          throw new Error("plan_needs_review");
      }
      output.push({code:target.code,ready:true,reused});
    }
    return reply(200,{ok:true,environment:"homologation",plans:output});
  } catch(error) {
    console.error("Discount plan setup failed",error instanceof Error?error.message:"unknown");
    return reply(502,{error:"setup_requires_review"});
  }
});
