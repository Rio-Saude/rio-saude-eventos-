window.RIO_SAUDE_CONFIG = {
  registrationEnabled: true,
  onboardingEnabled: true,
  supabaseUrl: "https://zzxveirmtgnrokgjthhy.supabase.co",
  supabaseAnonKey: "sb_publishable_glBPSbIG1ov2_vn8vPyJMw_0OvaAILs",
  fallbackFormUrl: "https://docs.google.com/forms/d/e/1FAIpQLScYh8rlUCamcUXrg4LwRzcYryLLTPWekAfwxBovOlrK40X9LQ/viewform",
  adminPage: "admin.html",
  onboardingPage: "onboarding.html",
  efiPaymentUrl: "",
  whatsappGroupUrl: ""
};

(() => {
  if (/onboarding\.html$/i.test(window.location.pathname)) return;

  document.addEventListener('DOMContentLoaded', () => {
    const hero = document.querySelector('.hero-inner');
    const choices = document.querySelector('.home-choices');

    if (hero) {
      const title = hero.querySelector('h1');
      const subtitle = hero.querySelector('.subtitle');
      const brand = hero.querySelector('.brand');

      if (brand) brand.textContent = 'RIO SAÚDE • PORTAL DO ALUNO';
      if (title) title.textContent = 'Tudo da Rio Saúde em um só lugar.';
      if (subtitle) subtitle.textContent = 'Faça seu primeiro acesso, acompanhe as provas da temporada e encontre os eventos especiais da Rio Saúde.';
    }

    if (choices && !document.querySelector('.rs-onboarding-card')) {
      const card = document.createElement('a');
      card.href = 'onboarding.html';
      card.className = 'choice-card rs-onboarding-card';
      card.innerHTML = [
        '<small>comece por aqui</small>',
        '<strong>Primeiro acesso</strong>',
        '<p>Cadastre seus dados, perfil esportivo, financeiro e TrainingPeaks para começar na Rio Saúde.</p>'
      ].join('');
      choices.prepend(card);
    }

    const style = document.createElement('style');
    style.textContent = `
      .home-choices{grid-template-columns:repeat(3,minmax(0,1fr))!important}
      .home-choices .choice-card{text-decoration:none}
      .rs-onboarding-card{border-color:rgba(168,224,190,.42)!important;background:#10251b!important}
      .rs-onboarding-card small{color:#a8e0be!important}
      @media(max-width:900px){.home-choices{grid-template-columns:1fr!important}}
    `;
    document.head.appendChild(style);
  });
})();
