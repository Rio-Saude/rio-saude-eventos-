(() => {
  "use strict";
  const cfg = window.RIO_SAUDE_CONFIG || {};
  const $ = (selector) => document.querySelector(selector);
  const loading = $("#races-loading");
  const app = $("#races-app");
  const dialog = $("#race-dialog");
  const today = () => new Date().toLocaleDateString("sv-SE", { timeZone:"America/Sao_Paulo" });
  const client = cfg.supabaseUrl && cfg.supabaseAnonKey && window.supabase
    ? window.supabase.createClient(cfg.supabaseUrl,cfg.supabaseAnonKey,{auth:{persistSession:true,autoRefreshToken:true}})
    : null;
  const state = { user:null, events:[], windows:[], counts:new Map(), mine:new Map(), suggestions:[], year:null, category:"all", currentTab:"calendar", editing:null };
  const fmt = (date) => date ? new Date(date + "T12:00:00").toLocaleDateString("pt-BR",{day:"2-digit",month:"short",year:"numeric"}) : "";
  const number = (n) => Number(n || 0).toLocaleString("pt-BR");
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
  const safeUrl = (s) => { try { const u = new URL(s); return ["http:","https:"].includes(u.protocol)?u.href:""; } catch {return "";} };
  const categoryOf = (e) => /triathlon/i.test(e.category||"") ? "tri" : /trail/i.test(e.category||"") ? "trail" : "run";
  const future = (e) => e.event_date >= today();
  const groupAvailable = (e) => ["checking","collecting","confirmed"].includes(e.group_status) &&
    (!e.group_deadline || e.group_deadline >= today());

  if (!client) { loading.textContent = "Configuração da homologação indisponível."; return; }

  function showError(message) {
    loading.classList.remove("hidden");
    app.classList.add("hidden");
    loading.textContent = message || "Não foi possível carregar suas provas. Atualize a página.";
  }
  function activate(tab) {
    state.currentTab = tab;
    document.querySelectorAll("[data-race-tab]").forEach(b => b.setAttribute("aria-selected",String(b.dataset.raceTab===tab)));
    ["calendar","mine","suggest"].forEach(k => $("#race-"+k+"-panel").classList.toggle("hidden",k!==tab));
    if (tab==="mine") renderMine();
  }
  function myEntry(eventId) { return state.mine.get(eventId) || null; }
  function windowLabel(w) {
    const now=today();
    const range=(w.start_date ? fmt(w.start_date) : "") + (w.start_date&&w.end_date ? " a " : "") + (w.end_date ? fmt(w.end_date) : "");
    let phase = w.start_date && w.start_date > now ? "Abertura futura" : w.end_date && w.end_date < now ? "Encerrada" : "Inscrições";
    return '<div class="race-meta">'+esc(w.label)+': '+esc(phase)+(range ? ' · '+esc(range) : "")+'</div>';
  }
  function createCard(event) {
    const card=document.createElement("article");
    card.className="race-card";
    const counts=state.counts.get(event.id)||{interest_count:0,going_count:0};
    const mine=myEntry(event.id);
    const location=[event.city,event.state].filter(Boolean).join(" · ");
    const windows=state.windows.filter(w=>w.event_name===event.name && w.active);
    const official=safeUrl(event.site_url);
    card.innerHTML =
      '<div class="race-top"><span class="race-date">'+esc(fmt(event.event_date))+'</span><span class="race-category">'+esc(event.category||"Prova")+'</span></div>'+
      '<h3>'+esc(event.name)+'</h3>'+
      (location?'<div class="race-meta">'+esc(location)+'</div>':"")+
      (event.distances?'<div class="race-meta">Distâncias: '+esc(event.distances)+'</div>':"")+
      (event.featured_note?'<div class="race-group">'+esc(event.featured_note)+'</div>':"")+
      windows.map(windowLabel).join("")+
      (mine?'<div class="race-status">Sua escolha: '+(mine.status==="going"?"Vou participar":"Tenho interesse")+(mine.distance?" · "+esc(mine.distance):"")+'</div>':"")+
      '<div class="race-counts"><div><strong>'+number(counts.going_count)+'</strong><span>vão participar</span></div>'+
      '<div><strong>'+number(counts.interest_count)+'</strong><span>têm interesse</span></div></div>'+
      (groupAvailable(event)?'<div class="race-group">Inscrição em grupo Rio Saúde: consulte a equipe para saber as condições e como participar.</div>':"")+
      '<div class="race-actions"></div>';
    const actions=card.querySelector(".race-actions");
    for (const [status,label] of [["interest","Tenho interesse"],["going","Vou participar"]]) {
      const btn=document.createElement("button");
      btn.type="button";btn.textContent=label;
      btn.className=mine?.status===status?"selected":"";
      btn.setAttribute("aria-pressed",String(mine?.status===status));
      btn.addEventListener("click",()=>openChoice(event,status));
      actions.appendChild(btn);
    }
    if (mine) {
      const remove=document.createElement("button");remove.type="button";remove.textContent="Remover";
      remove.className="race-remove";
      remove.addEventListener("click",()=>removeChoice(event,remove));
      actions.appendChild(remove);
    }
    if (official) {
      const a=document.createElement("a");a.href=official;a.target="_blank";a.rel="noopener noreferrer";a.textContent="Site oficial ↗";
      actions.appendChild(a);
    }
    return card;
  }
  function fillGrid(root,events,emptyText) {
    root.replaceChildren();
    if (!events.length) {
      const blank=document.createElement("p");
      blank.className="races-empty";blank.textContent=emptyText;root.appendChild(blank);return;
    }
    events.forEach(e=>root.appendChild(createCard(e)));
  }
  function renderCalendar() {
    const chosen=state.events.filter(e=>future(e) && String(e.event_date).slice(0,4)===String(state.year) &&
      (state.category==="all" || categoryOf(e)===state.category));
    $("#race-calendar-summary").textContent=chosen.length+" provas encontradas · Atualizado com o calendário Rio Saúde";
    fillGrid($("#race-calendar-grid"),chosen,"Nenhuma prova nesta seleção.");
  }
  function renderMine() {
    fillGrid($("#race-mine-grid"),state.events.filter(e=>future(e)&&state.mine.has(e.id)),
      "Você ainda não marcou nenhuma prova. Abra o calendário para começar.");
  }
  function renderSuggestions() {
    const root=$("#race-suggestion-list");root.replaceChildren();
    if (!state.suggestions.length) return;
    const h=document.createElement("h3");h.textContent="Suas sugestões";root.appendChild(h);
    const labels={pending:"Aguardando aprovação",approved:"Aprovada",rejected:"Não incluída"};
    state.suggestions.forEach(s=>{
      const div=document.createElement("div");div.className="race-suggestion";
      const title=document.createElement("strong");title.textContent=s.name;
      const sub=document.createElement("small");sub.textContent=fmt(s.event_date)+" · "+(s.city||"Local não informado");
      const badge=document.createElement("span");badge.className="race-chip";badge.textContent=labels[s.status]||s.status;
      div.append(title,sub,badge);root.appendChild(div);
    });
  }
  async function refreshChoices() {
    const [mineRes,countRes]=await Promise.all([
      client.from("race_participations").select("event_id,status,distance").eq("user_id",state.user.id),
      client.rpc("race_counts")
    ]);
    if (mineRes.error) throw mineRes.error;
    if (countRes.error) throw countRes.error;
    state.mine=new Map((mineRes.data||[]).map(r=>[r.event_id,r]));
    state.counts=new Map((countRes.data||[]).map(r=>[r.event_id,r]));
    renderCalendar();renderMine();
  }
  function openChoice(event,status) {
    state.editing={event,status};
    $("#race-dialog-title").textContent=status==="going"?"Vou participar":"Tenho interesse";
    $("#race-dialog-name").textContent=event.name;
    const select=$("#race-distance");select.replaceChildren();
    const add=(value,label)=>{const o=document.createElement("option");o.value=value;o.textContent=label;select.appendChild(o);};
    add("","Ainda não defini");
    const options=Array.isArray(event.distance_options)?event.distance_options:[];
    options.filter(Boolean).forEach(x=>add(x,x));
    const current=state.mine.get(event.id)?.distance||"";
    if (current && !options.includes(current)) add(current,current);
    if (event.allow_other_distance) add("__other__","Outra distância");
    select.value=current;
    $("#race-custom-distance-field").classList.add("hidden");
    $("#race-custom-distance").value="";
    $("#race-choice-status").textContent="";
    $("#race-save").disabled=false;
    dialog.showModal();
  }
  async function saveChoice(e) {
    e.preventDefault();
    if (!state.editing) return;
    const button=$("#race-save"),statusEl=$("#race-choice-status");
    let distance=$("#race-distance").value||null;
    if (distance==="__other__") {
      distance=$("#race-custom-distance").value.trim();
      if (!distance) {statusEl.textContent="Informe a distância.";return;}
    }
    button.disabled=true;statusEl.textContent="Salvando…";
    try {
      const {error}=await client.from("race_participations").upsert({
        event_id:state.editing.event.id,user_id:state.user.id,status:state.editing.status,distance:distance
      },{onConflict:"event_id,user_id"});
      if (error) throw error;
      await refreshChoices();
      state.editing=null;dialog.close();
    } catch(err) {
      statusEl.textContent="Não foi possível atualizar agora. Tente novamente.";
      button.disabled=false;
    }
  }
  async function removeChoice(event,button) {
    button.disabled=true;
    try {
      const {error}=await client.from("race_participations").delete().eq("event_id",event.id).eq("user_id",state.user.id);
      if (error) throw error;
      await refreshChoices();
    } catch {button.disabled=false;alert("Não foi possível remover agora. Tente novamente.");}
  }
  async function sendSuggestion(e) {
    e.preventDefault();
    const status=$("#race-suggest-status"),button=$("#suggest-submit");
    const name=$("#suggest-name").value.trim(),event_date=$("#suggest-date").value;
    if (event_date < today()) {status.textContent="Escolha uma prova futura.";return;}
    button.disabled=true;status.textContent="Enviando…";
    try {
      const entry={user_id:state.user.id,name,event_date,city:$("#suggest-city").value.trim()||null,
        category:$("#suggest-category").value||null,distance:$("#suggest-distance").value.trim()||null,
        notes:$("#suggest-notes").value.trim()||null,status:"pending"};
      const {error}=await client.from("race_suggestions").insert(entry);
      if (error) throw error;
      const {data:rows,error:readError}=await client.from("race_suggestions")
        .select("id,name,event_date,city,status").eq("user_id",state.user.id).order("created_at",{ascending:false});
      if (readError) throw readError;
      state.suggestions=rows||[];
      $("#race-suggestion-form").reset();
      status.textContent="Sugestão enviada! A equipe vai avaliar.";
      renderSuggestions();
    } catch {status.textContent="Não foi possível enviar agora. Tente novamente.";}
    finally {button.disabled=false;}
  }
  async function boot() {
    const {data:{user},error:authError}=await client.auth.getUser();
    if (authError||!user){location.replace(cfg.onboardingPage||"onboarding-homologacao.html");return;}
    state.user=user;
    const {data:profile,error:profileError}=await client.from("athlete_profiles")
      .select("onboarding_completed_at").eq("user_id",user.id).maybeSingle();
    if (profileError) throw profileError;
    if (!profile?.onboarding_completed_at){location.replace(cfg.onboardingPage||"onboarding-homologacao.html");return;}
    const [events,windows,mine,counts,suggestions]=await Promise.all([
      client.from("events").select("id,name,event_date,end_date,city,state,country,venue,category,distances,distance_options,allow_other_distance,site_url,group_status,group_minimum,group_deadline,featured,featured_note,active").eq("active",true).order("event_date",{ascending:true}),
      client.from("event_entry_windows").select("event_name,label,kind,start_date,end_date,url,active").eq("active",true),
      client.from("race_participations").select("event_id,status,distance").eq("user_id",user.id),
      client.rpc("race_counts"),
      client.from("race_suggestions").select("id,name,event_date,city,status").eq("user_id",user.id).order("created_at",{ascending:false})
    ]);
    for (const r of [events,windows,mine,counts,suggestions]) if (r.error) throw r.error;
    state.events=events.data||[];state.windows=windows.data||[];
    state.mine=new Map((mine.data||[]).map(r=>[r.event_id,r]));
    state.counts=new Map((counts.data||[]).map(r=>[r.event_id,r]));
    state.suggestions=suggestions.data||[];
    const years=[...new Set(state.events.filter(future).map(e=>e.event_date.slice(0,4)))].sort();
    state.year=years.includes(String(today().slice(0,4)))?today().slice(0,4):years[0];
    const select=$("#race-year");
    years.forEach(year=>{const o=document.createElement("option");o.value=year;o.textContent=year;select.appendChild(o);});
    select.value=state.year||"";
    renderCalendar();renderMine();renderSuggestions();
    loading.classList.add("hidden");app.classList.remove("hidden");
    client.rpc("is_admin").then(({data,error})=>{if(!error&&data===true)$("#race-admin-link").classList.remove("hidden");}).catch(()=>{});
  }
  document.querySelectorAll("[data-race-tab]").forEach(btn=>btn.addEventListener("click",()=>activate(btn.dataset.raceTab)));
  $("#race-year").addEventListener("change",e=>{state.year=e.target.value;renderCalendar();});
  $("#race-category").addEventListener("change",e=>{state.category=e.target.value;renderCalendar();});
  $("#race-distance").addEventListener("change",e=>{
    const other=e.target.value==="__other__";
    $("#race-custom-distance-field").classList.toggle("hidden",!other);
    $("#race-custom-distance").required=other;
    if(other)$("#race-custom-distance").focus();
  });
  $("#race-choice-form").addEventListener("submit",saveChoice);
  $("#race-cancel").addEventListener("click",()=>dialog.close());
  $("#race-suggestion-form").addEventListener("submit",sendSuggestion);
  client.auth.onAuthStateChange((event,session)=>{
    if(event!=="INITIAL_SESSION"&&!session)location.replace(cfg.onboardingPage||"onboarding-homologacao.html");
  });
  boot().catch(()=>showError("Não foi possível carregar o calendário. Atualize a página para tentar novamente."));
})();