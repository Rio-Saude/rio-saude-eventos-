# Rio Saúde — PAR-Q RJ (implementado em 20/10/2026)

- Questionário: 10 itens Sim/Não do Anexo I da Lei RJ nº 6.765/2014.
- Termo: Anexo II, declaração e nome digitado no fluxo autenticado.
- Etapas: dados pessoais → perfil esportivo → PAR-Q → financeiro → TrainingPeaks.
- Código: `parq.js`, `onboarding.js`, `portal.css` e `onboarding.html`.
- Histórico privado: `public.health_screenings`, incluindo assinatura, localidade e data do servidor.
- Menores de 18 anos: o sistema solicita assinatura do responsável e declaração de autorização.
- Resultado com resposta positiva: exigência de atestado médico informada; nenhuma liberação automática para treinamento.
- Painel restrito: `admin-parq.html`, com `admin_parq_status()` mostrando somente status, sem respostas.
- Proteções: RLS, ausência de acesso anônimo, respostas imutáveis para usuários comuns e assinatura adulta conferida no banco.
- Reavaliação: renovação após 365 dias ou quando a condição de saúde mudar.

## Ainda a validar antes de liberar para todos os alunos
- Teste completo no navegador de uma conta nova e de uma conta já concluída.
- Conferência jurídica da assinatura eletrônica adotada para o termo e da autorização de responsável legal.
- Procedimento administrativo para receber, analisar e arquivar atestado quando houver alguma resposta positiva.
- Política de privacidade e registros de tratamento de dados sensíveis; acesso mínimo por função.
- Processo de notificar os alunos quando a triagem vencer.

## Histórico de concepção
# Rio Saúde — Triagem PAR-Q (rascunho técnico, NÃO PUBLICADO)

Estado em 2026-10-20: **apenas banco preparado**. Não inserir esta etapa no fluxo público
nem enviar lembretes até validar conteúdo, termo, responsáveis legais e acesso da equipe.

## Fonte e versão
Versão jurídica proposta: Lei RJ nº 6.765/2014, Anexo I (10 respostas Sim/Não).
https://www.cremerj.org.br/resolucoes/exibe/weblei/1437
https://www.legisweb.com.br/legislacao/?id=272340

**Atenção:** PAR-Q clássico internacional = 7 perguntas; Anexo I da Lei RJ = 10.
No clássico, Q3 fala de dor *fora* da atividade; no texto da Lei RJ, Q3 fala
de dor *ao praticar atividade*. Não substituir uma redação pela outra sem revisão.

## Questões do Anexo I da Lei RJ
1. Algum médico já disse que você possui algum problema de coração ou pressão arterial, e que somente deveria realizar atividade física supervisionado por profissionais de saúde?
2. Você sente dores no peito quando pratica atividade física?
3. No último mês, você sentiu dores no peito ao praticar atividade física?
4. Você apresenta algum desequilíbrio devido à tontura e/ou perda momentânea da consciência?
5. Você possui algum problema ósseo ou articular, que pode ser afetado ou agravado pela atividade física?
6. Você toma atualmente algum tipo de medicação de uso contínuo?
7. Você realiza algum tipo de tratamento médico para pressão arterial ou problemas cardíacos?
8. Você realiza algum tratamento médico contínuo, que possa ser afetado ou prejudicado com a atividade física?
9. Você já se submeteu a algum tipo de cirurgia, que comprometa de alguma forma a atividade física?
10. Sabe de alguma outra razão pela qual a atividade física possa eventualmente comprometer sua saúde?

## Fluxo desejado
1. Dados pessoais.
2. Perfil esportivo e próximas provas.
3. PAR-Q RJ e termo de responsabilidade assinado — nova etapa.
4. Contratação e Efí (continua homologação).
5. TrainingPeaks.

Cada questão exige Sim/Não explícito, sem seleção prévia. Não misturar perguntas de
saúde ao perfil comercial. Registrar a versão integral do formulário no histórico.
Manter o aluno apto a concluir os campos administrativos mesmo que responda Sim;
**não liberar treino automaticamente**. Uma resposta Sim exige encaminhamento para
avaliação e atestado, conforme legislação aplicável. Respostas negativas também
não substituem avaliação individual apropriada.
Menores: o responsável legal preenche e assina com autorização escrita.
Antes de ativar: validar o termo do Anexo II, forma de assinatura e registros,
período de renovação adotado (meta operacional anual), privacidade, acesso clínico
e protocolo de revisão pela equipe.

## Segurança já criada
- Migração: `20261020102346_prepare_private_parq_rj_health_screenings.sql`.
- `public.health_screenings`: dados de saúde separados, versão das perguntas,
  10 campos booleanos, aceite, nome digitado, data atribuída pelo banco,
  resultado `medical_review_required` ou `no_positive_responses`.
- Histórico append-only: usuário não pode atualizar nem apagar respostas antigas.
- RLS: somente conta autenticada com perfil pode inserir; SELECT só do proprietário.
- Sem papel de treinador ou administrador com leitura indiscriminada nesta fase.
- Nenhum cadastro/validação pública habilitada nesta fase.

## Antes da publicação
- Concluir cópia do termo, política LGPD, acesso mínimo de profissionais autorizados,
  assinatura eletrônica e assinatura/guarda do responsável por menores.
- Criar mecanismo de revisão de atestado e status de liberação distinto do resultado
  do questionário. Nunca habilitar treino pela mera conclusão do formulário.
- Validar usuário A não lê dados de B, inserção não falsifica assinatura/timestamp
  e anonimato não tem acesso, além de testes de ponta a ponta.
