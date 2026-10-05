(() => {
  const config = window.RIO_SAUDE_CONFIG || {};
  const ready = Boolean(config.supabaseUrl && config.supabaseAnonKey && window.supabase);

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

  const client = window.supabase.createClient(config.supabaseUrl, config.supabaseAnonKey);
  let session = null;
  let profile = null;
  let pendingEmail = '';
  let authBusy = false;
  let resendAt = 0;
  let resendTimer = null;
  let authenticatedBoot = null;

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
    loginView.classList.add('hidden');
    appView.classList.remove('hidden');
    logoutButton.classList.remove('hidden');
    render();
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

    if (createError) throw createError;
    profile = created;
  }

  function render() {
    appStatus.textContent = '';
    appStatus.className = 'status';

    if (profile.onboarding_completed_at) {
      renderProgress(5);
      renderDashboard();
      return;
    }

    const step = Math.min(Math.max(Number(profile.onboarding_step || 1), 1), 5);
    renderProgress(step);
    if (step === 1) renderPersonal();
    if (step === 2) renderSport();
    if (step === 3) renderPayment();
    if (step === 4) renderTrainingPeaks();
    if (step === 5) renderWhatsApp();
  }

  function renderProgress(step) {
    progressRoot.innerHTML = '';
    for (let i = 1; i <= 5; i += 1) {
      const item = document.createElement('span');
      if (i <= step) item.classList.add('active');
      progressRoot.appendChild(item);
    }
  }

  function renderPersonal() {
    stepRoot.innerHTML = `
      <div class="step-kicker">1 de 5 · Seus dados</div>
      <h2>Começando pelo básico.</h2>
      <p class="lead">Esses dados identificam seu cadastro na Rio Saúde. O e-mail é a chave da sua conta.</p>
      <span class="email-pill">${escapeHtml(profile.email)}</span>
      <form id="personal-form" class="grid" style="margin-top:20px">
        <div class="field"><label for="first_name">Nome</label><input id="first_name" name="first_name" value="${value(profile.first_name)}" autocomplete="given-name" required></div>
        <div class="field"><label for="last_name">Sobrenome</label><input id="last_name" name="last_name" value="${value(profile.last_name)}" autocomplete="family-name" required></div>
        <div class="field"><label for="whatsapp">WhatsApp</label><input id="whatsapp" name="whatsapp" value="${value(profile.whatsapp)}" autocomplete="tel" placeholder="(21) 99999-9999" required></div>
        <div class="field"><label for="birth_date">Data de nascimento</label><input id="birth_date" name="birth_date" type="date" value="${value(profile.birth_date)}" required></div>
        <div class="field full"><label for="city">Cidade</label><input id="city" name="city" value="${value(profile.city)}" autocomplete="address-level2" placeholder="Rio de Janeiro" required></div>
        <div class="actions field full"><button class="primary-btn" type="submit">Continuar</button></div>
      </form>`;
    document.querySelector('#personal-form').addEventListener('submit', savePersonal);
  }

  async function savePersonal(event) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    await updateProfile({
      first_name: clean(form.get('first_name')),
      last_name: clean(form.get('last_name')),
      whatsapp: clean(form.get('whatsapp')),
      birth_date: clean(form.get('birth_date')),
      city: clean(form.get('city')),
      onboarding_step: 2
    });
  }

  function renderSport() {
    const selected = new Set(Array.isArray(profile.modalities) ? profile.modalities : []);
    const modal = [
      ['corrida','Corrida'],
      ['triathlon','Triathlon'],
      ['trail','Trail run'],
      ['natacao','Natação'],
      ['ciclismo','Ciclismo']
    ];
    const checks = modal.map(([key,label]) => `
      <label class="check"><input type="checkbox" name="modalities" value="${key}" ${selected.has(key) ? 'checked' : ''}>${label}</label>`).join('');

    stepRoot.innerHTML = `
      <div class="step-kicker">2 de 5 · Perfil esportivo</div>
      <h2>Onde você está e onde quer chegar.</h2>
      <p class="lead">Isso funciona como nossa avaliação inicial para direcionar seu começo e definir quem acompanha sua entrada.</p>
      <form id="sport-form" class="grid">
        <div class="field full"><label>Modalidades</label><div class="checks">${checks}</div></div>
        <div class="field"><label for="running_experience">Há quanto tempo você treina/corre?</label><input id="running_experience" name="running_experience" value="${value(profile.running_experience)}" placeholder="Ex.: 2 anos"></div>
        <div class="field"><label for="current_level">Como você define seu nível atual?</label><select id="current_level" name="current_level"><option value="">Selecione</option>${option('iniciante','Iniciante',profile.current_level)}${option('intermediario','Intermediário',profile.current_level)}${option('avancado','Avançado',profile.current_level)}</select></div>
        <div class="field"><label for="training_days_current">Quantos dias por semana você treina hoje?</label><input id="training_days_current" name="training_days_current" value="${value(profile.training_days_current)}" placeholder="Ex.: 4 dias"></div>
        <div class="field"><label for="training_days_available">Quantos dias você tem disponíveis?</label><input id="training_days_available" name="training_days_available" value="${value(profile.training_days_available)}" placeholder="Ex.: 5 dias"></div>
        <div class="field full"><label for="base_preference">Onde você costuma ou prefere treinar?</label><input id="base_preference" name="base_preference" value="${value(profile.base_preference)}" placeholder="Ex.: Lagoa, Aterro, Ipanema"></div>
        <div class="field full"><label for="primary_goal">Qual é seu principal objetivo agora?</label><textarea id="primary_goal" name="primary_goal" placeholder="Conte de forma simples o que você quer buscar nos próximos meses.">${value(profile.primary_goal)}</textarea></div>
        <div class="field"><label for="goal_event_name">Já tem alguma prova marcada?</label><input id="goal_event_name" name="goal_event_name" value="${value(profile.goal_event_name)}" placeholder="Nome da prova"></div>
        <div class="field"><label for="goal_event_date">Data da prova</label><input id="goal_event_date" name="goal_event_date" type="date" value="${value(profile.goal_event_date)}"></div>
        <div class="actions field full"><button class="secondary-btn" type="button" data-back="1">Voltar</button><button class="primary-btn" type="submit">Continuar</button></div>
      </form>`;

    document.querySelector('#sport-form').addEventListener('submit', saveSport);
    bindBackButtons();
  }

  async function saveSport(event) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const modalities = form.getAll('modalities').map(String);
    const eventName = clean(form.get('goal_event_name'));
    const eventDate = clean(form.get('goal_event_date'));
    const coach = eventName || eventDate ? 'Dum' : 'Pedrinho';

    await updateProfile({
      modalities,
      running_experience: clean(form.get('running_experience')),
      current_level: clean(form.get('current_level')),
      training_days_current: clean(form.get('training_days_current')),
      training_days_available: clean(form.get('training_days_available')),
      base_preference: clean(form.get('base_preference')),
      primary_goal: clean(form.get('primary_goal')),
      goal_event_name: eventName || null,
      goal_event_date: eventDate || null,
      coach,
      onboarding_step: 3
    });
  }

  function renderPayment() {
    const efiLink = String(config.efiPaymentUrl || '').trim();
    const paymentAction = efiLink
      ? `<a class="primary-btn" href="${escapeAttr(efiLink)}" target="_blank" rel="noopener">Abrir cadastro no EFI</a>`
      : '';

    stepRoot.innerHTML = `
      <div class="step-kicker">3 de 5 · Financeiro</div>
      <h2>Cadastro de pagamento.</h2>
      <p class="lead">Por enquanto essa etapa fica no EFI. O portal só registra o andamento para a equipe conseguir acompanhar seu onboarding.</p>
      <div class="notice"><strong>Importante:</strong> o pagamento não vai travar seu primeiro acesso. Se o cadastro financeiro ainda estiver sendo resolvido, você pode continuar.</div>
      ${paymentAction}
      <div class="actions">
        <button class="secondary-btn" type="button" data-back="2">Voltar</button>
        <button id="payment-pending" class="secondary-btn" type="button">Continuar por enquanto</button>
        <button id="payment-done" class="primary-btn" type="button">Já fiz essa etapa</button>
      </div>`;

    document.querySelector('#payment-pending').addEventListener('click', () => updateProfile({ payment_status: 'pending', onboarding_step: 4 }));
    document.querySelector('#payment-done').addEventListener('click', () => updateProfile({ payment_status: 'submitted', onboarding_step: 4 }));
    bindBackButtons();
  }

  function renderTrainingPeaks() {
    stepRoot.innerHTML = `
      <div class="step-kicker">4 de 5 · TrainingPeaks</div>
      <h2>Deixe seus treinos conectados.</h2>
      <p class="lead">Baixe o TrainingPeaks, aceite a Rio Saúde como treinador e conecte seu relógio para que os treinos e atividades fiquem no mesmo lugar.</p>
      <div class="success-box"><strong>Checklist:</strong><br>1. TrainingPeaks instalado<br>2. Convite da Rio Saúde aceito<br>3. Relógio conectado, se você usa um</div>
      <form id="tp-form" class="grid">
        <div class="field"><label for="watch_brand">Relógio</label><select id="watch_brand" name="watch_brand"><option value="">Selecione</option>${option('Garmin','Garmin',profile.watch_brand)}${option('Coros','Coros',profile.watch_brand)}${option('Apple Watch','Apple Watch',profile.watch_brand)}${option('Outro','Outro',profile.watch_brand)}${option('Não uso','Não uso',profile.watch_brand)}</select></div>
        <div class="field"><label for="watch_connected">Conexão</label><label class="check"><input id="watch_connected" name="watch_connected" type="checkbox" ${profile.watch_connected ? 'checked' : ''}>Meu relógio já está conectado</label></div>
        <div class="actions field full"><button class="secondary-btn" type="button" data-back="3">Voltar</button><button class="primary-btn" type="submit">Já concluí no TrainingPeaks</button></div>
      </form>`;

    document.querySelector('#tp-form').addEventListener('submit', saveTrainingPeaks);
    bindBackButtons();
  }

  async function saveTrainingPeaks(event) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    await updateProfile({
      watch_brand: clean(form.get('watch_brand')) || null,
      watch_connected: form.get('watch_connected') === 'on',
      trainingpeaks_status: 'completed',
      onboarding_step: 5
    });
  }

  function renderWhatsApp() {
    const whatsappLink = String(config.whatsappGroupUrl || '').trim();
    const linkButton = whatsappLink
      ? `<a class="primary-btn" href="${escapeAttr(whatsappLink)}" target="_blank" rel="noopener">Entrar no grupo da Rio Saúde</a>`
      : '';

    stepRoot.innerHTML = `
      <div class="step-kicker">5 de 5 · Finalização</div>
      <h2>Último passo.</h2>
      <p class="lead">Depois do cadastro e do TrainingPeaks, falta só entrar no canal de comunicação da Rio Saúde.</p>
      ${linkButton}
      ${whatsappLink ? '' : '<div class="notice">O link do grupo ainda não está configurado neste portal. A equipe pode enviar esse acesso diretamente sem impedir a conclusão do seu cadastro.</div>'}
      <div class="actions">
        <button class="secondary-btn" type="button" data-back="4">Voltar</button>
        <button id="finish-onboarding" class="primary-btn" type="button">Concluir primeiro acesso</button>
      </div>`;

    document.querySelector('#finish-onboarding').addEventListener('click', finishOnboarding);
    bindBackButtons();
  }

  async function finishOnboarding() {
    await updateProfile({
      whatsapp_group_status: config.whatsappGroupUrl ? 'completed' : 'pending',
      onboarding_step: 5,
      onboarding_completed_at: new Date().toISOString()
    });
  }

  function renderDashboard() {
    stepRoot.innerHTML = `
      <div class="step-kicker">Cadastro concluído</div>
      <h2>${profile.first_name ? `Tudo certo, ${escapeHtml(profile.first_name)}.` : 'Tudo certo.'}</h2>
      <p class="lead">Seu primeiro acesso foi concluído. A partir daqui, esse e-mail fica ligado ao seu cadastro da Rio Saúde.</p>
      <div class="success-box"><strong>Responsável inicial:</strong> ${escapeHtml(profile.coach || 'Equipe Rio Saúde')}<br><strong>Financeiro:</strong> ${paymentLabel(profile.payment_status)}<br><strong>TrainingPeaks:</strong> ${profile.trainingpeaks_status === 'completed' ? 'concluído' : 'pendente'}</div>
      <div class="dashboard-grid">
        <a class="dashboard-card" href="index.html"><small>Provas</small><strong>Calendário de eventos</strong><span>Veja provas, marque interesse e avise o que vai competir.</span></a>
        <div class="dashboard-card"><small>Perfil</small><strong>Seus dados estão salvos</strong><span>Na próxima versão, essa área também poderá ser usada para editar o cadastro.</span></div>
      </div>`;
  }

  async function updateProfile(values) {
    appStatus.className = 'status';
    appStatus.textContent = 'Salvando...';

    const { data, error } = await client
      .from('athlete_profiles')
      .update(values)
      .eq('user_id', session.user.id)
      .select('*')
      .single();

    if (error) {
      console.error(error);
      showAppError(error);
      return;
    }

    profile = data;
    appStatus.textContent = '';
    render();
  }

  function bindBackButtons() {
    document.querySelectorAll('[data-back]').forEach((button) => {
      button.addEventListener('click', async () => {
        const step = Number(button.dataset.back || 1);
        await updateProfile({ onboarding_step: step });
      });
    });
  }

  async function logout() {
    await client.auth.signOut();
    showLogin();
  }

  function showLogin() {
    session = null;
    profile = null;
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
