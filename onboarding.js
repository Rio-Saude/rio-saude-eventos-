(() => {
  const config = window.RIO_SAUDE_CONFIG || {};
  const ready = Boolean(config.supabaseUrl && config.supabaseAnonKey && window.supabase);
  // This is tied to the isolated project ref, not a URL flag or a hidden control.
  // If a browser changes it, its client can only point at homologation, never production.
  const isHomologationPreview = config.supabaseUrl === 'https://xiiudduncvcxcvbgbqpc.supabase.co' &&
    config.environmentLabel === 'HOMOLOGAÇÃO';
  // Capture the offer before login/navigation removes unrelated query parameters.
  const requestedOffer = new URLSearchParams(window.location.search).get('offer') === 'standard' ? 'standard' : 'trial';
  const raceCatalogSource = isHomologationPreview ? 'onboarding_race_catalog' : 'events';

  const loginView = document.querySelector('#login-view');
  const appView = document.querySelector('#app-view');
  const loginForm = document.querySelector('#login-form');
  const loginStatus = document.querySelector('#login-status');
  const otpForm = document.querySelector('#otp-form');
  const codeInput = document.querySelector('#login-code');
  const resendButton = document.querySelector('#resend-code');
  const changeEmailButton = document.querySelector('#change-email');
  const appStatus = document.querySelector('#app-status');
  const stepRoot = document.querySelector('#step-root');
  const progressRoot = document.querySelector('#progress');
  const logoutButton = document.querySelector('#logout-btn');

  if (!ready) {
    loginStatus.textContent = 'Configuração do portal indisponível.';
    loginStatus.classList.add('error');
    return;
  }

  const client = window.supabase.createClient(config.supabaseUrl, config.supabaseAnonKey, {
    auth: { persistSession: true, autoRefreshToken: true }
  });
  let session = null;
  let profile = null;
  let pendingEmail = '';
  let authBusy = false;
  let resendAt = 0;
  let resendTimer = null;
  let authenticatedBoot = null;
  let editing = false;
  let editStep = 1;
  let updated = false;
  let saving = false;
  let checkoutBusy = false;
  let parqOnlyMode = false;
  let availableRaceOptions = [];
  let pendingRaceEntries = [];
  let trialAccess = null;

  loginForm.addEventListener('submit', (event) => {
    event.preventDefault();
    sendCode(false);
  });
  otpForm.addEventListener('submit', verifyCode);
  resendButton.addEventListener('click', () => sendCode(true));
  changeEmailButton.addEventListener('click', () => {
    if (authBusy) return;
    resetCodeForm();
    document.querySelector('#login-email').focus();
  });
  codeInput.addEventListener('input', () => {
    codeInput.value = codeInput.value.replace(/[^0-9]/g, '').slice(0, 6);
  });
  logoutButton.addEventListener('click', logout);

  client.auth.onAuthStateChange((event, nextSession) => {
    if (event === 'INITIAL_SESSION') return; // boot() restores the existing session.
    session = nextSession;
    if (session?.user) {
      // Run database calls after Supabase releases its auth callback lock.
      setTimeout(() => {
        if (session === nextSession) enterOnboarding().catch(showAuthLoadError);
      }, 0);
    } else {
      showLogin();
    }
  });

  boot().catch((error) => {
    console.error(error);
    showLoginError('Não foi possível iniciar o portal. Tente novamente.');
  });

  async function boot() {
    const { data, error } = await client.auth.getSession();
    if (error) throw error;
    session = data.session;
    if (session?.user) await enterOnboarding();
    else showLogin();
  }

  async function sendCode(resend) {
    if (authBusy || (resend && Date.now() < resendAt)) return;
    const email = resend ? pendingEmail : String(new FormData(loginForm).get('email') || '').trim().toLowerCase();
    if (!email || (!resend && !loginForm.reportValidity())) return;
    setAuthBusy(true);
    loginStatus.className = 'status';
    loginStatus.textContent = 'Enviando código...';
    try {
      const { error } = await client.auth.signInWithOtp({
        email,
        options: { shouldCreateUser: true }
      });
      if (error) throw error;
      pendingEmail = email;
      loginForm.classList.add('hidden');
      otpForm.classList.remove('hidden');
      document.querySelector('#otp-destination').textContent = `Enviamos um código para ${email}`;
      codeInput.value = '';
      loginStatus.textContent = resend ? 'Código reenviado. Use o código mais recente.' : 'Confira sua caixa de entrada e o spam.';
      startResendCooldown();
      codeInput.focus();
    } catch (error) {
      const rateLimited = error.status === 429 || error.code === 'over_email_send_rate_limit';
      if (resend && rateLimited) startResendCooldown();
      showLoginError(rateLimited
        ? 'Aguarde um minuto antes de solicitar outro código.'
        : 'Não foi possível enviar o código. Confira o e-mail e tente novamente.');
    } finally {
      setAuthBusy(false);
    }
  }

  async function verifyCode(event) {
    event.preventDefault();
    if (authBusy || !pendingEmail) return;
    const token = codeInput.value.trim();
    if (!/^[0-9]{6}$/.test(token)) {
      showLoginError('Digite o código de 6 dígitos.');
      codeInput.focus();
      return;
    }
    setAuthBusy(true);
    loginStatus.className = 'status';
    loginStatus.textContent = 'Validando código...';
    try {
      const { data, error } = await client.auth.verifyOtp({ email: pendingEmail, token, type: 'email' });
      if (error) throw error;
      if (!data.session?.user) throw new Error('Sessão indisponível');
      session = data.session;
      try {
        await enterOnboarding();
      } catch (error) {
        showAuthLoadError(error);
      }
    } catch (error) {
      showLoginError(error.status === 429
        ? 'Muitas tentativas. Aguarde um pouco antes de tentar novamente.'
        : error.code === 'otp_expired' || error.status === 403
          ? 'Código incorreto ou expirado. Confira o código mais recente ou solicite um novo.'
          : 'Não foi possível validar o código. Tente novamente.');
      codeInput.focus();
      codeInput.select();
    } finally {
      setAuthBusy(false);
    }
  }

  function setAuthBusy(busy) {
    authBusy = busy;
    loginForm.querySelector('button').disabled = busy;
    document.querySelector('#login-email').disabled = busy;
    otpForm.querySelector('button[type="submit"]').disabled = busy;
    changeEmailButton.disabled = busy;
    updateResendButton();
  }

  function startResendCooldown() {
    clearInterval(resendTimer);
    resendAt = Date.now() + 60000;
    resendTimer = setInterval(updateResendButton, 1000);
    updateResendButton();
  }

  function updateResendButton() {
    const seconds = Math.max(0, Math.ceil((resendAt - Date.now()) / 1000));
    resendButton.disabled = authBusy || seconds > 0;
    resendButton.textContent = seconds ? `Reenviar código (${seconds}s)` : 'Reenviar código';
    if (!seconds) clearInterval(resendTimer);
  }

  function resetCodeForm() {
    pendingEmail = '';
    codeInput.value = '';
    resendAt = 0;
    clearInterval(resendTimer);
    otpForm.classList.add('hidden');
    loginForm.classList.remove('hidden');
    loginStatus.className = 'status';
    loginStatus.textContent = '';
    document.querySelector('#otp-destination').textContent = '';
    updateResendButton();
  }

  async function enterOnboarding() {
    if (!session?.user) return;
    if (authenticatedBoot) return authenticatedBoot;
    if (profile && !appView.classList.contains('hidden')) return;
    authenticatedBoot = bootAuthenticated();
    try {
      await authenticatedBoot;
      resetCodeForm();
    } finally {
      authenticatedBoot = null;
    }
  }

  function showAuthLoadError() {
    showLoginError('Seu acesso foi validado, mas não foi possível carregar o cadastro. Recarregue a página para tentar novamente.');
  }

  async function bootAuthenticated() {
    await loadOrCreateProfile();
    await claimTrialFromUrl();
    await loadTrialAccess();
    await preserveSelectedPlanFromUrl();
    // Migrated users already on financeiro/TrainingPeaks complete the new health step first.
    if (!profile.onboarding_completed_at && Number(profile.onboarding_step) >= 4) {
      const {data:health,error:healthError}=await client.from('health_screenings')
        .select('signed_at,form_version').eq('user_id',session.user.id)
        .order('signed_at',{ascending:false}).limit(1).maybeSingle();
      if(healthError)throw healthError;
      const last=Date.parse(health?.signed_at||'');
      const valid=health?.form_version==='rj_6765_2014_annex_i_v1' &&
        Number.isFinite(last) && last>Date.now()-365*86400000;
      if(!valid){
        const {data,error}=await client.from('athlete_profiles')
          .update({onboarding_step:3}).eq('user_id',session.user.id)
          .select('*').single();
        if(error)throw error;
        profile=data;
      }
    }
    const params = new URLSearchParams(location.search);
    editing = Boolean(profile.onboarding_completed_at && params.get('edit') === '1');
    editStep = params.get('edit') === '1' ? 1 : 1;
    const retainedParams = new URLSearchParams();
    if (params.get('edit') === '1') retainedParams.set('edit', '1');
    if (requestedOffer === 'standard') retainedParams.set('offer', 'standard');
    const query = retainedParams.toString();
    history.replaceState(null, '', location.pathname + (query ? `?${query}` : ''));
    loginView.classList.add('hidden');
    appView.classList.remove('hidden');
    logoutButton.classList.remove('hidden');
    render();
  }

  async function claimTrialFromUrl() {
    const token = new URLSearchParams(location.search).get('trial');
    if (!token) return;
    if (!/^[a-f0-9]{64}$/i.test(token)) throw new Error('invalid_trial_invitation');
    const { error } = await client.rpc('claim_trial_invitation', { p_token: token });
    if (error) throw error;
  }

  async function loadTrialAccess() {
    const { data, error } = await client.rpc('my_trial_access');
    if (error) throw error;
    trialAccess = data?.[0] || null;
  }

  async function preserveSelectedPlanFromUrl() {
    const selected = new URLSearchParams(location.search).get('plan');
    const selectablePlanCodes = new Set(['single_monthly', 'single_290_monthly', 'multi_monthly']);
    if (!selectablePlanCodes.has(selected) || profile.selected_plan_code === selected) return;
    const { data, error } = await client.from('athlete_profiles').update({ selected_plan_code: selected })
      .eq('user_id', session.user.id).select('*').single();
    if (error) throw error;
    profile = data;
  }

  async function loadOrCreateProfile() {
    const user = session.user;
    const { data, error } = await client
      .from('athlete_profiles')
      .select('*')
      .eq('user_id', user.id)
      .maybeSingle();

    if (error) throw error;

    if (data) {
      profile = data;
      return;
    }

    const { data: created, error: createError } = await client
      .from('athlete_profiles')
      .insert({
        user_id: user.id,
        email: String(user.email || '').toLowerCase(),
        onboarding_step: 1,
        payment_provider: 'efi'
      })
      .select('*')
      .single();

    if (createError?.code === '23505') {
      // A second tab may have created this user's unique profile meanwhile.
      const { data: existing, error: readError } = await client.from('athlete_profiles')
        .select('*').eq('user_id', user.id).single();
      if (readError) throw readError;
      profile = existing;
      return;
    }
    if (createError) throw createError;
    profile = created;
  }

  function render() {
    appStatus.textContent = '';
    appStatus.className = 'status';
    const completed = Boolean(profile.onboarding_completed_at && !editing);
    document.querySelector('.hero')?.classList.toggle('hidden', completed);
    progressRoot.classList.toggle('hidden', completed);
    if (completed) {
      renderDashboard();
      return;
    }
    const step = editing ? editStep : Math.min(Math.max(Number(profile.onboarding_step || 1), 1), 5);
    renderProgress(step);
    if (step === 1) renderPersonal();
    if (step === 2) renderSport();
    if (step === 3) renderHealthScreening();
    if (step === 4) renderPayment();
    if (step === 5) renderTrainingPeaks();
  }

  function renderProgress(step) {
    progressRoot.innerHTML = '';
    const labels = ['Dados pessoais', 'Perfil esportivo', 'Saúde / PAR-Q', 'Plano e pagamento', 'TrainingPeaks'];
    for (let i = 1; i <= 5; i += 1) {
      const item = document.createElement('span');
      item.textContent = labels[i - 1];
      if (i <= step) item.classList.add('active');
      progressRoot.appendChild(item);
    }
  }

  function renderPersonal() {
    stepRoot.innerHTML = `
      <div class="step-kicker">${editing ? 'Editar cadastro · ' : ''}1 de 5 · Seus dados</div>
      <h2>Começando pelo básico.</h2>
      <p class="lead">Esses dados identificam seu cadastro na Rio Saúde. O e-mail é a chave da sua conta.</p>
      <span class="email-pill">${escapeHtml(profile.email)}</span>
      <form id="personal-form" class="grid" style="margin-top:20px">
        <div class="field"><label for="first_name">Nome</label><input id="first_name" name="first_name" value="${value(profile.first_name)}" autocomplete="given-name" required></div>
        <div class="field"><label for="last_name">Sobrenome</label><input id="last_name" name="last_name" value="${value(profile.last_name)}" autocomplete="family-name" required></div>
        <div class="field full"><label for="cpf">CPF</label><input id="cpf" name="cpf" inputmode="numeric" maxlength="14" required placeholder="000.000.000-00" value="${value(formatCpf(profile.cpf))}" aria-describedby="cpf-note"><p id="cpf-note" class="field-help">Seu e-mail continua sendo o login. O CPF será a referência para o cadastro financeiro.</p></div>
        <div class="field"><label for="whatsapp">WhatsApp</label><input id="whatsapp" name="whatsapp" value="${value(profile.whatsapp)}" autocomplete="tel" placeholder="(21) 99999-9999" required></div>
        <label class="check field full"><input type="checkbox" name="whatsapp_financial_contact_authorized" ${profile.whatsapp_financial_contact_authorized ? 'checked' : ''}><span>Autorizo receber pelo WhatsApp lembretes sobre a ativação e o pagamento do meu plano.</span></label>
        <div class="field"><label for="birth_date">Data de nascimento</label><input id="birth_date" name="birth_date" type="date" value="${value(profile.birth_date)}" required></div>
        <div class="field full"><label for="city">Cidade</label><input id="city" name="city" value="${value(profile.city)}" autocomplete="address-level2" placeholder="Rio de Janeiro" required></div>
        <div class="actions field full"><button class="primary-btn" type="submit">Continuar</button></div>
      </form>`;
    document.querySelector('#personal-form').addEventListener('submit', savePersonal);
    document.querySelector('#cpf').addEventListener('input', event => {
      event.target.value = formatCpf(event.target.value);
      event.target.setCustomValidity('');
    });
    bindDatePickers();
  }

  async function savePersonal(event) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const cpf = clean(form.get('cpf')).replace(/\D/g, '');
    if (!validCpf(cpf)) {
      const input = document.querySelector('#cpf');
      input.setCustomValidity('Confira os 11 dígitos do CPF.');
      input.reportValidity();
      return;
    }
    await updateProfile({
      cpf: cpf || null,
      first_name: clean(form.get('first_name')),
      last_name: clean(form.get('last_name')),
      whatsapp: clean(form.get('whatsapp')),
      whatsapp_financial_contact_authorized: form.get('whatsapp_financial_contact_authorized') === 'on',
      birth_date: clean(form.get('birth_date')),
      city: clean(form.get('city')),
      onboarding_step: 2
    });
  }

  function renderSport() {
    const goals = ['Melhorar minha performance', 'Ter mais consistência nos treinos', 'Preparar para uma prova', 'Voltar a treinar'];
    const legacyText = String(profile.primary_goal || '');
    const firstLegacy = legacyText.split('\n')[0];
    const inferred = /^(performance)$/i.test(firstLegacy) ? 'Melhorar minha performance'
      : /^(consistência)$/i.test(firstLegacy) ? 'Ter mais consistência nos treinos'
      : /^(maratona|meia maratona|5 km|10 km|trail|triathlon|70.3|ironman)$/i.test(firstLegacy) ? 'Preparar para uma prova'
      : firstLegacy === 'Voltar a treinar' ? 'Voltar a treinar' : null;
    const selectedGoals = Array.isArray(profile.training_goals) && profile.training_goals.length
      ? profile.training_goals : (inferred ? [inferred] : []);
    const goalDetails = inferred ? legacyText.split('\n').slice(1).join('\n') : legacyText;
    const oldRace = profile.goal_event_name
      ? [{name:profile.goal_event_name, event_date:profile.goal_event_date || null, custom:true}] : [];
    pendingRaceEntries = (Array.isArray(profile.goal_events) && profile.goal_events.length ? profile.goal_events : oldRace)
      .filter(entry => entry && typeof entry.name === 'string').slice(0,15).map(entry=>({
        name:entry.name, event_date:entry.event_date || null, custom:entry.custom !== false
      }));
    const hasRace = pendingRaceEntries.length > 0;
    const selected = new Set(Array.isArray(profile.modalities) ? profile.modalities : []);
    const modal = [['corrida','Corrida'],['triathlon','Triathlon'],['trail','Trail run'],
      ['natacao','Natação'],['ciclismo','Ciclismo']];
    const checks = modal.map(([key,label]) => `
      <label class="check"><input type="checkbox" name="modalities" value="${key}" ${selected.has(key) ? 'checked' : ''}>${label}</label>`).join('');
    stepRoot.innerHTML = `
      <div class="step-kicker">2 de 5 · Perfil esportivo e provas</div>
      <h2>Onde você está e onde quer chegar.</h2>
      <p class="lead">Essas informações ajudam a equipe a organizar seu acompanhamento.</p>
      <form id="sport-form" class="grid">
        <div class="field full"><label>Modalidades</label><div class="checks">${checks}</div></div>
        <div class="field"><label for="running_experience">Há quanto tempo você treina/corre?</label><select id="running_experience" name="running_experience" required><option value="">Selecione</option>${['Nunca treinei','Menos de 6 meses','6 meses a 1 ano','1 a 2 anos','2 anos ou mais'].map(choice => option(choice, choice, profile.running_experience)).join('')}</select></div>
        <div class="field"><label for="current_level">Como você define seu nível atual?</label><select id="current_level" name="current_level"><option value="">Selecione</option>${option('iniciante','Iniciante',profile.current_level)}${option('intermediario','Intermediário',profile.current_level)}${option('avancado','Avançado',profile.current_level)}</select></div>
        <div class="field"><label for="training_days_current">Quantos dias por semana você treina hoje?</label><input id="training_days_current" name="training_days_current" value="${value(profile.training_days_current)}" placeholder="Ex.: 4 dias"></div>
        <div class="field"><label for="training_days_available">Quantos dias você tem disponíveis para treinar?</label><select id="training_days_available" name="training_days_available" required><option value="">Selecione</option>${['1–2 dias','3 dias','4 dias ou mais'].map(choice => option(choice, choice, profile.training_days_available)).join('')}</select></div>
        <div class="field full"><label for="base_preference">Em qual base você vai treinar?</label><select id="base_preference" name="base_preference" required><option value="">Selecione</option>${['Barra','Aterro','Lagoa','Online'].map(choice => option(choice, choice, profile.base_preference)).join('')}</select></div>
        <fieldset class="field full choice-fieldset"><legend>Já teve alguma lesão relacionada aos treinos?</legend><div class="goal-options"><label class="goal-option"><input type="radio" name="had_training_injury" value="yes" ${profile.had_training_injury === true ? 'checked' : ''} required><span>Sim</span></label><label class="goal-option"><input type="radio" name="had_training_injury" value="no" ${profile.had_training_injury === false ? 'checked' : ''} required><span>Não</span></label></div></fieldset>
        <div id="training-injury-details-wrap" class="field full ${profile.had_training_injury === true ? '' : 'hidden'}"><label for="training_injury_details">Conte mais sobre a lesão</label><textarea id="training_injury_details" name="training_injury_details" maxlength="1000" placeholder="Ex.: Tive dor no joelho ao preparar minha primeira meia maratona. Fiz fisioterapia e voltei a correr.">${value(profile.training_injury_details)}</textarea><p class="field-help">Somente o aluno e a equipe autorizada devem acessar essas informações.</p></div>
        <fieldset class="field full choice-fieldset"><legend>O que você busca com os treinos? (pode marcar mais de um)</legend><div class="goal-options">${goals.map(goal => `<label class="goal-option"><input type="checkbox" name="quick_goal" value="${escapeAttr(goal)}" ${selectedGoals.includes(goal) ? 'checked' : ''}><span>${escapeHtml(goal)}</span></label>`).join('')}</div></fieldset>
        <div class="field full"><label for="primary_goal">Quer contar algo mais sobre seu objetivo? (opcional)</label><textarea id="primary_goal" name="primary_goal" maxlength="2000" placeholder="Ex.: Quero fazer a minha primeira maratona em 2027 abaixo de 4h.">${value(goalDetails)}</textarea></div>
        <fieldset class="field full choice-fieldset"><legend>Você já tem alguma prova marcada?</legend><div class="goal-options"><label class="goal-option"><input type="radio" name="has_race" value="yes" ${hasRace ? 'checked' : ''}><span>Sim</span></label><label class="goal-option"><input type="radio" name="has_race" value="no" ${hasRace ? '' : 'checked'}><span>Ainda não</span></label></div></fieldset>
        <div id="race-choice" class="field full ${hasRace ? '' : 'hidden'}">
          <label for="goal_event_name">Escolha uma prova do calendário</label>
          <input id="goal_event_name" type="search" list="race-suggestions" autocomplete="off" placeholder="Busque pelo nome da prova">
          <datalist id="race-suggestions"></datalist>
          <div class="actions" style="margin:8px 0 12px"><button id="add-race" class="secondary-btn" type="button">+ Adicionar prova selecionada</button></div>
          <button id="show-manual-race" class="text-btn" type="button" aria-expanded="false" aria-controls="manual-race-entry">Minha prova não está na lista</button>
          <div id="manual-race-entry" class="hidden" style="border:1px solid rgba(255,255,255,.14);border-radius:16px;padding:18px;margin-top:12px">
            <div class="field"><label for="manual_race_name">Nome da sua prova</label><input id="manual_race_name" maxlength="180" placeholder="Ex.: Corrida do meu bairro"></div>
            <div class="field" style="margin-top:12px"><label for="manual_race_date">Data da prova</label><input id="manual_race_date" type="date" lang="pt-BR"></div>
            <div class="actions" style="margin:12px 0 0"><button id="add-manual-race" class="secondary-btn" type="button">+ Adicionar minha prova</button></div>
          </div>
          <p class="field-help" style="margin-top:18px">Suas provas (toque no X para remover):</p>
          <div id="selected-race-list"></div>
          <p id="race-feedback" class="field-help" role="status" aria-live="polite"></p>
        </div>
        <div class="actions field full"><button class="secondary-btn" type="button" data-back="1">Voltar</button><button class="primary-btn" type="submit">Continuar</button></div>
      </form>`;

    document.querySelector('#sport-form').addEventListener('submit', saveSport);
    document.querySelectorAll('[name="has_race"]').forEach(input => input.addEventListener('change', () => {
      const yes = document.querySelector('[name="has_race"]:checked')?.value === 'yes';
      document.querySelector('#race-choice').classList.toggle('hidden', !yes);
      if (yes) renderSelectedRaces();
    }));
    document.querySelector('#goal_event_name').addEventListener('keydown', event => {
      if (event.key === 'Enter') { event.preventDefault(); addSelectedRace(); }
    });
    document.querySelector('#goal_event_name').addEventListener('change', event => {
      const typed = clean(event.target.value).toLocaleLowerCase('pt-BR');
      if (availableRaceOptions.some(item => item.name.toLocaleLowerCase('pt-BR') === typed)) addSelectedRace();
    });
    document.querySelector('#add-race').addEventListener('click', addSelectedRace);
    document.querySelector('#show-manual-race').addEventListener('click', () => {
      const wrap = document.querySelector('#manual-race-entry');
      wrap.classList.toggle('hidden');
      document.querySelector('#show-manual-race').setAttribute('aria-expanded', String(!wrap.classList.contains('hidden')));
      if (!wrap.classList.contains('hidden')) document.querySelector('#manual_race_name').focus();
    });
    document.querySelector('#add-manual-race').addEventListener('click', addManualRace);
    document.querySelectorAll('#manual_race_name, #manual_race_date').forEach(field => field.addEventListener('keydown', event => {
      if (event.key === 'Enter') { event.preventDefault(); addManualRace(); }
    }));
    document.querySelectorAll('[name="had_training_injury"]').forEach(input => input.addEventListener('change', () => {
      const yes = document.querySelector('[name="had_training_injury"]:checked')?.value === 'yes';
      document.querySelector('#training-injury-details-wrap').classList.toggle('hidden', !yes);
      document.querySelector('#training_injury_details').required = yes;
    }));
    document.querySelector('#training_injury_details').required = profile.had_training_injury === true;
    renderSelectedRaces();
    loadRaceSuggestions();
    bindDatePickers();
    bindBackButtons();
  }

  function renderSelectedRaces() {
    const list = document.querySelector('#selected-race-list');
    if (!list) return;
    list.replaceChildren();
    if (!pendingRaceEntries.length) {
      const p = document.createElement('p');
      p.className = 'field-help';
      p.textContent = 'Nenhuma prova adicionada ainda.';
      list.appendChild(p);
      return;
    }
    pendingRaceEntries.forEach((race,index) => {
      const line = document.createElement('div');
      line.className = 'race-selected-item';
      line.style.cssText = 'display:flex;align-items:center;justify-content:space-between;gap:12px;padding:12px;border:1px solid rgba(255,255,255,.17);border-radius:12px;margin:8px 0;';
      const name = document.createElement('span');
      name.textContent = race.name;
      const remove = document.createElement('button');
      remove.type = 'button';
      remove.textContent = '×';
      remove.className = 'secondary-btn';
      remove.setAttribute('aria-label','Remover ' + race.name);
      remove.style.cssText = 'padding:5px 12px;font-size:20px;';
      remove.addEventListener('click', () => {
        pendingRaceEntries.splice(index, 1);
        renderSelectedRaces();
      });
      line.append(name, remove);
      list.appendChild(line);
    });
  }

  function addSelectedRace() {
    const input = document.querySelector('#goal_event_name');
    const feedback = document.querySelector('#race-feedback');
    const name = clean(input.value).toLocaleLowerCase('pt-BR');
    feedback.textContent = '';
    if (!name) { feedback.textContent = 'Selecione uma prova do calendário.'; return; }
    const listed = availableRaceOptions.find(item => item.name.toLocaleLowerCase('pt-BR') === name);
    if (!listed) {
      feedback.textContent = 'Não encontrou essa prova? Clique em “Minha prova não está na lista” e preencha o nome e a data.';
      return;
    }
    if (pendingRaceEntries.length >= 15) {
      feedback.textContent = 'Você pode adicionar até 15 provas.';
      return;
    }
    if (pendingRaceEntries.some(entry => entry.name.toLocaleLowerCase('pt-BR') === name)) {
      feedback.textContent = 'Essa prova já foi adicionada.';
      return;
    }
    pendingRaceEntries.push({name:listed.name,event_date:listed.event_date || null,custom:false});
    input.value = '';
    renderSelectedRaces();
  }

  function addManualRace() {
    const feedback = document.querySelector('#race-feedback');
    const nameInput = document.querySelector('#manual_race_name');
    const dateInput = document.querySelector('#manual_race_date');
    const name = clean(nameInput.value);
    const date = clean(dateInput.value);
    feedback.textContent = '';
    if (name.length < 3 || name.length > 180) {
      feedback.textContent = 'Informe o nome completo da prova (de 3 a 180 caracteres).';
      nameInput.focus();
      return;
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !dateInput.validity.valid) {
      feedback.textContent = 'Informe a data da sua prova.';
      dateInput.focus();
      return;
    }
    if (pendingRaceEntries.length >= 15) {
      feedback.textContent = 'Você pode adicionar até 15 provas.';
      return;
    }
    if (pendingRaceEntries.some(entry => entry.name.toLocaleLowerCase('pt-BR') === name.toLocaleLowerCase('pt-BR'))) {
      feedback.textContent = 'Essa prova já foi adicionada.';
      return;
    }
    pendingRaceEntries.push({name,event_date:date,custom:true});
    nameInput.value = '';
    dateInput.value = '';
    document.querySelector('#manual-race-entry').classList.add('hidden');
    document.querySelector('#show-manual-race').setAttribute('aria-expanded','false');
    renderSelectedRaces();
  }

  async function loadRaceSuggestions() {
    const datalist = document.querySelector('#race-suggestions');
    if (!datalist) return;
    try {
      const { data, error } = await client.from(raceCatalogSource)
        .select('name,event_date')
        .eq('active',true)
        .gte('event_date',new Date().toISOString().slice(0,10))
        .order('event_date',{ascending:true})
        .limit(300);
      if (error) throw error;
      availableRaceOptions = data || [];
      if (!datalist.isConnected) return;
      datalist.replaceChildren();
      availableRaceOptions.forEach(item => {
        const option = document.createElement('option');
        option.value = item.name;
        datalist.appendChild(option);
      });
    } catch(error) {
      console.warn('Não foi possível carregar a lista de provas',error);
    }
  }

  async function saveSport(event) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const modalities = form.getAll('modalities').map(String);
    const hasRaceSelected = form.get('has_race') === 'yes';
    if (hasRaceSelected && (clean(document.querySelector('#goal_event_name')?.value) || clean(document.querySelector('#manual_race_name')?.value))) {
      document.querySelector('#race-feedback').textContent = 'Você digitou uma prova que ainda não foi adicionada. Clique em Adicionar antes de continuar.';
      return;
    }
    if (hasRaceSelected && !pendingRaceEntries.length) {
      document.querySelector('#race-feedback').textContent = 'Adicione pelo menos uma prova ou marque “Ainda não”.';
      return;
    }
    const races = hasRaceSelected ? pendingRaceEntries.slice(0,15) : [];
    const hadTrainingInjury = form.get('had_training_injury') === 'yes';
    await updateProfile({
      modalities,
      running_experience:clean(form.get('running_experience')),
      current_level:clean(form.get('current_level')),
      training_days_current:clean(form.get('training_days_current')),
      training_days_available:clean(form.get('training_days_available')),
      base_preference:clean(form.get('base_preference')),
      had_training_injury:hadTrainingInjury,
      training_injury_details:hadTrainingInjury ? clean(form.get('training_injury_details')) : null,
      training_goals:form.getAll('quick_goal').map(String),
      primary_goal:clean(form.get('primary_goal')),
      goal_events:races,
      goal_event_name:races[0]?.name || null,
      goal_event_date:races[0]?.event_date || null,
      coach:races.length ? 'Dum' : 'Pedrinho',
      onboarding_step:3
    });
  }

  function renderHealthScreening() {
    if (!window.RioSaudePARQ) {
      stepRoot.innerHTML='<p class="status error">Questionário indisponível. Atualize a página e tente novamente.</p>';
      return;
    }
    window.RioSaudePARQ.render({
      client, user:session.user, profile, root:stepRoot,
      next: async () => {
        if(parqOnlyMode){parqOnlyMode=false;editing=false;updated=true;render();}
        else if(editing){editStep=4;render();}
        else await updateProfile({onboarding_step:4});
      },
      back: async () => {
        if(parqOnlyMode){parqOnlyMode=false;editing=false;render();}
        else if(editing){editStep=2;render();}
        else await updateProfile({onboarding_step:2});
      }
    });
  }

  function renderPayment() {
    if (trialAccess && trialAccess.lifecycle_status !== 'trial_expired_decision_pending') {
      renderTrialPaymentBypass();
      return;
    }
    stepRoot.innerHTML = `
      <div class="step-kicker">4 de 5 · Financeiro</div>
      <h2>Cadastro financeiro</h2>
      <div id="efi-first-access">
        <p class="lead">Escolha quantas modalidades vai contratar com a Rio Saúde.</p>
        <form id="billing-form" class="grid">
          <fieldset class="field full choice-fieldset"><legend>Plano mensal</legend>
            <div id="billing-plans" class="goal-options">Carregando planos...</div>
          </fieldset>
          <fieldset class="field full choice-fieldset"><legend>Forma de pagamento</legend>
            <label class="goal-option"><input type="radio" name="payment_method" value="card" checked><span>Cartão de crédito · checkout Efí ao fim da experiência</span></label>
            <label class="goal-option"><input type="radio" name="payment_method" value="boleto"><span>Boleto</span></label>
          </fieldset>
          <fieldset id="billing-address" class="field full choice-fieldset"><legend>Endereço de cobrança</legend>
            <p class="field-help">Solicitamos este endereço somente para a emissão de boleto.</p>
            <div class="grid"><label class="field full">Rua<input name="billing_street" autocomplete="street-address" required></label><label class="field">Número<input name="billing_number" autocomplete="address-line2" required></label><label class="field">Complemento<input name="billing_complement" autocomplete="address-line2"></label><label class="field">Bairro<input name="billing_neighborhood" autocomplete="address-level3" required></label><label class="field">Cidade<input name="billing_city" autocomplete="address-level2" required></label><label class="field">UF<input name="billing_state" maxlength="2" autocomplete="address-level1" required></label><label class="field">CEP<input name="billing_zipcode" inputmode="numeric" maxlength="9" autocomplete="postal-code" required></label></div>
          </fieldset>
          <div id="billing-summary" class="notice field full">Se você for elegível, sua experiência começa hoje e dura 30 dias. Para cartão, você informará os dados somente no checkout oficial da Efí ao fim desse período. A primeira cobrança só poderá ocorrer depois da experiência.</div>
          <div class="actions field full"><button id="billing-checkout" class="primary-btn" type="submit" disabled>Confirmar contratação</button></div>
        </form>
        <p class="field-help">A contratação é preparada com segurança neste cadastro. Você seguirá para o TrainingPeaks após a confirmação; pagamento confirmado é informado somente pela Efí.</p>
      </div>
      <div id="efi-return" class="hidden">
        <p class="lead">A contratação foi encaminhada. Você pode continuar o cadastro enquanto aguardamos a confirmação da Efí.</p>
        <p id="billing-status" class="status" role="status" aria-live="polite"></p>
        <div class="actions">
          <button id="efi-done" class="primary-btn" type="button">Já fiz meu cadastro na Efí</button>
          <button id="efi-later" class="secondary-btn" type="button">Ainda não fiz — seguir para o TrainingPeaks</button>
        </div>
        <p class="field-help">Isso não confirma o pagamento. Se ainda não terminou, você poderá voltar à Efí depois do TrainingPeaks.</p>
      </div>
      ${isHomologationPreview && profile.payment_status !== 'confirmed' ? `
      <div id="homologation-finance-fallback" class="notice">
        <strong>Homologação:</strong> se preferir não concluir a contratação agora, você pode continuar sem cobrança e resolver o financeiro depois.
        <div class="actions"><button id="finance-later-homologation" class="secondary-btn" type="button">Continuar e resolver o financeiro depois</button></div>
      </div>` : ''}
      <p id="billing-initial-status" class="status" role="status" aria-live="polite"></p>
      <p class="field-help">Ambiente de teste: não efetue pagamentos reais.</p>
      <div class="actions"><button class="text-btn" type="button" data-back="3">Voltar</button></div>`;

    document.querySelector('#billing-form').addEventListener('submit', startCheckout);
    document.querySelectorAll('[name="payment_method"]').forEach(input => input.addEventListener('change', updatePaymentMethodUI));
    updatePaymentMethodUI();
      document.querySelector('[name="billing_state"]')?.addEventListener('input', event => {
        event.target.value = event.target.value.replace(/[^a-z]/gi, '').toUpperCase();
      });
    document.querySelector('#efi-done').addEventListener('click', () => {
      const afterTrainingPeaks = profile.payment_followup_needed && profile.trainingpeaks_step_seen;
      // A browser click never settles a financial obligation. Only the Efí
      // webhook/reconciliation can move payment_status to confirmed.
      const next = {payment_status:profile.payment_status === 'confirmed' ? 'confirmed' : 'pending',payment_followup_needed:profile.payment_status !== 'confirmed',onboarding_step:5};
      if (afterTrainingPeaks) {
        next.onboarding_completed_at = profile.onboarding_completed_at || new Date().toISOString();
      }
      updateProfile(next,{finishEdit:editing && afterTrainingPeaks});
    });
    document.querySelector('#efi-later').addEventListener('click', () => updateProfile({
      payment_status:profile.payment_status === 'confirmed' ? 'confirmed' : 'pending',payment_followup_needed:profile.payment_status !== 'confirmed',onboarding_step:5
    }));
    document.querySelector('#finance-later-homologation')?.addEventListener('click', () => updateProfile({
      payment_status: 'pending', payment_followup_needed: true, onboarding_step: 5
    }));
    loadExistingCheckout();
    bindBackButtons();
  }

  function updatePaymentMethodUI() {
    const method = document.querySelector('[name="payment_method"]:checked')?.value || 'card';
    const address = document.querySelector('#billing-address');
    if (address) address.classList.toggle('hidden', method !== 'boleto');
    address?.querySelectorAll('input[required]').forEach(input => { input.required = method === 'boleto'; });
    const summary = document.querySelector('#billing-summary');
    const standardOffer = requestedOffer === 'standard';
    if (summary) summary.textContent = standardOffer
      ? 'Contratação sem gratuidade: a primeira cobrança ou vencimento seguirá a data confirmada pela Efí. Cancelamentos impedem novas cobranças.'
      : method === 'boleto'
      ? 'Se você for elegível, a experiência começa hoje. O boleto será emitido no 20º dia, vence no 30º dia e as cobranças posteriores serão mensais. Cancelamentos impedem novas cobranças.'
       : 'Se você for elegível, são 30 dias grátis. No 25º dia enviaremos, se você autorizou o contato pelo WhatsApp, o checkout oficial da Efí. A Efí poderá cobrar quando o cartão for cadastrado; não espere até o 31º dia para concluir. A Rio Saúde não coleta dados do cartão.';
  }

  function renderTrialPaymentBypass() {
    const end = String(trialAccess.ends_on || '').split('-').reverse().join('/');
    stepRoot.innerHTML = `
      <div class="step-kicker">4 de 5 · Plano e pagamento</div>
      <h2>Seu período experimental está ativo.</h2>
      <div class="success-box"><strong>Sem cobrança nesta etapa.</strong><br>Seu acesso experimental vai até ${escapeHtml(end)}. Você pode seguir para o TrainingPeaks sem informar cartão ou criar cobrança.</div>
      <p class="lead">Quando quiser contratar um plano, a equipe poderá aproveitar este mesmo cadastro.</p>
      <div class="actions"><button id="trial-continue" class="primary-btn" type="button">Continuar para o TrainingPeaks</button><button class="text-btn" type="button" data-back="3">Voltar</button></div>`;
    document.querySelector('#trial-continue').addEventListener('click', () => updateProfile({ onboarding_step: 5 }));
    bindBackButtons();
  }

  function showEfiReturnChoices(paymentUrl = '') {
    const options = document.querySelector('#efi-return');
    const firstAccess = document.querySelector('#efi-first-access');
    if (!options || !firstAccess) return;
    firstAccess.classList.add('hidden');
    options.classList.remove('hidden');
    const initialStatus = document.querySelector('#billing-initial-status');
    if (initialStatus) initialStatus.textContent = '';
    const status = document.querySelector('#billing-status');
    if (status) status.textContent = '';
    if (status && paymentUrl) {
      status.className = 'status';
      status.innerHTML = '<a target="_blank" rel="noopener noreferrer" href="' +
        escapeAttr(paymentUrl) + '">Abrir a Efí novamente</a>';
    }
  }

  function validEfiLink(urlString) {
    try {
      const url = new URL(urlString);
      const hosts = ['pagamento.gerencianet.com.br', 'pagamento-h.gerencianet.com.br',
        'pagamento.efipay.com.br', 'pagamento-h.efipay.com.br', 'pagamento.sejaefi.com.br',
        'pagamento-h.sejaefi.com.br'];
      return url.protocol === 'https:' && !url.username && !url.password && !url.port &&
        hosts.includes(url.hostname) ? url.href : '';
    } catch { return ''; }
  }
  function digits(value) { return String(value || '').replace(/\D/g,''); }

  async function loadExistingCheckout({ preparePlans = true } = {}) {
    const root = document.querySelector('#efi-first-access');
    const userId = session?.user.id;
    const profileId = profile?.id;
    if (!root || !userId || !profileId) return true;
    try {
      // Read through the authenticated client and the existing read-own RLS policy.
      const { data,error } = await client.from('billing_subscriptions')
        .select('payment_url,payment_expires_at,efi_subscription_id,creation_state,checkout_kind,trial_ends_on,first_charge_on,environment,status')
        .eq('athlete_profile_id',profileId).eq('environment','homologation')
        .in('status',['pending','active','past_due'])
        .order('created_at',{ascending:false}).limit(1);
      if (error) throw error;
      if (!root.isConnected || session?.user.id !== userId || profile?.id !== profileId) return true;
      const existing = data?.[0];
      if (!existing && profile.payment_status !== 'confirmed') {
        if (preparePlans) await loadBillingPlans();
        return false;
      }
      const created = Boolean(existing?.efi_subscription_id || existing?.creation_state === 'ready' ||
        ['active','past_due'].includes(existing?.status));
      const url = existing?.creation_state === 'ready' &&
        existing.payment_expires_at >= new Date().toISOString().slice(0,10) ?
        validEfiLink(existing.payment_url) : '';
      showEfiReturnChoices(url);
      document.querySelector('#efi-return .lead').textContent = 'Situação do seu cadastro financeiro';
      const status = document.querySelector('#billing-status');
      const hostedTrialWaiting = existing?.checkout_kind === 'card_hosted_trial' && existing?.creation_state === 'scheduled';
      const message = profile.payment_status === 'confirmed' ? 'Pagamento confirmado pela Rio Saúde.' :
        hostedTrialWaiting ? `Sua experiência gratuita está registrada até ${String(existing.trial_ends_on || '').split('-').reverse().join('/')}. No 25º dia, o checkout oficial da Efí será enviado pelo WhatsApp caso você tenha autorizado esse contato. A Efí poderá cobrar quando o cartão for cadastrado.` :
        created ? 'Assinatura já criada na Efí. Isso não confirma o pagamento. Você pode continuar sem criar outra assinatura.' :
        'Já existe uma solicitação em processamento ou conferência. Nenhuma nova assinatura será criada. Você pode seguir para o TrainingPeaks enquanto aguarda.';
      status.insertAdjacentHTML('afterbegin','<p>' + escapeHtml(message) + '</p>');
      const done = document.querySelector('#efi-done');
      done.disabled = !created && profile.payment_status !== 'confirmed';
      done.textContent = 'Continuar para o TrainingPeaks';
      return true;
    } catch(err) {
      console.warn('Não foi possível consultar a assinatura existente da Efí',err);
      if (!root.isConnected || session?.user.id !== userId) return true;
      showEfiReturnChoices();
      document.querySelector('#efi-done').disabled = true;
      document.querySelector('#billing-status').textContent =
        'Não foi possível verificar sua assinatura. Recarregue para tentar novamente ou siga para o TrainingPeaks. Nenhuma cobrança foi iniciada.';
      return true;
    }
  }

  function isUnder26(birthDate, today = new Date()) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(birthDate || '')) return false;
    const [year,month,day] = birthDate.split('-').map(Number);
    const age = today.getFullYear() - year -
      (today.getMonth() + 1 < month || (today.getMonth() + 1 === month && today.getDate() < day) ? 1 : 0);
    return age >= 0 && age < 26;
  }

  function pricingForProfile(athlete) {
    const discountedSingle = ['Barra','Aterro','Online'].includes(athlete.base_preference) ||
      isUnder26(athlete.birth_date);
    // Modalidades praticadas não determinam a contratação. A opção 2+ é o plano multiesporte.
    const studentMulti = isUnder26(athlete.birth_date);
    return [
      {code:discountedSingle ? 'single_290_monthly' : 'single_monthly',
       label:'1 modalidade',price:discountedSingle ? 29000 : 39000},
      {code:studentMulti ? 'multi_tri_u26_monthly' : 'multi_monthly',
       label:'2 ou mais modalidades',price:studentMulti ? 39000 : 49000}
    ];
  }

  async function loadBillingPlans() {
    const root = document.querySelector('#billing-plans');
    const checkout = document.querySelector('#billing-checkout');
    const options = pricingForProfile(profile);
    const money = amount => new Intl.NumberFormat('pt-BR',
      {style:'currency',currency:'BRL'}).format(amount / 100);
    checkout.disabled = true;
    try {
      const codes = ['single_monthly','single_290_monthly','multi_monthly','multi_tri_u26_monthly'];
      const { data,error } = await client.from('billing_plans')
        .select('code,name,price_cents,currency,active').eq('active',true).in('code',codes);
      if (error) throw error;
      if (!root.isConnected) return;
      const available = new Map((data || []).map(plan => [plan.code,plan]));
      root.innerHTML = options.map(opt => {
        const plan = available.get(opt.code);
        const ready = Boolean(plan && plan.active && plan.currency === 'BRL' &&
          plan.price_cents === opt.price);
        return `<label class="goal-option"><input type="radio" name="plan_code"
          value="${escapeAttr(opt.code)}" ${ready ? '' : 'disabled'}>
          <span>${escapeHtml(opt.label)} · ${escapeHtml(money(opt.price))}/mês${ready ? '' : ' · Em configuração'}</span></label>`;
      }).join('');
      root.querySelectorAll('input[name="plan_code"]').forEach(input => {
        input.addEventListener('change', () => { checkout.disabled = !root.querySelector('input[name="plan_code"]:checked'); });
      });
      const anyReady = options.some(opt => {
        const plan = available.get(opt.code);
        return plan && plan.active && plan.currency === 'BRL' && plan.price_cents === opt.price;
      });
      if (!anyReady) {
        const status = document.querySelector('#billing-initial-status');
        if (status) status.textContent = 'Esses planos ainda estão sendo configurados na Efí. Nenhuma cobrança será iniciada.';
      }
    } catch(error) {
      if (root.isConnected) root.textContent = 'Não foi possível carregar os planos. Tente novamente.';
      console.error('Falha ao carregar planos',error);
    }
  }

  async function efiBilling(body) {
    const { data,error } = await client.functions.invoke('efi-billing',{body});
    if (!error) return data;
    let result; try { result = await error.context?.json(); } catch { /* handled below */ }
    throw new Error(result?.error || 'billing_unavailable');
  }

  async function startCheckout(event) {
    event.preventDefault();
    const formElement = event.currentTarget;
    if (checkoutBusy || saving || !session?.user || !(formElement instanceof HTMLFormElement)) return;
    const formData = new FormData(formElement);
    const planCode = formData.get('plan_code');
    if (!planCode) return;
    const userId = session.user.id;
    const status = document.querySelector('#billing-initial-status');
    checkoutBusy = true;
    stepRoot.querySelectorAll('button').forEach(button => { button.disabled = true; });
    logoutButton.disabled = true;
    status.className = 'status';
    status.textContent = 'Preparando seu cadastro na Efí...';
    try {
      // Recheck before creation, including a subscription made in another tab.
      if (await loadExistingCheckout({preparePlans:false})) {
        return;
      }
      // Event.currentTarget is only set while the listener is running. Keep the
      // form snapshot above because the duplicate-check await has already run.
      const form = Object.fromEntries(formData);
      const paymentMethod = form.payment_method === 'boleto' ? 'boleto' : 'card';
      const billing_address = {
        street:String(form.billing_street||'').trim(), number:String(form.billing_number||'').trim(),
        complement:String(form.billing_complement||'').trim(), neighborhood:String(form.billing_neighborhood||'').trim(),
        city:String(form.billing_city||'').trim(), state:String(form.billing_state||'').replace(/[^a-z]/gi,'').toUpperCase(),
        zipcode:String(form.billing_zipcode||'').replace(/\D/g,'')
      };
      if (paymentMethod === 'boleto' && (!billing_address.street || !billing_address.number || !billing_address.neighborhood || !billing_address.city || !/^[A-Z]{2}$/.test(billing_address.state) || !/^\d{8}$/.test(billing_address.zipcode))) throw new Error('billing_address_invalid');
      const offer = requestedOffer;
      const data = await efiBilling({action:paymentMethod === 'boleto' ? 'boleto' : 'card_hosted',plan_code:planCode,offer,billing_address:paymentMethod === 'boleto' ? billing_address : undefined});
      if (session?.user.id !== userId) return;
      showEfiReturnChoices();
      const end=data?.trial_ends_on ? String(data.trial_ends_on).split('-').reverse().join('/') : '';
      document.querySelector('#billing-status').textContent = paymentMethod === 'boleto'
        ? `Experiência registrada${end ? ` até ${end}` : ''}. O boleto não foi emitido agora; a emissão é programada para o 20º dia.`
        : data?.checkout_deferred
          ? `Experiência registrada${end ? ` até ${end}` : ''}. No 25º dia, enviaremos o checkout oficial da Efí pelo WhatsApp se você autorizou o contato. A Efí poderá cobrar quando o cartão for cadastrado; nenhum cartão foi solicitado agora.`
          : 'O checkout oficial da Efí está disponível em “Minha assinatura”. O pagamento só será confirmado após a notificação da Efí.';
    } catch (error) {
      if (['subscription_exists','existing_subscription_other_plan','checkout_in_progress','checkout_requires_review'].includes(error.message)) {
        await loadExistingCheckout({preparePlans:false});
      }
      const messages = {
        profile_missing:'Complete seus dados pessoais antes de cadastrar o pagamento.',
        profile_incomplete:'Confira nome, sobrenome, CPF e data de nascimento em “Voltar” antes de continuar.',
        authentication_required:'Sua sessão expirou. Recarregue a página para entrar novamente.',
        checkout_in_progress:'Seu pagamento está sendo preparado. Aguarde e tente novamente.',
        checkout_requires_review:'Esta solicitação precisa ser conferida pela equipe. Uma nova assinatura não será criada.',
        existing_subscription_other_plan:'Você já tem uma assinatura ou pagamento pendente em outro plano. Fale com a equipe para trocar.',
        subscription_exists:'Você já possui uma assinatura. Fale com a equipe para alterar seu plano.',
        homologation_only:'O cadastro de pagamento está disponível somente em homologação.',
        plan_unavailable:'Este plano não está disponível no momento.'
        ,trial_not_available:'A experiência gratuita já foi utilizada. Você pode contratar sem gratuidade com a equipe.'
        ,billing_address_required:'Preencha o endereço de cobrança.'
        ,billing_address_invalid:'Confira o endereço de cobrança: informe rua, número, bairro, cidade, UF com duas letras e CEP com oito números.'
        ,efi_checkout_link_failed:'Não foi possível preparar o checkout oficial da Efí. Nenhuma cobrança foi confirmada.'
        ,billing_unavailable:'A Efí não respondeu agora. Nenhuma cobrança foi criada; aguarde um momento antes de tentar novamente.'
      };
      if (status.isConnected) {
        status.className = 'status error';
        status.textContent = messages[error.message] ||
          'Não foi possível preparar o cadastro na Efí. Tente novamente, sem repetir várias vezes.';
      }
    } finally {
      checkoutBusy = false;
      logoutButton.disabled = false;
      if (status.isConnected) {
        stepRoot.querySelectorAll('button').forEach(button => { button.disabled = false; });
        await loadExistingCheckout({preparePlans:false});
      }
    }
  }

  function renderTrainingPeaks() {
    const brands = ['Garmin', 'COROS', 'Apple Watch', 'Polar', 'Suunto', 'Amazfit', 'Outro', 'Não uso'];
    const storedBrand = profile.watch_brand === 'Coros' ? 'COROS' : profile.watch_brand;
    if (storedBrand && !brands.includes(storedBrand)) brands.push(storedBrand);
    stepRoot.innerHTML = `
      <div class="step-kicker">5 de 5 · TrainingPeaks e relógio</div>
      <h2>Deixe seus treinos conectados.</h2>
      <p class="lead">Você pode fazer essas conexões agora ou terminar depois.</p>
      <form id="tp-form" class="grid">
        <fieldset class="choice-fieldset field full"><legend>Você já tem uma conta no TrainingPeaks?</legend><div class="goal-options">
          <label class="goal-option"><input name="tp_account" type="radio" value="yes" ${profile.trainingpeaks_status === 'completed' ? 'checked' : ''}><span>Já tenho</span></label>
          <label class="goal-option"><input name="tp_account" type="radio" value="no"><span>Ainda não tenho</span></label></div></fieldset>
        <div id="tp-downloads" class="field full hidden"><p>Baixe o aplicativo e crie sua conta.</p><div class="actions">
          <a class="secondary-btn" href="https://apps.apple.com/br/app/trainingpeaks/id408047715" target="_blank" rel="noopener">iOS</a>
          <a class="secondary-btn" href="https://play.google.com/store/apps/details?id=com.peaksware.trainingpeaks" target="_blank" rel="noopener">Android</a></div></div>
        <div class="field full"><a class="primary-btn" href="https://home.trainingpeaks.com/attachtocoach?sharedKey=KMVXW2DT3WGPG" target="_blank" rel="noopener">Conectar à Rio Saúde</a><p class="field-help">Entre com a mesma conta criada no TrainingPeaks.</p></div>
        <div class="field full"><label for="watch_brand">Relógio</label><select id="watch_brand" name="watch_brand"><option value="">Selecione</option>${brands.map(brand => option(brand, brand, storedBrand)).join('')}</select></div>
        <div id="watch-guide" class="notice field full hidden" aria-live="polite"></div>
        <div id="watch-connection" class="field full"><label class="check"><input id="watch_connected" name="watch_connected" type="checkbox" ${profile.watch_connected ? 'checked' : ''}>Meu relógio já está conectado</label></div>
        <div class="actions field full"><button class="primary-btn" type="submit" name="tp_action" value="completed">Tudo pronto</button><button class="secondary-btn" type="submit" name="tp_action" value="pending">Terminar depois</button><button class="text-btn" type="button" data-back="4">Voltar</button></div>
      </form>`;

    document.querySelector('#tp-form').addEventListener('submit', saveTrainingPeaks);
    document.querySelectorAll('[name="tp_account"]').forEach(input => input.addEventListener('change', () => {
      document.querySelector('#tp-downloads').classList.toggle('hidden', input.value !== 'no');
    }));
    document.querySelector('#watch_brand').addEventListener('change', showWatchGuide);
    showWatchGuide();
    bindBackButtons();
  }

  function showWatchGuide() {
    const brand = document.querySelector('#watch_brand').value;
    const guides = {
      Garmin: '<a href="https://www.trainingpeaks.com/account/garminconnect" target="_blank" rel="noopener">Conectar Garmin ao TrainingPeaks</a>',
      Polar: '<a href="https://flow.polar.com/settings" target="_blank" rel="noopener">Abrir configurações do Polar Flow</a> e conectar sua conta TrainingPeaks.',
      COROS: 'No app COROS: Perfil → Configurações → Apps de terceiros → Sincronização de dados → TrainingPeaks.',
      'Apple Watch': 'No TrainingPeaks: More → App Connections → Connect Apple Health and Workout App.',
      Amazfit: 'No Zepp: Profile → 3rd-Party Account Linking → TrainingPeaks. A disponibilidade depende do modelo e da versão do aplicativo.',
      Suunto: 'No aplicativo Suunto: Perfil → Serviços parceiros → TrainingPeaks. Entre na sua conta para autorizar a conexão. <a href="https://help.trainingpeaks.com/hc/en-us/articles/204069974-How-do-I-sync-my-Suunto-with-TrainingPeaks" target="_blank" rel="noopener">Ver orientação oficial</a>.',
      Outro: 'Você pode consultar a compatibilidade do seu relógio depois. Isso não impede a conclusão do cadastro.',
      'Não uso': 'Você pode acompanhar os treinos no TrainingPeaks sem conectar um relógio.'
    };
    const guide = document.querySelector('#watch-guide');
    guide.innerHTML = guides[brand] || '';
    guide.classList.toggle('hidden', !guides[brand]);
    document.querySelector('#watch-connection').classList.toggle('hidden', !brand || brand === 'Não uso');
  }

  async function saveTrainingPeaks(event) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const needsPayment = !trialAccess && (profile.payment_followup_needed ||
      (profile.payment_status !== 'submitted' && profile.payment_status !== 'confirmed'));
    const canFinishWithFinancialFollowup = isHomologationPreview &&
      profile.payment_status === 'pending' && profile.payment_followup_needed;
    const mayComplete = !needsPayment || canFinishWithFinancialFollowup;
    await updateProfile({
      watch_brand:clean(form.get('watch_brand')) || null,
      watch_connected:form.get('watch_brand') && form.get('watch_brand') !== 'Não uso' &&
        form.get('watch_connected') === 'on' ? true : false,
      trainingpeaks_step_seen:true,
      trainingpeaks_status:event.submitter?.value === 'completed' ? 'completed' :
        (profile.trainingpeaks_status || 'pending'),
      onboarding_step:mayComplete ? 5 : 4,
      ...(mayComplete ? { onboarding_completed_at: profile.onboarding_completed_at || new Date().toISOString() } : {})
    }, {finishEdit:editing && mayComplete});
  }

  function renderDashboard() {
    const firstName = profile.first_name ? escapeHtml(profile.first_name) : '';
    const numRaces = Array.isArray(profile.goal_events) ? profile.goal_events.length : 0;
    const raceSummary = numRaces ? `Você adicionou ${numRaces} ${numRaces === 1 ? 'prova' : 'provas'} ao seu perfil.` : '';
    stepRoot.innerHTML = `
      <div class="step-kicker">${updated ? 'Informações atualizadas' : 'Cadastro concluído'}</div>
      <h2>${firstName ? 'Pronto, ' + firstName + '.' : 'Cadastro salvo.'}</h2>
      <p class="lead">Seus dados estão salvos na Rio Saúde. A equipe poderá consultar suas informações e acompanhar seu início nos treinos.</p>
      ${raceSummary ? `<p class="field-help">${escapeHtml(raceSummary)}</p>` : ''}
      <p class="field-help">${trialAccess ? 'Seu período experimental está registrado. A contratação poderá ser feita com este mesmo cadastro.' : 'O cadastro na Efí não é confirmação de pagamento. A situação financeira será verificada separadamente.'}</p>
      <div class="actions">
        <a class="primary-btn" href="index.html">Voltar ao portal</a>
        <button id="edit-profile" class="secondary-btn" type="button">Editar minhas informações</button>
        <button id="open-parq" class="secondary-btn" type="button">Saúde e segurança (PAR-Q)</button>
      </div>`;
    document.querySelector('#edit-profile').addEventListener('click', () => {
      parqOnlyMode=false; editing=true; editStep=1; updated=false; render();
    });
    document.querySelector('#open-parq').addEventListener('click',()=>{
      parqOnlyMode=true;editing=true;editStep=3;updated=false;render();
    });
  }

  function bindDatePickers() {
    stepRoot.querySelectorAll('input[type="date"]').forEach(input => {
      input.lang = 'pt-BR';
      input.addEventListener('click', () => {
        try { input.showPicker?.(); } catch (_) { /* Native input remains editable. */ }
      });
    });
  }

  async function updateProfile(values, { finishEdit = false } = {}) {
    if (saving || !session?.user) return;
    saving = true;
    const nextStep = values.onboarding_step;
    const payload = { ...values };
    if (editing) delete payload.onboarding_step;
    const userId = session.user.id;
    stepRoot.querySelectorAll('button').forEach(button => { button.disabled = true; });
    appStatus.className = 'status';
    appStatus.textContent = 'Salvando...';
    try {
      const { data, error } = await client
      .from('athlete_profiles')
      .update(payload)
      .eq('user_id', userId)
      .select('*')
      .single();

      if (error) throw error;
      if (session?.user.id !== userId) return;
      profile = data;
      if (editing && nextStep) editStep = nextStep;
      if (finishEdit) { editing = false; updated = true; }
      render();
    } catch (error) {
      if (session?.user.id === userId) showAppError(error);
    } finally {
      saving = false;
      stepRoot.querySelectorAll('button').forEach(button => { button.disabled = false; });
      // Plan loading controls checkout availability independently of profile saves.
      if (document.querySelector('#billing-plans') && !document.querySelector('[name="plan_code"]')) document.querySelector('#billing-checkout').disabled = true;
    }
  }

  function bindBackButtons() {
    document.querySelectorAll('[data-back]').forEach((button) => {
      button.addEventListener('click', async () => {
        const step = Number(button.dataset.back || 1);
        if (editing) {
          editStep = step;
          render();
        } else {
          await updateProfile({ onboarding_step: step });
        }
      });
    });
  }

  async function logout() {
    const { error } = await client.auth.signOut();
    if (error) { showAppError(error); return; }
    history.replaceState(null, '', location.pathname + (requestedOffer === 'standard' ? '?offer=standard' : ''));
    showLogin();
  }

  function showLogin() {
    document.querySelector('.hero')?.classList.remove('hidden');
    progressRoot.classList.remove('hidden');
    session = null;
    profile = null;
    trialAccess = null;
    editing = false;
    updated = false;
    parqOnlyMode = false;
    editStep = 1;
    stepRoot.innerHTML = '';
    document.querySelector('#login-email').value = '';
    resetCodeForm();
    loginView.classList.remove('hidden');
    appView.classList.add('hidden');
    logoutButton.classList.add('hidden');
  }

  function showLoginError(message) {
    loginStatus.className = 'status error';
    loginStatus.textContent = message;
  }

  function showAppError(error) {
    console.error(error);
    appStatus.className = 'status error';
    appStatus.textContent = 'Não foi possível salvar. Tente novamente.';
  }

  function clean(valueInput) {
    return String(valueInput || '').trim();
  }

  function formatCpf(input) {
    return String(input || '').replace(/\D/g, '').slice(0, 11)
      .replace(/^(\d{3})(\d)/, '$1.$2').replace(/^(\d{3}\.\d{3})(\d)/, '$1.$2')
      .replace(/^(\d{3}\.\d{3}\.\d{3})(\d)/, '$1-$2');
  }

  function validCpf(cpf) {
    if (!/^\d{11}$/.test(cpf) || /^(\d)\1{10}$/.test(cpf)) return false;
    for (let size = 9; size <= 10; size++) {
      let sum = 0;
      for (let i = 0; i < size; i++) sum += Number(cpf[i]) * (size + 1 - i);
      const digit = (sum * 10) % 11 % 10;
      if (digit !== Number(cpf[size])) return false;
    }
    return true;
  }

  function value(input) {
    return escapeAttr(input == null ? '' : String(input));
  }

  function option(optionValue, label, current) {
    const selected = String(current || '') === optionValue ? ' selected' : '';
    return `<option value="${escapeAttr(optionValue)}"${selected}>${escapeHtml(label)}</option>`;
  }

  function paymentLabel(status) {
    if (status === 'confirmed') return 'confirmado';
    if (status === 'submitted') return 'enviado para conferência';
    return 'pendente';
  }

  function escapeHtml(input) {
    return String(input || '')
      .replaceAll('&','&amp;')
      .replaceAll('<','&lt;')
      .replaceAll('>','&gt;')
      .replaceAll('"','&quot;')
      .replaceAll("'",'&#039;');
  }

  function escapeAttr(input) {
    return escapeHtml(input);
  }
})();

