'use strict';
/* Real-browser checks with exclusively fictional room data. No live API calls. */
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {chromium,webkit}=require('playwright');
const {BASE,API,room,createFixture,initialStorage,FIXED_TIME}=require('../scripts/launch-fixture.cjs');
const output=path.resolve(__dirname,'../../artifacts/casino-redesign');
fs.mkdirSync(output,{recursive:true});
const sizes=[{name:'small',width:320,height:700},{name:'iphone',width:430,height:932},{name:'tablet',width:768,height:1024}];
function intersects(a,b){return a.left<b.right-2&&a.right>b.left+2&&a.top<b.bottom-2&&a.bottom>b.top+2;}
async function runOne(browser,engine,viewport,{style='tournament',role='host',empty=false,mode='dark'}={}){
 const fixture=createFixture();fixture.state.role=role;
 const context=await browser.newContext({viewport:{width:viewport.width,height:viewport.height},serviceWorkers:'block',reducedMotion:'reduce',locale:'en-AU',timezoneId:'Australia/Brisbane',isMobile:viewport.width<=430,hasTouch:viewport.width<=430});
 await context.addInitScript(({stored,visual,appearance})=>{
  for(const [key,value] of Object.entries(stored))localStorage.setItem(key,value);
  localStorage.setItem('pkr_personal_visual_style_v1',visual);
  localStorage.setItem('pkr_personal_appearance_v1',appearance);
  if(window.innerWidth<=430)Object.defineProperty(navigator,'standalone',{configurable:true,get:()=>true});
 },{stored:initialStorage,visual:style,appearance:mode});
 const unexpected=[];
 await context.route('**/*',async route=>{
  const request=route.request(),url=new URL(request.url());
  if(url.origin===BASE)return route.continue();
  if(url.origin!==API)return route.abort();
  if(empty&&url.pathname==='/events/'+room.id+'/games'&&request.method()==='GET')
   return route.fulfill({status:200,contentType:'application/json',body:'[]',headers:{'access-control-allow-origin':BASE,'access-control-allow-credentials':'true','access-control-allow-headers':'Content-Type,Authorization','access-control-allow-methods':'GET,POST,PUT,OPTIONS'}});
  try{
   const body=fixture.resolve(url,request.method(),request.postData());
   return route.fulfill({status:200,contentType:'application/json',
    body:JSON.stringify(body),headers:{'access-control-allow-origin':BASE,'access-control-allow-credentials':'true','access-control-allow-headers':'Content-Type,Authorization','access-control-allow-methods':'GET,POST,PUT,OPTIONS'}});
  }catch(error){unexpected.push(error.message);return route.fulfill({status:404,contentType:'application/json',body:'{"error":"Fictional fixture unavailable"}'});}
 });
 const page=await context.newPage();page.setDefaultTimeout(17000);
 await page.clock.setFixedTime(new Date(FIXED_TIME));
 page.on('pageerror',error=>unexpected.push('Browser: '+error.message));
 try{
  await page.goto(BASE+'/dashboard?room='+room.id,{waitUntil:'domcontentloaded'});
  await page.goto(BASE+'/events/'+room.id+'?tab=games',{waitUntil:'domcontentloaded'});
  const stage=page.locator('.pkr-experience-stage.pkr-experience-games');
  try{await stage.waitFor({state:'visible'});}catch(error){
   const snapshot=await page.evaluate(()=>({url:location.href,style:document.documentElement.getAttribute('data-pkr-personal-style'),theme:document.documentElement.getAttribute('data-pkr-personal-theme'),body:document.body.innerText.slice(0,1400),dom:!!document.querySelector('.pkr-experience-stage'),errors:document.querySelectorAll('[role="alert"]').length}));
   console.error('CASINO BROWSER DIAGNOSTICS',JSON.stringify({snapshot,unexpected}));
   await page.screenshot({path:path.join(output,'failed-'+engine+'-'+viewport.name+'.png')}).catch(()=>{});throw error;
  }
  await page.locator('html[data-pkr-personal-style="'+style+'"][data-pkr-personal-theme="'+mode+'"]').waitFor();
  await page.evaluate(()=>document.fonts.ready);
  const nav=page.locator('.pkr-section-tabs button');
  assert.equal(await nav.count(),3,'Must retain three Game sections');
  const visual=await page.evaluate(()=>{
   const stage=document.querySelector('.pkr-experience-games');
   const card=stage?.querySelector('.pkr-casino-stage-art');
   const title=stage?.querySelector('h1');
   const subtitle=stage?.querySelector('p');
   const metrics=Array.from(stage?.querySelectorAll('.pkr-experience-command-stat,.pkr-experience-live-metric')||[]);
   const controls=Array.from(document.querySelectorAll('.pkr-section-tabs button,.pkr-experience-games .pkr-room-games-links button,.pkr-casino-empty-action'))
    .filter(el=>{const r=el.getBoundingClientRect();return r.width>0&&r.height>0;});
   const rect=el=>el?.getBoundingClientRect()?.toJSON()||null;
   return {
    vw:innerWidth,documentWidth:document.documentElement.scrollWidth,
    stage:rect(stage),art:rect(card),title:rect(title),subtitle:rect(subtitle),
    stageBackground:stage?getComputedStyle(stage).backgroundImage:'none',
    buttonIssues:controls.flatMap(el=>{const r=el.getBoundingClientRect(),text=el.textContent||'';
     return [r.width<45||r.height<43||r.left<-1||r.right>innerWidth+1||el.scrollWidth>el.clientWidth+3||el.scrollHeight>el.clientHeight+3?
      {text,width:r.width,height:r.height,left:r.left,right:r.right,client:el.clientWidth,scroll:el.scrollWidth}:null].filter(Boolean);
    }),
    statIssues:metrics.filter(el=>el.scrollWidth>el.clientWidth+3||el.scrollHeight>el.clientHeight+3).map(el=>el.textContent),
    labels:metrics.map(el=>el.textContent?.trim()),
   };
  });
  assert(visual.documentWidth<=viewport.width+3,'Horizontal page overflow '+JSON.stringify(visual));
  assert(visual.stageBackground!=='none','Stage did not receive the casino background');
  assert(visual.art&&visual.art.width>25,'Casino vector props not rendered');
  assert.equal(visual.buttonIssues.length,0,'Clipped or too-small control '+JSON.stringify(visual.buttonIssues));
  assert.equal(visual.statIssues.length,0,'Clipped statistic '+JSON.stringify(visual.statIssues));
  if(viewport.width<=430){
   assert(!intersects(visual.title,visual.art),'Title sits beneath decorative cards');
   assert(!intersects(visual.subtitle,visual.art),'Subtitle sits beneath decorative cards');
  }
  const image=engine+'-'+viewport.name+'-'+style+'-'+role+(empty?'-empty':'')+'.png';
  await page.screenshot({path:path.join(output,image),fullPage:false});
  if(empty){
   const emptyArena=page.getByTestId('casino-games-empty');
   await emptyArena.waitFor({state:'visible'});
   const action=emptyArena.getByRole('button',{name:role==='host'?'Schedule your first game':'Open game calendar'});
   await action.click();
   if(role==='host')await page.getByRole('heading',{name:'Schedule a game',exact:true}).waitFor({state:'visible'});
   else {await page.waitForURL(url=>url.pathname==='/schedule',{timeout:12000});
    assert(page.url().includes('/schedule'),'Player empty-state action must open calendar');}
  }else{
   assert(visual.labels.length===3,'Must retain three real record drilldowns');
   if(role==='host'){
    const schedule=stage.getByRole('button',{name:/Schedule game/i});
    await schedule.click();
    await page.getByRole('heading',{name:'Schedule a game',exact:true}).waitFor({state:'visible'});
   }
  }
  assert.deepEqual(unexpected,[],'Unexpected script error / API write');
  return image;
 }finally{await context.close();}
}
async function run(){
 const outputFiles=[];
 const chromiumBrowser=await chromium.launch({headless:true});
 try{
  for(const size of sizes)outputFiles.push(await runOne(chromiumBrowser,'chromium',size));
  outputFiles.push(await runOne(chromiumBrowser,'chromium',sizes[1],{style:'luxe',mode:'light',role:'member',empty:true}));
  outputFiles.push(await runOne(chromiumBrowser,'chromium',sizes[1],{style:'tournament',empty:true}));
 }finally{await chromiumBrowser.close();}
 const webkitBrowser=await webkit.launch({headless:true});
 try{outputFiles.push(await runOne(webkitBrowser,'webkit',sizes[1],{style:'neon'}));}
 finally{await webkitBrowser.close();}
 console.log('PASS real casino browser: responsive layout, no clipping, host/player actions, original modal and '+outputFiles.length+' fictional screenshots');
}
run().catch(error=>{console.error(error.stack||error);process.exitCode=1;});
