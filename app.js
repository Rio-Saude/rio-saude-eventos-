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

  injectStyles();
  injectModal();

  document.querySelectorAll(".event-register-card[data-event]").forEach((card) => {
    const actions = card.querySelector(".event-actions");
    if (!actions) return;

    const official = actions.querySelector('a[href^="http"]');
    if (!official) return;

    const officialHtml = official.outerHTML;
    actions.innerHTML = `
      ${officialHtml}
      <button type="button" class="rs-action rs-interest" data-status="interest">Tenho interesse</button>
      <button type="button" class="rs-action rs-going" data-status="going">Vou fazer esta prova</button>
      <button type="button" class="rs-action rs-group" data-status="group_interest">Quero inscrição em grupo</button>
    `;

    const note = card.querySelector(".form-note");
    if (note) {
      note.textContent = "Avise sua intenção à Rio Saúde. Isso não realiza sua inscrição oficial na prova.";
    }

    actions.querySelectorAll("[data-status]").forEach((button) => {
      button.addEventListener("click", () => {
        currentEvent = card.dataset.event || "";
        currentStatus = button.dataset.status || "going";
        openModal(currentEvent, currentStatus);
      });
    });
  });

  function injectStyles() {
    const style = document.createElement("style");
    style.textContent = `
      .event-actions { grid-template-columns: repeat(2,1fr) !important; }
      .rs-action {
        border:0; cursor:pointer; text-align:center; font:inherit;
        font-weight:900; padding:12px 10px; border-radius:14px; font-size:14px;
      }
      .rs-interest { background:rgba(255,255,255,.10); color:#a8e0be; border:1px solid rgba(168,224,190,.24); }
      .rs-going { background:#f8c644; color:#07110d; }
      .rs-group { background:#a8e0be; color:#07110d; grid-column:1/-1; }
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
      .rs-field input, .rs-field select {
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
      .rs-cancel { background:rgba(255,255,255,.10); color:white; }
      .rs-feedback { margin-top:14px; font-size:14px; }
      @media(max-width:700px){ .event-actions { grid-template-columns:1fr !important; } .rs-group { grid-column:auto; } }
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
            <input id="rs-name" name="name" autocomplete="name" required>
          </div>
          <div class="rs-field">
            <label for="rs-email">E-mail</label>
            <input id="rs-email" name="email" type="email" autocomplete="email" required>
          </div>
          <div class="rs-field">
            <label for="rs-distance">Distância / categoria</label>
            <input id="rs-distance" name="distance" placeholder="Ex.: 10 km, 21 km, Sprint, Standard">
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
      interest: "Você ainda está avaliando esta prova. Isso entra como interesse, não como participação confirmada.",
      going: "Você está avisando que pretende participar. A inscrição oficial continua sendo feita no site da prova.",
      group_interest: "Você quer entrar na contagem para uma possível inscrição em grupo da Rio Saúde. A vaga só será confirmada quando a equipe validar as condições da prova."
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
        ? "Rio Saúde avisada. Lembrete: sua inscrição oficial continua sendo responsabilidade sua."
        : "Atualização registrada com sucesso.";

      event.currentTarget.reset();
      setTimeout(closeModal, 1600);
    } catch (err) {
      console.error(err);
      feedback.textContent = "Não foi possível salvar agora. Tente novamente em alguns instantes.";
    } finally {
      submit.disabled = false;
    }
  }
})();
