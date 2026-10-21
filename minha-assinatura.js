(() => {
  const cfg = window.RIO_SAUDE_CONFIG;
  const root = document.querySelector('#content');
  const client = window.supabase.createClient(cfg.supabaseUrl,cfg.supabaseAnonKey,{auth:{persistSession:true,autoRefreshToken:true}});
  const esc = value => String(value ?? '').replace(/[&<>"']/g,char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
  const date = value => value ? String(value).split('-').reverse().join('/') : '—';
  const money = value => new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL'}).format((value || 0) / 100);
  const validEfiLink = value => { try { const url = new URL(value); return url.protocol === 'https:' && ['pagamento.gerencianet.com.br','pagamento-h.gerencianet.com.br','pagamento.efipay.com.br','pagamento-h.efipay.com.br','pagamento.sejaefi.com.br','pagamento-h.sejaefi.com.br'].includes(url.hostname) ? url.href : ''; } catch { return ''; } };

  async function load() {
    const {data:{session}} = await client.auth.getSession();
    if (!session) { root.innerHTML = '<h2>Entre pelo onboarding</h2><p>Use o mesmo e-mail do seu cadastro para acessar esta página.</p><a class="primary-btn" href="onboarding-homologacao.html">Entrar</a>'; return; }
    const {data:profile} = await client.from('athlete_profiles').select('id').eq('user_id',session.user.id).maybeSingle();
    if (!profile) { root.innerHTML = '<p class="status error">Não foi possível localizar seu cadastro.</p>'; return; }
    const {data:subscription,error} = await client.from('billing_subscriptions').select('id,status,creation_state,checkout_kind,payment_method,payment_url,payment_expires_at,price_cents,free_trial_days,trial_ends_on,first_charge_on,first_due_on,cancelled_effective_on,billing_plans(name)').eq('athlete_profile_id',profile.id).eq('environment','homologation').order('created_at',{ascending:false}).limit(1).maybeSingle();
    if (error || !subscription) { root.innerHTML = '<h2>Sem assinatura registrada</h2><p>Você ainda não tem uma contratação financeira registrada neste ambiente.</p><a class="primary-btn" href="onboarding-homologacao.html">Ir para o onboarding</a>'; return; }
    const {data:charges} = await client.from('billing_charges').select('status,amount_cents,due_on,paid_at,billet_url').eq('subscription_id',subscription.id).order('due_on',{ascending:false});
    const cancelled = subscription.status === 'cancelled';
    const hostedTrial = subscription.checkout_kind === 'card_hosted_trial';
    const checkout = validEfiLink(subscription.payment_url);
    const checkoutBlock = cancelled ? '' : checkout
      ? `<section class="notice"><strong>Cartão de crédito</strong><p>O checkout oficial da Efí está disponível. A assinatura só será ativada após a confirmação da Efí.</p><a class="primary-btn" target="_blank" rel="noopener noreferrer" href="${esc(checkout)}">Cadastrar cartão na Efí</a>${subscription.payment_expires_at ? `<p class="field-help">Disponível até ${date(subscription.payment_expires_at)}.</p>` : ''}</section>`
      : hostedTrial ? `<section class="notice"><strong>Checkout do cartão</strong><p>${subscription.trial_ends_on ? `Sua experiência segue até ${date(subscription.trial_ends_on)}. ` : ''}No 25º dia enviaremos o checkout oficial da Efí pelo WhatsApp se você autorizou esse contato. A Efí poderá cobrar quando o cartão for cadastrado. A Rio Saúde não solicita cartão agora.</p></section>` : '';
    root.innerHTML = `<h2>${esc(subscription.billing_plans?.name || 'Plano Rio Saúde')}</h2><dl class="summary-list"><dt>Situação</dt><dd>${esc(subscription.status)}</dd><dt>Forma de pagamento</dt><dd>${subscription.payment_method === 'boleto' ? 'Boleto' : 'Cartão de crédito'}</dd><dt>Valor mensal</dt><dd>${money(subscription.price_cents)}</dd><dt>Período gratuito</dt><dd>${subscription.free_trial_days ? `30 dias · até ${date(subscription.trial_ends_on)}` : 'Não aplicável'}</dd><dt>Próxima cobrança / vencimento</dt><dd>${date(subscription.first_due_on || subscription.first_charge_on)}</dd>${subscription.cancelled_effective_on ? `<dt>Acesso preservado até</dt><dd>${date(subscription.cancelled_effective_on)}</dd>` : ''}</dl>${checkoutBlock}<h3>Boletos</h3>${charges?.length ? `<ul>${charges.map(charge => `<li>${esc(charge.status)} · ${money(charge.amount_cents)} · ${date(charge.due_on)} ${charge.billet_url ? `<a target="_blank" rel="noopener" href="${esc(charge.billet_url)}">Abrir boleto</a>` : ''}</li>`).join('')}</ul>` : '<p>Nenhum boleto emitido.</p>'}${cancelled ? '<p class="success-box">Cancelamento confirmado. Não haverá novas cobranças.</p>' : '<button id="cancel" class="secondary-btn" type="button">Cancelar assinatura</button><p class="field-help">O cancelamento só é mostrado como concluído depois da confirmação da Efí. Durante o período gratuito, seu acesso segue até o fim dele.</p>'}`;
    document.querySelector('#cancel')?.addEventListener('click',async () => {
      if (!confirm('Cancelar a assinatura e impedir novas cobranças?')) return;
      const button = document.querySelector('#cancel'); button.disabled = true; button.textContent = 'Confirmando cancelamento…';
      const {data,error} = await client.functions.invoke('efi-billing',{body:{action:'cancel'}});
      if (error || !data?.cancelled) { button.disabled = false; button.textContent = 'Cancelar assinatura'; alert('Não foi possível confirmar o cancelamento na Efí. Nenhuma confirmação foi exibida.'); return; }
      await load();
    });
  }
  load();
})();
