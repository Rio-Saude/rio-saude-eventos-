/* Run: NODE_PATH=<directory containing playwright> node tests/apresentacao-v8.test.cjs [public-base-url]
   Read-only browser tests. No registration submission or WhatsApp message is sent. */
const fs=require('fs'),path=require('path'),http=require('http'),assert=require('node:assert/strict'),{execFileSync}=require('child_process');
const {chromium}=require('playwright');
const crypto=require('node:crypto');
const root=path.resolve(__dirname,'..'),remote=process.argv[2],out=path.resolve(root,'..',remote?'review-v8-live':'review-v8');fs.mkdirSync(out,{recursive:true});
const baseSHA='73ce8108f4f8a8683e918b7a08ac2e57fd8b39b5';const old=execFileSync('git',['show',baseSHA+':apresentacao.html'],{cwd:root,encoding:'utf8'}),current=fs.readFileSync(path.join(root,'apresentacao.html'),'utf8');
assert.equal(crypto.createHash('sha256').update(fs.readFileSync(path.join(root,'assets/apresentacao-v8/simbolo-oficial.svg'))).digest('hex'),'a9c354e3f3056216d39c9d58eb9d59fe4828ddcab4bfda0f80389d9ad6f74703');
const section=s=>s.slice(s.indexOf('<section class="plans shell v7-real-plans"'),s.indexOf('</section>',s.indexOf('<section class="plans shell v7-real-plans"'))+10).replace(/\r\n/g,'\n');assert.equal(section(current),section(old));
const contract=s=>s.slice(s.indexOf('function choosePlan('),s.indexOf("const registration=")).trim();assert.ok(current.includes(contract(old)));assert.equal(execFileSync('git',['diff',baseSHA,'--','assets/apresentacao-v7'],{cwd:root,encoding:'utf8'}),'');
const server=http.createServer((req,res)=>{const p=path.resolve(root,'.'+decodeURI(req.url.split('?')[0]));if(!p.startsWith(root+path.sep)){res.writeHead(403);return res.end()};try{res.setHeader('Content-Type',p.endsWith('.html')?'text/html; charset=utf-8':p.endsWith('.js')?'application/javascript; charset=utf-8':p.endsWith('.css')?'text/css':p.endsWith('.webp')?'image/webp':p.endsWith('.svg')?'image/svg+xml':'text/plain');res.end(fs.readFileSync(p))}catch{res.writeHead(404);res.end()}});
const report={baseSHA,source:remote||'local',commercialSectionUnchanged:true,commercialLogicUnchanged:true,originalPhotosUnchanged:true,pages:[],failures:[]};
const money=n=>new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL'}).format(n);
const pause=ms=>new Promise(r=>setTimeout(r,ms));
(async()=>{await new Promise(r=>server.listen(0,'127.0.0.1',r));const url=remote?remote.replace(/\/$/,''):'http://127.0.0.1:'+server.address().port;const browser=await chromium.launch({headless:true,channel:process.env.BROWSER_CHANNEL||'msedge'});try{
for(const width of [360,375,390,412,1366]){
 const context=await browser.newContext({viewport:{width,height:width===1366?900:844},reducedMotion:'reduce'});const external=[];
 await context.route(/https:\/\/(wa\.me|www\.google\.com\/maps)\//,route=>{external.push(route.request().url());return route.fulfill({status:200,contentType:'text/plain',body:'Destination validated. No message sent.'})});
 for(const mode of ['main','corrida','tri','lab','online']){
 const page=await context.newPage();page.setDefaultTimeout(7000);const errors=[],httpErrors=[];page.on('pageerror',e=>errors.push(e.message));page.on('response',r=>{if(r.status()>=400)httpErrors.push([r.url(),r.status()])});const state={width,mode,errors,httpErrors};report.pages.push(state);
 try{
 const file=mode==='main'?'apresentacao.html':`apresentacao-${mode==='tri'?'triathlon':mode==='lab'?'sport-lab':mode}.html`;
 const response=await page.goto(url+'/'+file);assert.equal(response.status(),200);
 if(remote)assert.equal((await response.text()).replace(/\r\n/g,'\n'),fs.readFileSync(path.join(root,file),'utf8').replace(/\r\n/g,'\n'));
 await page.locator(mode==='main'?'.hero-media img':'.modality-hero img').evaluate(e=>e.decode());await page.screenshot({path:path.join(out,`${mode}-hero-${width}.png`)});
 await page.locator('#nav-toggle').click();assert.ok(await page.locator('#nav-dialog').evaluate(e=>e.open));await page.locator('#nav-dialog details summary').click();assert.equal(await page.locator('#nav-dialog details a').count(),4);await page.keyboard.press('Escape');await page.waitForFunction(()=>document.querySelector('#nav-toggle').getAttribute('aria-expanded')==='false');
 await page.locator('#nav-toggle').click();await page.locator('.nav-close').click();assert.equal(await page.locator('#nav-dialog').evaluate(e=>e.open),false);
 for(const a of await page.locator('a[href*="script.google.com"]').all()){assert.equal(await a.getAttribute('href'),old.match(/const registration='([^']+)'/)[1])}
 if(mode==='main'){
 assert.equal(await page.locator('h1').innerText(),'Correr faz bem.\nJunto muda tudo.');assert.equal(await page.locator('.mobile-dock').count(),0);assert.equal(await page.locator('.quicknav').count(),0);assert.equal(await page.locator('.modality-card').count(),4);assert.equal(await page.locator('.concept-card:not(.loop-clone)').count(),3);
 const concepts=page.locator('[data-carousel="concepts"]');for(const n of [1,2,0]){await concepts.locator('[data-step="1"]').click();await pause(230);assert.equal(await concepts.locator('[aria-current="true"]').getAttribute('data-dot'),String(n))}
 await concepts.locator('[data-dot="2"]').click();await pause(230);
 if(width<800){const tr=concepts.locator('.carousel-track');await tr.scrollIntoViewIfNeeded();const box=await tr.boundingBox();await page.mouse.move(box.x+box.width/2,box.y+Math.min(box.height/2,150));await page.mouse.wheel(420,0);await page.waitForFunction(()=>document.querySelector('[data-carousel="concepts"] [aria-current="true"]').dataset.dot==='0',{},{timeout:3000})}
 for(const button of await page.locator('.concept-card:not(.loop-clone) [data-story]').all()){await button.click();assert.ok(await page.locator('#info-dialog').evaluate(e=>e.open));assert.ok((await page.locator('#dialog-text').innerText()).length>40);await page.locator('#dialog-close').click()}
 state.commercialStates=0;
 for(const id of ['corrida','tri','lab','online']){
 await page.locator(`[data-tab="${id}"]`).click();assert.equal(await page.locator('.plan-panel:not([hidden])').getAttribute('data-panel'),id);
 for(const card of await page.locator('.plan-panel:not([hidden]) .with-terms').all()){
 const monthly=Number(await card.getAttribute('data-monthly-price'));
 for(const months of [12,6,3,1]){await card.locator(`[data-months="${months}"]`).click();const total=Math.round(monthly*months*({1:1,3:.95,6:.9,12:.8}[months])*100)/100,inst={1:1,3:3,6:5,12:8}[months],amount=Math.round(total/inst*100)/100;assert.equal(await card.locator('.price').innerText(),money(Math.round(total/months*100)/100));assert.ok((await card.locator('.term-meta').innerText()).includes(money(total)));assert.equal(await card.locator(`[data-months="${months}"] .term-option-amount`).innerText(),months===1?money(total):inst+'x de '+money(amount));if(months>1)assert.ok((await card.locator('.term-meta').innerText()).includes(inst+'x de '+money(amount)));const href=new URL(await card.locator('.term-cta').getAttribute('href'));assert.equal(href.hostname,months===1?'script.google.com':'wa.me');if(months>1){assert.equal(href.pathname,'/5521999410202');assert.ok(href.searchParams.get('text').includes(money(total)))}state.commercialStates++}
 }
 const comp=page.locator('.plan-panel:not([hidden]) .v7-comparison');if(await comp.count()){await comp.locator('summary').click();assert.ok(await comp.locator('table').isVisible());if(width<800){const scroll=comp.locator('.comparison-scroll');await scroll.evaluate(e=>e.scrollLeft=e.scrollWidth);assert.ok(await scroll.evaluate(e=>e.scrollLeft>0))}await comp.locator('summary').click()}
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth),width);
 }
 assert.equal(await page.locator('.coach').count(),4);for(const d of await page.locator('.coach details').all()){await d.locator('summary').click();assert.ok(await d.evaluate(e=>e.open));assert.ok(await d.locator('a').isVisible());await d.locator('summary').click()}
 await page.locator('#historia summary').click();assert.ok(await page.locator('#historia details').evaluate(e=>e.open));await page.locator('#historia summary').click();await page.locator('[data-tab="corrida"]').click();
 // Verify both WhatsApp destinations by real clicks, intercepted before any messaging service opens.
 if(width===390){await page.locator('.plan-panel:not([hidden]) .with-terms').first().locator('[data-months="12"]').click();const [pop]=await Promise.all([context.waitForEvent('page'),page.locator('.plan-panel:not([hidden]) .term-cta').first().click()]);await pop.waitForLoadState();await pop.close();const [contact]=await Promise.all([context.waitForEvent('page'),page.locator('#contato a[href^="https://wa.me/"]').click()]);await contact.waitForLoadState();await contact.close();assert.equal(external.filter(x=>x.includes('wa.me')).length,2);await page.locator('.plan-panel:not([hidden]) .with-terms').first().locator('[data-months="1"]').click()}
 }else{
 await page.locator('[data-locations]').waitFor({state:'attached'});if(mode!=='online')await page.locator('.location-card').first().waitFor();
 state.locationCards=await page.locator('.location-card').count();assert.equal(state.locationCards,{corrida:3,tri:8,lab:1,online:0}[mode]);
 for(const a of await page.locator('a[href*="google.com/maps"]').all()){const map=new URL(await a.getAttribute('href'));assert.equal(map.searchParams.get('api'),'1');assert.ok(map.searchParams.get('query'));assert.equal(await a.getAttribute('target'),'_blank')}
 assert.equal(await page.locator('.location-card a[href*="script.google.com"]').count(),0);assert.equal(await page.locator('.find-workout a').count(),2);
 const plan=page.locator('.find-workout a[href*="modalidade="]');assert.equal(await plan.getAttribute('href'),`apresentacao.html?modalidade=${mode}#planos`);await plan.click();await page.waitForFunction(id=>document.querySelector('.plan-panel:not([hidden])')?.dataset.panel===id,mode);await page.goBack();await page.locator('.modality-hero').waitFor();
 await page.locator('#nav-toggle').click();await page.locator('#nav-dialog details summary').click();const next=mode==='corrida'?'apresentacao-triathlon.html':'apresentacao-corrida.html';await page.locator(`#nav-dialog a[href="${next}"]`).click();await page.locator('.modality-hero').waitFor();assert.ok(page.url().includes(next));await page.goto(url+'/'+file);
 }
 for(const img of await page.locator('img').all()){if(await img.isVisible()){await img.scrollIntoViewIfNeeded();await img.evaluate(e=>e.decode())}}
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth),width);assert.ok(await page.locator('section').evaluateAll(es=>es.every(e=>e.scrollLeft===0)));const duplicates=await page.evaluate(()=>[...document.querySelectorAll('[id]')].map(e=>e.id).filter((id,i,a)=>a.indexOf(id)!==i));assert.deepEqual(duplicates,[]);if(mode==='main')assert.ok(await page.locator('.coach>img').evaluateAll(es=>es.every(e=>e.clientHeight<e.clientWidth*1.2)));
 assert.deepEqual(errors,[]);assert.deepEqual(httpErrors,[]);await page.evaluate(()=>scrollTo(0,0));await page.screenshot({path:path.join(out,`${mode}-full-${width}.png`),fullPage:true});state.passed=true;console.log('PASS',width,mode);
 }catch(e){state.failure=e.message;report.failures.push({width,mode,message:e.message});console.log('FAIL',width,mode,e.message.slice(0,350));await page.screenshot({path:path.join(out,`failure-${mode}-${width}.png`)}).catch(()=>{})}finally{await page.close()}
 }
 await context.close();
}
}finally{await browser.close();server.close();fs.writeFileSync(path.join(out,'results.json'),JSON.stringify(report,null,2));console.log(JSON.stringify({passed:report.pages.filter(p=>p.passed).length,total:report.pages.length,commercialStates:report.pages.reduce((n,p)=>n+(p.commercialStates||0),0),failures:report.failures},null,2));if(report.failures.length)process.exitCode=1}})().catch(e=>{console.error(e);server.close();process.exitCode=1});
