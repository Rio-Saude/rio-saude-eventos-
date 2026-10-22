import { cp, mkdir, readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const source = join(root, 'homologacao-publica');
const destination = join(source, 'dist');
const allowedFiles = new Set([
  'index.html',
  'onboarding-homologacao.html',
  'onboarding.js',
  'meu-espaco-homologacao.html',
  'meu-espaco.js',
  'parq.js',
  'portal.css',
  'config-homologacao.js',
  'minha-assinatura-homologacao.html',
  'minha-assinatura.js',
  'admin-comercial-homologacao.html',
  'commercial-admin.js'
]);

await mkdir(destination, { recursive: true });
for (const name of allowedFiles) {
  await cp(join(source, name), join(destination, name));
}

const config = await readFile(join(destination, 'config-homologacao.js'), 'utf8');
if (!config.includes('https://xiiudduncvcxcvbgbqpc.supabase.co') || /zzxveirmtgnrokgjthhy|service_role/i.test(config)) {
  throw new Error('A configuração do pacote não está isolada para homologação.');
}
