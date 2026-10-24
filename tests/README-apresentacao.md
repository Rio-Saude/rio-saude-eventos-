# Testes da apresentação V8

Requer Node.js, Playwright disponível no `NODE_PATH` (ou instalado no ambiente) e Microsoft Edge. Nenhuma dependência foi adicionada aos sistemas existentes. Para outro Chromium compatível, configure `BROWSER_CHANNEL`.

A partir da raiz do repositório:

```powershell
node tests/apresentacao-v8.test.cjs
node tests/apresentacao-v8-links.test.cjs
```

Para repetir no site publicado:

```powershell
node tests/apresentacao-v8.test.cjs https://rio-saude.github.io/rio-saude-eventos-
node tests/apresentacao-v8-links.test.cjs https://rio-saude.github.io/rio-saude-eventos-
```

As capturas e relatórios são gravados ao lado do checkout em `review-v8/` ou `review-v8-live/`, fora do conteúdo publicado.

Cobertura: cinco páginas em 360, 375, 390, 412 e 1366 px; menu/teclado; transições entre páginas; conceitos circulares com rolagem manual; expansões; quatro treinadores; história; 100 estados comerciais, incluindo prestações; preservação da seção comercial, cálculo e seis fotos da V7; integridade do SVG original; links de planos; links Maps; abertura do questionário a partir do botão da apresentação; ausência de transbordamento e erros de execução/rede. O teste público também compara o HTML servido com o arquivo aprovado.

O questionário é apenas aberto e lido. Não são preenchidos nem enviados cadastros. WhatsApp e Maps são interceptados no navegador de teste para verificar os destinos sem mensagens ou alterações externas. Os testes V7 anteriores do workspace foram preservados; os novos seletores refletem a retirada intencional dos elementos legados solicitada para a V8.
