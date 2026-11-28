'use strict';
/* Check the single approved PKR brand in actual Games/RSVP UI using synthetic records.
   No production calls, no imaginary casino imagery. */
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const {chromium,webkit}=require('playwright');
const {BASE,API,room,createFixture,initialStorage,FIXED_TIME}=require('../scripts/launch-fixture.cjs');
const output=path.resolve(__dirname,'../../artifacts/pkr-official-brand');
fs.mkdirSync(output,{recursive:true});
const sizes=[{name:'small',width:320,height:700},{name:'iphone',width:430,height:932},{name:'tablet',width:768,height:1024},{name:'desktop',width:1440,height:900}];
async function runOne(browser,engine,viewport,{style='private-club',role='host',empty=false,mode='dark'}={}){
 const fixture=createFixture();fixture.state.role=role;
 const context=await browser.newContext({viewport:{width:viewport.width,height:viewport.height},serviceWorkers:'block',
  reducedMotion:'reduce',locale:'en-AU',timezoneId:'Australia/Brisbane',isMobile:viewport.width<=430,hasTouch:viewport.width<=430});
 await context.addInitScript(({stored,style,mode})=>{
  for(const [key,value] of Object.entries(stored))localStorage.setItem(key,value);
  localStorage.setItem('pkr_personal_visual_style_v1',style);
  localStorage.setItem('pkr_personal_appearance_v1',mode);
  if(innerWidth<=430)Object.defineProperty(navigator,'standalone',{configurable:true,get:()=>true});
 },{stored:initialStorage,style,mode});
 const unexpected=[];
 await context.route('**/*',async route=>{
  const request=route.request(),url=new URL(request.url());
  if(url.origin===BASE)return route.continue();
  if(url.origin!==API)return route.abort('blockedbyclient');
  if(empty&&url.pathname==='/events/'+room.id+'/games'&&request.method()==='GET')
   return route.fulfill({status:200,contentType:'application/json',body:'[]',headers:{'access-control-allow-origin':BASE,'access-control-allow-credentials':'true','access-control-allow-headers':'Content-Type,Authorization','access-control-allow-methods':'GET,POST,PUT,OPTIONS'}});
  try{const data=fixture.resolve(url,request.method(),request.postData());
   return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(data),
    headers:{'access-control-allow-origin':BASE,'access-control-allow-credentials':'true','access-control-allow-headers':'Content-Type,Authorization','access-control-allow-methods':'GET,POST,PUT,OPTIONS'}});
  }catch(error){unexpected.push(error.message);return route.fulfill({status:404,contentType:'application/json',body:'{"error":"Fictional fixture unavailable"}'});}
 });
 const page=await context.newPage();page.setDefaultTimeout(20000);
 await page.clock.setFixedTime(new Date(FIXED_TIME));
 page.on('pageerror',error=>unexpected.push('Browser: '+error.message));
 try{
  await page.goto(BASE+'/events/'+room.id+'?tab=games',{waitUntil:'domcontentloaded'});
  const games=page.getByTestId('private-club-games');await games.waitFor({state:'visible'});
  const hero=games.locator('.pkr-no-games-hero');await hero.waitFor({state:'visible'});
  await page.evaluate(()=>document.fonts.ready);
  assert.equal(await page.locator('html').getAttribute('data-pkr-personal-style'),'private-club','Older casino preference must not change design');
  assert.equal(await page.locator('html').getAttribute('data-pkr-personal-theme'),'dark','Older light preference must not change design');
  const nav=games.locator('.pkr-cf-filters button');
  assert.equal(await nav.count(),3,'Keep Upcoming, Live and Completed game filters');
  const visual=await page.evaluate(()=>{
   const hero=document.querySelector('.pkr-no-games-hero'),title=hero?.querySelector('h1');
   const metrics=[...document.querySelectorAll('.pkr-cf-hero-metrics button')];
   const buttons=[...document.querySelectorAll('.pkr-cf-filters button,.pkr-pc-lobby-actions button,.pkr-pc-rsvp-quick button,.pkr-pc-host-tools button,.pkr-cf-schedule')].filter(el=>{
    const r=el.getBoundingClientRect(),s=getComputedStyle(el);return r.width>0&&r.height>0&&s.display!=='none';
   });
   const art=[...document.querySelectorAll('.pkr-cf-hero-photo,.pkr-cf-tabletop,.pkr-casino-stage-art')].filter(el=>{
    const s=getComputedStyle(el),r=el.getBoundingClientRect();return s.display!=='none'&&r.width>0&&r.height>0;
   });
   return {width:innerWidth,documentWidth:document.documentElement.scrollWidth,
    banner:hero?getComputedStyle(hero).backgroundColor:null,
    bannerImage:hero?getComputedStyle(hero).backgroundImage:null,
    heading:title?.textContent||'',
    headingFont:title?getComputedStyle(title).fontFamily:null,
    metrics:metrics.map(el=>el.innerText.trim()),
    art:art.length,
    issues:buttons.flatMap(el=>{const r=el.getBoundingClientRect();
     return r.width<40||r.height<43||r.left< -2||r.right>innerWidth+2||el.scrollWidth>el.clientWidth+4||el.scrollHeight>el.clientHeight+4?
      [{name:el.textContent?.trim().slice(0,45),width:r.width,height:r.height,left:r.left,right:r.right}]:[];
    })};
  });
  assert(visual.documentWidth<=viewport.width+3,'Horizontal page overflow: '+JSON.stringify(visual));
  assert.equal(visual.banner,'rgb(16, 70, 248)','The approved PKR blue must be present: '+JSON.stringify(visual));
  assert.equal(visual.bannerImage,'none','No abstract hero image');
  assert.match(visual.heading,/THE NIGHT IS ON/,'Official headline');
  assert(/Inter|bodyFont/i.test(visual.headingFont),'Bundled sharp typography');
  assert.equal(visual.art,0,'No casino props or illustrated poker-table scenery');
  assert.equal(visual.issues.length,0,'All Game buttons remain readable: '+JSON.stringify(visual.issues));
  assert.equal(visual.metrics.length,3,'All three actual game counts visible');
  const image=engine+'-'+viewport.name+'-'+style+'-'+role+(empty?'-empty':'')+'.png';
  await page.screenshot({path:path.join(output,image),fullPage:false});
  if(empty){
   const emptyBlock=games.locator('.pkr-cf-empty');
   await emptyBlock.waitFor({state:'visible'});
   assert(await emptyBlock.locator('.pkr-no-empty-icon img').isVisible(),'Approved PKR emblem replaces fake felt table');
   const action=emptyBlock.locator('.pkr-cf-schedule');
   await action.waitFor({state:'visible'});
   const button=await action.evaluate(el=>({bg:getComputedStyle(el).backgroundColor,ink:getComputedStyle(el).color,height:el.getBoundingClientRect().height}));
   assert.equal(button.bg,'rgb(199, 255, 58)','Primary action uses PKR citron');
   assert.equal(button.ink,'rgb(11, 13, 20)','Citron button must use dark ink');
   assert(button.height>=44,'Accessible action size');
   await action.click();
   if(role==='host')await page.getByRole('heading',{name:'Schedule a game',exact:true}).waitFor({state:'visible'});
   else await page.waitForURL(url=>url.pathname==='/schedule',{timeout:12000});
  }else{
   assert(await games.locator('.pkr-cf-game-ticket').count()>0,'Actual game record tickets must render');
   if(role==='host'){
    assert(await games.locator('.pkr-pc-host-tools button').count()>=3,'Host tools must remain available');
    await games.locator('.pkr-cf-filters button[aria-pressed="true"]').waitFor();
    await games.locator('.pkr-cf-host-quick').click();
    await page.getByRole('heading',{name:'Schedule a game',exact:true}).waitFor({state:'visible'});
   }
  }
  assert.deepEqual(unexpected,[],'Unexpected script error / API write');
  return image;
 }finally{await context.close();}
}
async function run(){
 const outputs=[];
 const chromiumBrowser=await chromium.launch({headless:true});
 try{
  for(const viewport of sizes)outputs.push(await runOne(chromiumBrowser,'chromium',viewport));
  outputs.push(await runOne(chromiumBrowser,'chromium',sizes[1],{style:'luxe',mode:'light',role:'member',empty:true}));
  outputs.push(await runOne(chromiumBrowser,'chromium',sizes[1],{style:'tournament',empty:true}));
 }finally{await chromiumBrowser.close();}
 const webkitBrowser=await webkit.launch({headless:true});
 try{outputs.push(await runOne(webkitBrowser,'webkit',sizes[1],{style:'neon'}));}
 finally{await webkitBrowser.close();}
 console.log('PASS official PKR browser: single brand, all devices, real records and game controls, no abstract imagery; '+outputs.length+' snapshots');
}
run().catch(error=>{console.error(error.stack||error);process.exitCode=1;});
