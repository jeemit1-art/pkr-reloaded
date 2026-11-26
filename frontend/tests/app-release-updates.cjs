/* Installed-app release checks using fictional data and an isolated local build.
 * No third-party code, Worker request or API mutation reaches a real service. */
'use strict';
const {chromium,webkit}=require('playwright');
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const BASE='http://127.0.0.1:3000';
const API='https://pkr-reloaded-worker-staging.jeemit1.workers.dev';
const QR_LIBRARY='https://cdnjs.cloudflare.com/ajax/libs/qrcodejs/1.0.0/qrcode.min.js';
const release=JSON.parse(fs.readFileSync(path.resolve(__dirname,'../src/lib/app-version.generated.json'),'utf8'));
const CURRENT=release.version;
assert.match(CURRENT,/^[a-f0-9]{64}$/,'The build must embed its generated release ID');
const NEXT=CURRENT==='a'.repeat(64)?'b'.repeat(64):'a'.repeat(64);
const NEWER=NEXT==='c'.repeat(64)?'d'.repeat(64):'c'.repeat(64);
const output=path.resolve(__dirname,'../../artifacts/app-release-updates');
fs.mkdirSync(output,{recursive:true});
const now=Math.floor(Date.now()/1000);
const user={id:'release-user',name:'Morgan Example',email:'release@invalid.example',plan:'lifetime',is_active:true,trial_active:false,trial_days_left:0,avatar_url:null};
const room={id:'release-room',name:'Example Poker Club',status:'active',role:'host',host_id:user.id,member_count:2,game_count:1,buy_in:2500,created_at:now-86400};
const members=[{id:user.id,name:user.name,role:'host',joined_at:room.created_at},{id:'release-member',name:'Taylor Example',role:'member',joined_at:room.created_at}];
const game={id:'release-game',event_id:room.id,name:'Example live game',status:'active',seats:9,buy_in:2500,starting_chips:0,chip_value:0,bank_size:25,hand_tracking:0,scheduled_at:now,created_at:now,location:'Fictional table',live_token:'release-live',results_token:null};
const players=[{game_id:game.id,user_id:user.id,display_name:user.name,seat_number:1,buy_ins:1,buy_in_total:2500,cashout:null,revision:1}];
const transactions=[{type:'buyin',amount:25,ts:now*1000}];
const gameKey='pokerState_'+game.id+'_'+user.id;
const savedGame={game:{name:game.name,seats:9,defaultBuyin:25,bank_size:25,chip_value:0,starting_chips:0,hand_tracking:0},players:{seat1:{name:user.name,userId:user.id,transactions}}};
const stored={pkr_token:'synthetic-release-session',pkr_preferred_room:room.id,pkr_approved_device_refresh_v1:'f'.repeat(64),[gameKey]:JSON.stringify(savedGame)};
const confirmation='Refresh PKR now? Unsaved form entries will be lost. Saved games and payment records are unchanged.';

function fixture(url,method){
 if(method==='OPTIONS')return {};
 if(method!=='GET')throw new Error('Unexpected API mutation: '+method+' '+url.pathname);
 const p=url.pathname;
 if(p==='/auth/me')return user;
 if(p==='/events')return [room];
 if(p==='/events/'+room.id)return {...room,members};
 if(p==='/events/'+room.id+'/dashboard-layout')return {event_id:room.id,layout:'command',updated_at:now};
 if(p==='/events/'+room.id+'/profiles')return {profiles:[]};
 if(p==='/events/'+room.id+'/push-registrations')return {members:[],definition:'registered_devices_not_delivery_confirmation'};
 if(p==='/events/'+room.id+'/players'||p==='/events/'+room.id+'/history'||p==='/events/'+room.id+'/leaderboard')return [];
 if(p==='/events/'+room.id+'/games')return [game];
 if(p==='/events/'+room.id+'/settlement-ledger')return {games:[],transfers:[]};
 if(p==='/games/'+game.id)return {...game,players,rsvps:[]};
 if(p==='/games/'+game.id+'/hands')return [];
 if(p==='/push/vapid-key')return {key:'synthetic-release-test-only'};
 throw new Error('Missing fictional API fixture: '+p);
}
async function gotoPage(page,url){
 await page.waitForLoadState('networkidle',{timeout:10000});
 await page.goto(url,{waitUntil:'domcontentloaded'});
 await page.waitForLoadState('networkidle',{timeout:10000});
}
async function storage(page){return page.evaluate(keys=>Object.fromEntries(keys.map(key=>[key,localStorage.getItem(key)])),Object.keys(stored));}
async function documentId(page){return page.evaluate(()=>window.__pkrReleaseTestDocument);}
async function preserved(page,id,before){
 assert.equal(await documentId(page),id,'Update detection/dismissal must not reload the active document');
 assert.deepEqual(await storage(page),before,'Device sign-in, selected room and saved game state must remain intact');
}
async function screenshot(page,name){await page.screenshot({path:path.join(output,name+'.png'),fullPage:false});}
async function accountScrollMode(page){
 await page.waitForFunction(()=>document.documentElement.classList.contains('pkr-contained-scroll'));
 const state=await page.evaluate(()=>({window:scrollY,document:document.scrollingElement?.scrollTop,
  body:document.body.scrollTop,position:getComputedStyle(document.body).position,
  overflow:getComputedStyle(document.body).overflowY}));
 assert.equal(state.window,0,'Account updates must not move the native document viewport');
 assert.equal(state.document,0,'Account must scroll inside its installed viewport');
 assert.equal(state.position,'fixed');
 assert(['auto','scroll'].includes(state.overflow),'Update checks must not leave Account scroll-locked');
 return state;
}

