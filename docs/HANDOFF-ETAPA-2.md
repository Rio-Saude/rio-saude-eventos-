# Handoff — encerramento da Etapa 1

Atualizado em 22/10/2026. Este documento encerra a V1 de homologação; a Etapa
2 não foi iniciada.

## 1. Arquitetura e serviços

- Frontend estático HTML/CSS/JavaScript, com pacote público em
  `homologacao-publica/dist`.
- Supabase **somente de homologação**: `xiiudduncvcxcvbgbqpc` (Auth OTP,
  Postgres, RLS, Edge Functions e `pg_cron`).
- Efí em sandbox, por meio de `efi-billing`, `efi-webhook` e
  `efi-billing-cron`.
- Preview público atual hospedado no Sites:
  `https://rio-saude-homologacao-20261021.balmypuppy7.chatgpt.site`.
- Evolution API preparada em fila; envio desligado sem credenciais e flag
  explícita de homologação.

Produção (`zzxveirmtgnrokgjthhy`) é estritamente fora de escopo e não foi
acessada nesta etapa.

## 2. Branch e referência

Trabalhar exclusivamente em `feat/onboarding-experimental-crm`. A correção
remota `cb15c035` preserva `offer=standard` após OTP. Consulte o log da branch
para o commit final desta entrega antes de iniciar trabalho novo.

## 3. URLs de homologação

- Landing: `https://rio-saude-homologacao-20261021.balmypuppy7.chatgpt.site/`
- Onboarding: `/onboarding-homologacao.html`
- Minha assinatura: `/minha-assinatura-homologacao.html`
- Administração comercial: `/admin-comercial-homologacao.html`

As páginas usam apenas `config-homologacao.js`, que aponta para o projeto
Supabase de homologação. Não há fallback por parâmetro de URL para produção.

## 4. Arquivos relevantes

- `onboarding.js`: OTP, perfil, esporte, PAR-Q, financeiro e TrainingPeaks.
- `homologacao-publica/`: fonte do pacote público; `dist/` é o único diretório
  que deve ser publicado.
- `supabase/functions/efi-billing/index.ts`: ações financeiras autenticadas.
- `supabase/functions/efi-billing-cron/index.ts`: execução interna diária.
- `supabase/functions/efi-webhook/index.ts`: conciliação idempotente Efí.
- `supabase/migrations/` e `supabase/homologation/`: histórico SQL; não rodar
  em produção.
- `tests/*.test.mjs`: testes de contrato.
- `docs/homologation-frontend-deploy.md`: CI/CD e reversão.

## 5. Financeiro V1

- Quatro planos Efí de homologação ativos, com preço validado no backend.
- `offer=trial` permite uma única experiência de 30 dias por CPF; o backend
  decide a elegibilidade. `offer=standard` não concede nova gratuidade.
- Boleto: emissão agendada no 20º dia e vencimento no 30º dia; não representa
  pagamento confirmado.
- Cartão: checkout hospedado Efí é criado no 25º dia, com lembrete no 31º;
  não há cartão, CVV ou token armazenado no portal.
- Cancelamento depende de confirmação do provedor e preserva acesso até o fim
  da experiência quando aplicável.
- Assinatura criada, boleto emitido e pagamento confirmado são estados
  distintos. Webhook confiável é a origem da confirmação.

## 6. Autenticação, PAR-Q e TrainingPeaks

Login é por OTP de seis dígitos. O perfil é vinculado ao `user_id` e retoma
etapas salvas. PAR-Q mantém suas dez perguntas e regras; suas respostas não
aparecem no funil comercial. TrainingPeaks permanece acessível ao concluir o
onboarding, inclusive com financeiro pendente ou experiência autorizada.

## 7. Evolution API

Existe uma fila persistente e idempotente de avisos financeiros. O envio fica
inativo até `EVOLUTION_SEND_ENABLED_HOMOLOG=true` e credenciais de homologação
válidas. Não habilitar sem teste autorizado. A tabela de tentativas não é
exposta a `anon` ou `authenticated`.

## 8. Testes

**Comprovados:** testes de contrato automatizados, isolamento do pacote de
homologação, regras de oferta, RLS prevista em migrações, criação de link de
checkout hospedado no sandbox, boleto, cancelamento antes da cobrança,
idempotência da rotina e ausência de confirmação financeira fictícia.

**Simulados por contrato:** passagem do tempo (dias 20/25/30/31), bloqueio de
segunda gratuidade, falhas de provedor e prevenção de duplicidade nos caminhos
de código.

**Pendentes de comprovação final:** pagamento efetivamente confirmado no
sandbox com cartão, webhook correspondente e validação OTP no futuro domínio
Cloudflare. Não declarar pronto para produção enquanto esses itens não forem
executados.

## 9. Segurança

- Não expor `service_role`, credenciais Efí, segredo do cron ou Evolution.
- Ações financeiras do aluno validam JWT no handler; o cron usa segredo interno
  lido do Vault e não aceita chamadas públicas.
- RLS restringe dados de alunos ao dono e painéis administrativos a
  autorizados. Evitar qualquer autorização com `user_metadata`.
- `efi-billing` aceita CORS somente de origens de homologação conhecidas.
  Adicionar novo domínio somente após ele existir e ser aprovado.

## 10. Impedimentos para produção

Faltam confirmação de pagamento/webhook de cartão no sandbox, definição e
teste da hospedagem automática estável, CORS/redirect de tal domínio, revisão
operacional dos avisos Evolution e validação integral de homologação. Nenhuma
migração ou deploy de produção deve ser feito nesta etapa.

## 11. Desenvolvimento e publicação

1. Atualizar a branch, editar somente o escopo aprovado e rodar:
   `node --test tests/financial-homologation-contract.test.mjs tests/commercial-crm-contract.test.mjs`.
2. Gerar o pacote: `node scripts/build-homologation-public.mjs`.
3. Publicar a prévia atual apenas pelo mecanismo de Sites enquanto Cloudflare
   não estiver ativado.
4. Para CI/CD, seguir `docs/homologation-frontend-deploy.md`. Frontend é
   separado de SQL, Edge Functions e segredos; push nunca executa migrações.
5. Não fazer force push nem tocar em `main` ou no projeto de produção.

## 12. Próxima etapa: área do aluno (não implementar agora)

Criar **Meu espaço** após o onboarding, com os quatro acessos: Minhas provas,
Meu plano, Meus dados e Meus treinos. Incluir calendário e interesse/inscrição
em provas, reformulação premium de Meu plano, edição de dados, acesso direto
ao TrainingPeaks, entrada direta no Meu espaço, contraste do PAR-Q e uma
autorização de WhatsApp mais simples com canal alternativo. Preservar as regras
e dados da V1.
