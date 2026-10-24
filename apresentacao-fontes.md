# V8 — fontes e informações pendentes

Escopo: apresentação pública, seus recursos e quatro páginas de modalidades. Base: V7 / commit 73ce8108f4f8a8683e918b7a08ac2e57fd8b39b5.

- Preços, cards comerciais, tabelas, descontos, parcelamentos, cadastro e WhatsApp: preservados do HTML e script da V7. Nenhuma regra importada do site institucional, que apresenta condições diferentes.
- Horários de corrida e ciclismo: programação da V7, mantida em `apresentacao-dados.js`. Os três encontros externos são terça, sexta e sábado; quarta indoor aparece separadamente. A V7 não explica a correspondência entre 4h10/4h30 e os pontos de saída; essa informação não foi inventada.
- Natação com Denise: dias e contratação separada da V7. Horários precisam de confirmação; o site antigo contém outra grade e não foi usado para substituir condições vigentes.
- Referências adicionais verificadas no site institucional da própria assessoria, https://riosaudeonline.com.br/, consultado em 23/10/2026: ciclovia da Lagoa entre Gastão Bahiana e Vinícius de Moraes; Copacabana em frente à Rua Souza Lima; base Península na Barra; retratos e marca.
- Coordenadas de Lagoa e Copacabana: convertidas dos marcadores DMS publicados nos embeds Maps do site institucional (não dos centros de câmera): 22°58'43.7"S 43°12'04.3"W; 22°59'02.3"S 43°11'21.4"W. Os links usam Maps universal `search/?api=1&query=`.
- Aterro: referência fornecida no pedido, passarela em frente à Praia do Flamengo, 200. O endereço numerado também consta em documento público da Finep: https://www.finep.gov.br/images/licitacoes/2019/Licitacao012019/190612_Planilha_Oramento_estimado.pdf . A coordenada exata/lado da passarela não foi validada; o mapa abre apenas a referência do endereço, como indicado no card.
- Sport Lab: endereço da V7 (Visconde de Pirajá, 444, sala 209), também confirmado na relação de parceiros https://energylab.com.br/parceiros/ . Não há grade completa nem vagas confirmadas; não foram inventadas.
- Fotografias de treinos: os seis arquivos aprovados da V7, sem substituição. São imagens de treino da assessoria, não documentação de cada local.
- Retratos reais, identificados nominalmente na página institucional: `assets/img/robertoTadao.jpg`, `pedroMoreira.jpg`, `antonioJosiano.jpg`, `victorHugo.jpg`. Reutilizados localmente com otimização de formato, sem imagens artificiais.
- Currículos: texto da V7; formação e conquistas adicionais apenas onde verificáveis na seção de equipe do site institucional. Nenhuma afirmação antiga de cargo externo atual, matrícula profissional ou especialização em andamento foi promovida a dado atual.
- Marca oficial: SVG fornecido pelo usuário, copiado sem alterações para `assets/apresentacao-v8/simbolo-oficial.svg` (SHA-256 A9C354E3F3056216D39C9D58EB9D59FE4828DDCAB4BFDA0F80389D9AD6F74703). Aplicação monocromática clara em fundos escuros via CSS, preservando o vetor original. O PNG institucional pesquisado inicialmente não é utilizado.

## Informações ainda necessárias

Grade completa de turmas do Sport Lab; horários vigentes da natação; ponto exato de saída de cada encontro de ciclismo e correspondência 4h10/4h30; ponto exato da base Península e lado da passarela no Aterro; formação acadêmica detalhada de Pedro Moreira e atualização completa dos currículos quando desejada. A interface identifica as lacunas operacionais sem criar horários ou coordenadas fictícios.
