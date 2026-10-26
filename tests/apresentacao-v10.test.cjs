/* Read-only regression suite: never submits registration or sends WhatsApp. */
const fs=require('node:fs'),path=require('node:path'),http=require('node:http');
const assert=require('node:assert/strict'),{execFileSync}=require('node:child_process');
const {chromium,webkit}=require('playwright');
const root=path.resolve(__dirname,'..'),out=process.env.REVIEW_OUT||path.resolve(root,'../review-pr10-pr11');
fs.mkdirSync(out,{recursive:true});
const report={cases:[],failures:[],errors:[],network:[],engines:[]};
const check=async(name,fn)=>{try{await fn();report.cases.push(name);console.log('PASS',name)}catch(e){report.failures.push({name,error:e.stack});console.log('FAIL',name,e.message)}};
const read=f=>fs.readFileSync(path.join(root,f),'utf8').replace(/\r\n/g,'\n');
const main=f=>execFileSync('git',['show','8235df1:'+f],{cwd:root,encoding:'utf8'}).replace(/\r\n/g,'\n');
const server=http.createServer((req,res)=>{try{const f=path.resolve(root,'.'+decodeURIComponent(req.url.split('?')[0]));if(!f.startsWith(root+path.sep))throw Error();res.setHeader('Content-Type',f.endsWith('.html')?'text/html; charset=utf-8':f.endsWith('.js')?'application/javascript':f.endsWith('.css')?'text/css':f.endsWith('.svg')?'image/svg+xml':'image/webp');res.end(fs.readFileSync(f))}catch{res.writeHead(404);res.end()}});
const money=n=>new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL'}).format(n);
(async()=>{
 await check('Protected systems, price attributes, commercial calculation unchanged',async()=>{
  const changed=execFileSync('git',['diff','8235df1','--name-only'],{cwd:root,encoding:'utf8'}).trim().split('\n');
  assert.ok(changed.every(f=>['apresentacao.html','apresentacao-v8.js','apresentacao-v8.css'].includes(f)||f.startsWith('tests/')||f.startsWith('docs/')));
  const source=read('apresentacao.html'),old=main('apresentacao.html');
  assert.deepEqual([...source.matchAll(/data-plan-name="[^"]+" data-monthly-price="[^"]+"/g)].map(m=>m[0]),[...old.matchAll(/data-plan-name="[^"]+" data-monthly-price="[^"]+"/g)].map(m=>m[0]));
  const cards=s=>[...s.matchAll(/<article class="plan-card[\s\S]*?<\/article>/g)].map(m=>m[0].replace(/ data-online-sport="[^"]+"/g,''));
  assert.deepEqual(cards(source),cards(old));
  const calculation=s=>s.slice(s.indexOf('const moneyBRL='),s.indexOf('/* V9: comparação'));
  assert.equal(calculation(source),calculation(old));
  new Function(read('apresentacao-v8.js'));for(const m of source.matchAll(/<script>([\s\S]*?)<\/script>/g))new Function(m[1]);
 });
 await new Promise(r=>server.listen(0,'127.0.0.1',r));const base='http://127.0.0.1:'+server.address().port;
 for(const engine of process.env.TEST_ENGINES?.split(',')||['chromium','webkit']){
  const browser=await ({chromium,webkit}[engine]).launch(engine==='chromium'?{headless:true,channel:'msedge'}:{headless:true});report.engines.push(engine);
  try{for(const width of process.env.TEST_WIDTHS?.split(',').map(Number)||[320,390,768,1024,1440]){
   const context=await browser.newContext({viewport:{width,height:900},hasTouch:width<801,isMobile:width<801});
   await context.route(/https:\/\/(wa\.me|www\.google\.com\/maps|script\.google\.com)\//,r=>r.fulfill({status:200,contentType:'text/html',body:'Destination validated; no submission.'}));
   const page=await context.newPage();page.setDefaultTimeout(5000);
   // Start each interaction from a settled viewport; WebKit may still be scrolling after an element screenshot.
   const clickChoice=async selector=>{const button=page.locator(selector);await button.evaluate(e=>e.scrollIntoView({block:'center',behavior:'instant'}));await button.click()};
   const clickPrice=async selector=>{const button=page.locator(selector);await button.evaluate(e=>e.scrollIntoView({block:'center',behavior:'instant'}));const top=await button.evaluate(e=>e.getBoundingClientRect().top);await button.click();await page.waitForTimeout(150);const after=await button.evaluate(e=>e.getBoundingClientRect().top);assert.ok(Math.abs(after-top)<3,`Price control moved after selection: ${top} -> ${after}`)};
   page.on('pageerror',e=>report.errors.push({engine,width,error:e.message}));
   page.on('response',r=>{if(r.status()>=400)report.network.push({engine,width,url:r.url(),status:r.status()})});
   const prefix=engine+' '+width;
   await page.goto(base+'/apresentacao.html');
   await check(prefix+' layout, images, menu, keyboard',async()=>{
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth),width);
    for(const img of await page.locator('img:not(.loop-clone img)').all()){if(await img.isVisible()){await img.scrollIntoViewIfNeeded();await img.evaluate(e=>e.decode())}}
    const ids=await page.locator('[id]').evaluateAll(es=>es.map(e=>e.id));assert.equal(new Set(ids).size,ids.length);
    await page.locator('#nav-toggle').click();assert.ok(await page.locator('#nav-dialog').evaluate(e=>e.open));
    await page.keyboard.press('Escape');await page.waitForFunction(()=>document.querySelector('#nav-toggle').getAttribute('aria-expanded')==='false');
    await page.locator('#nav-toggle').click();await page.locator('#nav-dialog details summary').click();assert.equal(await page.locator('#nav-dialog details a').count(),4);await page.locator('.nav-close').click();
   });
   await check(prefix+' mode/sport, schedules, Maps, comparison, Sport Lab',async()=>{
    for(const mode of ['presencial','online'])for(const sport of ['corrida','tri']){
     await clickChoice(`[data-training-mode=${mode}]`);await clickChoice(`[data-training-sport=${sport}]`);
     assert.equal(await page.locator(`[data-price-mode=${mode}]`).getAttribute('aria-pressed'),'true');assert.equal(await page.locator(`[data-price-sport=${sport}]`).getAttribute('aria-pressed'),'true');
     assert.equal(await page.locator('#training-title').innerText(),(sport==='tri'?'Triathlon':'Corrida')+' '+(mode==='online'?'online':'presencial'));
     assert.equal(await page.locator('.plan-panel:visible').getAttribute('data-panel'),mode==='online'?'online':sport);
     assert.equal(await page.locator('#comparacao').isVisible(),mode==='presencial');
     if(mode==='presencial'){
      const comparison=page.locator('[data-comparison-panel]:visible');await comparison.locator('summary').click();
      if(width<=800){await comparison.locator('select').selectOption('1');assert.ok(await comparison.locator('.comparison-mobile-item').count()>0)}else assert.ok(await comparison.locator('.comparison-table').isVisible());
      await comparison.locator('summary').click();
     }
     if(mode==='online'){assert.equal(await page.locator('[data-online-sport]:visible').count(),1);assert.equal(await page.locator('[data-online-sport]:visible').getAttribute('data-online-sport'),sport);await page.locator('#training-photo').evaluate(e=>e.decode());}
     else{const groups=page.locator('.training-schedule-group');assert.equal(await groups.count(),sport==='tri'?4:1);for(const g of await groups.all()){if(!await g.evaluate(e=>e.open))await g.locator('summary').click();assert.ok(await g.evaluate(e=>e.open))}for(const a of await page.locator('.training-map').all()){const u=new URL(await a.getAttribute('href'));assert.equal(u.hostname,'www.google.com');assert.equal(u.searchParams.get('api'),'1');assert.ok(u.searchParams.get('query'))}const missing=await page.evaluate(sport=>{const data=window.RioSaude;const items=data[sport].groups.flatMap(g=>g.reuse?data[g.reuse].groups[0].items:g.items||[]);return items.filter(i=>i.note&&!document.querySelector('#training-schedules').textContent.includes(i.note)).map(i=>i.name)},sport);assert.deepEqual(missing,[])}
     assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth),width);
     if(width===390||width===1440){await page.locator('#modalidades').screenshot({path:path.join(out,`${engine}-${width}-${mode}-${sport}.png`)});await page.locator('#planos').screenshot({path:path.join(out,`${engine}-${width}-prices-${mode}-${sport}.png`)})}
    }
    await page.locator('[data-show-lab]').click();assert.equal(await page.locator('.plan-panel:visible').getAttribute('data-panel'),'lab');assert.equal(await page.locator('.plan-panel:visible .plan-card').count(),3);assert.equal(await page.locator('#comparacao').isVisible(),false);
    assert.deepEqual(await page.locator('.plan-panel:visible .price').allTextContents(),['R$ 240','R$ 390','R$ 490']);
    for(const mode of ['online','presencial'])for(const sport of ['tri','corrida']){await clickPrice(`[data-price-mode=${mode}]`);await clickPrice(`[data-price-sport=${sport}]`);assert.equal(await page.locator(`[data-training-mode=${mode}]`).getAttribute('aria-pressed'),'true');assert.equal(await page.locator(`[data-training-sport=${sport}]`).getAttribute('aria-pressed'),'true')}
    assert.equal(await page.locator('[data-training-sport*=trail],[data-price-sport*=trail]').count(),0);
   });
   await check(prefix+' prices, terms and CTA destinations',async()=>{
    for(const mode of ['presencial','online'])for(const sport of ['corrida','tri']){
     await clickPrice(`[data-price-mode=${mode}]`);await clickPrice(`[data-price-sport=${sport}]`);
     for(const card of await page.locator('.plan-panel:visible .with-terms:visible').all()){
      const monthly=Number(await card.getAttribute('data-monthly-price'));
      for(const months of [12,6,3,1]){await card.locator(`[data-months="${months}"]`).click();const discount={1:0,3:.05,6:.1,12:.2}[months],total=Math.round(monthly*months*(1-discount)*100)/100;
       assert.equal(await card.locator('.price').innerText(),money(Math.round(total/months*100)/100));assert.ok((await card.locator('.term-meta').innerText()).includes(money(total)));
       const link=await card.locator('.term-cta').getAttribute('href');assert.equal(new URL(link).hostname,months===1?'script.google.com':'wa.me');if(months>1){const msg=new URL(link).searchParams.get('text');assert.ok(msg.includes(await card.getAttribute('data-plan-name')));assert.ok(msg.includes(money(total)))}
      }
     }
    }
    const popupPromise=page.waitForEvent('popup');await page.locator('.training-secondary').click();const popup=await popupPromise;await popup.waitForLoadState();assert.equal(new URL(popup.url()).hostname,'script.google.com');await popup.close();
    const whatsapp=page.waitForEvent('popup');await page.locator('.endlinks a[href*="wa.me"]').click();const wa=await whatsapp;await wa.waitForLoadState();assert.equal(new URL(wa.url()).pathname,'/5521999410202');await wa.close();
   });
   if(width<801)await check(prefix+' carousel bidirectional loop, resize, motion, team',async()=>{
    await page.goto(base+'/apresentacao.html');const tr=page.locator('.concept-track');await tr.scrollIntoViewIfNeeded();await tr.focus();
    for(const motion of ['no-preference','reduce']){
     await page.emulateMedia({reducedMotion:motion});
     for(const dir of [1,-1])for(let i=0;i<6;i++){
      const old=Number(await page.locator('#conceitos [aria-current=true]').getAttribute('data-dot'));await tr.press(dir===1?'ArrowRight':'ArrowLeft');await page.waitForTimeout(700);
      assert.equal(Number(await page.locator('#conceitos [aria-current=true]').getAttribute('data-dot')),(old+dir+3)%3);
      assert.ok(await tr.evaluate(e=>{const originals=[...e.children].filter(c=>!c.classList.contains('loop-clone'));return originals.some(c=>Math.abs(c.offsetLeft-e.offsetLeft-e.scrollLeft)<2)}));
     }
    }
    const before=await tr.evaluate(e=>e.scrollLeft);await page.setViewportSize({width,height:740});await page.waitForTimeout(200);assert.ok(Math.abs(await tr.evaluate(e=>e.scrollLeft)-before)<2);
    if(width===390)await page.locator('#conceitos').screenshot({path:path.join(out,`${engine}-390-concepts.png`)});
    for(let i=0;i<3;i++){await page.locator(`#conceitos [data-dot="${i}"]`).click();await page.waitForTimeout(250);await page.locator('.concept-card:not(.loop-clone) .concept-link').nth(i).click();assert.equal(new URL(page.url()).hash,'#modalidades')}
    await page.locator('#equipe [data-step="1"]').click();await page.waitForTimeout(250);assert.equal(await page.locator('#equipe [aria-current=true]').getAttribute('data-dot'),'1');await page.locator('#equipe [data-step="-1"]').click();await page.waitForTimeout(250);assert.equal(await page.locator('#equipe [aria-current=true]').getAttribute('data-dot'),'0');
   });
   await context.close();
  }
  const context=await browser.newContext({viewport:{width:390,height:844}});const p=await context.newPage();
  await check(engine+' external photo failure fallback and rapid selection',async()=>{
   await context.route('https://images.unsplash.com/**',r=>r.abort());await p.goto(base+'/apresentacao.html');
   for(let i=0;i<3;i++){await p.locator('[data-training-mode=online]').click();await p.locator('#training-photo').scrollIntoViewIfNeeded();await p.waitForFunction(()=>document.querySelector('#training-photo').src.includes('atitude.webp'));await p.locator('#training-photo').evaluate(e=>e.decode());await p.locator('[data-training-sport=tri]').click();await p.locator('#training-photo').evaluate(e=>e.decode());await p.locator('[data-training-mode=presencial]').click()}
  });
  for(const file of ['apresentacao-corrida.html','apresentacao-triathlon.html','apresentacao-sport-lab.html','apresentacao-online.html'])await check(engine+' detail page '+file,async()=>{await p.goto(base+'/'+file);assert.equal(await p.evaluate(()=>document.documentElement.scrollWidth),390);for(const img of await p.locator('img').all()){if(await img.isVisible()){await img.scrollIntoViewIfNeeded();await img.evaluate(e=>e.decode())}}await p.locator('#nav-toggle').click();await p.locator('.nav-close').click()});
  await context.close();
  }finally{await browser.close()}
 }
})().catch(e=>report.failures.push({name:'suite',error:e.stack})).finally(()=>{server.close();fs.writeFileSync(path.join(out,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify({passed:report.cases.length,failures:report.failures,errors:report.errors,network:report.network},null,2));process.exitCode=report.failures.length||report.errors.length?1:0});
