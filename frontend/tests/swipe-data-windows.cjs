'use strict';
// Remote CI browser regression. Chromium uses real browser touch input via CDP.
// WebKit exercises DOM touch-event integration; it does not emulate iOS's system UI.
// All records are fictional and every external API request is intercepted.
const {chromium,webkit}=require('playwright');
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {BASE,API,FIXED_TIME,room,liveGame,createFixture,initialStorage}=require('../scripts/launch-fixture.cjs');
const output=path.resolve(__dirname,'../../artifacts/swipe-data-windows');fs.mkdirSync(output,{recursive:true});

async function touchGesture(page,engine,locator,{dx=0,dy=120,cancel=false}={}){
 const bounds=await locator.boundingBox();assert(bounds,'Gesture target must be visible');
 const x=bounds.x+bounds.width/2,y=bounds.y+Math.min(12,bounds.height/2);
 if(engine==='chromium'){
  const cdp=await page.context().newCDPSession(page);
  try{
   const point=(x,y)=>({x,y,id:1,radiusX:2,radiusY:2,force:1});
   await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[point(x,y)]});
   for(let i=1;i<=8;i++){
    await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[point(x+dx*i/8,y+dy*i/8)]});
    await page.waitForTimeout(18);
   }
   await cdp.send('Input.dispatchTouchEvent',{type:cancel?'touchCancel':'touchEnd',touchPoints:[]});
  }finally{await cdp.detach();}
 }else{
  // WebKit's Playwright protocol has no native swipe driver. Deliberately label
  // this as event integration, rather than claiming a physical iPhone swipe.
  await locator.evaluate((element,{x,y,dx,dy,cancel})=>{
   function send(type,atX,atY,ended=false){
    const touch={identifier:1,target:element,clientX:atX,clientY:atY};
    const event=new Event(type,{bubbles:true,cancelable:true});
    Object.defineProperties(event,{touches:{value:ended?[]:[touch]},changedTouches:{value:[touch]}});
    element.dispatchEvent(event);
   }
   send('touchstart',x,y);for(let i=1;i<=8;i++)send('touchmove',x+dx*i/8,y+dy*i/8);
   send(cancel?'touchcancel':'touchend',x+dx,y+dy,true);
  },{x,y,dx,dy,cancel});
 }
 await page.waitForTimeout(230);
}
async function shellState(page){
 return page.evaluate(()=>{
  const body=document.body,header=document.querySelector('.pkr-primary-mobile-utility'),footer=document.querySelector('.pkr-primary-bottom-nav');
  return {contained:document.documentElement.classList.contains('pkr-contained-scroll'),window:scrollY,root:document.documentElement.scrollTop,
   body:body.scrollTop,overflow:getComputedStyle(body).overflowY,headerTop:header?.getBoundingClientRect().top,
   footerBottom:footer?.getBoundingClientRect().bottom,bodyBottom:body.getBoundingClientRect().bottom,height:innerHeight};
 });
}
async function assertInstalledShell(page,label,offset){
 const value=await shellState(page);assert(value.contained,label+': installed body scroll remains active');
 assert.equal(value.window,0,label+': native document must stay stationary');assert.equal(value.root,0,label+': root must stay stationary');
 assert(Math.abs(value.headerTop)<=1&&Math.abs(value.footerBottom-value.height)<=1&&Math.abs(value.bodyBottom-value.height)<=1,label+': fixed header/footer/body must remain viewport bounded '+JSON.stringify(value));
 if(offset!==undefined)assert(Math.abs(value.body-offset)<=1,label+': background position changed');return value;
}
async function recordsReady(page){
 const sheet=page.locator('.pkr-record-dialog');await sheet.locator('.pkr-record-body[aria-busy="false"]').waitFor();
 assert.equal(await sheet.locator('.pkr-record-error').count(),0);return sheet;
}
async function run(engine,type){
 const browser=await type.launch({headless:true}),errors=[],fixture=createFixture();
 const context=await browser.newContext({viewport:{width:430,height:873},screen:{width:430,height:932},isMobile:true,hasTouch:true,
  deviceScaleFactor:1,serviceWorkers:'block',reducedMotion:engine==='webkit'?'reduce':'no-preference'});
 await context.addInitScript(storage=>{
  for(const [key,value]of Object.entries(storage))localStorage.setItem(key,value);
  Object.defineProperty(navigator,'standalone',{configurable:true,get:()=>true});
 },initialStorage);
 const page=await context.newPage();page.setDefaultTimeout(15000);await page.clock.setFixedTime(new Date(FIXED_TIME));
 page.on('pageerror',error=>errors.push(error.stack||error.message));
 await context.route('**/*',async route=>{
  const request=route.request(),url=new URL(request.url());
  if(url.origin===BASE)return route.continue();
  if(url.origin!==API)return route.abort();
  try{
   const data=fixture.resolve(url,request.method(),request.postData());
   await route.fulfill({status:200,contentType:'application/json',headers:{'access-control-allow-origin':BASE,'access-control-allow-credentials':'true','access-control-allow-headers':'Content-Type,Authorization','access-control-allow-methods':'GET,OPTIONS'},body:JSON.stringify(data)});
  }catch(error){errors.push(error.message);await route.abort();}
 });
 try{
  await page.goto(BASE+'/insights',{waitUntil:'domcontentloaded'});
  const trigger=page.getByRole('button',{name:'View underlying records: Settled games',exact:true});await trigger.waitFor();
  await page.waitForFunction(()=>document.documentElement.classList.contains('pkr-contained-scroll'));
  async function open(){await trigger.scrollIntoViewIfNeeded();await trigger.focus();await trigger.click();return recordsReady(page);}
  let sheet=await open();assert.equal(await sheet.locator('.pkr-record-row').count(),12);
  const before=await assertInstalledShell(page,'Opening data records');assert.equal(before.overflow,'hidden');
  await page.screenshot({path:path.join(output,engine+'-records-with-drag-handle.png')});
  const handle=sheet.locator('.pkr-swipe-handle');assert(await handle.isVisible());
  for(const gesture of [{dy:36},{dx:145,dy:18},{dy:-60},{dy:125,cancel:true}]){
   await touchGesture(page,engine,handle,gesture);assert(await sheet.isVisible(),'Short/horizontal/upward/cancelled touches must not close');
   await assertInstalledShell(page,'Rejected data-window swipe',before.body);
  }
  const search=sheet.locator('input[type="search"]');await search.fill('');
  await touchGesture(page,engine,search,{dy:105});assert(await sheet.isVisible(),'An input gesture must not dismiss a data window');
  const list=sheet.locator('.pkr-record-body');
  // Real browser scroll ownership is checked with touch input in Chromium;
  // WebKit checks the same component boundary with DOM events and native scroll state.
  await list.evaluate(el=>{el.scrollTop=240;});
  const row=list.locator('.pkr-record-row').nth(4);await row.scrollIntoViewIfNeeded();
  const scrollBefore=await list.evaluate(el=>el.scrollTop);assert(scrollBefore>20);
  await touchGesture(page,engine,row,{dy:95});assert(await sheet.isVisible(),'Scrolling down a records list must not dismiss');
  if(engine==='chromium')assert((await list.evaluate(el=>el.scrollTop))<scrollBefore,'A downward touch must natively scroll the list towards its top');
  await assertInstalledShell(page,'Scrolling inside data records',before.body);
  // The fixed heading/grip remains a dismissal target even while the list is scrolled.
  await touchGesture(page,engine,handle);await sheet.waitFor({state:'detached'});
  assert(await trigger.evaluate(el=>el===document.activeElement),'Swipe close restores metric focus');
  assert(['auto','scroll'].includes((await assertInstalledShell(page,'After swipe close',before.body)).overflow));

  // List-top swipes also dismiss, without turning a row into a navigation click.
  sheet=await open();await list.evaluate(el=>{el.scrollTop=0;});const pathBefore=page.url();
  await touchGesture(page,engine,sheet.locator('.pkr-record-row').first());await sheet.waitFor({state:'detached'});
  assert.equal(page.url(),pathBefore,'Swiping a record must not open that record or an underlying action');
  sheet=await open();await sheet.getByRole('button',{name:'Close record details'}).click();await sheet.waitFor({state:'detached'});
  sheet=await open();await page.keyboard.press('Escape');await sheet.waitFor({state:'detached'});

  // A deeper record sheet still has a working Back button, then can be swiped closed.
  await page.getByRole('button',{name:'View underlying records: Players who owe',exact:true}).click();sheet=await recordsReady(page);
  await sheet.locator('button.pkr-record-row').first().click();sheet=await recordsReady(page);
  await sheet.getByRole('button',{name:'Back to breakdown'}).click();sheet=await recordsReady(page);
  await touchGesture(page,engine,sheet.locator('.pkr-swipe-handle'));await sheet.waitFor({state:'detached'});

  await page.goto(BASE+'/events/'+room.id+'?tab=leaderboard',{waitUntil:'domcontentloaded'});
  await page.locator('.pkr-standings-podium-card').first().click();
  const history=page.locator('.pkr-player-history-overlay');await history.waitFor({state:'visible'});
  await touchGesture(page,engine,history.locator('.pkr-swipe-handle'));await history.waitFor({state:'detached'});
  await assertInstalledShell(page,'After standings detail dismissal');

  await page.goto(BASE+'/games/'+liveGame.id+'/play',{waitUntil:'domcontentloaded'});
  await page.waitForFunction(()=>typeof window.openPanel==='function'&&!!document.querySelector('.pkr-game-seat-card'));
  await page.locator('.bank-bar').click();
  await page.getByRole('button',{name:'View underlying records: table buy-ins',exact:true}).click();
  const bank=page.locator('.pkr-bank-record-dialog');await bank.waitFor({state:'visible'});
  assert.equal(await bank.locator('.pkr-bank-record-row').count(),9);
  await touchGesture(page,engine,bank.locator('.pkr-swipe-handle'));await bank.waitFor({state:'detached'});
  await page.locator('#lbInGameBtn').click();const leaderboard=page.locator('#lbSheet');
  await page.waitForFunction(()=>document.getElementById('lbSheet').classList.contains('show'));
  await touchGesture(page,engine,leaderboard.locator('.pkr-swipe-handle'));
  await page.waitForFunction(()=>!document.getElementById('lbSheet').classList.contains('show'));
  await page.locator('#seat1').click();const panel=page.locator('#sidePanel');
  await page.waitForFunction(()=>document.getElementById('sidePanel').classList.contains('open'));
  await touchGesture(page,engine,panel.locator('.panel-hdr'),{dy:130,cancel:true});
  assert(await panel.evaluate(el=>el.classList.contains('open')),'Cancelling a player-panel gesture must leave it open');
  await panel.getByRole('button',{name:'Other amount',exact:false}).click();
  const amount=panel.locator('input').first();await amount.fill('75');
  await touchGesture(page,engine,panel.locator('.panel-hdr'));
  assert(await panel.evaluate(el=>el.classList.contains('open')),'An unsaved buy-in form must not be swiped away');assert.equal(await amount.inputValue(),'75');
  await panel.getByRole('button',{name:'Back to player',exact:false}).click();
  await touchGesture(page,engine,panel.locator('.panel-hdr'));
  await page.waitForFunction(()=>!document.getElementById('sidePanel').classList.contains('open'));
  assert.equal(fixture.state.writes.length,0,'Closing read-only windows must not write records or settings');
  assert.deepEqual(errors,[]);
  console.log(engine+': data-window swipe passed ('+(engine==='chromium'?'native CDP touch input':'synthetic touch-event integration, reduced motion')+').');
 }catch(error){await page.screenshot({path:path.join(output,engine+'-failure.png')}).catch(()=>{});throw error;}
 finally{await context.close();await browser.close();}
}
(async()=>{await run('chromium',chromium);await run('webkit',webkit);})().catch(error=>{console.error(error);process.exitCode=1;});
