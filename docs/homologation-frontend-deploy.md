# Publicação do frontend de homologação

O workflow `.github/workflows/homologation-pages.yml` executa somente na branch
`feat/onboarding-experimental-crm`. Ele roda os testes de contrato, gera o
pacote estático a partir de `homologacao-publica/` e só então pode publicar o
artefato `homologacao-publica/dist`. Migrações, Edge Functions, segredos e
arquivos fora desse diretório não participam do deploy.

## Ativação única no Cloudflare Pages

Esta etapa exige uma conta Cloudflare autorizada pelo proprietário, portanto não
foi executada automaticamente. No repositório GitHub, configure:

1. Crie um projeto **Cloudflare Pages** exclusivo de homologação, por exemplo
   `rio-saude-homologacao`. Não conecte a produção nem a branch `main`.
2. Crie um token Cloudflare com escopo mínimo **Cloudflare Pages: Edit** apenas
   na conta que contém esse projeto.
3. Em *Settings > Secrets and variables > Actions* do repositório, cadastre os
   secrets `CLOUDFLARE_API_TOKEN` e `CLOUDFLARE_ACCOUNT_ID` e a variable
   `CLOUDFLARE_PAGES_PROJECT` com o nome do projeto. Não envie esses valores
   pelo chat nem os coloque em arquivos versionados.
4. Faça um push na branch de homologação. O job **Validar frontend de
   homologação** precisa passar para liberar **Publicar no Cloudflare Pages**.
   O endereço estável será `https://<nome-do-projeto>.pages.dev`.

O workflow interrompe a publicação quando os testes falham. Quando os valores
acima não existem, o job de deploy é explicitamente ignorado e nada é
publicado. Para reverter, execute o workflow em um commit anterior aprovado ou
republique esse commit pelo painel Cloudflare Pages; nunca use `main`.

## Depois de criar o domínio

Antes de usá-lo para OTP e financeiro, inclua exatamente o domínio HTTPS do
Pages nas URLs de redirecionamento permitidas de **Supabase Auth** do projeto
`xiiudduncvcxcvbgbqpc` e na allowlist de CORS da Edge Function `efi-billing`.
Mantenha as origens locais e a URL atual de homologação durante a transição.
Teste OTP, `efi-billing` e o checkout Efí no novo domínio antes de trocar o
link compartilhado. O Supabase de produção não participa dessa configuração.

## Diagnóstico

Abra a aba **Actions** do GitHub e selecione *Homologação - frontend estático*.
O artefato `rio-saude-homologacao-publica` permite inspecionar exatamente o que
foi publicado. Falhas de teste impedem o upload ao Cloudflare. Falhas de CORS,
OTP ou Edge Functions não devem ser contornadas removendo autenticação: revise
as allowlists do ambiente de homologação.
