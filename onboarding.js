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
    const params = new URLSearchParams(location.search);
    editing = Boolean(profile.onboarding_completed_at && params.get('edit') === '1');
    editStep = params.get('from') === 'provas' ? 5 : 1;
    if (params.get('from') === 'provas' && !profile.onboarding_completed_at && Number(profile.onboarding_step) === 4) {
      const { data, error } = await client.from('athlete_profiles').update({ onboarding_step: 5 })
        .eq('user_id', session.user.id).select('*').single();
      if (error) throw error;
      profile = data;
    }
    history.replaceState(null, '', location.pathname);
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

    if (profile.onboarding_completed_at && !editing) {
      renderProgress(6);
      renderDashboard();
      return;
    }

    const step = editing ? editStep : Math.min(Math.max(Number(profile.onboarding_step || 1), 1), 6);
    renderProgress(step);
    if (step === 1) renderPersonal();
    if (step === 2) renderSport();
    if (step === 3) renderPayment();
    if (step === 4) renderRaces();
    if (step === 5) renderTrainingPeaks();
    if (step === 6) renderWhatsApp();
  }

  function renderProgress(step) {
    progressRoot.innerHTML = '';
    for (let i = 1; i <= 6; i += 1) {
      const item = document.createElement('span');
      if (i <= step) item.classList.add('active');
      progressRoot.appendChild(item);
    }
  }

  function renderPersonal() {
    stepRoot.innerHTML = `
      <div class="step-kicker">${editing ? 'Editar cadastro · ' : ''}1 de 6 · Seus dados</div>
      <h2>Começando pelo básico.</h2>
      <p class="lead">Esses dados identificam seu cadastro na Rio Saúde. O e-mail é a chave da sua conta.</p>
      <span class="email-pill">${escapeHtml(profile.email)}</span>
      <form id="personal-form" class="grid" style="margin-top:20px">
        <div class="field"><label for="first_name">Nome</label><input id="first_name" name="first_name" value="${value(profile.first_name)}" autocomplete="given-name" required></div>
        <div class="field"><label for="last_name">Sobrenome</label><input id="last_name" name="last_name" value="${value(profile.last_name)}" autocomplete="family-name" required></div>
        <div class="field full"><label for="cpf">CPF (opcional)</label><input id="cpf" name="cpf" inputmode="numeric" maxlength="14" placeholder="000.000.000-00" value="${value(formatCpf(profile.cpf))}" aria-describedby="cpf-note"><p id="cpf-note" class="field-help">Seu e-mail continua sendo o login. O CPF será a referência para o cadastro financeiro.</p></div>
        <div class="field"><label for="whatsapp">WhatsApp</label><input id="whatsapp" name="whatsapp" value="${value(profile.whatsapp)}" autocomplete="tel" placeholder="(21) 99999-9999" required></div>
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
    if (cpf && !validCpf(cpf)) {
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
      birth_date: clean(form.get('birth_date')),
      city: clean(form.get('city')),
      onboarding_step: 2
    });
  }

  function renderSport() {
    const goals = ['Performance', 'Consistência', '5 km', '10 km', 'Meia maratona', 'Maratona', 'Triathlon', '70.3', 'Ironman', 'Trail', 'Voltar a treinar', 'Outro'];
    const savedGoal = String(profile.primary_goal || '');
    const quickGoal = goals.find(goal => savedGoal === goal || savedGoal.startsWith(goal + '\n')) || '';
    const goalDetails = quickGoal ? savedGoal.slice(quickGoal.length).replace(/^\n/, '') : savedGoal;
    const hasRace = Boolean(profile.goal_event_name || profile.goal_event_date || profile.coach === 'Dum');
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
      <div class="step-kicker">2 de 6 · Perfil esportivo</div>
      <h2>Onde você está e onde quer chegar.</h2>
      <p class="lead">Isso funciona como nossa avaliação inicial para direcionar seu começo e definir quem acompanha sua entrada.</p>
      <form id="sport-form" class="grid">
        <div class="field full"><label>Modalidades</label><div class="checks">${checks}</div></div>
        <div class="field"><label for="running_experience">Há quanto tempo você treina/corre?</label><input id="running_experience" name="running_experience" value="${value(profile.running_experience)}" placeholder="Ex.: 2 anos"></div>
        <div class="field"><label for="current_level">Como você define seu nível atual?</label><select id="current_level" name="current_level"><option value="">Selecione</option>${option('iniciante','Iniciante',profile.current_level)}${option('intermediario','Intermediário',profile.current_level)}${option('avancado','Avançado',profile.current_level)}</select></div>
        <div class="field"><label for="training_days_current">Quantos dias por semana você treina hoje?</label><input id="training_days_current" name="training_days_current" value="${value(profile.training_days_current)}" placeholder="Ex.: 4 dias"></div>
        <div class="field"><label for="training_days_available">Quantos dias você tem disponíveis?</label><input id="training_days_available" name="training_days_available" value="${value(profile.training_days_available)}" placeholder="Ex.: 5 dias"></div>
        <div class="field full"><label for="base_preference">Onde você costuma ou prefere treinar?</label><input id="base_preference" name="base_preference" value="${value(profile.base_preference)}" placeholder="Ex.: Lagoa, Aterro, Ipanema"></div>
        <fieldset class="field full choice-fieldset"><legend>Qual é seu principal objetivo agora?</legend><div class="goal-options">${goals.map(goal => `<label class="goal-option"><input type="radio" name="quick_goal" value="${escapeAttr(goal)}" ${quickGoal === goal ? 'checked' : ''}><span>${escapeHtml(goal)}</span></label>`).join('')}</div></fieldset>
        <div class="field full"><label for="primary_goal">Conte mais sobre seu objetivo (opcional)</label><textarea id="primary_goal" name="primary_goal" placeholder="Ex.: Quero correr minha primeira maratona em 2027 abaixo de 4h.">${value(goalDetails)}</textarea></div>
        <fieldset class="field full choice-fieldset"><legend>Você já tem uma prova marcada?</legend><div class="goal-options"><label class="goal-option"><input type="radio" name="has_race" value="yes" ${hasRace ? 'checked' : ''}><span>Sim</span></label><label class="goal-option"><input type="radio" name="has_race" value="no" ${hasRace ? '' : 'checked'}><span>Ainda não</span></label></div></fieldset>
        <div id="race-choice" class="field full ${hasRace ? '' : 'hidden'}">
          ${profile.goal_event_name ? `<p class="field-help">Prova já cadastrada: ${escapeHtml(profile.goal_event_name)}</p>` : ''}
          <p class="field-help">Você poderá escolher sua prova no calendário após a etapa financeira.</p>
          <label for="goal_event_date">Data da prova (opcional)</label><input id="goal_event_date" name="goal_event_date" type="date" lang="pt-BR" value="${value(profile.goal_event_date)}">
        </div>
        <div class="actions field full"><button class="secondary-btn" type="button" data-back="1">Voltar</button><button class="primary-btn" type="submit">Continuar</button></div>
      </form>`;

    document.querySelector('#sport-form').addEventListener('submit', saveSport);
    document.querySelectorAll('[name="has_race"]').forEach(input => input.addEventListener('change', () => {
      document.querySelector('#race-choice').classList.toggle('hidden', input.value !== 'yes');
    }));
    bindDatePickers();
    bindBackButtons();
  }

  async function saveSport(event) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const modalities = form.getAll('modalities').map(String);
    const eventName = profile.goal_event_name;
    const eventDate = form.get('has_race') === 'yes' ? clean(form.get('goal_event_date')) : profile.goal_event_date;
    const coach = eventName || eventDate || form.get('has_race') === 'yes' ? 'Dum' : 'Pedrinho';

    await updateProfile({
      modalities,
      running_experience: clean(form.get('running_experience')),
      current_level: clean(form.get('current_level')),
      training_days_current: clean(form.get('training_days_current')),
      training_days_available: clean(form.get('training_days_available')),
      base_preference: clean(form.get('base_preference')),
      primary_goal: [clean(form.get('quick_goal')), clean(form.get('primary_goal'))].filter(Boolean).join('\n'),
      goal_event_name: eventName || null,
      goal_event_date: eventDate || null,
      coach,
      onboarding_step: 3
    });
  }

  function renderPayment() {
    stepRoot.innerHTML = `
      <div class="step-kicker">3 de 6 · Financeiro</div>
      <h2>Cadastro financeiro</h2>
      <p class="lead">Falta só deixar sua forma de pagamento cadastrada.</p>
      <p class="notice">Ambiente de homologação: este fluxo ainda está em teste.</p>
      <form id="billing-form" class="grid">
        <fieldset class="field full choice-fieldset"><legend>Escolha seu plano mensal</legend>
          <div id="billing-plans" class="goal-options">Carregando planos...</div>
        </fieldset>
      <div class="actions">
        <button id="billing-checkout" class="primary-btn" type="submit" disabled>Cadastrar pagamento</button>
        <button id="payment-pending" class="secondary-btn" type="button">Fazer depois</button>
      </div>
      </form>
      <p id="billing-status" class="status" role="status" aria-live="polite"></p>
      <p id="payment-note" class="field-help">Você pode concluir esta etapa posteriormente. O pagamento acontece na página segura da Efí. O Portal não recebe dados de cartão.</p>
      <div class="actions"><button class="text-btn" type="button" data-back="2">Voltar</button><button id="payment-done" class="text-btn" type="button">Já cadastrei meu pagamento</button></div>`;

    document.querySelector('#billing-form').addEventListener('submit', startCheckout);
    loadBillingPlans();
    document.querySelector('#payment-pending').addEventListener('click', () => updateProfile({ payment_status: profile.payment_status || 'pending', onboarding_step: 4 }));
    document.querySelector('#payment-done').addEventListener('click', () => updateProfile({ payment_status: profile.payment_status === 'confirmed' ? 'confirmed' : 'submitted', onboarding_step: 4 }));
    bindBackButtons();
  }

  async function loadBillingPlans() {
    const root = document.querySelector('#billing-plans');
    const checkout = document.querySelector('#billing-checkout');
    try {
      const { data, error } = await client.from('billing_plans').select('code,name,price_cents,currency')
        .eq('active', true).in('code', ['single_monthly', 'multi_monthly']).order('price_cents');
      if (error || !data?.length) throw error || new Error('Planos indisponíveis');
      if (!root.isConnected) return;
      root.innerHTML = data.map(plan => `<label class="goal-option"><input type="radio" name="plan_code" value="${escapeAttr(plan.code)}" required><span>${escapeHtml(plan.name)} · ${escapeHtml(new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(plan.price_cents / 100))}/mês</span></label>`).join('');
      checkout.disabled = false;
    } catch {
      if (root.isConnected) root.textContent = 'Não foi possível carregar os planos. Recarregue a página ou faça esta etapa depois.';
    }
  }

  async function startCheckout(event) {
    event.preventDefault();
    if (checkoutBusy || saving || !session?.user) return;
    const planCode = new FormData(event.currentTarget).get('plan_code');
    if (!planCode) return;
    const userId = session.user.id;
    const status = document.querySelector('#billing-status');
    checkoutBusy = true;
    stepRoot.querySelectorAll('button').forEach(button => { button.disabled = true; });
    logoutButton.disabled = true;
    status.className = 'status';
    status.textContent = 'Preparando seu pagamento na Efí...';
    try {
      const { data, error } = await client.functions.invoke('efi-create-subscription', { body: { plan_code: planCode } });
      if (session?.user.id !== userId) return;
      let result = data;
      if (error) {
        try { result = await error.context?.json(); } catch { /* Network errors have no JSON body. */ }
        throw new Error(result?.error || 'checkout_unavailable');
      }
      const url = new URL(data?.payment_url);
      const hosts = ['pagamento.gerencianet.com.br', 'pagamento-h.gerencianet.com.br', 'pagamento.efipay.com.br', 'pagamento-h.efipay.com.br'];
      if (data?.environment !== 'homologation' || url.protocol !== 'https:' || url.username || url.password || url.port || !hosts.includes(url.hostname)) throw new Error('checkout_unavailable');
      // Keep the saved onboarding step. Returning from checkout resumes Financeiro.
      location.assign(url.href);
    } catch (error) {
      const messages = {
        profile_missing: 'Complete seus dados pessoais antes de cadastrar o pagamento.',
        profile_incomplete: 'Confira nome, sobrenome, CPF e data de nascimento em “Voltar” antes de continuar.',
        authentication_required: 'Sua sessão expirou. Recarregue a página para entrar novamente.',
        checkout_in_progress: 'Seu pagamento está sendo preparado. Aguarde e tente novamente.',
        checkout_requires_review: 'Esta solicitação precisa ser conferida pela equipe. Uma nova assinatura não será criada.',
        existing_subscription_other_plan: 'Você já tem uma assinatura ou pagamento pendente em outro plano. Fale com a equipe para trocar.',
        subscription_exists: 'Você já possui uma assinatura. Fale com a equipe para alterar seu plano.',
        homologation_only: 'O cadastro de pagamento está disponível somente em homologação.',
        plan_unavailable: 'Este plano não está disponível no momento.'
      };
      if (status.isConnected) {
        status.className = 'status error';
        status.textContent = messages[error.message] || 'Não foi possível preparar o pagamento. Tente novamente; cliques repetidos não criam outra assinatura.';
      }
    } finally {
      checkoutBusy = false;
      logoutButton.disabled = false;
      if (status.isConnected) stepRoot.querySelectorAll('button').forEach(button => { button.disabled = false; });
    }
  }

  function renderRaces() {
    stepRoot.innerHTML = `
      <div class="step-kicker">4 de 6 · Suas provas</div>
      <h2>Escolha suas próximas provas.</h2>
      <p class="lead">Use o calendário de Eventos Oficiais e avise a Rio Saúde. Após confirmar o aviso, toque em “Continuar cadastro” para configurar o TrainingPeaks.</p>
      <div class="actions"><a class="primary-btn" href="index.html?source=onboarding${editing ? '&edit=1' : ''}#eventos-oficiais">Escolher prova</a>
      <button id="skip-races" class="secondary-btn" type="button">Escolher depois</button></div>
      <div class="actions"><button class="text-btn" type="button" data-back="3">Voltar</button></div>`;
    document.querySelector('#skip-races').addEventListener('click', () => updateProfile({ onboarding_step: 5 }));
    bindBackButtons();
  }

  function renderTrainingPeaks() {
    const brands = ['Garmin', 'COROS', 'Apple Watch', 'Polar', 'Suunto', 'Amazfit', 'Outro', 'Não uso'];
    const storedBrand = profile.watch_brand === 'Coros' ? 'COROS' : profile.watch_brand;
    if (storedBrand && !brands.includes(storedBrand)) brands.push(storedBrand);
    stepRoot.innerHTML = `
      <div class="step-kicker">5 de 6 · TrainingPeaks e relógio</div>
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
    await updateProfile({
      watch_brand: clean(form.get('watch_brand')) || null,
      watch_connected: form.get('watch_brand') && form.get('watch_brand') !== 'Não uso' && form.get('watch_connected') === 'on' ? true : false,
      trainingpeaks_status: event.submitter?.value === 'completed' ? 'completed' : (profile.trainingpeaks_status || 'pending'),
      onboarding_step: 6
    });
  }

  function renderWhatsApp() {
    const whatsappLink = String(config.whatsappGroupUrl || '').trim();
    const linkButton = whatsappLink
      ? `<a class="primary-btn" href="${escapeAttr(whatsappLink)}" target="_blank" rel="noopener">Entrar no grupo da Rio Saúde</a>`
      : '';

    stepRoot.innerHTML = `
      <div class="step-kicker">6 de 6 · Finalização</div>
      <h2>Último passo.</h2>
      <p class="lead">Depois do cadastro e do TrainingPeaks, falta só entrar no canal de comunicação da Rio Saúde.</p>
      ${linkButton}
      ${whatsappLink ? '' : '<div class="notice">O link do grupo ainda não está configurado neste portal. A equipe pode enviar esse acesso diretamente sem impedir a conclusão do seu cadastro.</div>'}
      <div class="actions">
        <button class="secondary-btn" type="button" data-back="5">Voltar</button>
        <button id="finish-onboarding" class="primary-btn" type="button">${editing ? 'Salvar edição' : 'Concluir primeiro acesso'}</button>
      </div>`;

    document.querySelector('#finish-onboarding').addEventListener('click', finishOnboarding);
    bindBackButtons();
  }

  async function finishOnboarding() {
    await updateProfile({
      whatsapp_group_status: profile.whatsapp_group_status === 'completed' || config.whatsappGroupUrl ? 'completed' : 'pending',
      onboarding_step: 6,
      onboarding_completed_at: profile.onboarding_completed_at || new Date().toISOString()
    }, { finishEdit: editing });
  }

  function renderDashboard() {
    stepRoot.innerHTML = `
      <div class="step-kicker">${updated ? 'Cadastro atualizado' : 'Cadastro concluído'}</div>
      <h2>${profile.first_name ? `Tudo certo, ${escapeHtml(profile.first_name)}.` : 'Tudo certo.'}</h2>
      <p class="lead">Seu cadastro está salvo. Agora escolha suas próximas provas e avise a Rio Saúde.</p>
      <div class="actions"><a class="primary-btn" href="index.html#eventos-oficiais">Escolher minhas provas</a>
      <button id="edit-profile" class="secondary-btn" type="button">Editar meu cadastro</button>
      <button id="switch-account" class="text-btn" type="button">Sair / entrar com outro e-mail</button></div>`;
    document.querySelector('#edit-profile').addEventListener('click', () => { editing = true; editStep = 1; updated = false; render(); });
    document.querySelector('#switch-account').addEventListener('click', logout);
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
        await updateProfile({ onboarding_step: step });
      });
    });
  }

  async function logout() {
    const { error } = await client.auth.signOut();
    if (error) { showAppError(error); return; }
    history.replaceState(null, '', location.pathname);
    showLogin();
  }

  function showLogin() {
    session = null;
    profile = null;
    editing = false;
    updated = false;
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
