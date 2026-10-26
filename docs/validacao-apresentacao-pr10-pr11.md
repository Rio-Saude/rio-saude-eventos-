# Rio Saúde — validação das PRs #10 e #11

26/10/2026. Base `8235df1`; PR #10 `cd7d56d`; PR #11 `2c2b732`. A #11 contém integralmente a #10. Ordem de integração: #10 em main, depois #11 em main, preservando os commits da #10 (se houver squash, revisar novamente a base e o diff da #11).

## Correções locais preparadas

- Carrossel: impede recentralização durante uma pausa com o dedo pressionado; mantém swipe, teclado, indicadores e redução de movimento.
- Seletores dos preços: mantém a posição da tela quando os horários acima mudam de altura, inclusive no WebKit.
- Horários: restaura as observações existentes sobre referências dos mapas e confirmação de encontros.
- Foto “Treine onde quiser”: mantém a imagem externa aprovada; usa a foto local em caso de falha, com texto alternativo correto, sem tentar novamente a cada troca de esporte. A imagem ocupa o bloco sem provocar mudança de altura quando carrega. Cache do JS/CSS atualizado para 10.1.

Visual preservado; o único ajuste adicional de CSS estabiliza a imagem dentro do bloco existente. Os oito cards comerciais e o código de cálculo foram comparados integralmente com a base e estão preservados (apenas atributos de filtro Online adicionados pela #11). Cadastro, Apps Script, Sheets, dados de horários, alunos, provas, financeiro e TrainingPeaks sem alterações. Sport Lab separado; nenhum plano Trail.

## Testes

Resultado final: 24 grupos aprovados em Chromium e 24 em WebKit; zero falhas, zero erros JavaScript e zero respostas HTTP de erro no tráfego normal. 200 combinações de plano/período verificadas. Teste adicional de toque aprovado: 12 swipes, com pausa durante o gesto e mudança de largura. A falha externa simulada é intencional e resultou na imagem local carregada.

Suítes: `tests/apresentacao-v10.test.cjs` e `tests/apresentacao-v10-touch.test.cjs`; instruções em `tests/README-apresentacao-v10.md`.

Chromium/Edge e WebKit, larguras 320, 390, 768, 1024 e 1440 px: seleções nos dois blocos, quatro combinações formato/esporte, Sport Lab, expansões, observações, URLs Maps, comparação, preços e períodos, destinos de cadastro e WhatsApp, menu/teclado, imagens, transbordamento e quatro páginas detalhadas. Carrossel nos dois sentidos com movimento normal e reduzido; teste adicional com eventos reais de toque em Chromium, pausa de 400 ms e mudança de largura. Foto externa carregada e indisponibilidade simulada com fallback local.

O formulário real do Apps Script abriu corretamente. Nenhum cadastro, mensagem ou pagamento enviado; escrita no Sheets não exercitada. Testes móveis emulados, sem aparelho físico. Capturas e JSON ficam nas pastas `review-pr10-pr11-final-chromium` e `review-pr10-pr11-final-webkit`, ao lado deste checkout.

## Bloqueios de publicação

Os checks remotos das duas PRs estão com falha. Os logs consultados identificam configuração de infraestrutura:

- [Pages — #10](https://dash.cloudflare.com/?to=/df6fc986455688f108dc24ee2760ffd6/pages/view/rio-saude-homologacao/2ace7317-112a-435e-8a2f-f2502f560b0b) e [Pages — #11](https://dash.cloudflare.com/?to=/df6fc986455688f108dc24ee2760ffd6/pages/view/rio-saude-homologacao/a4c04878-bb88-4c12-85ee-96a016676e4d): executa `node scripts/build-homologation-public.mjs`, ausente nas branches destas PRs; saída configurada como `homologacao-publica/dist`. Esse script pertence à branch de outro fluxo de homologação; não foi importado para a apresentação.
- [Workers — #11](https://dash.cloudflare.com/df6fc986455688f108dc24ee2760ffd6/workers/services/view/rio-saude-eventos/production/builds/c82f20ca-120a-473f-9614-54796e706c01): comando `npx wrangler preview` falha por ausência do bloco `previews`. O check Workers da #10 também está com falha. Não foram alteradas configurações ou disparados novos deploys.

Antes de publicar: aprovar e incorporar o patch local na #11; ajustar o escopo/configuração dos checks Cloudflare para essas branches sem mudar os outros sistemas; obter checks válidos; autorizar a integração #10 → #11 e a publicação no destino correto. Não aprovar publicação enquanto os builds estiverem falhando. Uma conferência em iPhone físico continua recomendada.

Sem push, merge, publicação de site ou implantação de Apps Script. As correções estão apenas na branch local `validacao/pr10-pr11`, para revisão e aprovação.
