'use strict';
/* Authenticated browser proof with fictional, isolated PKR data.
 * No external service, real room or real payment record is contacted. */
const {chromium,webkit}=require('playwright');
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {BASE,API,room,initialStorage,createFixture}=require('../scripts/launch-fixture.cjs');
const output=path.resolve(__dirname,'../../artifacts/private-club');
fs.mkdirSync(output,{recursive:true});
const devices=[['small-phone',320,700],['iphone',430,873],['tablet',768,1024],['desktop',1440,900]];
const cases=[];
async function boot(browser,w,h,role='host'){
 const fixture=createFixture();fixture.state.role=role;
 const ctx=await browser.newContext({viewport:{width:w,height:h},deviceScaleFactor:1,serviceWorkers:'block',reducedMotion:'reduce'});
 await ctx.addInitScript(stored=>{
  for(const [key,value] of Object.entries(stored))localStorage.setItem(key,value);
  localStorage.setItem('pkr_personal_visual_style_v1','private-club');
  localStorage.setItem('pkr_personal_appearance_v1','dark');
 },initialStorage);
 const failures=[],page=await ctx.newPage();page.setDefaultTimeout(19000);
 page.on('pageerror',error=>failures.push(error.message));
 await ctx.route('**/*',async route=>{
  const request=route.request(),url=new URL(request.url());
  if(url.origin===BASE)return route.continue();
  if(url.origin!==API)return route.abort();
  try{
   const body=fixture.resolve(url,request.method(),request.postData());
   return route.fulfill({status:200,body:JSON.stringify(body),contentType:'application/json',
    headers:{'access-control-allow-origin':BASE,'access-control-allow-headers':'Content-Type,Authorization','access-control-allow-methods':'GET,POST,PUT,OPTIONS'}});
  }catch(error){failures.push(String(error));return route.fulfill({status:404,body:'{"error":"No fictional record"}',contentType:'application/json'});}
 });
 return {page,ctx,fixture,failures};
}
async function validate(page,label,ignoreClipped=[]){
 await page.evaluate(()=>document.fonts.ready);
 const issues=await page.evaluate(ignore=>{
  const all=[...document.querySelectorAll('.pkr-pc-main-action,.pkr-pc-shortcuts button,.pkr-pc-lobby-filter button,.pkr-pc-lobby-actions button,.pkr-pc-rsvp-quick button,.pkr-pc-next-actions button')];
  const visible=all.filter(el=>{const r=el.getBoundingClientRect();return r.width>0&&r.height>0&&getComputedStyle(el).visibility!=='hidden'});
  return {width:innerWidth,scroll:document.documentElement.scrollWidth,
   clipped:visible.filter(el=>!ignore.some(t=>el.textContent?.includes(t))&&(el.scrollWidth>el.clientWidth+4||el.scrollHeight>el.clientHeight+4)).map(el=>({text:el.textContent,w:el.clientWidth,scroll:el.scrollWidth,h:el.clientHeight,sh:el.scrollHeight})),
   offscreen:visible.filter(el=>{const r=el.getBoundingClientRect();return r.left< -2||r.right>innerWidth+2}).map(el=>el.textContent)
  };
 },ignoreClipped);
 assert(issues.scroll<=issues.width+4,label+' document overflow '+JSON.stringify(issues));
 assert.equal(issues.clipped.length,0,label+' clipped text '+JSON.stringify(issues.clipped));
 assert.equal(issues.offscreen.length,0,label+' horizontal control '+JSON.stringify(issues.offscreen));
}
async function runHost(browser,device){
 const [name,w,h]=device;const {page,ctx,failures}=await boot(browser,w,h);
 try{
  await page.goto(BASE+'/dashboard',{waitUntil:'domcontentloaded'});
  await page.getByTestId('private-club-host-home').waitFor({state:'visible'});
  assert(await page.locator('.pkr-privateclub-original-host').isHidden(),'Old host dashboard should not overlay approved UI');
  assert(await page.locator('.pkr-pc-entrance').isVisible(),'Cinematic lounge must be visible');
  assert(await page.locator('.pkr-pc-ticket').isVisible(),'Real ticket must be visible');
  await validate(page,name+' host');
  await page.screenshot({path:path.join(output,'host-'+name+'.png')});
  await page.goto(BASE+'/events/'+room.id+'?tab=games',{waitUntil:'domcontentloaded'});
  await page.getByTestId('private-club-games').waitFor({state:'visible'});
  assert(await page.locator('.pkr-pc-old-games').isHidden(),'The old generic dashboard must not be visible beneath lobby');
  assert.equal(await page.locator('.pkr-pc-lobby-filter button').count(),3);
  await validate(page,name+' Games');
  await page.screenshot({path:path.join(output,'games-'+name+'.png')});
  await page.getByRole('navigation',{name:'Game lobby filters'}).getByRole('button',{name:/Live/}).click();
  assert.equal(await page.locator('.pkr-pc-lobby-ticket.is-live').count(),1,'Live tab must show the true active game');
  await page.getByRole('navigation',{name:'Game lobby filters'}).getByRole('button',{name:/Completed/}).click();
  assert((await page.locator('.pkr-pc-lobby-ticket').count())>=1,'Completed must display saved games');
  await page.getByRole('navigation',{name:'Game lobby filters'}).getByRole('button',{name:/Upcoming/}).click();
  const going=page.getByRole('button',{name:/Going/}).first();
  await going.waitFor({state:'visible'});
  await going.click();
  assert(new URL(page.url()).searchParams.get('choice')==='yes','Going must navigate to authorised RSVP form');
  assert(!failures.some(e=>/Forbidden fixture mutation|Unexpected API write/.test(e)),'No RSVP may be submitted automatically');
  if(w>=768){
   await page.goto(BASE+'/results?room='+room.id);
   await page.locator('.pkr-results-page').waitFor();
   await page.screenshot({path:path.join(output,'results-'+name+'.png')});
   await page.goto(BASE+'/payments?room='+room.id);
   await page.locator('.pkr-gn-payment-workspace').waitFor();
   await page.screenshot({path:path.join(output,'payments-'+name+'.png')});
  }
  assert.deepEqual(failures,[],name+' browser/API errors');
  cases.push('host-'+name);
 }finally{await ctx.close();}
}
async function runPlayer(browser){
 const {page,ctx,failures}=await boot(browser,430,873,'member');
 try{
  await page.goto(BASE+'/dashboard');
  await page.getByTestId('private-club-player-home').waitFor({state:'visible'});
  assert(await page.locator('.gn-player-next').isHidden(),'Player must see approved lounge rather than old summary panel');
  await validate(page,'player');
  await page.screenshot({path:path.join(output,'player-iphone.png')});
  assert.deepEqual(failures,[]);
  cases.push('player-iphone');
 }finally{await ctx.close();}
}
(async()=>{
 const browser=await chromium.launch({headless:true});
 try{
  for(const item of devices)await runHost(browser,item);
  await runPlayer(browser);
 }finally{await browser.close();}
 const safari=await webkit.launch({headless:true});
 try{await runHost(safari,['safari-iphone',390,844]);}finally{await safari.close();}
 console.log('PASS Private Casino Club browser: '+cases.join(', '));
})().catch(error=>{console.error(error.stack||error);process.exitCode=1;});
