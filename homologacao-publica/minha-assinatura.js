(() => {
  const cfg = window.RIO_SAUDE_CONFIG || {};
  const root = document.querySelector('#content');
  const back = document.querySelector('#subscription-back');
  const onboarding = cfg.onboardingPage || 'onboarding-homologacao.html';
  const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
  const shortDate = value => {
    if (!value) return 'A confirmar';
    const part = String(value).split('T')[0];
    const bits = part.split('-');
    return bits.length === 3 ? bits.reverse().join('/') : 'A confirmar';
  };
  const money = cents => new Intl.NumberFormat('pt-BR', {style:'currency',currency:'BRL'}).format((Number(cents) || 0) / 100);
  const statusText = value => ({pending:'Aguardando confirmação',active:'Ativa',past_due:'Pagamento em atraso',cancelled:'Cancelada',expired:'Expirada',failed:'Não concluída'}[value] || 'Em análise');
  const chargeStatus = value => ({paid:'Pago',settled:'Pago',waiting:'Aguardando pagamento',unpaid:'Aguardando pagamento',pending:'Aguardando pagamento',overdue:'Vencido',cancelled:'Cancelado',canceled:'Cancelado',expired:'Expirado'}[value] || 'Em análise');
  const statusClass = value => value === 'active' ? 'is-active' : value === 'cancelled' ? 'is-cancelled' : ['past_due','failed'].includes(value) ? 'is-attention' : 'is-pending';
  const safeHttps = value => { try { const url = new URL(value); return url.protocol === 'https:' ? url.href : ''; } catch { return ''; } };
  const validEfiLink = value => {
    try {
      const url = new URL(value);
      return url.protocol === 'https:' && ['pagamento.gerencianet.com.br','pagamento-h.gerencianet.com.br','pagamento.efipay.com.br','pagamento-h.efipay.com.br','pagamento.sejaefi.com.br','pagamento-h.sejaefi.com.br'].includes(url.hostname) ? url.href : '';
    } catch { return ''; }
  };
  const note = (label, text) => '<div class="subscription-note"><strong>' + esc(label) + '</strong><p>' + text + '</p></div>';
  const box = (icon, label, value, detail = '') => '<div class="subscription-info-box"><span class="subscription-info-icon" aria-hidden="true">' + icon + '</span><span class="subscription-info-label">' + esc(label) + '</span><strong>' + esc(value) + '</strong>' + (detail ? '<small>' + esc(detail) + '</small>' : '') + '</div>';

  if (!root || !cfg.supabaseUrl || !cfg.supabaseAnonKey || !window.supabase) {
    if (root) root.innerHTML = '<div class="card"><p class="status error">Configuração do portal indisponível.</p></div>';
    return;
  }
  const client = window.supabase.createClient(cfg.supabaseUrl, cfg.supabaseAnonKey, {auth:{persistSession:true,autoRefreshToken:true}});

  function panel(title, description, href, label) {
    root.innerHTML = '<div class="card subscription-empty"><h2>' + esc(title) + '</h2><p>' + esc(description) + '</p><a class="primary-btn" href="' + esc(href) + '">' + esc(label) + '</a></div>';
  }

  function nextCharge(subscription) {
    if (['cancelled','expired'].includes(subscription.status)) return 'Sem novas cobranças';
    const raw = subscription.next_charge_on || (subscription.payment_method === 'boleto' ? subscription.first_due_on : subscription.first_charge_on);
    if (!raw) return 'A confirmar';
    const parts = new Intl.DateTimeFormat('en-US', {timeZone:'America/Sao_Paulo',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date());
    const piece = key => parts.find(part => part.type === key)?.value || '';
    const today = [piece('year'),piece('month'),piece('day')].join('-');
    const day = String(raw).slice(0,10);
    if (day < today && subscription.status === 'active') return 'A confirmar';
    return shortDate(raw);
  }

  function buildName(subscription, profile) {
    const plan = subscription.billing_plans || {};
    const multi = plan.modality_tier === 'multi' || /triathlon|triatlo|2 ou mais modalidades|2\+ modalidades/i.test(plan.name || '');
    const title = multi ? 'Triathlon' : plan.modality_tier === 'single' ? 'Corrida' : plan.name || 'Plano Rio Saúde';
    const base = !multi ? String(profile.base_preference || '').trim() : '';
    const subtitle = multi ? 'Natação, ciclismo e corrida' : base && !/nenhum|não tenho|indiferente/i.test(base) ? 'Base ' + base.slice(0,48) : 'Treinamento de corrida';
    return {multi, title, subtitle};
  }

  function checkoutInfo(subscription) {
    if (subscription.status === 'cancelled') return '';
    const hostedTrial = ['card_hosted_trial','card_hosted_resume'].includes(subscription.checkout_kind);
    const checkout = validEfiLink(subscription.payment_url);
    if (checkout) return '<div class="subscription-important"><strong>Cartão de crédito — cadastro pendente</strong><p>Cadastre o cartão no checkout oficial da Efí. A assinatura só será ativada após confirmação da Efí.</p><a class="primary-btn" target="_blank" rel="noopener noreferrer" href="' + esc(checkout) + '">Cadastrar cartão na Efí ↗</a>' + (subscription.payment_expires_at ? '<p class="subscription-small">Disponível até ' + esc(shortDate(subscription.payment_expires_at)) + '.</p>' : '') + '</div>';
    if (hostedTrial) return '<div class="subscription-important"><strong>Checkout do cartão</strong><p>' + (subscription.trial_ends_on ? 'Sua experiência segue até ' + esc(shortDate(subscription.trial_ends_on)) + '. ' : '') + 'No 25º dia enviaremos o checkout oficial da Efí pelo WhatsApp se você autorizou esse contato. A Efí poderá cobrar quando o cartão for cadastrado. A Rio Saúde não solicita cartão agora.</p></div>';
    return '';
  }

  function boletoInfo(charges) {
    if (!charges.length) return '';
    return '<details class="subscription-detail"><summary>Consultar boletos <span aria-hidden="true">⌄</span></summary><ul class="subscription-charge-list">' + charges.map(charge => {
      const url = safeHttps(charge.billet_url);
      return '<li><span><strong>' + esc(chargeStatus(charge.status)) + '</strong><small>' + esc(shortDate(charge.due_on)) + ' · ' + esc(money(charge.amount_cents)) + '</small></span>' + (url ? '<a href="' + esc(url) + '" target="_blank" rel="noopener noreferrer">Abrir boleto ↗</a>' : '') + '</li>';
    }).join('') + '</ul></details>';
  }

  function render(subscription, profile, charges) {
    const current = buildName(subscription, profile);
    const cancelled = subscription.status === 'cancelled';
    const paymentMethod = subscription.payment_method === 'boleto' ? 'Boleto' : ['card','credit_card','credit'].includes(subscription.payment_method) ? 'Cartão de crédito' : 'A confirmar';
    const period = Number(subscription.billing_plans?.interval_months) || 1;
    const cadence = period === 1 ? '/mês' : '/a cada ' + period + ' meses';
    const trial = subscription.free_trial_days && subscription.trial_ends_on ? '<p class="subscription-trial">Experiência gratuita até ' + esc(shortDate(subscription.trial_ends_on)) + '</p>' : '';
    const cancelledNote = subscription.cancelled_effective_on ? '<p class="subscription-small">Acesso preservado até ' + esc(shortDate(subscription.cancelled_effective_on)) + '.</p>' : '';

    const main = '<section class="subscription-primary-card" aria-label="Plano atual">' +
      '<div class="subscription-card-top"><span class="subscription-overline">SEU PLANO ATUAL</span><span class="subscription-status ' + statusClass(subscription.status) + '">' + esc(statusText(subscription.status)) + '</span></div>' +
      '<h2>' + esc(current.title) + '</h2><p class="subscription-subtitle">' + esc(current.subtitle) + '</p>' +
      '<p class="subscription-amount">' + esc(money(subscription.price_cents)) + '<small>' + esc(cadence) + '</small></p>' + trial + cancelledNote + '</section>';

    const details = '<div class="subscription-facts">' +
      box('◷', cancelled ? 'Próxima cobrança' : subscription.payment_method === 'boleto' ? 'Próximo vencimento' : 'Próxima cobrança', nextCharge(subscription)) +
      box('▣', 'Forma de pagamento', paymentMethod) + '</div>';

    const alternatives = cancelled ? '' :
      '<section class="subscription-extra"><div class="subscription-extra-title"><span><strong>Outras durações</strong><small>Trimestral e semestral</small></span><span class="subscription-label">Em avaliação</span></div><p>Opções em estudo. Ainda não é possível contratar ou alterar sua assinatura por aqui.</p></section>' +
      (current.multi ? '' : '<details class="subscription-detail subscription-tri"><summary><span><strong>Conheça o Triathlon</strong><small>Treinamento nas três modalidades</small></span><span aria-hidden="true">↗</span></summary><p>Treinamento integrado de natação, ciclismo e corrida, com orientação da equipe Rio Saúde. Para conhecer as condições ou mudar de modalidade, converse com a equipe.</p></details>');

    const confirm = cancelled ?
      '<div class="subscription-rehire"><p><strong>Cancelamento confirmado.</strong> Não haverá novas cobranças nesta assinatura.</p><a class="primary-btn" href="onboarding-homologacao.html?payment=1">Contratar novamente</a><p class="subscription-small">Usaremos seu cadastro atual. A elegibilidade ao período gratuito é verificada automaticamente e não é reiniciada.</p></div>' :
      '<section class="subscription-cancel-area"><button id="cancel" type="button" class="subscription-cancel-trigger">Cancelar assinatura <span aria-hidden="true">→</span></button><div id="cancel-confirm" class="subscription-cancel-confirm" hidden><h3>Confirmar cancelamento?</h3><p>A confirmação será enviada à Efí para impedir novas cobranças. Se estiver no período gratuito, a validade do acesso seguirá as regras da sua assinatura.</p><div class="subscription-confirm-actions"><button id="cancel-back" type="button" class="secondary-btn">Voltar</button><button id="cancel-final" type="button" class="subscription-danger-btn">Confirmar cancelamento</button></div><p id="cancel-message" role="status" class="subscription-small" aria-live="polite"></p></div></section>';

    root.innerHTML = '<div class="subscription-layout">' + main + details + checkoutInfo(subscription) + (subscription.payment_method === 'boleto' ? boletoInfo(charges) : '') + alternatives + confirm + '</div>';
    document.querySelector('#cancel')?.addEventListener('click', () => {
      document.querySelector('#cancel-confirm').hidden = false;
      document.querySelector('#cancel').hidden = true;
      document.querySelector('#cancel-final')?.focus();
    });
    document.querySelector('#cancel-back')?.addEventListener('click', () => {
      document.querySelector('#cancel-confirm').hidden = true;
      document.querySelector('#cancel').hidden = false;
      document.querySelector('#cancel')?.focus();
    });
    document.querySelector('#cancel-final')?.addEventListener('click', async () => {
      const button = document.querySelector('#cancel-final');
      const backButton = document.querySelector('#cancel-back');
      const output = document.querySelector('#cancel-message');
      button.disabled = true;
      backButton.disabled = true;
      button.textContent = 'Confirmando…';
      const {data, error} = await client.functions.invoke('efi-billing', {body:{action:'cancel'}});
      if (error || !data?.cancelled) {
        button.disabled = false;
        backButton.disabled = false;
        button.textContent = 'Confirmar cancelamento';
        output.textContent = 'Não foi possível confirmar o cancelamento na Efí. Sua assinatura não foi marcada como cancelada.';
        output.classList.add('subscription-error');
        return;
      }
      await load();
    });
  }

  async function load() {
    try {
      const {data:{user},error:authError} = await client.auth.getUser();
      if (authError || !user) {
        panel('Entre pelo onboarding','Use o mesmo e-mail do seu cadastro para acessar esta página.',onboarding,'Entrar');
        return;
      }
      const {data:profile,error:profileError} = await client.from('athlete_profiles').select('id,base_preference,onboarding_completed_at').eq('user_id',user.id).maybeSingle();
      if (profileError) throw profileError;
      if (!profile) {
        panel('Cadastro não encontrado','Não foi possível localizar seu cadastro.',onboarding,'Ir para o onboarding');
        return;
      }
      back.href = profile.onboarding_completed_at ? 'meu-espaco-homologacao.html' : onboarding;
      back.textContent = profile.onboarding_completed_at ? '← Meu espaço' : '← Onboarding';
      const {data:subscription,error} = await client.from('billing_subscriptions')
        .select('id,status,creation_state,checkout_kind,payment_method,payment_url,payment_expires_at,price_cents,free_trial_days,trial_ends_on,first_charge_on,next_charge_on,first_due_on,cancelled_effective_on,billing_plans(name,code,modality_tier,interval_months)')
        .eq('athlete_profile_id',profile.id).eq('environment','homologation')
        .order('created_at',{ascending:false}).limit(1).maybeSingle();
      if (error) throw error;
      if (!subscription) {
        panel('Sem assinatura registrada','Você ainda não tem uma contratação financeira registrada na homologação.',onboarding,'Ver opções de contratação');
        return;
      }
      let charges = [];
      if (subscription.payment_method === 'boleto') {
        const result = await client.from('billing_charges').select('status,amount_cents,due_on,paid_at,billet_url').eq('subscription_id',subscription.id).order('due_on',{ascending:false});
        if (!result.error) charges = result.data || [];
      }
      render(subscription,profile,charges);
    } catch {
      root.innerHTML = '<div class="card"><p class="status error">Não foi possível carregar sua assinatura. Recarregue a página para tentar novamente.</p></div>';
    }
  }
  load();
})();