async function check(type,label){
 const browser=await type.launch({headless:true});
 const context=await browser.newContext({viewport:{width:390,height:844},deviceScaleFactor:1,serviceWorkers:'block',colorScheme:'dark',isMobile:type===webkit,hasTouch:true});
 const unexpected=[],versionChecks=[],documentRequests=[];
 const state={version:CURRENT};
 await context.addCookies([{name:'release-fixture-cookie',value:'fictional-session-cookie',url:BASE}]);
 await context.addInitScript(({stored,ctx})=>{
  // Seed once only, so an accidental reload cannot conceal cleared app data.
  if(!sessionStorage.getItem('pkr_release_fixture_seeded')){
   for(const [key,value] of Object.entries(stored))localStorage.setItem(key,value);
   localStorage.setItem('pkrCtx',JSON.stringify(ctx));
   sessionStorage.setItem('pkr_setup_compact_v1','1');
   sessionStorage.setItem('pkr_release_fixture_seeded','1');
  }
  Object.defineProperty(navigator,'standalone',{configurable:true,get:()=>true});
  window.__pkrReleaseTestDocument=Date.now()+'-'+Math.random();
 },{stored,ctx:{gameId:game.id,eventId:room.id,userId:user.id,userName:user.name,token:stored.pkr_token,apiUrl:API}});
 await context.route('**/*',async route=>{
  const request=route.request(),url=new URL(request.url());
  if(url.origin===BASE&&url.pathname==='/app-version.json'){
   const headers=request.headers();
   versionChecks.push({method:request.method(),search:url.search,cookie:headers.cookie,authorization:headers.authorization,version:state.version});
   if(request.method()!=='GET'){unexpected.push('Release check must be read-only');return route.abort();}
   return route.fulfill({status:200,contentType:'application/json',headers:{'cache-control':'no-store'},body:JSON.stringify({schema:1,version:state.version})});
  }
  if(url.origin===BASE){if(request.resourceType()==='document')documentRequests.push(url.pathname);return route.continue();}
  if(url.href===QR_LIBRARY&&request.method()==='GET'&&request.resourceType()==='script')return route.abort('blockedbyclient');
  if(url.origin!==API){unexpected.push('Unexpected external request: '+url.origin);return route.abort();}
  try{
   const data=fixture(url,request.method());
   await route.fulfill({status:200,contentType:'application/json',headers:{'access-control-allow-origin':BASE,'access-control-allow-credentials':'true','access-control-allow-headers':'Content-Type,Authorization','access-control-allow-methods':'GET,OPTIONS'},body:JSON.stringify(data)});
  }catch(error){unexpected.push(error.message);await route.abort();}
 });
 const page=await context.newPage();page.setDefaultTimeout(18000);
 page.on('pageerror',error=>unexpected.push(new Date().toISOString()+' '+page.url()+': '+(error.stack||error.message)));
 try{
  await gotoPage(page,BASE+'/account');
  const settings=page.getByTestId('app-version-settings');
  const version=settings.getByTestId('running-app-version');
  await version.waitFor({state:'visible'});
  assert.equal(await version.getAttribute('data-version'),CURRENT);
  assert.equal(await version.getAttribute('title'),CURRENT);
  assert.equal(await version.innerText(),CURRENT.slice(0,12),'Account must show the running build, not merely the server release');
  await settings.getByText('You are using the latest app version.',{exact:true}).waitFor();
  await accountScrollMode(page);
  assert.equal(await page.locator('.pkr-update-notice').count(),0);
  const before=await storage(page),id=await documentId(page),initialDocuments=documentRequests.length;
  assert.deepEqual(before,stored);
  assert(initialDocuments===1,'Account should start in one document');

  state.version=NEXT;
  const beforeCheck=versionChecks.length;
  await settings.getByRole('button',{name:'Check for updates',exact:true}).click();
  await settings.getByText('An app update is ready.',{exact:true}).waitFor();
  const notice=page.locator('.pkr-update-notice');await notice.waitFor({state:'visible'});
  assert(versionChecks.length>beforeCheck,'The Account check must request current public release metadata');
  assert.equal(await version.getAttribute('data-version'),CURRENT,'Detecting a release must not mislabel the running build');
  assert((await accountScrollMode(page)).body>0,'The Account update action must be reached by scrolling the contained body');
  await preserved(page,id,before);
  await screenshot(page,label+'-update-ready');
  await notice.getByRole('button',{name:'Dismiss app update',exact:true}).click();
  await notice.waitFor({state:'detached'});
  await page.waitForTimeout(600);
  await preserved(page,id,before);assert.equal(documentRequests.length,initialDocuments);
  await accountScrollMode(page);
  await settings.getByRole('button',{name:'Check for updates',exact:true}).click();
  await settings.getByText('An app update is ready.',{exact:true}).waitFor();
  assert.equal(await notice.count(),0,'Checking the same release must respect Later');
  await screenshot(page,label+'-later-keeps-session');

  const cancelDialog=page.waitForEvent('dialog');
  const cancelClick=settings.getByRole('button',{name:'Refresh app',exact:true}).click();
  const cancel=await cancelDialog;assert.equal(cancel.type(),'confirm');assert.equal(cancel.message(),confirmation);
  await cancel.dismiss();await cancelClick;
  await settings.getByText('Refresh cancelled. Your current session is still open.',{exact:true}).waitFor();
  await preserved(page,id,before);assert.equal(documentRequests.length,initialDocuments,'Cancelling refresh must not navigate');

  // A different release can be offered again; Later is scoped to that release.
  state.version=NEWER;
  await settings.getByRole('button',{name:'Check for updates',exact:true}).click();
  await notice.waitFor({state:'visible'});await preserved(page,id,before);
  await page.waitForLoadState('networkidle',{timeout:10000});
  const acceptDialog=page.waitForEvent('dialog');
  const acceptClick=settings.getByRole('button',{name:'Refresh app',exact:true}).click();
  const accept=await acceptDialog;assert.equal(accept.message(),confirmation);
  const reloaded=page.waitForEvent('domcontentloaded');
  await accept.accept();await acceptClick;await reloaded;
  await page.waitForLoadState('networkidle',{timeout:10000});
  await page.getByTestId('running-app-version').waitFor();
  assert.notEqual(await documentId(page),id,'An accepted refresh must actually reload the app');
  assert.equal(documentRequests.length,initialDocuments+1,'Exactly one user-approved reload is allowed');
  assert.deepEqual(await storage(page),before,'A voluntary refresh must retain saved games and device sign-in');
  await accountScrollMode(page);

  const beforeLiveChecks=versionChecks.length;
  await gotoPage(page,BASE+'/games/'+game.id+'/play');
  assert.equal(new URL(page.url()).pathname,'/games/'+game.id+'/play','The live-table case must remain on the authorised host route');
  await page.locator('#seat1 .seat-money').filter({hasText:'$25'}).waitFor();
  assert.equal(await page.evaluate(()=>document.documentElement.classList.contains('pkr-contained-scroll')),false,
   'Gameplay must retain its existing table viewport, outside the primary-page scroll container');
  assert(versionChecks.length>beforeLiveChecks,'The newer release must still be detected during live play');
  assert.equal(versionChecks.at(-1).version,NEWER);
  assert.equal(await page.locator('.pkr-update-notice').count(),0,'An update invitation must never cover a live poker table');
  const liveId=await documentId(page),liveDocuments=documentRequests.length;
  await page.waitForTimeout(600);
  assert.equal(await documentId(page),liveId);assert.equal(documentRequests.length,liveDocuments,'Live play must never auto-refresh');
  const liveStorage=await storage(page);
  for(const key of ['pkr_token','pkr_preferred_room','pkr_approved_device_refresh_v1'])assert.equal(liveStorage[key],stored[key]);
  assert.deepEqual(JSON.parse(liveStorage[gameKey]).players.seat1.transactions,transactions,'The update check must not change financial records');
  await screenshot(page,label+'-live-game-no-prompt');

  assert(versionChecks.length>=5);
  for(const request of versionChecks){
   assert.equal(request.method,'GET');assert.equal(request.search,'');
   assert.equal(request.cookie,undefined,'Public release checks must omit session cookies');
   assert.equal(request.authorization,undefined,'Public release checks must not send the access token');
  }
  assert.deepEqual(unexpected,[],'Release checks and refresh controls must cause no API writes, unexpected requests or runtime errors');
  console.log('PASS '+label+' running version, update detection, Later, confirmed/cancelled refresh, preserved state and live-game suppression');
 }catch(error){if(unexpected.length)console.error(label+' unexpected requests/errors: '+JSON.stringify(unexpected));await screenshot(page,label+'-failure').catch(()=>{});throw error;}
 finally{await context.close();await browser.close();}
}
(async()=>{
 const failures=[];
 for(const [label,type] of [['chromium-installed',chromium],['webkit-installed',webkit]]){
  try{await check(type,label);}catch(error){failures.push(label+': '+error.stack);}
 }
 assert.deepEqual(failures,[],'Every installed-app release flow must remain safe and actionable');
})().catch(error=>{console.error(error);process.exitCode=1;});
