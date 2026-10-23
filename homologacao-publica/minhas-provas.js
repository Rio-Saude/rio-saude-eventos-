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
  const state = { user:null, events:[], windows:[], counts:new Map(), mine:new Map(), goals:[], suggestions:[], year:null, category:"all", currentTab:"calendar", editing:null };
  const fmt = (date) => date ? new Date(date + "T12:00:00").toLocaleDateString("pt-BR",{day:"2-digit",month:"short",year:"numeric"}) : "";
  const number = (n) => Number(n || 0).toLocaleString("pt-BR");
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
  const safeUrl = (s) => { try { const u = new URL(s); return ["http:","https:"].includes(u.protocol)?u.href:""; } catch {return "";} };
  const categoryOf = (e) => /triathlon|triatlo|ironman/i.test(e.category||"") ? "tri" : /trail|montanha/i.test(e.category||"") ? "trail" : "run";
  const raceKey = (name,date) => String(name||"").trim().normalize("NFD").replace(/[\u0300-\u036f]/g,"").toLowerCase().replace(/\s+/g," ")+"|"+(date||"");
  const goalFor = event => state.goals.find(g=>raceKey(g.name,g.event_date)===raceKey(event.name,event.event_date))||null;
  const goalStatus = g => g?.status==="interest" ? "interest" : "going";
  const goalFuture = g => !g.event_date || g.event_date>=today();
  function matchesFilter(event) {
    if (state.category==="all") return true;
    const sport=categoryOf(event);
    if (["run","trail","tri"].includes(state.category)) return sport===state.category;
    if (sport!=="run") return false;
    const words=[event.category,event.name,event.distances,...(Array.isArray(event.distance_options)?event.distance_options:[])].filter(Boolean).join(" ").toLowerCase();
    if (state.category==="run5") return /\b5\s*(?:km|k)\b/.test(words);
    if (state.category==="run10") return /\b10\s*(?:km|k)\b/.test(words);
    if (state.category==="half") return /meia\s*maratona|\b21(?:[,.]1)?\s*(?:km|k)\b/.test(words);
    if (state.category==="marathon") return /\b42(?:[,.]2)?\s*(?:km|k)\b/.test(words) || (/\bmaratona\b/.test(words) && !/meia\s*maratona/.test([event.category,event.name].join(" ").toLowerCase()));
    return false;
  }
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
  function myEntry(eventId) {
    const existing=state.mine.get(eventId);
    if (existing) return existing;
    const event=state.events.find(e=>e.id===eventId);
    const goal=event&&goalFor(event);
    return goal ? {status:goalStatus(goal),distance:goal.distance||null} : null;
  }
  async function persistGoals(goals) {
    if (goals.length>15) throw new Error("Limite de 15 provas atingido.");
    const payload={goal_events:goals,goal_event_name:goals[0]?.name||null,goal_event_date:goals[0]?.event_date||null};
    const {data,error}=await client.from("athlete_profiles").update(payload)
      .eq("user_id",state.user.id).select("goal_events").single();
    if (error) throw error;
    state.goals=Array.isArray(data.goal_events)?data.goal_events:goals;
  }
  function goalCard(goal) {
    const card=document.createElement("article");
    card.className="race-card";
    const selected=goalStatus(goal);
    const suggestion=state.suggestions.find(s=>raceKey(s.name,s.event_date)===raceKey(goal.name,goal.event_date));
    const review=suggestion?.status==="approved"?"Incluída no calendário coletivo":
      suggestion?.status==="pending"?"Em análise para o calendário coletivo":
      suggestion?.status==="rejected"?"Fora do calendário coletivo":"Prova pessoal";
    card.innerHTML='<div class="race-top"><span class="race-date">'+esc(goal.event_date?fmt(goal.event_date):"Data a definir")+
      '</span><span class="race-category">'+esc(goal.category||"Prova pessoal")+'</span></div>'+
      '<h3>'+esc(goal.name)+'</h3>'+
      (goal.city?'<div class="race-meta">'+esc(goal.city)+'</div>':"")+
      (goal.distance?'<div class="race-meta">Distância: '+esc(goal.distance)+'</div>':"")+
      '<div class="race-status">Sua escolha: '+(selected==="going"?"Vou participar":"Tenho interesse")+'</div>'+
      '<div class="race-meta">'+esc(review)+' · Esta prova já está salva para você.</div>'+
      '<div class="race-actions"></div>';
    const actions=card.querySelector(".race-actions");
    for (const [status,label] of [["interest","Tenho interesse"],["going","Vou participar"]]) {
      const button=document.createElement("button");button.type="button";button.textContent=label;
      button.className=selected===status?"selected":"";
      button.setAttribute("aria-pressed",String(selected===status));
      button.addEventListener("click",()=>changeGoal(goal,status,button));actions.appendChild(button);
    }
    const remove=document.createElement("button");remove.type="button";remove.textContent="Remover";
    remove.className="race-remove";remove.addEventListener("click",()=>removeGoal(goal,remove));actions.appendChild(remove);
    return card;
  }
  async function changeGoal(goal,status,button) {
    button.disabled=true;
    try {
      await persistGoals(state.goals.map(g=>raceKey(g.name,g.event_date)===raceKey(goal.name,goal.event_date)?{...g,status}:g));
      renderMine();
    } catch {button.disabled=false;alert("Não foi possível atualizar esta prova. Tente novamente.");}
  }
  async function removeGoal(goal,button) {
    button.disabled=true;
    try {
      await persistGoals(state.goals.filter(g=>raceKey(g.name,g.event_date)!==raceKey(goal.name,goal.event_date)));
      renderMine();
    } catch {button.disabled=false;alert("Não foi possível remover esta prova. Tente novamente.");}
  }
  async function submitForCalendar(goal) {
    if (!goal.event_date || state.events.some(e=>raceKey(e.name,e.event_date)===raceKey(goal.name,goal.event_date)) ||
      state.suggestions.some(s=>raceKey(s.name,s.event_date)===raceKey(goal.name,goal.event_date))) return true;
    const entry={user_id:state.user.id,name:goal.name,event_date:goal.event_date,city:goal.city||null,
      category:goal.category||"Corrida",distance:goal.distance||null,notes:goal.notes||null,status:"pending"};
    const {data,error}=await client.from("race_suggestions").insert(entry)
      .select("id,name,event_date,city,status").single();
    if (error) return false;
    state.suggestions.unshift(data);renderSuggestions();return true;
  }
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
      matchesFilter(e));
    $("#race-calendar-summary").textContent=chosen.length+" provas encontradas · Atualizado com o calendário Rio Saúde";
    fillGrid($("#race-calendar-grid"),chosen,"Nenhuma prova nesta seleção.");
  }
  function renderMine() {
    const official=state.events.filter(e=>future(e)&&(state.mine.has(e.id)||goalFor(e)));
    const personal=state.goals.filter(g=>g?.name&&goalFuture(g)&&
      !state.events.some(e=>future(e)&&raceKey(e.name,e.event_date)===raceKey(g.name,g.event_date)));
    const root=$("#race-mine-grid");root.replaceChildren();
    const cards=[...official.map(e=>({date:e.event_date,node:createCard(e)})),
      ...personal.map(g=>({date:g.event_date||"9999-12-31",node:goalCard(g)}))];
    cards.sort((a,b)=>a.date.localeCompare(b.date)).forEach(item=>root.appendChild(item.node));
    $("#race-mine-summary").textContent=cards.length+
      (cards.length===1?" prova no seu perfil.":" provas no seu perfil.")+" Atualize ou remova seus objetivos quando quiser.";
    if (!cards.length) {
      const p=document.createElement("p");p.className="races-empty";
      p.textContent="Nenhuma prova cadastrada. Escolha uma no calendário ou toque em Adicionar prova.";
      root.appendChild(p);
    }
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
    const current=myEntry(event.id)?.distance||"";
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
      const goal=goalFor(state.editing.event);
      if (goal) await persistGoals(state.goals.map(g=>raceKey(g.name,g.event_date)===raceKey(goal.name,goal.event_date)
        ? {...g,status:state.editing.status,distance} : g));
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
      const goal=goalFor(event);
      if (goal) await persistGoals(state.goals.filter(g=>raceKey(g.name,g.event_date)!==raceKey(goal.name,goal.event_date)));
      await refreshChoices();
    } catch {button.disabled=false;alert("Não foi possível remover agora. Tente novamente.");}
  }
  async function sendSuggestion(e) {
    e.preventDefault();
    const message=$("#race-suggest-status"),button=$("#suggest-submit");
    const name=$("#suggest-name").value.trim(),event_date=$("#suggest-date").value;
    if (name.length<3 || event_date<today()) {
      message.textContent="Informe o nome e uma data futura.";return;
    }
    const status=$("#suggest-intent").value==="interest"?"interest":"going";
    const distance=$("#suggest-distance").value.trim()||null;
    const city=$("#suggest-city").value.trim()||null;
    const category=$("#suggest-category").value||"Corrida";
    button.disabled=true;message.textContent="Salvando sua prova…";
    try {
      const official=state.events.find(event=>raceKey(event.name,event.event_date)===raceKey(name,event_date));
      let queued=true;
      if (official) {
        const {error}=await client.from("race_participations").upsert({
          event_id:official.id,user_id:state.user.id,status,distance
        },{onConflict:"event_id,user_id"});
        if (error) throw error;
        const goal=goalFor(official);
        if (goal) await persistGoals(state.goals.map(g=>raceKey(g.name,g.event_date)===raceKey(name,event_date)?{...g,status,distance}:g));
        await refreshChoices();
      } else {
        const entry={name,event_date,custom:true,status,distance,city,category,notes:$("#suggest-notes").value.trim()||null};
        const key=raceKey(name,event_date);
        const existing=state.goals.findIndex(g=>raceKey(g.name,g.event_date)===key);
        if (existing<0 && state.goals.length>=15) {
          message.textContent="Você já cadastrou 15 provas. Remova uma antes de adicionar outra.";return;
        }
        const next=state.goals.slice();
        if (existing>=0) next[existing]={...next[existing],...entry};
        else next.push(entry);
        await persistGoals(next);
        queued=await submitForCalendar(entry);
      }
      $("#race-suggestion-form").reset();
      $("#race-mine-feedback").textContent=queued
        ? "Prova salva! Ela já está na sua lista. A inclusão no calendário coletivo é avaliada separadamente."
        : "Sua prova foi salva! A sugestão para o calendário coletivo não pôde ser enviada agora.";
      message.textContent="";
      renderCalendar();renderMine();activate("mine");
    } catch(err) {
      message.textContent="Não foi possível salvar sua prova. Tente novamente.";
    } finally {button.disabled=false;}
  }
  async function syncCalendarGoals() {
    // An onboarding goal matching a public event should count without a second registration.
    let synced=false;
    for (const goal of state.goals.filter(g=>g?.name&&g.event_date&&goalFuture(g))) {
      const event=state.events.find(e=>raceKey(e.name,e.event_date)===raceKey(goal.name,goal.event_date));
      if (!event || state.mine.has(event.id)) continue;
      const {error}=await client.from("race_participations").upsert({
        event_id:event.id,user_id:state.user.id,status:goalStatus(goal),distance:goal.distance||null
      },{onConflict:"event_id,user_id"});
      if (!error) {
        state.mine.set(event.id,{event_id:event.id,status:goalStatus(goal),distance:goal.distance||null});
        synced=true;
      }
    }
    if (synced) await refreshChoices();
  }
  async function boot() {
    const {data:{user},error:authError}=await client.auth.getUser();
    if (authError||!user){location.replace(cfg.onboardingPage||"onboarding-homologacao.html");return;}
    state.user=user;
    const {data:profile,error:profileError}=await client.from("athlete_profiles")
      .select("onboarding_completed_at,goal_events,goal_event_name,goal_event_date").eq("user_id",user.id).maybeSingle();
    if (profileError) throw profileError;
    if (!profile?.onboarding_completed_at){location.replace(cfg.onboardingPage||"onboarding-homologacao.html");return;}
    const [events,windows,mine,counts,suggestions]=await Promise.all([
      client.from("events").select("id,name,event_date,end_date,city,state,country,venue,category,distances,distance_options,allow_other_distance,site_url,group_status,group_minimum,group_deadline,featured,featured_note,active").eq("active",true).order("event_date",{ascending:true}),
      client.from("event_entry_windows").select("event_name,label,kind,start_date,end_date,url,active").eq("active",true),
      client.from("race_participations").select("event_id,status,distance").eq("user_id",user.id),
      client.rpc("race_counts"),
      client.from("race_suggestions").select("id,name,event_date,city,category,distance,status").eq("user_id",user.id).order("created_at",{ascending:false})
    ]);
    for (const r of [events,windows,mine,counts,suggestions]) if (r.error) throw r.error;
    state.events=events.data||[];state.windows=windows.data||[];
    state.mine=new Map((mine.data||[]).map(r=>[r.event_id,r]));
    state.counts=new Map((counts.data||[]).map(r=>[r.event_id,r]));
    state.suggestions=suggestions.data||[];
    state.goals=Array.isArray(profile.goal_events)&&profile.goal_events.length ? profile.goal_events
      : (profile.goal_event_name ? [{name:profile.goal_event_name,event_date:profile.goal_event_date||null,custom:true}] : []);
    // Older "Sugerir prova" submissions had no personal record. Recover them as interests.
    const imported=state.goals.slice();
    for (const suggestion of state.suggestions) {
      if (!suggestion?.name || !suggestion.event_date || suggestion.event_date<today() || imported.length>=15) continue;
      if (imported.some(g=>raceKey(g.name,g.event_date)===raceKey(suggestion.name,suggestion.event_date))) continue;
      if (state.events.some(e=>state.mine.has(e.id)&&raceKey(e.name,e.event_date)===raceKey(suggestion.name,suggestion.event_date))) continue;
      imported.push({name:suggestion.name,event_date:suggestion.event_date,custom:true,status:"interest",
        city:suggestion.city||null,category:suggestion.category||"Corrida",distance:suggestion.distance||null});
    }
    if (imported.length>state.goals.length) {
      try { await persistGoals(imported); }
      catch (err) { state.goals=imported;console.warn("Ainda não foi possível persistir as sugestões antigas.",err); }
    }
    const years=[...new Set(state.events.filter(future).map(e=>e.event_date.slice(0,4)))].sort();
    state.year=years.includes(String(today().slice(0,4)))?today().slice(0,4):years[0];
    const select=$("#race-year");
    years.forEach(year=>{const o=document.createElement("option");o.value=year;o.textContent=year;select.appendChild(o);});
    select.value=state.year||"";
    renderCalendar();renderMine();renderSuggestions();
    loading.classList.add("hidden");app.classList.remove("hidden");
    try { await syncCalendarGoals(); } catch (err) { console.warn("A sincronização com o calendário será tentada novamente.",err); }
    // Personal onboarding races are immediately visible; collective publication remains moderated.
    for (const goal of state.goals.filter(g=>g?.custom===true && goalFuture(g) && g.event_date)) {
      if (await submitForCalendar(goal)) continue;
      break; // Keep the page usable if the moderation queue is unavailable.
    }
    renderMine();
    client.rpc("is_admin").then(({data,error})=>{if(!error&&data===true)$("#race-admin-link").classList.remove("hidden");}).catch(()=>{});
  }
  document.querySelectorAll("[data-race-tab]").forEach(btn=>btn.addEventListener("click",()=>activate(btn.dataset.raceTab)));
  $("#race-add-from-mine").addEventListener("click",()=>{activate("suggest");$("#suggest-name").focus();});
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