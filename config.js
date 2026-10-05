window.RIO_SAUDE_CONFIG = {
  registrationEnabled: true,
  onboardingEnabled: false,
  supabaseUrl: "https://zzxveirmtgnrokgjthhy.supabase.co",
  supabaseAnonKey: "sb_publishable_glBPSbIG1ov2_vn8vPyJMw_0OvaAILs",
  fallbackFormUrl: "https://docs.google.com/forms/d/e/1FAIpQLScYh8rlUCamcUXrg4LwRzcYryLLTPWekAfwxBovOlrK40X9LQ/viewform",
  adminPage: "admin.html",
  onboardingPage: "onboarding.html",
  efiPaymentUrl: "",
  whatsappGroupUrl: ""
};

(() => {
  if (!window.RIO_SAUDE_CONFIG.onboardingEnabled) return;
  if (/onboarding\.html$/i.test(window.location.pathname)) return;
  document.addEventListener('DOMContentLoaded', () => {
    if (document.querySelector('.rs-portal-entry')) return;
    const hero = document.querySelector('.hero-inner');
    if (!hero) return;

    const entry = document.createElement('div');
    entry.className = 'rs-portal-entry';
    entry.innerHTML = '<a href="onboarding.html">Primeiro acesso / Minha conta</a>';
    entry.style.marginTop = '24px';

    const link = entry.querySelector('a');
    link.style.display = 'inline-block';
    link.style.padding = '11px 16px';
    link.style.borderRadius = '999px';
    link.style.border = '1px solid rgba(168,224,190,.30)';
    link.style.background = 'rgba(168,224,190,.08)';
    link.style.color = '#a8e0be';
    link.style.fontWeight = '900';
    link.style.textDecoration = 'none';

    hero.appendChild(entry);
  });
})();
