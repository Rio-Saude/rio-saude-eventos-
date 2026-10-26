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
  // V9: selecionar a modalidade revela cards na mesma página, reutilizando os dados oficiais.
  const modalityButtons=[...document.querySelectorAll('.modality-card[data-modality]')];
  const modalityDetail=document.querySelector('#modality-detail');
  if(modalityButtons.length&&modalityDetail&&window.RioSaude){
    const track=modalityDetail.querySelector('#modality-detail-track');
    const more=modalityDetail.querySelector('#modality-detail-more');
    const plans=modalityDetail.querySelector('#modality-detail-plans');
    const pages={corrida:'apresentacao-corrida.html',tri:'apresentacao-triathlon.html',lab:'apresentacao-sport-lab.html',online:'apresentacao-online.html'};
    const planKeys={corrida:'corrida',tri:'tri',lab:'lab',online:'online'};
    const element=(tag,cls,value)=>{const e=document.createElement(tag);if(cls)e.className=cls;if(value)e.textContent=value;return e};
    const controls=modalityDetail.querySelector('.modality-scroll-controls');
    const updateControls=()=>{controls.hidden=track.scrollWidth<=track.clientWidth+1};
    new ResizeObserver(updateControls).observe(track);
    let active='';
    const fill=(key)=>{
      const data=window.RioSaude[key];
      if(!data)return;
      modalityDetail.querySelector('#modality-detail-title').textContent=data.title;
      modalityDetail.querySelector('#modality-detail-intro').textContent=data.description;
      more.href=pages[key];
      plans.dataset.planTarget=planKeys[key];
      track.replaceChildren();
      data.groups.forEach(group=>{
        const items=group.reuse?window.RioSaude[group.reuse].groups[0].items:(group.items||[]);
        if(!items.length&&group.intro){
          const card=element('article','modality-detail-card');
          card.append(element('span','eyebrow',group.title),element('h4','',group.title),element('p','',group.intro));
          track.append(card);
        }
        items.forEach(item=>{
          const card=element('article','modality-detail-card');
          card.append(element('span','eyebrow',group.title),element('h4','',item.name));
          card.append(element('p','modality-card-days',item.days||''));
          const times=Array.isArray(item.times)?item.times.join(' · '):(item.times||'');
          if(times)card.append(element('p','modality-card-time',times));
          if(item.meeting)card.append(element('p','modality-card-meeting','Ponto de encontro: '+item.meeting));
          track.append(card);
        });
      });
      if(!track.children.length){
        const card=element('article','modality-detail-card');
        card.append(element('span','eyebrow','COMO FUNCIONA'),element('h4','',data.intro),element('p','',data.description));
        track.append(card);
      }
      updateControls();
      track.scrollTo({left:0,behavior:'instant'});
    };
    modalityButtons.forEach(button=>button.addEventListener('click',()=>{
      const key=button.dataset.modality;
      if(active===key){
        active='';modalityDetail.hidden=true;
        modalityButtons.forEach(b=>{b.classList.remove('is-active');b.setAttribute('aria-expanded','false')});
        return;
      }
      active=key;modalityDetail.hidden=false;fill(key);
      modalityButtons.forEach(b=>{const selected=b.dataset.modality===key;b.classList.toggle('is-active',selected);b.setAttribute('aria-expanded',String(selected))});
      if(matchMedia('(max-width:800px)').matches)requestAnimationFrame(()=>modalityDetail.scrollIntoView({behavior:matchMedia('(prefers-reduced-motion:reduce)').matches?'instant':'smooth',block:'start'}));
    }));
    modalityDetail.querySelectorAll('[data-modality-scroll]').forEach(button=>button.addEventListener('click',()=>{
      const direction=Number(button.dataset.modalityScroll);
      const card=track.firstElementChild;
      if(card)track.scrollBy({left:direction*(card.getBoundingClientRect().width+14),behavior:matchMedia('(prefers-reduced-motion:reduce)').matches?'instant':'smooth'});
    }));
    plans.addEventListener('click',()=>{if(typeof choosePlan==='function'&&active)choosePlan(planKeys[active])});
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
