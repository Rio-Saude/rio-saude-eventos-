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
  let currentEvent = "";
  let currentStatus = "going";
  let activeFilter = "all";
  let selectedYear = new Date().getFullYear();
  let allEvents = [];
  let statsMap = new Map();
  let windowsMap = new Map();

  injectStyles();
  injectModal();
  bindFilters();
  hydrateCalendar().catch((error) => {
    console.error("Rio Saúde calendar load", error);
  });

  function bindFilters() {
    document.querySelectorAll(".filter-card[data-filter]").forEach((button) => {
      button.addEventListener("click", () => {
        activeFilter = button.dataset.filter || "all";
        document.querySelectorAll(".filter-card[data-filter]").forEach((item) => {
          item.classList.toggle("active", item === button);
        });
        if (allEvents.length) renderCalendar();
      });
    });
  }

  async function hydrateCalendar() {
    const results = await Promise.all([
      client
        .from("events")
        .select("name,event_date,end_date,city,state,country,venue,category,distances,series_name,site_url,coupon_code,coupon_label,group_status,group_minimum,group_deadline,active,featured,featured_note")
        .eq("active", true)
        .order("event_date", { ascending:true }),
      client
        .from("event_public_stats")
        .select("event_name,interest_count,going_count,group_count"),
      client
        .from("event_entry_windows")
        .select("event_name,label,kind,start_date,end_date,url,active")
        .eq("active", true)
        .order("start_date", { ascending:true })
    ]);

    const eventResult = results[0];
    const statsResult = results[1];
    const windowsResult = results[2];

    if (eventResult.error) throw eventResult.error;
    if (statsResult.error) throw statsResult.error;
    if (windowsResult.error) throw windowsResult.error;

    allEvents = (eventResult.data || [])
      .filter((event) => event.event_date && !isPastEvent(event))
      .sort((a,b) => String(a.event_date).localeCompare(String(b.event_date)));

    statsMap = new Map(
      (statsResult.data || []).map((row) => [normalize(row.event_name), row])
    );

    windowsMap = new Map();
    (windowsResult.data || []).forEach((row) => {
      const key = normalize(row.event_name);
      if (!windowsMap.has(key)) windowsMap.set(key, []);
      windowsMap.get(key).push(row);
    });

    document.querySelectorAll(".panel-all > .month-block").forEach((block) => {
      block.style.display = "none";
    });

    renderCalendar();
  }

  function ensureRoot() {
    let root = document.querySelector("#rs-calendar-root");
    if (root) return root;

    root = document.createElement("div");
    root.id = "rs-calendar-root";
    const head = document.querySelector(".panel-all .section-head");
    if (head) head.after(root);
    return root;
  }

  function renderCalendar() {
    const root = ensureRoot();
    const years = Array.from(
      new Set(allEvents.map((event) => Number(String(event.event_date).slice(0,4))))
    ).sort((a,b) => a-b);

    if (!years.includes(Number(selectedYear))) {
      selectedYear = years.includes(new Date().getFullYear())
        ? new Date().getFullYear()
        : (years[0] || new Date().getFullYear());
    }

    root.innerHTML = "";

    const featured = allEvents.filter((event) => event.featured && isCurrentFeature(event));
    if (featured.length) {
      const featuredSection = document.createElement("section");
      featuredSection.className = "rs-featured-section";
      featuredSection.innerHTML =
        '<div class="rs-featured-heading"><small>DESTAQUE RIO SAÚDE</small><strong>Prazo importante</strong></div>';
      const grid = document.createElement("div");
      grid.className = "cards";
      featured.forEach((event) => grid.appendChild(buildCard(event, true)));
      featuredSection.appendChild(grid);
      root.appendChild(featuredSection);
    }

    const yearSelector = document.createElement("div");
    yearSelector.className = "rs-year-selector";
    years.forEach((year) => {
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = year;
      button.className = Number(selectedYear) === year ? "active" : "";
      button.addEventListener("click", () => {
        selectedYear = year;
        renderCalendar();
      });
      yearSelector.appendChild(button);
    });
    root.appendChild(yearSelector);

    const visibleEvents = allEvents.filter((event) => {
      return Number(String(event.event_date).slice(0,4)) === Number(selectedYear) &&
        matchesFilter(event, activeFilter);
    });

    const byMonth = new Map();
    visibleEvents.forEach((event) => {
      const date = new Date(event.event_date + "T12:00:00");
      const key = String(date.getMonth()).padStart(2,"0");
      if (!byMonth.has(key)) {
        byMonth.set(key, {
          label: capitalize(date.toLocaleString("pt-BR", { month:"long" })),
          events: []
        });
      }
      byMonth.get(key).events.push(event);
    });

    if (!visibleEvents.length) {
      const empty = document.createElement("div");
      empty.className = "rs-empty";
      empty.textContent = "Nenhuma prova encontrada neste filtro.";
      root.appendChild(empty);
    } else {
      byMonth.forEach((group) => {
        const block = document.createElement("div");
        block.className = "month-block rs-dynamic-month";

        const title = document.createElement("div");
        title.className = "month-title";
        title.textContent = group.label;
        block.appendChild(title);

        const grid = document.createElement("div");
        grid.className = "cards";
        group.events.forEach((event) => grid.appendChild(buildCard(event, false)));
        block.appendChild(grid);
        root.appendChild(block);
      });
    }

    updateHeading();
  }

  function buildCard(event, highlighted) {
    const stat = statsMap.get(normalize(event.name)) || {
      interest_count:0,
      going_count:0,
      group_count:0
    };
    const windows = windowsMap.get(normalize(event.name)) || [];
    const groupVisible = isGroupVisible(event);
    const minimum = Number(event.group_minimum || 10);
    const groupCount = Number(stat.group_count || 0);

    const card = document.createElement("div");
    card.className = "card event-register-card" + (highlighted ? " rs-featured-card" : "");
    card.dataset.event = event.name;

    const topNote = event.series_name || event.category || "";
    const location = [event.venue, event.city].filter(Boolean).join(" · ");
    const couponHtml = event.coupon_code
      ? '<div class="rs-coupon"><span>Cupom Rio Saúde</span><strong>' +
          escapeHtml(event.coupon_code) + '</strong></div>'
      : "";

    const featuredHtml = highlighted && event.featured_note
      ? '<div class="rs-featured-note">' + escapeHtml(event.featured_note) + '</div>'
      : "";

    const windowsHtml = windows.length
      ? '<div class="rs-window-list">' +
          windows.map((windowItem) => renderWindow(windowItem)).join("") +
        '</div>'
      : "";

    const groupHtml = groupVisible
      ? '<div class="rs-group-progress">' +
          '<span>Inscrição em grupo Rio Saúde</span>' +
          '<strong>' + groupCount + '/' + minimum + '</strong>' +
          '<small>' + escapeHtml(groupStatusText(event, groupCount, minimum)) + '</small>' +
        '</div>'
      : "";

    card.innerHTML =
      '<div class="top">' +
        '<div class="date">' + escapeHtml(formatEventDate(event)) + '</div>' +
        (topNote ? '<span class="note">' + escapeHtml(topNote) + '</span>' : '') +
      '</div>' +
      '<h4>' + escapeHtml(event.name) + '</h4>' +
      (location ? '<div class="rs-location">' + escapeHtml(location) + '</div>' : '') +
      (event.distances ? '<div class="rs-distances">' + escapeHtml(event.distances) + '</div>' : '') +
      featuredHtml +
      couponHtml +
      windowsHtml +
      '<div class="rs-community-label">Rio Saúde nesta prova</div>' +
      '<div class="rs-counts">' +
        '<div><strong>' + Number(stat.going_count || 0) + '</strong><span>vão participar</span></div>' +
        '<div><strong>' + Number(stat.interest_count || 0) + '</strong><span>têm interesse</span></div>' +
      '</div>' +
      groupHtml +
      '<div class="event-actions"></div>' +
      '<div class="form-note">Avise sua intenção à Rio Saúde. Isso não realiza sua inscrição oficial na prova.</div>';

    const actions = card.querySelector(".event-actions");

    if (event.site_url) {
      const official = document.createElement("a");
      official.href = event.site_url;
      official.target = "_blank";
      official.rel = "noopener";
      official.className = "rs-official-link";
      official.textContent = "Site oficial";
      actions.appendChild(official);
    }

    actions.appendChild(
      createStatusButton(card, "Tenho interesse", "interest", "rs-interest")
    );
    actions.appendChild(
      createStatusButton(card, "Vou fazer esta prova", "going", "rs-going")
    );

    if (groupVisible) {
      actions.appendChild(
        createStatusButton(
          card,
          "Quero inscrição em grupo · " + groupCount + "/" + minimum,
          "group_interest",
          "rs-group"
        )
      );
    }

    return card;
  }

  function createStatusButton(card, label, status, cssClass) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "rs-action " + cssClass;
    button.dataset.status = status;
    button.textContent = label;
    button.addEventListener("click", () => {
      currentEvent = card.dataset.event || "";
      currentStatus = status;
      openModal(currentEvent, currentStatus);
    });
    return button;
  }

  function renderWindow(windowItem) {
    const dates = formatWindowDates(windowItem);
    const status = windowStatus(windowItem);
    const css = status.kind === "open"
      ? " rs-window-open"
      : status.kind === "upcoming"
        ? " rs-window-upcoming"
        : " rs-window-closed";

    return '<div class="rs-window' + css + '">' +
      '<div><strong>' + escapeHtml(windowItem.label) + '</strong>' +
      (dates ? '<span>' + escapeHtml(dates) + '</span>' : '') + '</div>' +
      '<small>' + escapeHtml(status.text) + '</small>' +
    '</div>';
  }

  function formatWindowDates(windowItem) {
    if (windowItem.start_date && windowItem.end_date) {
      return formatShortDate(windowItem.start_date) + " a " + formatShortDate(windowItem.end_date);
    }
    if (windowItem.end_date) return "até " + formatShortDate(windowItem.end_date);
    if (windowItem.start_date) return "a partir de " + formatShortDate(windowItem.start_date);
    return "";
  }

  function windowStatus(windowItem) {
    const today = todayValue();
    const start = windowItem.start_date || null;
    const end = windowItem.end_date || null;

    if (start && today < start) {
      return { kind:"upcoming", text:"abre em " + formatShortDate(start) };
    }
    if (end && today > end) {
      return { kind:"closed", text:"encerrado" };
    }
    if (start || end) {
      return { kind:"open", text:"em andamento" };
    }
    return { kind:"open", text:"consulte o site oficial" };
  }

  function isCurrentFeature(event) {
    const windows = windowsMap.get(normalize(event.name)) || [];
    const rioWindows = windows.filter((item) =>
      normalize(item.label).includes("rio saúde")
    );
    if (!rioWindows.length) return true;

    return rioWindows.some((item) => {
      return !item.end_date || todayValue() <= item.end_date;
    });
  }

  function isGroupVisible(event) {
    if (!["collecting","confirmed"].includes(event.group_status)) return false;
    if (event.group_deadline && todayValue() > event.group_deadline) return false;
    return true;
  }

  function groupStatusText(event, count, minimum) {
    if (event.group_status === "confirmed") {
      return "Inscrição em grupo confirmada pela Rio Saúde.";
    }
    if (count >= minimum) {
      return "Mínimo atingido. A equipe vai validar a condição com a organização.";
    }
    return "Disponível com mínimo de " + minimum + " interessados. Até agora: " + count + ".";
  }

  function matchesFilter(event, filter) {
    if (filter === "all") return true;
    return classifyEvent(event).includes(filter);
  }

  function classifyEvent(event) {
    const types = [];
    const category = normalize(event.category);
    const name = normalize(event.name);
    const distances = normalize(event.distances);

    if (category.includes("trail")) return ["trail"];
    if (category.includes("tri")) return ["tri"];

    if (category.includes("meia")) types.push("half");
    if (category.includes("maratona")) types.push("marathon");

    const has21 = /(^|[^0-9])21([,.]1)?\s*k/.test(distances) ||
      distances.includes("21k") || name.includes("half marathon") ||
      name.includes("meia") || name.includes("21k");
    const has42 = /(^|[^0-9])42([,.]195)?\s*k/.test(distances) ||
      distances.includes("42k") || name.includes("maratona") ||
      name.includes("marathon");

    if (has21 && !types.includes("half")) types.push("half");
    if (has42 && !types.includes("marathon")) types.push("marathon");

    const stripped = distances
      .replace(/42([,.]195)?\s*k/g,"")
      .replace(/21([,.]1)?\s*k/g,"")
      .replace(/desafio/g,"")
      .replace(/[•+]/g,"")
      .trim();

    if (category.includes("corrida") && (stripped || (!has21 && !has42))) {
      types.push("run");
    }

    if (!types.length) types.push("run");
    return Array.from(new Set(types));
  }

  function isPastEvent(event) {
    const endDate = event.end_date || event.event_date;
    return endDate < todayValue();
  }

  function todayValue() {
    const d = new Date();
    const year = d.getFullYear();
    const month = String(d.getMonth()+1).padStart(2,"0");
    const day = String(d.getDate()).padStart(2,"0");
    return year + "-" + month + "-" + day;
  }

  function formatEventDate(event) {
    if (event.end_date && event.end_date !== event.event_date) {
      const start = new Date(event.event_date + "T12:00:00");
      const end = new Date(event.end_date + "T12:00:00");
      if (start.getMonth() === end.getMonth()) {
        return start.getDate() + " a " + end.getDate() + "/" +
          String(end.getMonth()+1).padStart(2,"0");
      }
      return formatShortDate(event.event_date) + " a " + formatShortDate(event.end_date);
    }
    return formatShortDate(event.event_date);
  }

  function formatShortDate(dateString) {
    if (!dateString) return "";
    const parts = String(dateString).split("-");
    if (parts.length !== 3) return dateString;
    return parts[2] + "/" + parts[1];
  }

  function updateHeading() {
    const titleMap = {
      all:"Próximas provas",
      run:"Corridas — outras distâncias",
      half:"Meias maratonas",
      marathon:"Maratonas",
      trail:"Trail Run",
      tri:"Triathlon"
    };

    const title = document.querySelector(".panel-all .section-head h2");
    const badge = document.querySelector(".panel-all .section-head span");
    if (title) title.textContent = titleMap[activeFilter] || titleMap.all;
    if (badge) badge.textContent = "Calendário " + selectedYear;
  }

  function injectStyles() {
    const style = document.createElement("style");
    style.textContent = [
      ".official-area .panel{display:none!important}",
      ".official-area .panel-all{display:block!important}",
      ".filter-card.active{transform:translateY(-3px);background:#214b37;border-color:rgba(168,224,190,.35)}",
      "#rs-calendar-root{display:block}",
      ".rs-year-selector{display:flex;gap:10px;flex-wrap:wrap;margin:0 0 28px}",
      ".rs-year-selector button{border:1px solid rgba(255,255,255,.12);background:#0b1712;color:#a8e0be;border-radius:999px;padding:11px 20px;font:inherit;font-weight:900;cursor:pointer}",
      ".rs-year-selector button.active{background:#a8e0be;color:#07110d;border-color:#a8e0be}",
      ".rs-featured-section{margin:0 0 30px}",
      ".rs-featured-heading{display:flex;justify-content:space-between;align-items:center;gap:14px;margin-bottom:14px;padding:12px 16px;border:1px solid rgba(248,198,68,.35);background:rgba(248,198,68,.08);border-radius:16px}",
      ".rs-featured-heading small{color:#f8c644;font-weight:900;letter-spacing:.1em}",
      ".rs-featured-heading strong{color:#fff4cf}",
      ".rs-featured-card{border-color:rgba(248,198,68,.6);box-shadow:0 18px 46px rgba(0,0,0,.22)}",
      ".rs-featured-note{background:#f8c644;color:#07110d;border-radius:13px;padding:11px 13px;font-weight:900;margin:0 0 12px}",
      ".rs-location{color:#d6e6dd;font-size:14px;margin:-8px 0 8px}",
      ".rs-distances{display:inline-block;background:rgba(168,224,190,.10);border:1px solid rgba(168,224,190,.18);color:#a8e0be;border-radius:999px;padding:6px 10px;font-size:12px;font-weight:900;margin:0 0 14px}",
      ".rs-community-label{color:#d6e6dd;font-size:11px;font-weight:900;letter-spacing:.08em;text-transform:uppercase;margin:12px 0 7px}",
      ".rs-counts{display:grid;grid-template-columns:1fr 1fr;gap:8px}",
      ".rs-counts div{background:rgba(255,255,255,.07);border:1px solid rgba(255,255,255,.09);border-radius:13px;padding:10px 12px}",
      ".rs-counts strong{display:block;font-size:20px;color:#a8e0be}",
      ".rs-counts span{display:block;font-size:11px;color:#d6e6dd;margin-top:2px}",
      ".rs-coupon{display:flex;justify-content:space-between;align-items:center;gap:12px;background:rgba(105,189,141,.13);border:1px solid rgba(168,224,190,.30);border-radius:13px;padding:10px 12px;margin:0 0 10px}",
      ".rs-coupon span{font-size:12px;font-weight:800;color:#d6e6dd}",
      ".rs-coupon strong{color:#a8e0be;letter-spacing:.05em}",
      ".rs-window-list{display:grid;gap:7px;margin:0 0 10px}",
      ".rs-window{display:flex;justify-content:space-between;align-items:center;gap:12px;border-radius:12px;padding:9px 11px;border:1px solid rgba(255,255,255,.10);background:rgba(255,255,255,.05)}",
      ".rs-window div{display:grid;gap:2px}",
      ".rs-window strong{font-size:12px}",
      ".rs-window span{font-size:11px;color:#d6e6dd}",
      ".rs-window small{font-size:11px;font-weight:900;white-space:nowrap}",
      ".rs-window-open{border-color:rgba(168,224,190,.35)}",
      ".rs-window-open small{color:#a8e0be}",
      ".rs-window-upcoming small{color:#f8c644}",
      ".rs-window-closed{opacity:.6}",
      ".rs-group-progress{display:grid;grid-template-columns:1fr auto;gap:3px 12px;background:rgba(248,198,68,.10);border:1px solid rgba(248,198,68,.30);border-radius:13px;padding:11px 12px;margin-top:9px}",
      ".rs-group-progress span{font-size:12px;font-weight:800;color:#fff4cf}",
      ".rs-group-progress strong{color:#f8c644}",
      ".rs-group-progress small{grid-column:1/-1;color:#d6e6dd;font-size:11px;line-height:1.35}",
      ".event-actions{grid-template-columns:repeat(2,1fr)!important}",
      ".event-actions .rs-official-link{grid-column:1/-1}",
      ".rs-action{border:0;cursor:pointer;text-align:center;font:inherit;font-weight:900;padding:12px 10px;border-radius:14px;font-size:14px}",
      ".rs-interest{background:rgba(255,255,255,.10);color:#a8e0be;border:1px solid rgba(168,224,190,.24)}",
      ".rs-going{background:#f8c644;color:#07110d}",
      ".rs-group{background:#a8e0be;color:#07110d;grid-column:1/-1}",
      ".rs-empty{background:#0b1712;border:1px solid rgba(255,255,255,.12);border-radius:20px;padding:24px;color:#d6e6dd}",
      ".rs-modal-backdrop{position:fixed;inset:0;z-index:9999;background:rgba(0,0,0,.72);display:none;align-items:center;justify-content:center;padding:20px}",
      ".rs-modal-backdrop.open{display:flex}",
      ".rs-modal{width:min(560px,100%);max-height:92vh;overflow:auto;background:#0b1712;border:1px solid rgba(168,224,190,.25);border-radius:28px;padding:28px;box-shadow:0 30px 80px rgba(0,0,0,.55)}",
      ".rs-modal h3{font-size:30px;margin-bottom:8px}",
      ".rs-modal .rs-event-name{color:#a8e0be;font-weight:900;margin-bottom:18px}",
      ".rs-modal .rs-alert{background:rgba(248,198,68,.10);border:1px solid rgba(248,198,68,.38);color:#fff4cf;border-radius:14px;padding:12px 14px;margin-bottom:18px;font-size:14px}",
      ".rs-field{margin-bottom:14px}",
      ".rs-field label{display:block;font-size:13px;font-weight:800;margin-bottom:6px;color:#d6e6dd}",
      ".rs-field input{width:100%;padding:13px 14px;border-radius:12px;border:1px solid rgba(255,255,255,.16);background:#07110d;color:white;font:inherit}",
      ".rs-confirm{display:flex;gap:10px;align-items:flex-start;margin:16px 0;font-size:13px;color:#d6e6dd}",
      ".rs-confirm input{margin-top:3px}",
      ".rs-modal-actions{display:flex;gap:10px}",
      ".rs-modal-actions button{flex:1;padding:13px;border-radius:999px;border:0;font-weight:900;cursor:pointer}",
      ".rs-submit{background:#a8e0be;color:#07110d}",
      ".rs-submit:disabled{opacity:.55;cursor:not-allowed}",
      ".rs-cancel{background:rgba(255,255,255,.10);color:white}",
      ".rs-feedback{margin-top:14px;font-size:14px}",
      "@media(max-width:700px){.event-actions{grid-template-columns:1fr!important}.event-actions .rs-official-link,.rs-group{grid-column:auto}.rs-window{align-items:flex-start;flex-direction:column}.rs-modal-actions{flex-direction:column}}"
    ].join("");
    document.head.appendChild(style);
  }

  function injectModal() {
    const root = document.createElement("div");
    root.className = "rs-modal-backdrop";
    root.id = "rs-modal";
    root.innerHTML =
      '<div class="rs-modal" role="dialog" aria-modal="true" aria-labelledby="rs-modal-title">' +
        '<h3 id="rs-modal-title">Avise a Rio Saúde</h3>' +
        '<div class="rs-event-name" id="rs-event-name"></div>' +
        '<div class="rs-alert" id="rs-status-explainer"></div>' +
        '<form id="rs-registration-form">' +
          '<div class="rs-field"><label for="rs-name">Nome e sobrenome</label><input id="rs-name" name="name" autocomplete="name" maxlength="120" required></div>' +
          '<div class="rs-field"><label for="rs-email">E-mail</label><input id="rs-email" name="email" type="email" autocomplete="email" maxlength="320" required></div>' +
          '<div class="rs-field"><label for="rs-distance">Distância / categoria</label><input id="rs-distance" name="distance" maxlength="80" placeholder="Ex.: 10 km, 21 km, Sprint, Standard"></div>' +
          '<label class="rs-confirm"><input id="rs-understood" type="checkbox" required><span>Entendi que este aviso <strong>não realiza minha inscrição oficial</strong> na prova.</span></label>' +
          '<div class="rs-modal-actions"><button type="button" class="rs-cancel" id="rs-cancel">Cancelar</button><button type="submit" class="rs-submit">Confirmar aviso</button></div>' +
          '<div class="rs-feedback" id="rs-feedback"></div>' +
        '</form>' +
      '</div>';

    document.body.appendChild(root);
    root.addEventListener("click", (event) => {
      if (event.target === root) closeModal();
    });
    root.querySelector("#rs-cancel").addEventListener("click", closeModal);
    root.querySelector("#rs-registration-form").addEventListener("submit", submitForm);
  }

  function openModal(eventName, status) {
    document.querySelector("#rs-event-name").textContent = eventName;
    const explainers = {
      interest:"Você ainda está avaliando esta prova. Marcar interesse ajuda a Rio Saúde a medir a demanda e, em algumas provas, buscar inscrição em grupo ou condição especial.",
      going:"Você está avisando que vai participar. A inscrição oficial continua sendo feita no site da prova.",
      group_interest:"Você quer entrar na contagem da inscrição em grupo da Rio Saúde para esta prova. A vaga só será confirmada quando a equipe validar as condições."
    };
    document.querySelector("#rs-status-explainer").textContent =
      explainers[status] || explainers.going;
    document.querySelector("#rs-feedback").textContent = "";
    document.querySelector("#rs-modal").classList.add("open");
  }

  function closeModal() {
    const modal = document.querySelector("#rs-modal");
    if (modal) modal.classList.remove("open");
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
      const result = await client.rpc("submit_race_response", {
        p_event_name:currentEvent,
        p_athlete_name:name,
        p_athlete_email:email,
        p_distance:distance || null,
        p_status:currentStatus
      });
      if (result.error) throw result.error;

      feedback.textContent = currentStatus === "going"
        ? "Rio Saúde avisada. Sua inscrição oficial continua sendo responsabilidade sua."
        : "Atualização registrada com sucesso.";

      event.currentTarget.reset();

      hydrateCalendar().catch((refreshError) => {
        console.error("Cadastro salvo; falha apenas ao atualizar os contadores", refreshError);
      });

      setTimeout(closeModal, 1500);
    } catch (error) {
      console.error("Erro ao registrar prova", error);
      feedback.textContent = "Não foi possível salvar agora. Tente novamente.";
    } finally {
      submit.disabled = false;
    }
  }

  function normalize(value) {
    return String(value || "").trim().toLocaleLowerCase("pt-BR");
  }

  function capitalize(value) {
    return value ? value.charAt(0).toUpperCase() + value.slice(1) : value;
  }

  function escapeHtml(value) {
    return String(value == null ? "" : value)
      .replace(/&/g,"&amp;")
      .replace(/</g,"&lt;")
      .replace(/>/g,"&gt;")
      .replace(/"/g,"&quot;")
      .replace(/'/g,"&#039;");
  }
})();