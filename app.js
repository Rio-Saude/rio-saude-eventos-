(() => {
  const config = window.RIO_SAUDE_CONFIG || {};
  const dbReady = Boolean(
    config.registrationEnabled &&
    config.supabaseUrl &&
    config.supabaseAnonKey &&
    window.supabase
  );

  if (!dbReady) return;

  const client = window.supabase.createClient(config.supabaseUrl, config.supabaseAnonKey);
  const cards = Array.from(document.querySelectorAll(".panel-all .event-register-card[data-event]"));
  const filterButtons = Array.from(document.querySelectorAll(".filter-card[data-filter]"));
  let currentEvent = "";
  let currentStatus = "going";
  let activeFilter = "all";

  injectStyles();
  injectModal();
  prepareCards();
  bindFilters();
  hydratePublicData();

  function prepareCards() {
    cards.forEach((card) => {
      const actions = card.querySelector(".event-actions");
      if (!actions) return;

      const official = actions.querySelector('a[href^="http"]');
      if (!official) return;

      actions.innerHTML = "";
      official.classList.add("rs-official-link");
      actions.appendChild(official);

      actions.appendChild(createStatusButton("Tenho interesse", "interest", "rs-interest"));
      actions.appendChild(createStatusButton("Vou fazer esta prova", "going", "rs-going"));

      const note = card.querySelector(".form-note");
      if (note) {
        note.textContent = "Avise sua intenção à Rio Saúde. Isso não realiza sua inscrição oficial na prova.";
      }

      if (!card.querySelector(".rs-public-info")) {
        const info = document.createElement("div");
        info.className = "rs-public-info";
        actions.before(info);
      }
    });
  }

  function createStatusButton(label, status, cssClass) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "rs-action " + cssClass;
    button.dataset.status = status;
    button.textContent = label;
    button.addEventListener("click", () => {
      const card = button.closest(".event-register-card");
      currentEvent = card?.dataset.event || "";
      currentStatus = status;
      openModal(currentEvent, currentStatus);
    });
    return button;
  }

  function bindFilters() {
    filterButtons.forEach((button) => {
      button.addEventListener("click", () => {
        activeFilter = button.dataset.filter || "all";
        filterButtons.forEach((item) => item.classList.toggle("active", item === button));
        applyFilter();
      });
    });
  }

  async function hydratePublicData() {
    const [{ data: events, error: eventsError }, { data: stats, error: statsError }] = await Promise.all([
      client
        .from("events")
        .select("name,event_date,end_date,category,coupon_code,coupon_label,group_status,group_minimum,group_deadline,active")
        .eq("active", true),
      client
        .from("event_public_stats")
        .select("event_name,interest_count,going_count,group_count")
    ]);

    if (eventsError || statsError) {
      console.error("Rio Saúde public data", eventsError || statsError);
      applyFilter();
      return;
    }

    const eventMap = new Map((events || []).map((item) => [normalize(item.name), item]));
    const statsMap = new Map((stats || []).map((item) => [normalize(item.event_name), item]));

    cards.forEach((card) => {
      const key = normalize(card.dataset.event || "");
      const meta = eventMap.get(key);
      const stat = statsMap.get(key) || { interest_count:0, going_count:0, group_count:0 };

      card.dataset.rsType = classifyEvent(meta, card.dataset.event || "");

      if (meta) {
        const finalDate = meta.end_date || meta.event_date;
        if (finalDate && isPast(finalDate)) card.dataset.past = "true";
        renderPublicInfo(card, meta, stat);
        configureGroupButton(card, meta, stat);
      }
    });

    applyFilter();
  }

  function classifyEvent(meta, eventName) {
    const category = normalize(meta?.category);
    const name = normalize(eventName);

    if (category.includes("trail")) return "trail";
    if (category.includes("tri")) return "tri";

    if (
      name.includes("meia") ||
      name.includes("half marathon") ||
      name.includes("21k") ||
      name.includes("21 km")
    ) return "half";

    if (name.includes("maratona") || name.includes("marathon")) return "marathon";

    return "run";
  }

  function isPast(dateString) {
    const end = new Date(dateString + "T23:59:59");
    const now = new Date();
    return now > end;
  }

  function applyFilter() {
    cards.forEach((card) => {
      const past = card.dataset.past === "true";
      const type = card.dataset.rsType || classifyEvent(null, card.dataset.event || "");
      const matches = activeFilter === "all" || activeFilter === type;
      card.style.display = !past && matches ? "" : "none";
    });

    document.querySelectorAll(".panel-all .month-block").forEach((block) => {
      const visible = Array.from(block.querySelectorAll(".event-register-card")).some(
        (card) => card.style.display !== "none"
      );
      block.style.display = visible ? "" : "none";
    });

    const titles = {
      all: "Próximas provas",
      run: "Corridas",
      half: "Meias maratonas",
      marathon: "Maratonas",
      trail: "Trail Run",
      tri: "Triathlon"
    };
    const title = document.querySelector(".panel-all .section-head h2");
    if (title) title.textContent = titles[activeFilter] || titles.all;
  }

  function renderPublicInfo(card, meta, stat) {
    const info = card.querySelector(".rs-public-info");
    if (!info) return;

    const coupon = meta.coupon_code
      ? `<div class="rs-coupon"><span>Cupom Rio Saúde</span><strong>${escapeHtml(meta.coupon_code)}</strong></div>`
      : "";

    const groupVisible = ["collecting", "confirmed"].includes(meta.group_status);
    const minimum = Number(meta.group_minimum || 10);
    const group = groupVisible
      ? `<div class="rs-group-progress">
           <span>Inscrição em grupo Rio Saúde</span>
           <strong>${Number(stat.group_count || 0)}/${minimum}</strong>
           <small>${groupStatusText(meta.group_status, Number(stat.group_count || 0), minimum)}</small>
         </div>`
      : "";

    info.innerHTML = `
      ${coupon}
      <div class="rs-community-label">Rio Saúde nesta prova</div>
      <div class="rs-counts">
        <div><strong>${Number(stat.going_count || 0)}</strong><span>vão participar</span></div>
        <div><strong>${Number(stat.interest_count || 0)}</strong><span>têm interesse</span></div>
      </div>
      ${group}
    `;
  }

  function configureGroupButton(card, meta, stat) {
    const actions = card.querySelector(".event-actions");
    if (!actions) return;

    actions.querySelector('[data-status="group_interest"]')?.remove();

    if (!["collecting", "confirmed"].includes(meta.group_status)) return;

    const minimum = Number(meta.group_minimum || 10);
    const count = Number(stat.group_count || 0);
    actions.appendChild(
      createStatusButton(`Quero inscrição em grupo · ${count}/${minimum}`, "group_interest", "rs-group")
    );
  }

  function groupStatusText(status, count, minimum) {
    if (status === "confirmed") return "Inscrição em grupo confirmada pela Rio Saúde.";
    if (count >= minimum) return "Mínimo atingido. A equipe vai validar a inscrição com a organização.";
    return `Disponível com mínimo de ${minimum} interessados. Até agora: ${count}.`;
  }

  function injectStyles() {
    const style = document.createElement("style");
    style.textContent = `
      .official-area .panel { display:none !important; }
      .official-area .panel-all { display:block !important; }
      .filter-card.active {
        transform:translateY(-3px);
        background:#214b37;
        border-color:rgba(168,224,190,.35);
      }
      .event-actions { grid-template-columns: repeat(2,1fr) !important; }
      .event-actions .rs-official-link { grid-column:1/-1; }
      .rs-action {
        border:0; cursor:pointer; text-align:center; font:inherit;
        font-weight:900; padding:12px 10px; border-radius:14px; font-size:14px;
      }
      .rs-interest { background:rgba(255,255,255,.10); color:#a8e0be; border:1px solid rgba(168,224,190,.24); }
      .rs-going { background:#f8c644; color:#07110d; }
      .rs-group { background:#a8e0be; color:#07110d; grid-column:1/-1; }
      .rs-public-info { display:grid; gap:9px; margin:0 0 16px; }
      .rs-community-label {
        color:#d6e6dd; font-size:11px; font-weight:900; letter-spacing:.08em;
        text-transform:uppercase; margin-top:2px;
      }
      .rs-counts { display:grid; grid-template-columns:1fr 1fr; gap:8px; }
      .rs-counts div {
        background:rgba(255,255,255,.07); border:1px solid rgba(255,255,255,.09);
        border-radius:13px; padding:10px 12px;
      }
      .rs-counts strong { display:block; font-size:20px; color:#a8e0be; }
      .rs-counts span { display:block; font-size:11px; color:#d6e6dd; margin-top:2px; }
      .rs-coupon {
        display:flex; justify-content:space-between; align-items:center; gap:12px;
        background:rgba(105,189,141,.13); border:1px solid rgba(168,224,190,.30);
        border-radius:13px; padding:10px 12px;
      }
      .rs-coupon span { font-size:12px; font-weight:800; color:#d6e6dd; }
      .rs-coupon strong { color:#a8e0be; letter-spacing:.05em; }
      .rs-group-progress {
        display:grid; grid-template-columns:1fr auto; gap:3px 12px;
        background:rgba(248,198,68,.10); border:1px solid rgba(248,198,68,.30);
        border-radius:13px; padding:11px 12px;
      }
      .rs-group-progress span { font-size:12px; font-weight:800; color:#fff4cf; }
      .rs-group-progress strong { color:#f8c644; }
      .rs-group-progress small { grid-column:1/-1; color:#d6e6dd; font-size:11px; line-height:1.35; }
      .rs-modal-backdrop {
        position:fixed; inset:0; z-index:9999; background:rgba(0,0,0,.72);
        display:none; align-items:center; justify-content:center; padding:20px;
      }
      .rs-modal-backdrop.open { display:flex; }
      .rs-modal {
        width:min(560px,100%); max-height:92vh; overflow:auto;
        background:#0b1712; border:1px solid rgba(168,224,190,.25);
        border-radius:28px; padding:28px; box-shadow:0 30px 80px rgba(0,0,0,.55);
      }
      .rs-modal h3 { font-size:30px; margin-bottom:8px; }
      .rs-modal .rs-event-name { color:#a8e0be; font-weight:900; margin-bottom:18px; }
      .rs-modal .rs-alert {
        background:rgba(248,198,68,.10); border:1px solid rgba(248,198,68,.38);
        color:#fff4cf; border-radius:14px; padding:12px 14px; margin-bottom:18px; font-size:14px;
      }
      .rs-field { margin-bottom:14px; }
      .rs-field label { display:block; font-size:13px; font-weight:800; margin-bottom:6px; color:#d6e6dd; }
      .rs-field input {
        width:100%; padding:13px 14px; border-radius:12px;
        border:1px solid rgba(255,255,255,.16); background:#07110d; color:white; font:inherit;
      }
      .rs-confirm {
        display:flex; gap:10px; align-items:flex-start; margin:16px 0; font-size:13px; color:#d6e6dd;
      }
      .rs-confirm input { margin-top:3px; }
      .rs-modal-actions { display:flex; gap:10px; }
      .rs-modal-actions button { flex:1; padding:13px; border-radius:999px; border:0; font-weight:900; cursor:pointer; }
      .rs-submit { background:#a8e0be; color:#07110d; }
      .rs-submit:disabled { opacity:.55; cursor:not-allowed; }
      .rs-cancel { background:rgba(255,255,255,.10); color:white; }
      .rs-feedback { margin-top:14px; font-size:14px; }
      @media(max-width:700px){
        .event-actions { grid-template-columns:1fr !important; }
        .event-actions .rs-official-link, .rs-group { grid-column:auto; }
      }
    `;
    document.head.appendChild(style);
  }

  function injectModal() {
    const root = document.createElement("div");
    root.className = "rs-modal-backdrop";
    root.id = "rs-modal";
    root.innerHTML = `
      <div class="rs-modal" role="dialog" aria-modal="true" aria-labelledby="rs-modal-title">
        <h3 id="rs-modal-title">Avise a Rio Saúde</h3>
        <div class="rs-event-name" id="rs-event-name"></div>
        <div class="rs-alert" id="rs-status-explainer"></div>
        <form id="rs-registration-form">
          <div class="rs-field">
            <label for="rs-name">Nome e sobrenome</label>
            <input id="rs-name" name="name" autocomplete="name" maxlength="120" required>
          </div>
          <div class="rs-field">
            <label for="rs-email">E-mail</label>
            <input id="rs-email" name="email" type="email" autocomplete="email" maxlength="320" required>
          </div>
          <div class="rs-field">
            <label for="rs-distance">Distância / categoria</label>
            <input id="rs-distance" name="distance" maxlength="80" placeholder="Ex.: 10 km, 21 km, Sprint, Standard">
          </div>
          <label class="rs-confirm">
            <input id="rs-understood" type="checkbox" required>
            <span>Entendi que este aviso <strong>não realiza minha inscrição oficial</strong> na prova.</span>
          </label>
          <div class="rs-modal-actions">
            <button type="button" class="rs-cancel" id="rs-cancel">Cancelar</button>
            <button type="submit" class="rs-submit">Confirmar aviso</button>
          </div>
          <div class="rs-feedback" id="rs-feedback"></div>
        </form>
      </div>
    `;
    document.body.appendChild(root);

    root.addEventListener("click", (event) => {
      if (event.target === root) closeModal();
    });
    root.querySelector("#rs-cancel").addEventListener("click", closeModal);
    root.querySelector("#rs-registration-form").addEventListener("submit", submitForm);
  }

  function openModal(eventName, status) {
    const modal = document.querySelector("#rs-modal");
    document.querySelector("#rs-event-name").textContent = eventName;
    const explainers = {
      interest: "Você ainda está avaliando esta prova. Marcar interesse ajuda a Rio Saúde a medir a demanda e, em algumas provas, buscar inscrição em grupo ou condição especial.",
      going: "Você está avisando que vai participar. A inscrição oficial continua sendo feita no site da prova.",
      group_interest: "Você quer entrar na contagem da inscrição em grupo da Rio Saúde para esta prova. A vaga só será confirmada quando a equipe validar as condições."
    };
    document.querySelector("#rs-status-explainer").textContent = explainers[status] || explainers.going;
    document.querySelector("#rs-feedback").textContent = "";
    modal.classList.add("open");
  }

  function closeModal() {
    document.querySelector("#rs-modal")?.classList.remove("open");
  }

  async function submitForm(event) {
    event.preventDefault();
    const feedback = document.querySelector("#rs-feedback");
    const submit = event.currentTarget.querySelector(".rs-submit");
    submit.disabled = true;
    feedback.textContent = "Salvando...";

    const name = document.querySelector("#rs-name").value.trim();
    const email = document.querySelector("#rs-email").value.trim().toLowerCase();
    const distance = document.querySelector("#rs-distance").value.trim();

    try {
      const { error } = await client.rpc("submit_race_response", {
        p_event_name: currentEvent,
        p_athlete_name: name,
        p_athlete_email: email,
        p_distance: distance || null,
        p_status: currentStatus
      });
      if (error) throw error;

      feedback.textContent = currentStatus === "going"
        ? "Rio Saúde avisada. Sua inscrição oficial continua sendo responsabilidade sua."
        : "Atualização registrada com sucesso.";

      event.currentTarget.reset();
      await hydratePublicData();
      setTimeout(closeModal, 1500);
    } catch (err) {
      console.error("Erro ao registrar prova", err);
      feedback.textContent = "Não foi possível salvar agora. Tente novamente.";
    } finally {
      submit.disabled = false;
    }
  }

  function normalize(value) {
    return String(value || "").trim().toLocaleLowerCase("pt-BR");
  }

  function escapeHtml(value) {
    return String(value || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }
})();
