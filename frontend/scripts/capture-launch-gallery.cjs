'use strict';
// Capture the real compiled PKR app. All accounts, games and payments are fictional.
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {chromium}=require('playwright');
const sharp=require('sharp');
const data=require('./launch-fixture.cjs');
const {BASE,API,FIXED_TIME,room,user,upcoming,liveGame,denseGame,handGame,settled,createFixture,initialStorage}=data;
const OUTPUT=path.resolve(__dirname,'../../artifacts/launch-gallery');
const PUBLIC=path.resolve(__dirname,'../public/demo/launch-20261127');
const mode=process.argv[2]||'app';
fs.mkdirSync(OUTPUT,{recursive:true});
fs.mkdirSync(PUBLIC,{recursive:true});
const manifest={schema:1,sourceCommit:process.env.GITHUB_SHA||'unpublished',fixtureDate:FIXED_TIME,sampleData:true,
 description:'Actual PKR screens, rendered from the application with fictional River City Poker records. No production data or device status bars are simulated.',screens:[],boards:[],checks:[],errors:[]};
const sizes={mobile:{width:430,height:873,dpr:2,installed:true},desktop:{width:1440,height:900,dpr:1,installed:false},tablet:{width:1024,height:1366,dpr:1,installed:true}};
const BLOCKED_NOTIFICATION_GUIDANCE='Notifications are blocked in your phone settings. On iPhone, open Settings → Notifications → PKR, allow alerts, then return to this screen. On Android, check the Chrome or PKR app notification permission.';
const html=value=>String(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
async function contextFor(browser,size,{signedIn=true,role='host'}={}){
 const fixture=createFixture();fixture.state.role=role;
 const context=await browser.newContext({viewport:{width:size.width,height:size.height},deviceScaleFactor:size.dpr,
  isMobile:size.installed,hasTouch:size.installed,serviceWorkers:'block',reducedMotion:'reduce',locale:'en-AU',timezoneId:'Australia/Brisbane'});
 // Keep the browser's genuine permission state; no push subscription is created.
 await context.addInitScript(({storage,installed,signedIn})=>{
  if(signedIn)Object.entries(storage).forEach(([key,value])=>localStorage.setItem(key,value));
  if(installed)Object.defineProperty(navigator,'standalone',{configurable:true,get:()=>true});
 },{storage:initialStorage,installed:size.installed,signedIn});
 const errors=[];
 await context.route('**/*',async route=>{
  const request=route.request(),url=new URL(request.url());
  if(url.origin===BASE)return route.continue();
  if(url.origin===API){
   try{
    const body=fixture.resolve(url,request.method(),request.postData());
    return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(body),headers:{'access-control-allow-origin':BASE,'access-control-allow-credentials':'true','access-control-allow-headers':'Content-Type,Authorization','access-control-allow-methods':'GET,POST,PUT,OPTIONS'}});
   }catch(error){errors.push(error.message);return route.fulfill({status:404,contentType:'application/json',body:JSON.stringify({error:'Unavailable fictional fixture'})});}
  }
  // Never contact live Workers, analytics, external avatars, login or payment providers.
  if(url.hostname.includes('workers.dev')||url.hostname==='mypkr.app')errors.push('Live request prevented: '+url.origin+url.pathname);
  return route.abort();
 });
 const page=await context.newPage();page.setDefaultTimeout(18000);
 await page.clock.setFixedTime(new Date(FIXED_TIME));
 page.on('pageerror',error=>errors.push(error.message));
 return {context,page,fixture,errors};
}
async function settle(page){
 await page.waitForLoadState('networkidle',{timeout:15000});
 await page.evaluate(async()=>{
  await document.fonts.ready;
  await Promise.all(Array.from(document.images,img=>{img.loading='eager';return img.decode().catch(()=>{});}));
 });
 await page.waitForTimeout(200);
}
async function top(page){await page.evaluate(()=>{document.body.scrollTop=0;window.scrollTo(0,0);});await page.waitForTimeout(200);}
async function focusSection(page,selector){
 const target=page.locator(selector).first();await target.waitFor({state:'visible'});
 await target.evaluate(element=>element.scrollIntoView({block:'start',behavior:'instant'}));
 await page.waitForTimeout(220);
}
async function snapshot(page,id,title,category,size,{fullPage=false,sourceRoute,allowedAlerts=[]}={}){
 await settle(page);
 const checks=await page.evaluate(()=>{
  const header=document.querySelector('.pkr-primary-mobile-utility');
  const rect=header?.getBoundingClientRect(),style=header?getComputedStyle(header):null;
  const hit=document.elementFromPoint(Math.floor(innerWidth/2),Math.min(innerHeight-1,Math.max(0,(rect?.top||0)+16)));
  return {viewport:{width:innerWidth,height:innerHeight},scrollWidth:document.documentElement.scrollWidth,
  bodyScrollWidth:document.body.scrollWidth,heading:document.querySelector('h1,h2')?.textContent||'',
  header:{exists:Boolean(header),rect:rect?.toJSON()||null,display:style?.display||null,visibility:style?.visibility||null,
   opacity:style?.opacity||null,zIndex:style?.zIndex||null,position:style?.position||null,
   className:header?.className||null,rootClass:document.documentElement.className,
   hitTest:{tag:hit?.tagName||null,className:typeof hit?.className==='string'?hit.className:null,insideHeader:Boolean(header&&hit&&header.contains(hit))}},
  rootScroll:document.documentElement.scrollTop,bodyScroll:document.body.scrollTop,
  visibleAlerts:Array.from(document.querySelectorAll('[role="alert"]')).filter(el=>el.getBoundingClientRect().width&&el.getBoundingClientRect().height).map(el=>el.textContent.trim()),
  brokenImages:Array.from(document.images).filter(img=>img.getBoundingClientRect().width>0&&!img.complete||img.complete&&img.naturalWidth===0&&img.getAttribute('src')).map(img=>img.getAttribute('src'))};
 });
 assert(checks.scrollWidth<=size.width+3,id+' has horizontal document overflow');
 assert(checks.bodyScrollWidth<=size.width+3,id+' has horizontal body overflow');
 // The installation screen also documents denied OS notification permission.
 // Capture that real guidance unchanged; only its exact notice is expected.
 assert.deepEqual(checks.visibleAlerts.filter(notice=>!allowedAlerts.includes(notice)),[],id+' has an unexpected visible error');
 assert.deepEqual(checks.brokenImages,[],id+' has a broken image');
 const png=path.join(OUTPUT,id+'.png');
 await page.screenshot({path:png,fullPage,animations:'disabled'});
 const info=await sharp(png).metadata();
 const webp=path.join(PUBLIC,id+'.webp');
 await sharp(png).webp({quality:85,effort:6}).toFile(webp);
 fs.copyFileSync(webp,path.join(OUTPUT,id+'.webp'));
 const screen={id,title,category,viewport:{width:size.width,height:size.height},width:info.width,height:info.height,
  image:id+'.png',webImage:id+'.webp',publicPath:'/demo/launch-20261127/'+id+'.webp',route:sourceRoute||new URL(page.url()).pathname+new URL(page.url()).search};
 manifest.screens.push(screen);manifest.checks.push({id,...checks,allowedAlerts});
 console.log('CAPTURE '+id+' '+info.width+'x'+info.height);
}
async function captureCase(page,size,item,errors){
 const before=errors.length;
 try{
  if(item.route){await settle(page);await page.goto(BASE+item.route,{waitUntil:'domcontentloaded'});}
  if(item.ready)await page.locator(item.ready).first().waitFor({state:'visible'});
  if(item.action)await item.action(page);
  await settle(page);
  if(item.focus)await focusSection(page,item.focus);else if(item.top!==false)await top(page);
  assert.deepEqual(errors.slice(before),[],item.id+' encountered fixture/runtime errors');
  await snapshot(page,item.id,item.title,item.category,size,{sourceRoute:item.route,allowedAlerts:item.allowedAlerts});
 }catch(error){
  manifest.errors.push(item.id+': '+error.stack);console.error('FAIL '+item.id+': '+error.message);
  await page.screenshot({path:path.join(OUTPUT,'failure-'+item.id+'.png'),fullPage:false}).catch(()=>{});
 }
}
const fullDashboard=mode=>async page=>{
 await page.getByRole('group',{name:'Home view'}).getByRole('button',{name:'Full dashboard',exact:true}).click();
 const appearance=page.getByRole('group',{name:'Host poker room appearance'});
 await appearance.getByRole('button',{name:new RegExp(mode==='live'?'Live Poker':'Command Centre')}).click();
 await page.locator('[data-testid="dual-dashboard"][data-layout="'+mode+'"]').waitFor({state:'visible'});
};
const openTableTools=async page=>{await page.getByRole('button',{name:'Open table controls'}).click();await page.locator('.pkr-table-tools-dialog').waitFor({state:'visible'});};
async function captureApp(browser){
 for(const [label,size] of Object.entries(sizes)){
  const {context,page,fixture,errors}=await contextFor(browser,size);
  try{
   const prefix=label+'-';
   const items=[
    {id:prefix+'home',title:'Game night home',category:'Planning & club',route:'/dashboard?room='+room.id,ready:'[data-testid="game-night-host-home"]',action:async page=>page.getByRole('group',{name:'Home view'}).getByRole('button',{name:'Game night',exact:true}).click()},
    {id:prefix+'command-centre',title:'Full dashboard · Command Centre',category:'Dashboard layouts',route:'/dashboard?room='+room.id,ready:'[data-testid="game-night-host-home"]',action:fullDashboard('command')},
    {id:prefix+'live-dashboard',title:'Full dashboard · Live Poker',category:'Dashboard layouts',route:'/dashboard?room='+room.id,ready:'.pkr-gn-home-switch',action:fullDashboard('live')},
   ];
   if(label==='mobile'||label==='desktop')items.push(
    {id:prefix+'games',title:'Game sessions',category:'Planning & club',route:'/events/'+room.id+'?tab=games',ready:'.pkr-room-games-intro'},
    {id:prefix+'calendar',title:'Calendar and schedule',category:'Planning & club',route:'/schedule?room='+room.id,ready:'.pkr-schedule-game'},
    {id:prefix+'game-detail',title:'Game details and host actions',category:'Planning & club',route:'/games/'+upcoming.id,ready:'.pkr-game-summary'},
    {id:prefix+'rsvp',title:'RSVP board and seat selection',category:'Planning & club',route:'/games/'+upcoming.id+'/rsvp',ready:'.pkr-guest-options'},
    {id:prefix+'sharing',title:'Live RSVPs and WhatsApp sharing',category:'Planning & club',route:'/events/'+room.id+'?tab=night&game='+upcoming.id,ready:'.pkr-night-stats'},
    {id:prefix+'players',title:'Player profiles and membership',category:'Players & access',route:'/events/'+room.id+'?tab=members',ready:'.pkr-member-roster'},
    {id:prefix+'invites',title:'Private invitations and QR tools',category:'Players & access',route:'/events/'+room.id+'?tab=members&view=invite',ready:'.pkr-member-invite',focus:'.pkr-member-invite'},
    {id:prefix+'approvals',title:'Host approval requests',category:'Players & access',route:'/events/'+room.id+'?tab=members&view=requests',ready:'.pkr-member-request-card',focus:'.pkr-member-request-card'},
    {id:prefix+'results',title:'Player standings',category:'Results & records',route:'/results?room='+room.id,ready:'.pkr-results-live-player, .pkr-results-ledger-row'},
    {id:prefix+'history',title:'Completed game history',category:'Results & records',route:'/results?room='+room.id+'&view=history',ready:'.pkr-results-history-card'},
    {id:prefix+'insights',title:'Club performance insights',category:'Results & records',route:'/results?room='+room.id+'&view=insights',ready:'.pkr-results-net-row'},
    {id:prefix+'records',title:'Underlying player records',category:'Results & records',route:'/events/'+room.id+'?tab=members',ready:'.pkr-member-history-link',action:async page=>{
     await page.locator('.pkr-member-history-link').first().click();
     await page.locator('.pkr-record-dialog .pkr-record-body[aria-busy="false"]').waitFor();
     assert.equal(await page.locator('.pkr-record-dialog .pkr-record-row').count(),12);
    },top:false},
    {id:prefix+'payments',title:'Payments overview',category:'Payments',route:'/payments?room='+room.id,ready:'.pkr-gn-payment-totals[aria-busy="false"]'},
    {id:prefix+'payment-ledger',title:'Payment ledger and tools',category:'Payments',route:'/payments?room='+room.id+'&paymentsView=ledger',ready:'.pkr-vnext-insights'},
    {id:prefix+'account',title:'Account and appearance settings',category:'Settings & access',route:'/account',ready:'.pkr-account-appearance'},
    {id:prefix+'notifications',title:'Club notifications and device settings',category:'Settings & access',route:'/account',ready:'.pkr-account-status',focus:'.pkr-account-status'},
    {id:prefix+'install',title:'Install, reconnect and notification guidance',category:'Settings & access',route:'/install?group='+room.id,ready:'.pkr-install-vnext',allowedAlerts:label==='mobile'?[BLOCKED_NOTIFICATION_GUIDANCE]:[]}
   );
   for(const item of items)await captureCase(page,size,item,errors);
   for(const item of [
    {id:prefix+'live-table',title:'Live cash table · 9 players',category:'Live gameplay',route:'/games/'+liveGame.id+'/play',ready:'#seat9 .pkr-game-seat-card',action:async page=>page.waitForFunction(()=>document.querySelectorAll('.seat-chip.seated').length===9)},
    {id:prefix+'table-tools',title:'Table controls and view choices',category:'Live gameplay',ready:'#tableFelt',action:openTableTools,top:false},
    {id:prefix+'table-compact',title:'Compact table · names and amounts',category:'Live gameplay',action:async page=>{
      const tools=page.locator('.pkr-table-tools-dialog');
      await tools.getByRole('button',{name:'Compact table view',exact:true}).click();
      await tools.getByRole('button',{name:'Close table controls'}).click();
      await page.locator('#seat9 .pkr-game-compact-name').waitFor({state:'visible'});
    },top:false},
    {id:prefix+'player-details',title:'Player buy-ins and chip details',category:'Live gameplay',action:async page=>{await page.locator('#seat1').click();await page.locator('.side-panel.open .pkr-quick-metrics').waitFor();},top:false},
    {id:prefix+'bank-records',title:'Table bank and buy-in records',category:'Live gameplay',action:async page=>{
     await page.locator('#panelCloseBtn').click();await page.locator('#bankBar').click();
     await page.getByRole('button',{name:'View underlying records: table bank',exact:true}).click();
     await page.locator('.pkr-bank-record-sheet').waitFor();
    },top:false},
    {id:prefix+'tournament',title:'Tournament timer and blinds',category:'Live gameplay',route:'/games/'+liveGame.id+'/play',ready:'#seat9 .pkr-game-seat-card',action:async page=>{
     await openTableTools(page);await page.locator('.pkr-table-tools-dialog').getByRole('button',{name:/Tournament/}).click();
     await page.locator('#tTimerDisplay').waitFor({state:'visible'});
    },top:false},
    {id:prefix+'table-13',title:'Live table · 13 players',category:'Live gameplay',route:'/games/'+denseGame.id+'/play',ready:'#seat13 .pkr-game-seat-card',action:async page=>page.waitForFunction(()=>document.querySelectorAll('.seat-chip.seated').length===13)},
   ])await captureCase(page,size,item,errors);
   if(label==='mobile'){
    await captureCase(page,size,{id:'mobile-table-13-lower',title:'13-player table · lower seats after scrolling',category:'Live gameplay',ready:'#seat13 .pkr-game-seat-card',action:async page=>{
     await page.locator('#tableArea').evaluate(element=>{element.scrollTop=element.scrollHeight;});
     await page.waitForTimeout(220);
     const lowerSeats=await page.locator('#tableArea').evaluate(element=>{
      const area=element.getBoundingClientRect();
      return {scrollTop:element.scrollTop,visible:[7,8,9].every(number=>{
       const balance=document.querySelector('#seat'+number+' .pkr-game-seat-result')?.getBoundingClientRect();
       return balance&&balance.top>=area.top&&balance.bottom<=area.bottom;
      })};
     });
     assert(lowerSeats.scrollTop>0&&lowerSeats.visible,'Lower 13-player balances must be reachable by ordinary table scrolling');
     manifest.checks.push({id:'mobile-table-13-lower',...lowerSeats});
    },top:false},errors);
    await captureCase(page,size,{id:'mobile-payment-records',title:'Open payment records and confirmations',category:'Payments',route:'/payments?room='+room.id,ready:'.pkr-gn-payment-card',action:async page=>{
     await page.getByRole('button',{name:'View underlying records: To receive',exact:true}).click();
     await page.getByRole('heading',{name:'To receive — underlying records',exact:true}).waitFor({state:'visible'});
     assert.equal(await page.locator('.pkr-gn-payment-card').count(),3);
    },top:false},errors);
    await captureCase(page,size,{id:'mobile-appearance',title:'Room appearance and layout choices',category:'Settings & access',route:'/account',ready:'.pkr-account-appearance',focus:'.pkr-account-appearance'},errors);
    await captureCase(page,size,{id:'mobile-analysis',title:'Hand analysis and player statistics',category:'Results & records',route:'/games/'+settled[0].id+'/analysis',ready:'.pkr-analysis-player-record'},errors);
    await captureCase(page,size,{id:'mobile-shared-results',title:'Shared game results and settlements',category:'Results & records',route:'/games/results/'+settled[0].results_token,ready:'.section-header'},errors);
    await captureCase(page,size,{id:'mobile-live-spectator',title:'Player live table view',category:'Live gameplay',route:'/games/live/'+liveGame.live_token,ready:'#liveTableFelt'},errors);
    await captureCase(page,size,{id:'mobile-hand-tracker',title:'Hand tracking controls',category:'Live gameplay',route:'/games/'+handGame.id+'/play',ready:'#seat9 .pkr-game-seat-card',action:async page=>{
     await page.locator('#handTrackerBtn').waitFor({state:'visible'});await page.locator('#handTrackerBtn').click();
     await page.locator('#handTrackerSheet.open #handTrackerBody').waitFor({state:'visible'});
    },top:false},errors);
   }
   if(label==='desktop'){
    fixture.state.runningTournament=true;
    await captureCase(page,size,{id:'desktop-tournament-tv',title:'Tournament display for a shared screen',category:'Live gameplay',route:'/games/'+liveGame.id+'/tv',ready:'a[aria-label="Back to poker game"]',action:async page=>{
     await page.getByText('13:00',{exact:true}).waitFor({state:'visible'});
    }},errors);
   }
   assert(errors.length===0,'Fixture/runtime errors: '+errors.join('; '));
   manifest.checks.push({viewport:label,apiRequests:fixture.state.requests.length,simulatedWrites:fixture.state.writes});
  }catch(error){manifest.errors.push(label+': '+error.stack);}
  finally{await context.close();}
 }
 // Member and signed-out entry are separate actual application states.
 for(const [id,title,options,route,ready] of [
  ['mobile-player-home','The player’s club dashboard',{role:'member'},'/dashboard?room='+room.id,'[data-testid="player-dashboard"]'],
  ['mobile-player-login','Member sign-in and recovery',{signedIn:false},'/mobile-login','.pkr-classic-mobile-login'],
 ]){
  const {context,page,errors}=await contextFor(browser,sizes.mobile,options);
  try{await captureCase(page,sizes.mobile,{id,title,category:'Settings & access',route,ready},errors);assert.deepEqual(errors,[]);}catch(error){manifest.errors.push(id+': '+error.stack);}finally{await context.close();}
 }
}
function galleryMarkup(screens,{boardTitle,embed=false}={}){
 return '<!doctype html><html lang="en-AU"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>PKR · '+html(boardTitle||'App screenshot gallery')+'</title><style>'+ 
 '*{box-sizing:border-box}body{margin:0;background:#edf1f4;color:#14242c;font:16px Inter,system-ui,sans-serif;padding:40px}header{max-width:1440px;margin:0 auto 30px}small{font-size:13px;letter-spacing:.11em;text-transform:uppercase;font-weight:700;color:#a33d28}h1{font-size:36px;letter-spacing:-1px;margin:8px 0 12px}p{color:#64727a;line-height:1.6;max-width:900px;margin:0}.grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:24px;max-width:1440px;margin:auto}figure{margin:0;background:white;border:1px solid #dfe5e9;border-radius:16px;padding:12px;overflow:hidden}img{width:100%;height:auto;display:block;border:1px solid #dfe5e9;border-radius:8px}figcaption{font-size:16px;font-weight:650;line-height:1.4;padding:14px 3px 3px}figcaption span{display:block;font-size:12px;font-weight:400;color:#64727a;margin-top:5px}a{color:inherit;text-decoration:none}@media(max-width:900px){body{padding:20px}.grid{grid-template-columns:repeat(2,minmax(0,1fr))}}'+
 '</style><header><small>PKR · Actual app screens</small><h1>'+html(boardTitle||'Your poker night, from every angle.')+'</h1><p>Real application screens with fictional River City Poker data. Phone captures show the web app viewport; the operating system’s status bar is not part of these images.</p></header><main class="grid">'+screens.map(s=>{
  const src=embed?'data:image/png;base64,'+fs.readFileSync(path.join(OUTPUT,s.image)).toString('base64'):s.image;
  return '<figure><a href="'+(embed?'#':html(s.image))+'"><img src="'+src+'" alt="'+html(s.title)+'"></a><figcaption>'+html(s.title)+'<span>'+s.viewport.width+' × '+s.viewport.height+' viewport</span></figcaption></figure>';
 }).join('')+'</main></html>';
}
async function makeBoards(browser){
 const groups=[
  ['01-planning-and-club','Planning and your club',['mobile-home','mobile-games','mobile-calendar','mobile-rsvp','mobile-players','mobile-invites','mobile-approvals','mobile-sharing']],
  ['02-live-gameplay','At the table',['mobile-live-table','mobile-table-13','mobile-table-13-lower','mobile-table-compact','mobile-table-tools','mobile-player-details','mobile-bank-records','mobile-tournament','mobile-hand-tracker','mobile-live-spectator','mobile-game-detail']],
  ['03-results-and-payments','Results, records and payments',['mobile-results','mobile-history','mobile-insights','mobile-records','mobile-payments','mobile-payment-records','mobile-payment-ledger','mobile-shared-results']],
  ['04-settings-and-access','Account, settings and player access',['mobile-account','mobile-appearance','mobile-notifications','mobile-install','mobile-player-home','mobile-player-login','mobile-analysis']],
 ];
 const page=await browser.newPage({viewport:{width:1440,height:1000},deviceScaleFactor:1});
 try{
  for(const [id,title,ids] of groups){
   const screens=ids.map(id=>manifest.screens.find(s=>s.id===id)).filter(Boolean);
   if(!screens.length)continue;
   await page.setContent(galleryMarkup(screens,{boardTitle:title,embed:true}),{waitUntil:'load'});
   await page.evaluate(async()=>Promise.all(Array.from(document.images,img=>img.decode())));
   await page.screenshot({path:path.join(OUTPUT,id+'.png'),fullPage:true});manifest.boards.push({id,title,image:id+'.png',screens:ids});
  }
 }finally{await page.close();}
 fs.writeFileSync(path.join(OUTPUT,'index.html'),galleryMarkup(manifest.screens));
}
async function captureMarketing(browser){
 // Capture the real Next OpenGraph route as evidence as well. On the first
 // bootstrap build its source images may not exist yet; the subsequent build
 // with committed launch assets must render the screenshot composition.
 const request=await browser.newContext({serviceWorkers:'block'});
 try{
  const response=await request.request.get(BASE+'/opengraph-image');
  assert(response.ok(),'The social preview route must return successfully');
  assert.match(response.headers()['content-type']||'',/image\/png/,'The social preview must be a PNG');
  const bytes=await response.body(),info=await sharp(bytes).metadata();
  assert.equal(info.width,1200,'Social preview width');assert.equal(info.height,630,'Social preview height');
  assert(bytes.length>5000,'Social preview must contain a rendered graphic');
  fs.writeFileSync(path.join(OUTPUT,'homepage-social-preview.png'),bytes);
  manifest.checks.push({id:'homepage-social-preview',width:info.width,height:info.height,bytes:bytes.length,route:'/opengraph-image'});
 }catch(error){manifest.errors.push('Social preview: '+error.stack);}
 finally{await request.close();}
 for(const [label,size] of Object.entries(sizes).filter(([label])=>label!=='tablet')){
  const {context,page,errors}=await contextFor(browser,size,{signedIn:false});
  try{
   await page.goto(BASE+'/',{waitUntil:'domcontentloaded'});await page.locator('.pkr-l2-hero').waitFor();
   await settle(page);
   const images=page.locator('img[src^="/demo/launch-20261127/"]');
   assert(await images.count()>=8,'Homepage must show the fresh app screenshots');
   const tabs=page.getByRole('tablist',{name:'PKR app features'});
   const count=await tabs.getByRole('tab').count();assert(count>=8,'Launch tour must cover the core app areas');
   for(let i=0;i<count;i++){
    await tabs.getByRole('tab').nth(i).click();await settle(page);
    const image=page.locator('#pkr-tour-panel picture img');
    assert(await image.isVisible(),'Selected tour screenshot must be visible');
    const result=await image.evaluate(img=>({ready:img.complete&&img.naturalWidth>100,src:img.getAttribute('src')}));
    assert(result.ready&&result.src.startsWith('/demo/launch-20261127/'),'Every tour tab must load its current actual-app image');
   }
   await tabs.getByRole('tab').first().click();await top(page);
   await snapshot(page,label+'-homepage','Launch homepage','Public website',size,{fullPage:true});
   assert.deepEqual(errors,[]);
  }catch(error){manifest.errors.push(label+' homepage: '+error.stack);await page.screenshot({path:path.join(OUTPUT,'failure-'+label+'-homepage.png'),fullPage:true}).catch(()=>{});}
  finally{await context.close();}
 }
}
(async()=>{
 const browser=await chromium.launch({headless:true});
 try{
  if(mode==='app'){await captureApp(browser);await makeBoards(browser);}
  else if(mode==='marketing')await captureMarketing(browser);
  else throw Error('Unknown capture mode: '+mode);
 }finally{await browser.close();}
 fs.writeFileSync(path.join(OUTPUT,'manifest-'+mode+'.json'),JSON.stringify(manifest,null,2));
 if(mode==='app')fs.writeFileSync(path.join(PUBLIC,'manifest.json'),JSON.stringify({schema:1,sourceCommit:manifest.sourceCommit,fixtureDate:FIXED_TIME,sampleData:true,screens:manifest.screens},null,2));
 assert.deepEqual(manifest.errors,[],'Every requested app screen must capture successfully');
 console.log('PASS: '+manifest.screens.length+' actual PKR '+mode+' screenshots; '+manifest.boards.length+' overview boards.');
})().catch(error=>{console.error(error);process.exitCode=1;});
