# Rio Saúde — Central de Eventos e Provas

Site público da Rio Saúde para calendário de provas, eventos especiais e comunicação de participação dos atletas.

## Produção
- `index.html`: calendário público.
- `config.js`: configuração do cadastro/banco.
- `app.js`: fluxo de interesse / participação / inscrição em grupo.
- `admin.html`: painel privado da equipe.
- `supabase-schema.sql`: banco, segurança e funções do admin.

## Regra do cadastro
O botão da Rio Saúde serve para **avisar a equipe**. Ele não substitui a inscrição oficial da prova.

Status previstos:
- `interest` — atleta tem interesse.
- `going` — atleta pretende participar / já decidiu.
- `group_interest` — atleta quer entrar na contagem para possível inscrição em grupo da Rio Saúde.

## Segurança
O admin nunca deve usar senha escrita no HTML. O acesso é feito por autenticação do Supabase e allowlist de e-mails em `admin_emails`.

## Migração
Enquanto `registrationEnabled=false` em `config.js`, o site mantém o Google Forms atual como fallback.
Depois de criar/conectar o Supabase:
1. aplicar `supabase-schema.sql`;
2. cadastrar os e-mails admin;
3. preencher `supabaseUrl` e `supabaseAnonKey`;
4. alterar `registrationEnabled` para `true`.

## Operação mensal
No dia 1 de cada mês, revisar provas relevantes no Rio de Janeiro, calendários de maratonas e cupons/parcerias. O calendário público deve priorizar eventos realmente úteis para os atletas da Rio Saúde.
