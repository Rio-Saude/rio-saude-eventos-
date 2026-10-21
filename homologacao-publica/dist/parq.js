// PAR-Q Anexo I e Termo Anexo II da Lei RJ 6.765/2014.
(() => {
  'use strict';
  const QUESTIONS=["Algum médico já disse que você possui algum problema de coração ou pressão arterial, e que somente deveria realizar atividade física supervisionado por profissionais de saúde?","Você sente dores no peito quando pratica atividade física?","No último mês, você sentiu dores no peito ao praticar atividade física?","Você apresenta algum desequilíbrio devido à tontura e/ou perda momentânea da consciência?","Você possui algum problema ósseo ou articular, que pode ser afetado ou agravado pela atividade física?","Você toma atualmente algum tipo de medicação de uso contínuo?","Você realiza algum tipo de tratamento médico para pressão arterial ou problemas cardíacos?","Você realiza algum tratamento médico contínuo, que possa ser afetado ou prejudicado com a atividade física?","Você já se submeteu a algum tipo de cirurgia, que comprometa de alguma forma a atividade física?","Sabe de alguma outra razão pela qual a atividade física possa eventualmente comprometer sua saúde?"];
  const TERM="Declaro que estou ciente de que é recomendável conversar com um médico, antes de iniciar ou aumentar o nível de atividade física pretendido, assumindo plena responsabilidade pela realização de qualquer atividade física sem o atendimento desta recomendação.";
  const version='rj_6765_2014_annex_i_v1';
  const escape=s=>String(s==null?'':s).replace(/&/g,'&amp;')
    .replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
  const age=birth=>{
    if(!/^\d{4}-\d{2}-\d{2}$/.test(String(birth||'')))return null;
    const [y,m,d]=birth.split('-').map(Number);
    const t=new Date();
    return t.getFullYear()-y-((t.getMonth()+1<m || (t.getMonth()+1===m && t.getDate()<d))?1:0);
  };
  const recent=r=>{
    const n=Date.parse(r?.signed_at||'');
    return r?.form_version===version && Number.isFinite(n) &&
      n<=Date.now() && n>Date.now()-365*86400000;
  };
  function render({client,user,profile,root,next,back}) {
    root.innerHTML=`
      <div class="step-kicker">3 de 5 · Saúde e segurança</div>
      <h2>Prontidão para atividade física</h2>
      <p class="lead">Responda às 10 perguntas previstas na Lei Estadual nº 6.765/2014 do Rio de Janeiro.</p>
      <div id="parq-body"><p class="field-help">Verificando seu questionário...</p></div>
      <div class="actions"><button type="button" id="parq-back" class="text-btn">Voltar</button></div>`;
    root.querySelector('#parq-back').addEventListener('click',back);
    const area=root.querySelector('#parq-body');
    let saving=false;
    const showForm=()=>{
      const minor=age(profile.birth_date)<18;
      const inputs=QUESTIONS.map((question,i)=>`
        <fieldset class="parq-question"><legend>${i+1}. ${escape(question)}</legend>
          <div class="parq-options">
            <label class="parq-option"><input type="radio" name="q${i+1}" value="yes" required><span>Sim</span></label>
            <label class="parq-option"><input type="radio" name="q${i+1}" value="no" required><span>Não</span></label>
          </div>
        </fieldset>`).join('');
      area.innerHTML=`
        <form id="parq-form">
          <p class="field-help">Essas respostas são informações sensíveis, armazenadas separadamente dos dados financeiros e protegidas por acesso restrito.</p>
          ${inputs}
          <h3>Termo de responsabilidade para prática de atividade física</h3>
          <p class="parq-term">${escape(TERM)}</p>
          ${minor?'<div class="notice">O responsável legal pelo menor deve preencher, assinar e autorizar sua participação por escrito.</div>':''}
          ${minor?'<div class="field"><label for="parq-signer">Nome completo do responsável legal</label><input id="parq-signer" name="signed_name" maxlength="160" autocomplete="name" required></div>':''}
          ${minor?'<label class="check parq-accept"><input type="checkbox" name="guardian_accept" required> Sou o responsável legal e autorizo por escrito a participação do menor, observadas as condições de saúde e segurança.</label>':''}
          <label class="check parq-accept"><input type="checkbox" name="term_accept" required> Li e aceito o termo e confirmo que respondi com sinceridade.</label>
          <p class="field-help">Local da declaração: ${escape(profile.city||'Rio de Janeiro')}. A data e hora são registradas pelo servidor, e a confirmação fica vinculada à conta autenticada.</p>
          <p id="parq-status" class="status" role="status" aria-live="polite"></p>
          <div class="actions"><button class="primary-btn" type="submit">Confirmar e continuar</button></div>
        </form>`;
      area.querySelector('#parq-form').addEventListener('submit',async event=>{
        event.preventDefault();
        if(saving) return;
        const form=event.currentTarget, fd=new FormData(form);
        const own=[profile.first_name,profile.last_name].map(x=>String(x||'').trim()).join(' ').trim();
        const name=minor?String(fd.get('signed_name')||'').trim():own;
        const errorEl=form.querySelector('#parq-status');
        const setError=msg=>{errorEl.className='status error';errorEl.textContent=msg;};
        if(name.length<3) {
          setError(minor?'Digite o nome completo do responsável legal.':'Confira seu nome completo nos dados pessoais antes de continuar.');
          return;
        }
        if(!fd.has('term_accept') || (minor&&!fd.has('guardian_accept'))){
          setError('Confirme o termo de responsabilidade e a autorização.');
          return;
        }
        const body={signed_name:name,signed_city:String(profile.city||'Rio de Janeiro').trim(),declaration_accepted:true,signer_role:minor?'guardian':'athlete',
          guardian_name:minor?name:null,guardian_authorization_accepted:minor};
        for(let i=1;i<=10;i++){
          const answer=fd.get('q'+i);
          if(answer!=='yes'&&answer!=='no'){setError('Responda todas as perguntas.');return;}
          body['q'+i]=answer==='yes';
        }
        saving=true;
        form.querySelectorAll('button').forEach(x=>x.disabled=true);
        errorEl.className='status';
        errorEl.textContent='Salvando seu PAR-Q...';
        try{
          const {data,error}=await client.from('health_screenings').insert(body)
            .select('signed_at,screening_result,form_version').single();
          if(error)throw error;
          if(!root.isConnected)return;
          if(data.screening_result==='medical_review_required')showReceipt(data);
          else await next();
        }catch(error){
          console.error('Erro ao salvar PAR-Q',error);
          if(form.isConnected)setError('Não foi possível salvar o questionário. Tente novamente.');
        }finally{
          saving=false;
          if(form.isConnected)form.querySelectorAll('button').forEach(x=>x.disabled=false);
        }
      });
    };
    const showReceipt=data=>{
      const positive=data.screening_result==='medical_review_required';
      area.innerHTML=`
        <div class="success-box"><strong>PAR-Q registrado em ${escape(new Date(data.signed_at).toLocaleDateString('pt-BR'))}.</strong>
          <p>Suas respostas estão salvas no histórico privado.</p></div>
        ${positive?'<div class="notice"><strong>Importante:</strong> uma ou mais respostas foram Sim. Para iniciar os treinos é preciso apresentar atestado médico de aptidão e aguardar a conferência pela Rio Saúde.</div>':''}
        <div class="actions"><button type="button" id="parq-next" class="primary-btn">Continuar</button>
          <button type="button" id="parq-again" class="secondary-btn">Responder novamente</button></div>`;
      area.querySelector('#parq-next').addEventListener('click',next);
      area.querySelector('#parq-again').addEventListener('click',showForm);
    };
    client.from('health_screenings').select('signed_at,screening_result,form_version')
      .eq('user_id',user.id).order('signed_at',{ascending:false}).limit(1).maybeSingle()
      .then(({data,error})=>{
        if(!area.isConnected)return;
        if(error)throw error;
        if(recent(data))showReceipt(data);
        else showForm();
      }).catch(error=>{
        console.error('Erro ao carregar PAR-Q',error);
        if(!area.isConnected)return;
        area.innerHTML='<div class="status error">Não foi possível verificar seu PAR-Q. Recarregue a página.</div><button type="button" class="secondary-btn" id="parq-retry">Tentar novamente</button>';
        area.querySelector('#parq-retry').addEventListener('click',()=>render({client,user,profile,root,next,back}));
      });
  }
  window.RioSaudePARQ={render,questions:QUESTIONS,version};
})();

