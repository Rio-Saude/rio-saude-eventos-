(() => {
  const config = window.RIO_SAUDE_CONFIG || {};
  const onboardingPage = config.onboardingPage || 'onboarding-homologacao.html';
  const loading = document.querySelector('#my-space-loading');
  const app = document.querySelector('#my-space-app');
  const name = document.querySelector('#athlete-first-name');
  const logoutButton = document.querySelector('#logout-btn');

  if (!config.supabaseUrl || !config.supabaseAnonKey || !window.supabase) {
    loading.innerHTML = '<p class="status error">Configuração do portal indisponível.</p>';
    return;
  }

  const client = window.supabase.createClient(config.supabaseUrl, config.supabaseAnonKey, {
    auth: { persistSession: true, autoRefreshToken: true }
  });

  function goToOnboarding() {
    window.location.replace(onboardingPage);
  }

  async function boot() {
    const { data: { session }, error: sessionError } = await client.auth.getSession();
    if (sessionError) throw sessionError;
    if (!session?.user) {
      goToOnboarding();
      return;
    }

    const { data: profile, error: profileError } = await client
      .from('athlete_profiles')
      .select('first_name,onboarding_completed_at')
      .eq('user_id', session.user.id)
      .maybeSingle();
    if (profileError) throw profileError;
    if (!profile?.onboarding_completed_at) {
      goToOnboarding();
      return;
    }

    name.textContent = String(profile.first_name || 'atleta').trim() || 'atleta';
    loading.classList.add('hidden');
    app.classList.remove('hidden');
  }

  logoutButton.addEventListener('click', async () => {
    logoutButton.disabled = true;
    const { error } = await client.auth.signOut();
    if (error) {
      logoutButton.disabled = false;
      loading.classList.remove('hidden');
      loading.innerHTML = '<p class="status error">Não foi possível encerrar a sessão. Tente novamente.</p>';
      return;
    }
    goToOnboarding();
  });

  client.auth.onAuthStateChange((event, session) => {
    if (event !== 'INITIAL_SESSION' && !session) goToOnboarding();
  });

  boot().catch(() => {
    loading.innerHTML = '<p class="status error">Não foi possível carregar seu espaço. Recarregue a página para tentar novamente.</p>';
  });
})();
