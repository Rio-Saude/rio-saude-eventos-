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
  const dialog=document.querySelector('#info-dialog');
  if(dialog){
    const content={performance:['PERFORMANCE','Treinar com propósito.','Planejamento individual, análise de evolução e testes periódicos. O treinador acompanha as métricas e ajusta o caminho até o seu próximo objetivo.'],individualidade:['INDIVIDUALIDADE','Seu treino faz sentido para você.','Objetivos, rotina e histórico orientam o planejamento. A revisão dos treinos ajuda a ajustar as sessões ao momento de cada atleta.'],comunidade:['COMUNIDADE','O treino termina. A conexão continua.','Treinos coletivos, encontros e experiências compartilhadas. Em provas selecionadas, a equipe organiza apoio; viagens e eventos aproximam quem divide o caminho.']};
    document.querySelectorAll('[data-story]').forEach(b=>b.addEventListener('click',()=>{const [tag,title,text]=content[b.dataset.story];document.querySelector('#dialog-tag').textContent=tag;document.querySelector('#dialog-title').textContent=title;document.querySelector('#dialog-text').textContent=text;dialog.showModal()}));
    document.querySelector('#dialog-close').addEventListener('click',()=>dialog.close());
    dialog.addEventListener('click',e=>{if(e.target===dialog){const r=dialog.getBoundingClientRect();if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom)dialog.close()}});
  }
  document.querySelectorAll('[data-carousel]').forEach(box=>{
    const track=box.querySelector('.carousel-track'),real=[...track.children],loop=box.dataset.carousel==='concepts',mobile=matchMedia('(max-width:800px)');
    let active=0,timer;
    if(loop){for(const [original,where] of [[real.at(-1),'start'],[real[0],'end']]){const clone=original.cloneNode(true);clone.classList.add('loop-clone');clone.setAttribute('aria-hidden','true');clone.inert=true;clone.querySelectorAll('[id]').forEach(e=>e.removeAttribute('id'));where==='start'?track.prepend(clone):track.append(clone)}}
    const dots=[...box.querySelectorAll('[data-dot]')];
    const mark=()=>{dots.forEach((b,i)=>b.setAttribute('aria-current',String(i===active)));const status=box.querySelector('[data-carousel-status]');if(status)status.textContent=`${String(active+1).padStart(2,'0')} / ${String(real.length).padStart(2,'0')}`};
    const offset=e=>e.offsetLeft-track.offsetLeft;
    const go=(n,behavior='smooth')=>{active=loop?(n+real.length)%real.length:Math.max(0,Math.min(real.length-1,n));if(mobile.matches)track.scrollTo({left:offset(real[active]),behavior:matchMedia('(prefers-reduced-motion:reduce)').matches?'instant':behavior});mark()};
    box.querySelectorAll('[data-step]').forEach(b=>b.addEventListener('click',()=>go(active+Number(b.dataset.step))));dots.forEach((b,i)=>b.addEventListener('click',()=>go(i)));
    const settle=()=>{if(!mobile.matches)return;const all=[...track.children];let nearest=all.reduce((a,b)=>Math.abs(offset(a)-track.scrollLeft)<Math.abs(offset(b)-track.scrollLeft)?a:b);if(nearest.classList.contains('loop-clone')){active=nearest===all[0]?real.length-1:0;track.scrollTo({left:offset(real[active]),behavior:'instant'})}else active=real.indexOf(nearest);mark()};
    track.addEventListener('scroll',()=>{clearTimeout(timer);timer=setTimeout(settle,180)},{passive:true});
    track.addEventListener('keydown',e=>{if(e.key==='ArrowRight'||e.key==='ArrowLeft'){e.preventDefault();go(active+(e.key==='ArrowRight'?1:-1))}});
    const reset=()=>{if(mobile.matches)go(active,'instant');else track.scrollTo({left:0,behavior:'instant'})};
    mobile.addEventListener('change',reset);window.addEventListener('resize',reset);requestAnimationFrame(reset);mark();
  });
  const params=new URLSearchParams(location.search),selected=params.get('modalidade');
  if(typeof choosePlan==='function'&&['corrida','tri','lab','online'].includes(selected))choosePlan(selected);
  document.querySelectorAll('[data-plan-target]').forEach(a=>a.addEventListener('click',()=>{if(typeof choosePlan==='function')choosePlan(a.dataset.planTarget)}));
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
