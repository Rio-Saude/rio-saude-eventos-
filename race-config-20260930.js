window.RIO_SAUDE_CONFIG = {
  registrationEnabled: true,
  onboardingEnabled: true,
  supabaseUrl: "https://zzxveirmtgnrokgjthhy.supabase.co",
  supabaseAnonKey: "sb_publishable_glBPSbIG1ov2_vn8vPyJMw_0OvaAILs",
  fallbackFormUrl: "https://docs.google.com/forms/d/e/1FAIpQLScYh8rlUCamcUXrg4LwRzcYryLLTPWekAfwxBovOlrK40X9LQ/viewform",
  adminPage: "admin.html",
  onboardingPage: "onboarding.html"
};

(() => {
  document.addEventListener('DOMContentLoaded', () => {
    const hero = document.querySelector('.hero-inner');
    const choices = document.querySelector('.home-choices');
    if (!hero || !choices) return;

    const title = hero.querySelector('h1');
    const subtitle = hero.querySelector('.subtitle');
    if (title) title.textContent = 'Portal Rio Saúde.';
    if (subtitle) subtitle.textContent = 'Primeiro acesso, calendário de provas e eventos da Rio Saúde em um só lugar.';

    if (!choices.querySelector('.rs-onboarding-card')) {
      const onboarding = document.createElement('a');
      onboarding.href = 'onboarding.html';
      onboarding.className = 'choice-card rs-onboarding-card';
      onboarding.innerHTML = '<small>área do aluno</small><strong>Primeiro acesso</strong><p>Faça seu cadastro inicial e deixe seus dados, perfil esportivo e TrainingPeaks organizados.</p>';
      choices.prepend(onboarding);
    }

    const style = document.createElement('style');
    style.textContent = [
      '.home-choices{grid-template-columns:repeat(3,1fr)!important}',
      '.rs-onboarding-card{text-decoration:none}',
      '@media(max-width:850px){.home-choices{grid-template-columns:1fr!important}}'
    ].join('');
    document.head.appendChild(style);
  });
})();
