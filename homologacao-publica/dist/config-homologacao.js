// Used only by the dedicated homologation pages. There is intentionally no
// production fallback here: an invalid or absent URL parameter cannot switch
// these previews to the production project.
window.RIO_SAUDE_CONFIG = {
  registrationEnabled: true,
  onboardingEnabled: true,
  supabaseUrl: "https://xiiudduncvcxcvbgbqpc.supabase.co",
  supabaseAnonKey: "sb_publishable_K2bGyfOGFvmzY4mB-kDagQ_RMkIhXmF",
  fallbackFormUrl: "",
  adminPage: "admin-comercial-homologacao.html",
  onboardingPage: "onboarding-homologacao.html",
  efiPaymentUrl: "",
  whatsappGroupUrl: "",
  environmentLabel: "HOMOLOGAÇÃO"
};
