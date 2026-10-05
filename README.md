# Portal Rio Saúde

Site público da Rio Saúde para calendário de provas, eventos especiais e comunicação de participação dos atletas.

## Produção e arquivos ativos
O GitHub Pages publica a raiz do `main` em https://rio-saude.github.io/rio-saude-eventos-/.

- `index.html`: home com **Primeiro acesso**, **Eventos Oficiais** e **Eventos Especiais** escritos diretamente no HTML. O primeiro acesso abre `onboarding.html`; os eventos mantêm a navegação original por radios/CSS.
- A home carrega, nesta ordem: `race-config-20260930.js?v=portal-20261005`, `https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2` e `race-app-20261001.js?v=onboarding-1.1`. Seu CSS está no próprio HTML. O fragmento `#eventos-oficiais` abre diretamente o calendário existente.
- `race-config-20260930.js`: configuração ativa do calendário e do admin. Não deve inserir ou alterar elementos da home.
- `race-app-20261001.js`: script ativo do calendário, filtros, anos, contadores e avisos de participação. As provas são lidas do Supabase; os eventos especiais e o calendário de fallback permanecem no HTML.
- `onboarding.html`: primeiro acesso existente, com `portal.css`, SDK Supabase `2.117.2`, `config.js` e `onboarding.js`, nessa ordem de scripts. Mantém o acesso por link no e-mail e as etapas do cadastro.
- `config.js`: configuração do onboarding, incluindo os links opcionais de EFI e WhatsApp. Não é carregado pela home nem pelo admin. Não deve inserir elementos na home.
- `admin.html`: painel privado da equipe; carrega `race-config-20260930.js`, SDK Supabase `@2` e seu próprio script inline.
- `supabase-schema.sql`: banco, segurança e funções do admin.

### Duplicados e versões antigas confirmados em 05/10/2026
- `app.js` era uma cópia idêntica de `race-app-20261001.js` na revisão de 05/10/2026; permanece como legado e não recebe as melhorias da V1.1. Nenhuma página o carrega.
- `race-app-20260930.js` e `race-app-20260930b.js` são versões anteriores; nenhuma página as carrega.
- Esses três arquivos foram mantidos apenas como legado. **Não editar esses arquivos para alterar o site publicado**; usar o script ativo acima.
- `config.js` e `race-config-20260930.js` atendem páginas diferentes e não são intercambiáveis: o primeiro contém também as opções do onboarding. Ambos agora contêm apenas configuração; a home não depende mais de injeção de HTML por JavaScript.

Não alterar o conteúdo das provas nem o funcionamento atual do calendário sem necessidade. Não reaplicar os SQLs para uma alteração visual da home.

### Onboarding V1.1
As opções rápidas e o texto complementar usam o campo existente `primary_goal` (opção e texto separados por uma quebra de linha). Textos antigos continuam disponíveis. `goal_event_name` é preservado, e a escolha de prova leva ao calendário em outra aba para manter o formulário em andamento. A resposta “Sim” também direciona o responsável inicial para Dum; sem prova ou data, permanece Pedrinho. Não há migração de banco.

O formulário de aviso preenche campos vazios a partir de `athlete_profiles` do usuário da sessão, respeitando as políticas existentes e sem sobrescrever digitação manual. O botão financeiro usa apenas `efiPaymentUrl`; enquanto vazio, fica indisponível com orientação e opção “Fazer depois”.

## Validação da home
Servir a pasta com um servidor HTTP local e conferir:
1. As três opções da home aparecem também com JavaScript desativado.
2. Primeiro acesso abre o onboarding existente e o link de retorno abre a home.
3. Eventos Oficiais abre o calendário; os seis filtros, a seleção de ano e abrir/cancelar os avisos continuam funcionando.
4. Eventos Especiais abre os cards existentes e os detalhes de Itatiaia; o retorno à home funciona.
5. Conferir desktop/mobile, console e respostas do Supabase sem cadastrar atletas ou enviar e-mails de teste em produção.
6. Após publicar no `main`, conferir o deploy **pages build and deployment**, o SHA e o conteúdo servido na URL pública.

## Regra do cadastro
O botão da Rio Saúde serve para **avisar a equipe**. Ele não substitui a inscrição oficial da prova.

Status previstos:
- `interest` — atleta tem interesse.
- `going` — atleta pretende participar / já decidiu.
- `group_interest` — atleta quer entrar na contagem para possível inscrição em grupo da Rio Saúde.

## Segurança
O admin nunca deve usar senha escrita no HTML. O acesso é feito por autenticação do Supabase e allowlist de e-mails em `admin_emails`.

## Migração
Enquanto `registrationEnabled=false` em `race-config-20260930.js`, o site mantém o Google Forms atual como fallback.
Depois de criar/conectar o Supabase:
1. aplicar `supabase-schema.sql`;
2. cadastrar os e-mails admin;
3. preencher `supabaseUrl` e `supabaseAnonKey` em `race-config-20260930.js`;
4. alterar `registrationEnabled` para `true`.

## Operação mensal
No dia 1 de cada mês, revisar provas relevantes no Rio de Janeiro, calendários de maratonas e cupons/parcerias. O calendário público deve priorizar eventos realmente úteis para os atletas da Rio Saúde.
