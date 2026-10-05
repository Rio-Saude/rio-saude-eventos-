# Efí ↔ Portal — V1 de homologação

A etapa Financeiro do onboarding carrega os dois planos ativos em `billing_plans`. O aluno escolhe um plano e o frontend envia **somente `plan_code`** para `efi-create-subscription` com o JWT da sessão Supabase.

A função verifica o usuário pelo Supabase Auth, encontra seu `athlete_profiles` e valida nome, sobrenome, e-mail, CPF normalizado e nascimento. Preço, moeda, intervalo e `efi_plan_id_homolog` vêm do banco; não são aceitos no JSON do navegador. Os dados do perfil não são duplicados na tabela financeira.

O endpoint oficial `/v1/plan/:id/subscription/one-step/link` não oferece um objeto `customer` para pré-preenchimento. Por isso, a assinatura fica vinculada ao perfil no Portal, e os dados do pagador são informados na página hospedada da Efí. Não enviamos campos fora do schema, não coletamos cartão e não guardamos respostas brutas do provedor.

## Limite de ambiente

- A função exige `EFI_ENV=homologation` e usa exclusivamente `EFI_CLIENT_ID_HOMOLOG` / `EFI_CLIENT_SECRET_HOMOLOG`.
- O endereço da API está fixo em `https://cobrancas-h.api.efipay.com.br`; não há fallback de produção.
- As credenciais de produção permanecem intocadas. Não usamos os nomes genéricos `EFI_CLIENT_ID` / `EFI_CLIENT_SECRET`.
- `SUPABASE_SERVICE_ROLE_KEY` fica somente na Edge Function. JWT da sessão é verificado por `auth.getUser`, além do `verify_jwt=true` da plataforma.
- Nenhum webhook é criado ou informado. Gerar um link mantém `status=pending`; isso não confirma pagamento ou ativa o plano no Portal.

## Persistência e duplicação

Migração aplicada: `supabase/migrations/20261005201819_efi_homolog_checkout.sql` (nome gerado pelo CLI, alinhado à versão registrada no servidor). Adiciona ambiente, estado de criação, URL/validade, ID da cobrança, status Efí e valor contratado. Preserva os campos e políticas de leitura existentes; somente o servidor grava as tabelas financeiras.

O índice único por perfil/ambiente para `pending`, `active` e `past_due` reserva a assinatura antes do POST externo, incluindo cliques concorrentes e abas diferentes. O `custom_id` na Efí é o UUID dessa reserva.

- `reserved` / `requested`: tentativa em andamento, não criar outra.
- `ready`: retornar o mesmo link válido do mesmo plano.
- Outro plano, assinatura ativa ou link vencido: bloquear nova criação e orientar atendimento.
- `failed`: falha antes do POST de criação (por exemplo OAuth); permite nova tentativa.
- `review`: resultado externo incerto ou falha em salvar o resultado; **não repetir o POST automaticamente**. Conferir a Efí pelo `custom_id` antes de qualquer liberação. Se houve criação, reconciliar seus IDs/link na mesma reserva. Só liberar após comprovar que não existe assinatura externa.

O Portal permanece na etapa financeira quando o aluno sai para a Efí. Ao voltar pode continuar o onboarding pelo fluxo existente, sem considerar o link como confirmação de pagamento.

## Como testar

1. Entrar por OTP com a conta de teste e conferir nome, CPF e nascimento.
2. Abrir **Meu cadastro → dados pessoais → perfil esportivo → Financeiro**.
3. Conferir **1 modalidade — R$390/mês** e **2+ modalidades — R$490/mês**.
4. Escolher um plano e clicar **Cadastrar pagamento**. Deve abrir a página HTTPS da Efí de homologação; não informar cartão real.
5. Conferir em `billing_subscriptions` a mesma pessoa/plano, `environment=homologation`, ID Efí, URL, valor e `status=pending` / `creation_state=ready`.
6. Voltar e clicar no mesmo plano novamente: deve reutilizar a reserva/link, sem outro ID Efí. Selecionar outro plano deve exibir uma orientação, sem criar uma segunda assinatura.
7. Sem sessão ou com CPF incompleto, não deve criar assinatura. **Fazer depois** continua para as provas como antes.

Testes de lógica (sem credenciais ou cartão):

```sh
node --test supabase/functions/efi-create-subscription/core.test.mjs
```

Cobrem os dois planos, concorrência, reuso, validação/autenticação, recusa de produção, timeout, falha de persistência e URL de redirecionamento. Os testes de navegador locais cobrem desktop/mobile com APIs simuladas. O teste real deve ser registrado separadamente, sem afirmar confirmação de pagamento enquanto não houver webhook.

Referências: [assinaturas/link Efí](https://dev.efipay.com.br/docs/api-cobrancas/assinatura/), [autenticação de Edge Functions](https://supabase.com/docs/guides/functions/auth-headers).
