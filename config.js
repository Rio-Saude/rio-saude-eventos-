const rioSaudeProductionConfig = {
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

// Local/static preview only. Production remains the default and is never selected implicitly.
const rioSaudeHomologationConfig = {
  ...rioSaudeProductionConfig,
  supabaseUrl: "https://xiiudduncvcxcvbgbqpc.supabase.co",
  supabaseAnonKey: "sb_publishable_K2bGyfOGFvmzY4mB-kDagQ_RMkIhXmF"
};

window.RIO_SAUDE_CONFIG = new URLSearchParams(window.location.search).get('environment') === 'homologacao'
  ? rioSaudeHomologationConfig
  : rioSaudeProductionConfig;
