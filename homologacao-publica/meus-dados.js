(() => {
  const cfg = window.RIO_SAUDE_CONFIG || {};
  const root = document.querySelector('#profile-content');
  const onboarding = cfg.onboardingPage || 'onboarding-homologacao.html';
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const asText = value => String(value ?? '').trim();
  const readableDate = value => {
    if (!value) return 'Não informado';
    const bits = String(value).slice(0,10).split('-');
    return bits.length === 3 ? bits.reverse().join('/') : 'Não informado';
  };
  const maskedCpf = value => {
    const cpf = String(value ?? '').replace(/\D/g,'');
    return cpf.length === 11 ? '***.***.***-' + cpf.slice(-2) : 'Não informado';
  };
  const info = (label, value, helper = '') => '<div class="profile-info"><span>' + esc(label) + '</span><strong>' + esc(value || 'Não informado') + '</strong>' + (helper ? '<small>' + esc(helper) + '</small>' : '') + '</div>';

  if (!root || !cfg.supabaseUrl || !cfg.supabaseAnonKey || !window.supabase) {
    if (root) root.innerHTML = '<div class="card"><p class="status error">Configuração do portal indisponível.</p></div>';
    return;
  }
  const client = window.supabase.createClient(cfg.supabaseUrl,cfg.supabaseAnonKey,{auth:{persistSession:true,autoRefreshToken:true}});
  let currentUser = null;

  async function start() {
    try {
      const {data:{user},error:authError} = await client.auth.getUser();
      if (authError || !user) { window.location.replace(onboarding); return; }
      currentUser = user;
      const {data:profile,error} = await client.from('athlete_profiles')
        .select('first_name,last_name,email,cpf,birth_date,whatsapp,city,whatsapp_financial_contact_authorized,onboarding_completed_at')
        .eq('user_id',user.id).maybeSingle();
      if (error) throw error;
      if (!profile?.onboarding_completed_at) { window.location.replace(onboarding); return; }
      render(profile);
    } catch {
      root.innerHTML = '<div class="card"><p class="status error">Não foi possível carregar seus dados. Recarregue a página para tentar novamente.</p></div>';
    }
  }

  function render(profile) {
    const identity = '<section class="profile-panel"><div class="profile-panel-heading"><span class="profile-icon" aria-hidden="true">◉</span><div><h2>Identificação</h2><p>Informações vinculadas ao cadastro original.</p></div></div><div class="profile-info-grid">' +
      info('E-mail de acesso',profile.email,'Para alterar, procure a equipe.') +
      info('CPF',maskedCpf(profile.cpf),'Protegido por segurança.') +
      info('Nascimento',readableDate(profile.birth_date),'Para corrigir, procure a equipe.') +
      '</div></section>';

    const contact = '<section class="profile-panel"><div class="profile-panel-heading"><span class="profile-icon" aria-hidden="true">✎</span><div><h2>Dados e contato</h2><p>Atualize diretamente as informações abaixo.</p></div></div>' +
      '<form id="profile-form" class="profile-form">' +
      '<div class="field"><label for="profile-first">Nome</label><input id="profile-first" name="first_name" autocomplete="given-name" maxlength="80" required value="' + esc(profile.first_name) + '"></div>' +
      '<div class="field"><label for="profile-last">Sobrenome</label><input id="profile-last" name="last_name" autocomplete="family-name" maxlength="120" required value="' + esc(profile.last_name) + '"></div>' +
      '<div class="field"><label for="profile-phone">WhatsApp</label><input id="profile-phone" name="whatsapp" type="tel" inputmode="tel" autocomplete="tel" maxlength="25" required value="' + esc(profile.whatsapp) + '"></div>' +
      '<div class="field"><label for="profile-city">Cidade</label><input id="profile-city" name="city" autocomplete="address-level2" maxlength="120" required value="' + esc(profile.city) + '"></div>' +
      '<label class="profile-consent"><input type="checkbox" name="whatsapp_financial_contact_authorized" ' + (profile.whatsapp_financial_contact_authorized ? 'checked' : '') + '><span>Autorizo contatos pelo WhatsApp sobre a ativação e o pagamento do meu plano.</span></label>' +
      '<div class="profile-actions"><button id="profile-save" type="submit" class="primary-btn">Salvar alterações</button><p id="profile-status" role="status" aria-live="polite"></p></div>' +
      '<p class="profile-helper">Alterar o nome aqui não modifica dados já enviados à Efí. Para corrigir documentos ou dados de cobrança, procure a equipe.</p>' +
      '</form></section>';
    root.innerHTML = '<div class="profile-panels">' + contact + identity + '</div>';
    document.querySelector('#profile-form').addEventListener('submit', save);
  }

  async function save(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    const values = {
      first_name:asText(data.get('first_name')).replace(/\s+/g,' '),
      last_name:asText(data.get('last_name')).replace(/\s+/g,' '),
      whatsapp:asText(data.get('whatsapp')),
      city:asText(data.get('city')).replace(/\s+/g,' '),
      whatsapp_financial_contact_authorized:data.get('whatsapp_financial_contact_authorized') === 'on'
    };
    const button = document.querySelector('#profile-save');
    const status = document.querySelector('#profile-status');
    if (!values.first_name || !values.last_name || !values.city || !/^\d{10,13}$/.test(values.whatsapp.replace(/\D/g,''))) {
      status.textContent = 'Confira o nome, a cidade e o número de WhatsApp (com DDD).';
      status.className = 'profile-error';
      return;
    }
    button.disabled = true;
    button.textContent = 'Salvando…';
    status.textContent = '';
    status.className = '';
    try {
      const {data:updated,error} = await client.from('athlete_profiles')
        .update(values).eq('user_id',currentUser.id)
        .select('first_name,last_name,email,cpf,birth_date,whatsapp,city,whatsapp_financial_contact_authorized,onboarding_completed_at').single();
      if (error || !updated) throw error || new Error('update_failed');
      status.textContent = 'Alterações salvas.';
      status.className = 'profile-success';
    } catch {
      status.textContent = 'Não foi possível salvar. Confira os dados e tente novamente.';
      status.className = 'profile-error';
    } finally {
      button.disabled = false;
      button.textContent = 'Salvar alterações';
    }
  }
  start();
})();
