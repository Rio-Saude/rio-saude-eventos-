(() => {
  "use strict";
  const cfg=window.RIO_SAUDE_CONFIG||{};
  const client=cfg.supabaseUrl&&cfg.supabaseAnonKey&&window.supabase
    ? window.supabase.createClient(cfg.supabaseUrl,cfg.supabaseAnonKey,{auth:{persistSession:true,autoRefreshToken:true}}):null;
  const list=document.querySelector("#race-review-list");
  const status=document.querySelector("#race-admin-status");
  const fmt=d=>d?new Date(d+"T12:00:00").toLocaleDateString("pt-BR"):"";
  if(!client){status.textContent="Configuração da homologação indisponível.";return;}
  let rows=[];
  async function refresh(){
    const {data,error}=await client.from("race_suggestions")
      .select("id,name,event_date,city,category,distance,notes,status,created_at")
      .eq("status","pending").order("created_at",{ascending:true});
    if(error)throw error;
    rows=data||[];list.replaceChildren();
    status.textContent=rows.length?rows.length+" sugestão(ões) aguardando revisão.":"Tudo em dia.";
    if(!rows.length){const p=document.createElement("p");p.className="race-admin-empty";p.textContent="Nenhuma prova aguardando aprovação.";list.appendChild(p);return;}
    for(const s of rows){
      const card=document.createElement("article");card.className="race-review";
      const title=document.createElement("h2");title.textContent=s.name;
      const details=document.createElement("p");details.textContent=[fmt(s.event_date),s.city,s.category,s.distance].filter(Boolean).join(" · ");
      card.append(title,details);
      if(s.notes){const note=document.createElement("p");note.textContent="Observação: "+s.notes;card.appendChild(note);}
      const actions=document.createElement("div");actions.className="actions";
      const approve=document.createElement("button");approve.className="primary-btn";approve.textContent="Aprovar e incluir";
      const reject=document.createElement("button");reject.className="secondary-btn";reject.textContent="Não incluir";
      async function perform(type) {
        if(type==="reject"&&!confirm("Não incluir esta prova no calendário?"))return;
        approve.disabled=reject.disabled=true;status.textContent="Salvando decisão…";
        try{
          const res=type==="approve"?await client.rpc("approve_race_suggestion",{p_id:s.id}):
            await client.from("race_suggestions").update({status:"rejected",reviewed_at:new Date().toISOString()}).eq("id",s.id);
          if(res.error)throw res.error;
          await refresh();
        }catch(e){status.textContent="Não foi possível salvar. Confira se a prova já existe e tente novamente.";approve.disabled=reject.disabled=false;}
      }
      approve.addEventListener("click",()=>perform("approve"));reject.addEventListener("click",()=>perform("reject"));
      actions.append(approve,reject);card.appendChild(actions);list.appendChild(card);
    }
  }
  (async()=>{
    const {data:{user},error}=await client.auth.getUser();
    if(error||!user){status.textContent="Entre na sua conta da Rio Saúde para acessar.";return;}
    const admin=await client.rpc("is_admin");
    if(admin.error||admin.data!==true){status.textContent="Esta área é exclusiva da equipe Rio Saúde.";return;}
    await refresh();
  })().catch(()=>{status.textContent="Não foi possível carregar as sugestões. Atualize a página.";});
})();