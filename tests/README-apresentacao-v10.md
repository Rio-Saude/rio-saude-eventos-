# Validação combinada das PRs #10 e #11

Pré-requisitos: Node.js e Playwright disponível no `NODE_PATH`, Microsoft Edge e o navegador WebKit do Playwright instalado. Execute na raiz do checkout:

```powershell
node tests/apresentacao-v10.test.cjs
node tests/apresentacao-v10-touch.test.cjs
```

`TEST_ENGINES=chromium` ou `webkit` permite rodar um motor; `TEST_WIDTHS=320,390,768,1024,1440` define as larguras; `REVIEW_OUT` define a pasta das capturas e do `report.json` (por padrão, fora do repositório).

O teste principal verifica arquivos protegidos contra a base `8235df1`, identidade dos oito cards comerciais e do código de cálculo, seletores sincronizados, horários e observações, URLs Maps, comparação, Sport Lab, imagens e fallback, navegação, teclado, movimento reduzido e quatro páginas detalhadas. São 20 combinações de plano/período por largura e motor. Nenhum plano Trail é criado.

O teste de toque usa eventos de toque do Chromium, com dois ciclos completos em cada sentido e pausa de 400 ms com o dedo pressionado. A versão original recentralizava o conteúdo durante essa pausa; a regressão verifica que a posição permanece estável até soltar o dedo. Também verifica mudança de largura.

Links de cadastro, Maps e WhatsApp são interceptados no teste principal. Não há envio de cadastro, mensagem, pagamento ou escrita no Sheets. Abertura real do formulário foi conferida separadamente, sem preencher dados. WebKit emulado não substitui um teste em iPhone físico.
