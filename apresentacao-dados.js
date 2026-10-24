/* Dados públicos da apresentação. Horários comerciais preservados da V7.
   Referências: apresentacao-fontes.md. null significa informação ainda não confirmada. */
window.RioSaude = {
  corrida: {
    title: 'Corrida', kicker: 'CORRIDA PRESENCIAL',
    intro: 'Do primeiro treino à próxima maratona.',
    description: 'Planejamento individual pelo TrainingPeaks, análise da evolução e professores presentes nos treinos. Escolha a base que combina com sua rotina e confira as condições do seu plano.',
    image: 'corrida',
    groups: [{title:'Três bases. O seu ponto de partida.', items:[
      {name:'Lagoa Rodrigo de Freitas', sport:'Corrida presencial', image:'corrida', days:'Segunda a sábado', times:['Segunda e quarta · 6h–8h30','Terça e quinta · 6h–10h e 17h30–19h30','Sexta e sábado · 6h–10h'], meeting:'Ciclovia entre as ruas Gastão Bahiana e Vinícius de Moraes.', address:'Lagoa Rodrigo de Freitas · Rio de Janeiro', map:'-22.9788056,-43.2011944', note:'10h é o encerramento habitual na Lagoa.'},
      {name:'Aterro do Flamengo',sport:'Corrida presencial',image:'grupo',days:'Terça e quinta',times:['6h–8h30'],meeting:'Passarela em frente à Praia do Flamengo, 200.',address:'Praia do Flamengo, 200 · referência para o encontro',map:'Praia do Flamengo 200 Rio de Janeiro',note:'O mapa abre a referência de endereço. Confirme com a equipe o lado da passarela e o ponto exato antes do primeiro treino.'},
      {name:'Barra · Península',sport:'Corrida presencial',image:'performance',days:'Terça e quinta',times:['6h–8h30'],meeting:'Base Península. Combine o ponto exato com a equipe.',address:'Península · Barra da Tijuca, Rio de Janeiro',map:'Península Barra da Tijuca Rio de Janeiro',note:'O mapa indica a região; o ponto de encontro precisa ser confirmado.'}
    ]}]
  },
  tri: {
    title:'Triathlon',kicker:'NATAÇÃO · CICLISMO · CORRIDA',intro:'Três modalidades. Um planejamento.',
    description:'Natação, ciclismo e corrida integrados em um plano individual. Análise de ritmo, potência e evolução para preparar cada etapa da sua prova. O planejamento das três modalidades faz parte do acompanhamento; a natação com Denise tem contratação e pagamento separados.',image:'performance',
    groups:[
      {title:'Corrida · três bases para treinar.',reuse:'corrida'},
      {title:'Ciclismo · três encontros ao ar livre.',items:[
        {name:'Lagoa → APCC Aterro',sport:'Ciclismo em grupo',image:'atitude',days:'Terça-feira',times:['4h10 / 4h30'],meeting:'Saída da Lagoa em direção à APCC. Confirme o ponto e a qual saída corresponde cada horário.',address:'Lagoa → Aterro do Flamengo',map:null,note:'A programação indica dois horários. Combine a saída correspondente e o local exato com o treinador.'},
        {name:'Vista Chinesa',sport:'Ciclismo em grupo',image:'grupo',days:'Sexta-feira',times:['6h'],meeting:'Ponto de saída a combinar com o treinador.',address:'Região da Vista Chinesa · Rio de Janeiro',map:null,note:'Não se dirija ao mirante sem confirmar o ponto de saída do grupo.'},
        {name:'Longo da semana',sport:'Ciclismo em grupo',image:'corrida',days:'Sábado',times:['5h'],meeting:'Percurso e ponto de saída definidos para cada semana.',address:'Programação da assessoria',map:null,note:'Combine distância, percurso e encontro com seu treinador.'}
      ]},
      {title:'Natação · encontros com Denise.',intro:'Atividade presencial contratada e paga separadamente. Confirme as condições vigentes com a parceira.',items:[
        {name:'Aterro do Flamengo',sport:'Natação · parceria Denise',image:'comunidade',days:'Terça e quinta',times:['Horário a confirmar com Denise'],meeting:'Ponto de encontro a confirmar com a parceira.',address:'Aterro do Flamengo · Rio de Janeiro',map:null,note:'Wellhub e TotalPass no Aterro conforme as condições da parceira.'},
        {name:'Copacabana',sport:'Natação no mar · parceria Denise',image:'hero',days:'Quarta e sexta',times:['Horário a confirmar com Denise'],meeting:'Areia em frente à Rua Souza Lima. Confirme o encontro com a parceira.',address:'Praia de Copacabana · altura da Rua Souza Lima',map:'-22.9839722,-43.1892778',note:'A programação depende das condições e da orientação da parceira.'}
      ]},
      {title:'Ciclismo indoor · Sport Lab.',intro:'A programação V7 também prevê uma sessão indoor às quartas-feiras, em horário a combinar com o treinador. Consulte condições de participação e agendamento.',items:[]}
    ]
  },
  lab:{title:'Sport Lab',kicker:'FORÇA PARA ENDURANCE',intro:'Força para ir mais longe.',description:'Treinamento de força para corrida e triathlon: potência, estabilidade e trabalho específico para endurance. Aulas agendadas de 60 minutos, em grupos de até quatro pessoas ou com personal trainer. O espaço também recebe ciclismo indoor, conforme programação e agendamento.',image:'atitude',groups:[{title:'Seu treino em Ipanema.',items:[
    {name:'42+ Sport Lab',sport:'Força e ciclismo indoor',image:'comunidade',days:'Turmas com agendamento',times:['Aulas de força · 60 minutos','Indoor às quartas · horário a combinar'],meeting:'Rua Visconde de Pirajá, 444, sala 209.',address:'Ipanema · Rio de Janeiro',map:'Rua Visconde de Pirajá 444 Ipanema Rio de Janeiro',note:'Confirme a grade de turmas e as vagas com a equipe. O agendamento não garante disponibilidade.'}
  ]}]},
  online:{title:'Online',kicker:'ACOMPANHAMENTO REMOTO',intro:'Seu treinador, onde você estiver.',description:'Planejamento de corrida ou triathlon pelo TrainingPeaks, análise da evolução e revisão semanal dos treinos. Contato semanal por WhatsApp, com resposta em até 24 horas em dias úteis. O acompanhamento remoto não inclui treinos presenciais em grupo.',image:'hero',groups:[]}
};
