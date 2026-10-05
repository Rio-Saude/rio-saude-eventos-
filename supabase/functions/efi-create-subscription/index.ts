import { createClient } from 'npm:@supabase/supabase-js@2.117.2';
import { createHandler } from './core.mjs';

const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
// This key only exists on the server. Ownership comes from Auth, never request JSON.
const admin = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
const db = {
  async profile(userId: string) {
    const { data, error } = await admin.from('athlete_profiles')
      .select('id,first_name,last_name,email,cpf,birth_date').eq('user_id', userId).maybeSingle();
    if (error) throw error;
    return data;
  },
  async plan(code: string) {
    const { data, error } = await admin.from('billing_plans')
      .select('id,code,name,price_cents,currency,interval_months,active,efi_plan_id_homolog').eq('code', code).maybeSingle();
    if (error) throw error;
    return data;
  },
  async reserve(values: Record<string, unknown>) {
    const { data, error } = await admin.from('billing_subscriptions').insert(values).select('*').single();
    if (!error) return { created: true, row: data };
    if (error.code !== '23505') throw error;
    const existing = await admin.from('billing_subscriptions').select('*')
      .eq('athlete_profile_id', values.athlete_profile_id).eq('environment', 'homologation')
      .in('status', ['pending', 'active', 'past_due']).maybeSingle();
    if (existing.error) throw existing.error;
    return { created: false, row: existing.data };
  },
  async update(id: string, values: Record<string, unknown>) {
    const { data, error } = await admin.from('billing_subscriptions').update(values)
      .eq('id', id).eq('environment', 'homologation').select('id').single();
    if (error || !data) throw error || new Error('subscription_not_saved');
  }
};

Deno.serve(createHandler({ env: (name: string) => Deno.env.get(name), db,
  authenticate: async (req: Request) => {
    const header = req.headers.get('Authorization') || '';
    if (!header.startsWith('Bearer ')) return null;
    const { data, error } = await admin.auth.getUser(header.slice(7));
    return error ? null : data.user;
  }
}));
