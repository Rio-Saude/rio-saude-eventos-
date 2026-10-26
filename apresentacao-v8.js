(() => {
  'use strict';
  const nav=document.querySelector('#nav-dialog'),toggle=document.querySelector('#nav-toggle');
  if(nav&&toggle){
    const close=()=>{nav.close();toggle.setAttribute('aria-expanded','false')};
    toggle.addEventListener('click',()=>{nav.showModal();toggle.setAttribute('aria-expanded','true')});
    nav.querySelector('.nav-close').addEventListener('click',close);
    nav.addEventListener('close',()=>toggle.setAttribute('aria-expanded','false'));
    nav.addEventListener('click',e=>{if(e.target===nav){const r=nav.getBoundingClientRect();if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom)close()}});
    nav.querySelectorAll('a').forEach(a=>a.addEventListener('click',close));
  }
  // V9.2: cópias simétricas, sem reset ao mudar a altura do Safari.
  document.querySelectorAll('[data-carousel]').forEach(box=>{
    const track=box.querySelector('.carousel-track'),real=[...track.children];
    const loop=box.dataset.carousel==='concepts';
    const mobile=matchMedia('(max-width:800px)');
    const reduced=matchMedia('(prefers-reduced-motion: reduce)');
    let active=0,timer,rebasing=false,before=[],after=[];
    if(loop){
      const clone=original=>{
        const card=original.cloneNode(true);
        card.classList.add('loop-clone');
        card.setAttribute('aria-hidden','true');
        card.inert=true;
        card.querySelectorAll('[id]').forEach(e=>e.removeAttribute('id'));
        return card;
      };
      before=real.map(clone);after=real.map(clone);
      track.prepend(...before);track.append(...after);
    }
    const dots=[...box.querySelectorAll('[data-dot]')];
    const mark=()=>{
      dots.forEach((b,i)=>b.setAttribute('aria-current',String(i===active)));
      const status=box.querySelector('[data-carousel-status]');
      if(status)status.textContent=`${String(active+1).padStart(2,'0')} / ${String(real.length).padStart(2,'0')}`;
    };
    const offset=card=>card.offsetLeft-track.offsetLeft;
    const recenter=index=>{
      rebasing=true;
      const previous=track.style.scrollSnapType;
      track.style.scrollSnapType='none';
      track.scrollTo({left:offset(real[index]),behavior:'instant'});
      requestAnimationFrame(()=>{
        track.style.scrollSnapType=previous;
        rebasing=false;
      });
    };
    const settle=()=>{
      if(!mobile.matches||rebasing)return;
      const all=[...track.children];
      const nearest=all.reduce((a,b)=>Math.abs(offset(a)-track.scrollLeft)<=Math.abs(offset(b)-track.scrollLeft)?a:b);
      const position=all.indexOf(nearest);
      active=loop?(position-real.length+real.length*3)%real.length:real.indexOf(nearest);
      if(loop&&(position<real.length||position>=2*real.length))recenter(active);
      mark();
    };
    const go=(n,behavior='smooth')=>{
      const next=loop?(n+real.length)%real.length:Math.max(0,Math.min(real.length-1,n));
      if(mobile.matches){
        let destination=real[next];
        if(loop&&active===0&&n===-1)destination=before[real.length-1];
        if(loop&&active===real.length-1&&n===real.length)destination=after[0];
        track.scrollTo({left:offset(destination),behavior:reduced.matches?'instant':behavior});
      }
      active=next;mark();
    };
    box.querySelectorAll('[data-step]').forEach(b=>b.addEventListener('click',()=>go(active+Number(b.dataset.step))));
    dots.forEach((b,i)=>b.addEventListener('click',()=>go(i)));
    track.addEventListener('scroll',()=>{
      if(!mobile.matches||rebasing)return;
      clearTimeout(timer);timer=setTimeout(settle,150);
    },{passive:true});
    track.addEventListener('scrollend',()=>{clearTimeout(timer);settle()});
    track.addEventListener('keydown',e=>{
      if(e.key==='ArrowRight'||e.key==='ArrowLeft'){
        e.preventDefault();go(active+(e.key==='ArrowRight'?1:-1));
      }
    });
    const reset=()=>{
      clearTimeout(timer);
      if(mobile.matches)recenter(active);
      else track.scrollTo({left:0,behavior:'instant'});
      mark();
    };
    mobile.addEventListener('change',reset);
    if(mobile.matches)recenter(0);
    mark();
  });
  const params=new URLSearchParams(location.search),selected=params.get('modalidade');
  if(typeof choosePlan==='function'&&['corrida','tri','lab','online'].includes(selected))choosePlan(selected);
  document.querySelectorAll('[data-plan-target]').forEach(a=>a.addEventListener('click',()=>{if(typeof choosePlan==='function')choosePlan(a.dataset.planTarget)}));
  // V10: duas decisões simples — formato e esporte — para modalidades e preços.
  const training=document.querySelector('#modalidades');
  const prices=document.querySelector('#planos');
  if(training&&prices&&window.RioSaude){
    const scenic="https://images.unsplash.com/photo-1610066370580-f698d2ccfb69?auto=format&fit=crop&w=1200&q=78";
    const state={
      mode:selected==='online'?'online':'presencial',
      sport:selected==='tri'?'tri':'corrida',
      lab:selected==='lab'
    };
    const el=(tag,cls,value)=>{
      const node=document.createElement(tag);
      if(cls)node.className=cls;
      if(value!==undefined)node.textContent=value;
      return node;
    };
    const photo=training.querySelector('#training-photo');
    const caption=training.querySelector('#training-photo-caption');
    const schedules=training.querySelector('#training-schedules');
    const label=training.querySelector('#training-context');
    const title=training.querySelector('#training-title');
    const description=training.querySelector('#training-description');
    const benefits=training.querySelector('#training-benefits');
    const sportLabel={corrida:'Corrida',tri:'Triathlon'};
    const copy={
      presencial:{
        corrida:'Planilha individual, professores presentes e treinos em grupo na Lagoa, no Aterro e na Barra. Escolha a base que cabe na sua rotina.',
        tri:'Natação, ciclismo e corrida organizados em um planejamento individual. Treinos de corrida e ciclismo com a equipe; natação com Denise tem contratação separada.'
      },
      online:{
        corrida:'Planejamento individual de corrida pelo TrainingPeaks, revisão semanal e contato com o treinador. Você treina onde estiver, sem precisar morar no Rio.',
        tri:'Natação, ciclismo e corrida em um planejamento integrado, com análise da evolução, revisão semanal e contato com o treinador — de qualquer cidade.'
      }
    };
    const perks={
      presencial:{corrida:['Planilha individual','Treinos com professores','Lagoa · Aterro · Barra'],tri:['Três modalidades','Ciclismo e corrida em grupo','Natação parceira à parte']},
      online:{corrida:['TrainingPeaks','Revisão semanal','Contato com treinador'],tri:['Três modalidades','Revisão semanal','Contato com treinador']}
    };
    const buildSchedules=()=>{
      schedules.replaceChildren();
      const show=state.mode==='presencial'&&!state.lab;
      schedules.hidden=!show;
      if(!show)return;
      const source=window.RioSaude[state.sport];
      const groups=state.sport==='tri'
        ?[source.groups[1],source.groups[0],source.groups[2],source.groups[3]]
        :source.groups;
      const heading=el('div','training-schedule-head');
      heading.append(el('h3','',state.sport==='tri'?'Encontros e horários':'Onde treinamos'),el('p','', 'Abra uma atividade para consultar dias, horários e pontos de encontro.'));
      schedules.append(heading);
      groups.forEach((group,i)=>{
        if(!group)return;
        const details=el('details','training-schedule-group');
        details.open=i===0;
        const summary=el('summary','',group.title);
        const body=el('div','training-schedule-body');
        if(group.intro)body.append(el('p','training-schedule-note',group.intro));
        const items=group.reuse?window.RioSaude[group.reuse].groups[0].items:(group.items||[]);
        items.forEach(item=>{
          const row=el('article','training-place');
          row.append(el('h4','',item.name));
          const timing=Array.isArray(item.times)?item.times.join(' · '):(item.times||'');
          const when=el('p','',item.days+(timing?' · '+timing:''));
          row.append(when);
          if(item.meeting)row.append(el('p','training-place-meeting','Ponto: '+item.meeting));
          if(item.map){
            const link=el('a','training-map','Como chegar ↗');
            link.href='https://www.google.com/maps/search/?api=1&query='+encodeURIComponent(item.map);
            link.target='_blank';link.rel='noopener noreferrer';row.append(link);
          }
          body.append(row);
        });
        details.append(summary,body);
        schedules.append(details);
      });
    };
    const renderPrices=()=>{
      document.querySelectorAll('[data-price-mode]').forEach(button=>{
        const chosen=!state.lab&&button.dataset.priceMode===state.mode;
        button.classList.toggle('active',chosen);
        button.setAttribute('aria-pressed',String(chosen));
      });
      document.querySelectorAll('[data-price-sport]').forEach(button=>{
        const chosen=!state.lab&&button.dataset.priceSport===state.sport;
        button.classList.toggle('active',chosen);
        button.setAttribute('aria-pressed',String(chosen));
      });
      const labButton=document.querySelector('[data-price-lab]');
      if(labButton){
        labButton.classList.toggle('active',state.lab);
        labButton.setAttribute('aria-pressed',String(state.lab));
      }
      const plan=state.lab?'lab':state.mode==='online'?'online':state.sport;
      document.querySelectorAll('[data-online-sport]').forEach(card=>{
        card.hidden=state.mode==='online'&&!state.lab&&card.dataset.onlineSport!==state.sport;
      });
      if(typeof choosePlan==='function')choosePlan(plan);
    };
    const renderTraining=()=>{
      const online=state.mode==='online';
      const name=sportLabel[state.sport];
      label.textContent=online?'ONLINE · TODO O BRASIL':'PRESENCIAL · RIO DE JANEIRO';
      title.textContent=name+(online?' online':' presencial');
      description.textContent=copy[state.mode][state.sport];
      benefits.replaceChildren(...perks[state.mode][state.sport].map(v=>el('span','',v)));
      photo.src=online?scenic:'assets/apresentacao-v7/corrida.webp';
      photo.alt=online?'Corredor em uma trilha de montanhas verdes':'Atletas da Rio Saúde treinando corrida no Rio de Janeiro';
      caption.textContent=online?'Treine onde quiser.':'Treine junto. Evolua do seu jeito.';
      document.querySelectorAll('[data-training-mode]').forEach(button=>{
        const chosen=button.dataset.trainingMode===state.mode;
        button.classList.toggle('active',chosen);
        button.setAttribute('aria-pressed',String(chosen));
      });
      document.querySelectorAll('[data-training-sport]').forEach(button=>{
        const chosen=button.dataset.trainingSport===state.sport;
        button.classList.toggle('active',chosen);
        button.setAttribute('aria-pressed',String(chosen));
      });
      buildSchedules();
    };
    const render=()=>{renderTraining();renderPrices()};
    photo.addEventListener('error',()=>{
      if(photo.src.startsWith('https://images.unsplash.com/'))
        photo.src='assets/apresentacao-v7/atitude.webp';
    });
    document.querySelectorAll('[data-training-mode],[data-price-mode]').forEach(button=>button.addEventListener('click',()=>{
      state.mode=button.dataset.trainingMode||button.dataset.priceMode;
      state.lab=false;render();
    }));
    document.querySelectorAll('[data-training-sport],[data-price-sport]').forEach(button=>button.addEventListener('click',()=>{
      state.sport=button.dataset.trainingSport||button.dataset.priceSport;
      state.lab=false;render();
    }));
    document.querySelectorAll('[data-price-lab],[data-show-lab]').forEach(button=>button.addEventListener('click',()=>{
      state.lab=true;renderPrices();
    }));
    render();
  }

  const host=document.querySelector('[data-locations]');
  if(host&&window.RioSaude){
    const data=window.RioSaude[host.dataset.locations];
    const photoNames={corrida:'Atletas da Rio Saúde correndo em grupo.',grupo:'Alunos da Rio Saúde treinando juntos.',performance:'Corredora da Rio Saúde à frente de um pelotão.',atitude:'Atleta da Rio Saúde durante uma corrida.',comunidade:'Participantes da Rio Saúde após um treino.',hero:'Corredora da Rio Saúde durante um treino ao ar livre.'};
    const make=(tag,cls,text)=>{const e=document.createElement(tag);if(cls)e.className=cls;if(text)e.textContent=text;return e};
    data.groups.forEach(group=>{
      const section=make('section','schedule-group');section.append(make('h2','',group.title));if(group.intro)section.append(make('p','',group.intro));const grid=make('div','location-grid');
      const items=group.reuse?window.RioSaude[group.reuse].groups[0].items:group.items;
      items.forEach(item=>{
        const article=make('article','location-card'),img=make('img');img.src=`assets/apresentacao-v7/${item.image}.webp`;img.alt=photoNames[item.image];img.loading='lazy';img.decoding='async';img.width=1200;img.height=800;article.append(img);const copy=make('div','location-copy');copy.append(make('div','eyebrow',item.sport),make('h3','',item.name));const dl=make('dl');
        [['Dias',item.days],['Horários',item.times],['Ponto de encontro',item.meeting],['Endereço / referência',item.address]].forEach(([title,value])=>{dl.append(make('dt','',title));const dd=make('dd');if(Array.isArray(value))value.forEach(v=>dd.append(make('span','',v)));else dd.textContent=value;dl.append(dd)});copy.append(dl);
        if(item.note)copy.append(make('p','location-note',item.note));
        if(item.map){const a=make('a','link-bold','Como chegar ↗');a.href='https://www.google.com/maps/search/?api=1&query='+encodeURIComponent(item.map);a.target='_blank';a.rel='noopener noreferrer';copy.append(a)}else copy.append(make('p','map-pending','Combine o ponto exato com a equipe antes de sair.'));
        article.append(copy);grid.append(article)
      });section.append(grid);host.append(section)
    });
  }
})();
