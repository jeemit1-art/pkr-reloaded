/* Visual and interaction regressions for the completed Game night appearance.
 * Run in CI against the local staging build. Every API response is fictional;
 * unexpected external requests and all unapproved API writes are blocked. */
'use strict';
const {chromium,webkit}=require('playwright');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const BASE='http://127.0.0.1:3000';
const API='https://pkr-reloaded-worker-staging.jeemit1.workers.dev';
const QR_LIBRARY='https://cdnjs.cloudflare.com/ajax/libs/qrcodejs/1.0.0/qrcode.min.js';
const output=path.resolve(__dirname,'../../artifacts/game-night-polish');
fs.mkdirSync(output,{recursive:true});
const now=Math.floor(Date.now()/1000);
const room={id:'polish-room',name:'Sample Poker Club',description:'Fictional regression fixture',status:'active',role:'host',host_id:'polish-user',member_count:4,game_count:3,buy_in:5000,created_at:now-86400*30};
const user={id:'polish-user',name:'Alex Morgan',email:'fixture@invalid.example',avatar_url:null,plan:'pro',is_active:true,trial_active:false,trial_days_left:0};
const photo='data:image/svg+xml;charset=utf-8,'+encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64"><rect width="64" height="64" fill="#edf1f4"/><circle cx="32" cy="24" r="12" fill="#a33d28"/><path d="M12 64c0-28 40-28 40 0" fill="#a33d28"/></svg>');
const members=[
 {id:user.id,name:user.name,role:'host',avatar_url:photo,joined_at:room.created_at},
 {id:'polish-jordan',name:'Jordan Lee',role:'member',avatar_url:null,joined_at:room.created_at},
 {id:'polish-casey',name:'Casey Brooks',role:'member',avatar_url:null,joined_at:room.created_at},
 {id:'polish-taylor',name:'Taylor Reed',role:'member',avatar_url:null,joined_at:room.created_at},
];
const upcoming={id:'polish-upcoming',event_id:room.id,status:'scheduled',scheduled_at:now+86400,location:'Sample venue',notes:'',seats:8,buy_in:5000,created_at:now,player_count:1,results_token:null,live_token:null};
const finished={...upcoming,id:'polish-finished',status:'settled',scheduled_at:now-86400,player_count:2,results_token:'polish-results',variance:0};
const older={...finished,id:'polish-older',scheduled_at:now-8*86400,results_token:'polish-older-results'};
const playersFor=game=>[
 {game_id:game.id,user_id:user.id,display_name:user.name,buy_ins:1,buy_in_total:5000,cashout:game.id===finished.id?12500:2500,net:game.id===finished.id?7500:-2500,seat_number:1,whatsapp:null,settled_at:game.scheduled_at},
 {game_id:game.id,user_id:'polish-jordan',display_name:'Jordan Lee',buy_ins:2,buy_in_total:10000,cashout:game.id===finished.id?2500:12500,net:game.id===finished.id?-7500:2500,seat_number:2,whatsapp:null,settled_at:game.scheduled_at},
];
const leaders=[
 {user_id:user.id,display_name:user.name,games_played:2,games_won:1,total_net:5000,biggest_win:7500,biggest_loss:-2500,last_played:finished.scheduled_at},
 {user_id:'polish-jordan',display_name:'Jordan Lee',games_played:2,games_won:1,total_net:-5000,biggest_win:2500,biggest_loss:-7500,last_played:finished.scheduled_at},
];
const rsvps=[
 {id:'polish-yes',game_id:upcoming.id,display_name:'Jordan Lee',status:'yes',arrival_option:'19:00',seat_number:1,created_at:now,updated_at:now},
 {id:'polish-maybe',game_id:upcoming.id,display_name:'Casey Brooks',status:'maybe',arrival_option:'maybe',seat_number:null,created_at:now,updated_at:now},
 {id:'polish-no',game_id:upcoming.id,display_name:'Riley Gray',status:'no',arrival_option:'not-coming',seat_number:null,created_at:now,updated_at:now},
];
const seated=[{game_id:upcoming.id,user_id:user.id,display_name:user.name,seat_number:2,buy_ins:0,buy_in_total:0,cashout:null,net:null}];
const allTransfers=[
 {id:'polish-own-pay',from:user.id,from_name:user.name,to:'polish-jordan',to_name:'Jordan Lee',amount:1200,status:'owed'},
 {id:'polish-own-receive',from:'polish-casey',from_name:'Casey Brooks',to:user.id,to_name:user.name,amount:2300,status:'payer_claimed'},
 // The display name matches the signed-in player, but its immutable ID does not.
 {id:'polish-unrelated',from:'polish-other-alex',from_name:user.name,to:'polish-taylor',to_name:'Taylor Reed',amount:4700,status:'owed'},
];

function fixtureState(){return {layout:'command',layoutWrites:0,upcoming:true,noOwnPay:false};}
function fixture(state,url,method,body){
 const p=url.pathname;
 if(method==='OPTIONS')return {};
 if(method==='POST'&&p==='/auth/device-session/start')return {refresh_token:'b'.repeat(64),expires_in:45*86400};
 if(method==='PUT'&&p==='/events/'+room.id+'/dashboard-layout'){
  const value=JSON.parse(body||'{}');assert.deepEqual(Object.keys(value),['layout']);assert(['command','live'].includes(value.layout));
  state.layout=value.layout;state.layoutWrites++;return {event_id:room.id,layout:state.layout,updated_at:now};
 }
 if(method!=='GET')throw new Error('Unexpected API mutation: '+method+' '+p);
 const transfers=allTransfers.filter(item=>!state.noOwnPay||item.id!=='polish-own-pay');
 if(p==='/auth/me')return user;
 if(p==='/events')return [state.memberMode?{...room,role:'member'}:room];
 if(p==='/events/'+room.id)return {...room,members};
 if(p==='/events/'+room.id+'/games')return [...(state.upcoming?[state.live?{...upcoming,status:'active'}:upcoming]:[]),finished,older];
 if(p==='/events/'+room.id+'/history')return [finished,older];
 if(p==='/events/'+room.id+'/leaderboard')return leaders;
 if(p==='/events/'+room.id+'/profiles')return {profiles:[{profile_key:'member:polish-jordan',screen_name:null,avatar_data:null,avatar_emoji:'🦊',preferred_contact:'none'}]};
 if(p==='/events/'+room.id+'/players')return state.historical?[{display_name:'Christopher Nguyen',games_played:8},{display_name:'Historical Guest',games_played:8}]:[];
 if(p==='/events/'+room.id+'/historical-player-visibility')return {hidden_names:[]};
 if(p==='/events/'+room.id+'/dashboard-layout')return {event_id:room.id,layout:state.layout,updated_at:now};
 if(p==='/events/'+room.id+'/join-requests')return {requests:[]};
 if(p==='/events/'+room.id+'/push-registrations')return {members:[{user_id:user.id,device_count:2}],definition:'registered_devices_not_delivery_confirmation'};
 if(p==='/events/'+room.id+'/phone-contacts')return {contacts:state.inviteAudit?[
  {id:'joined-jordan',display_name:'Jordan Lee',phone:'+61400000001',user_id:'polish-jordan',status:'approved_awaiting_member'},
  {id:'joined-casey',display_name:'Casey Brooks',phone:'+61400000002',user_id:'polish-casey',status:'joined',returning:false},
  {id:'awaiting',display_name:'New Guest',phone:'+61400000003',user_id:null,status:'awaiting_host_approval',returning:false},
  {id:'former',display_name:'Former Guest',phone:'+61400000004',user_id:'former-id',status:'removed',returning:true},
  {id:'expired',display_name:'Expired Guest',phone:'+61400000005',user_id:null,status:'expired',returning:false}
 ]:[]};
 if(p==='/events/'+room.id+'/settlement-ledger')return {games:[finished,older],transfers:transfers.map(item=>({...item,game_id:finished.id}))};
 if(p==='/games/'+upcoming.id)return {...upcoming,status:state.live?'active':upcoming.status,players:seated,rsvps:state.noConfirmed?rsvps.filter(r=>r.status!=='yes'):rsvps};
 if(p==='/games/'+upcoming.id+'/rsvp-board')return {game:upcoming,event:room,players:seated,guests:state.noConfirmed?rsvps.filter(r=>r.status!=='yes'):rsvps,options:['19:00','20:00']};
 for(const game of [finished,older]){
  if(p==='/games/'+game.id){const players=playersFor(game);if(state.integrityIssue&&game.id===finished.id)players[0]={...players[0],net:8000};return {...game,players,rsvps:[],transfers:game.id===finished.id?transfers:[]};}
  if(p==='/games/results/'+game.results_token){state.resultReads=(state.resultReads||0)+1;return {game:state.unreconciled?{...game,variance:100}:game,event:room,players:playersFor(game),transfers:game.id===finished.id?transfers:[]};}
  if(p==='/games/'+game.id+'/settlement-control')return {game_id:game.id,enabled:true,reminders_enabled:false,last_broadcast_at:null};
 }
 if(p==='/push/vapid-key')return {key:'synthetic-unusable-vapid-key'};
 if(p==='/events/'+room.id+'/date-polls')return {polls:[]};
 if(p==='/events/'+room.id+'/seasons')return {seasons:[]};
 if(p==='/events/'+room.id+'/shared-expenses')return {expenses:[],members:members.map(m=>({user_id:m.id,display_name:m.name}))};
 if(p==='/events/'+room.id+'/tournament-presets')return {presets:[]};
 throw new Error('Missing synthetic fixture: '+p);
}

async function colour(locator,property){return locator.evaluate((element,key)=>getComputedStyle(element)[key],property);}
async function waitForColour(page,locator,property,expected){
 const element=await locator.elementHandle();
 try{
  // React commits the selected state before the finite CSS colour transition
  // finishes. Check the exact final paint, without accepting intermediate alpha.
  await page.waitForFunction(({element,key,value})=>!!element&&getComputedStyle(element)[key]===value,
   {element,key:property,value:expected},{timeout:3000});
 }finally{await element?.dispose();}
}
async function readable(locator,label){
 const result=await locator.evaluate(element=>{
  const channels=value=>(value.match(/[\d.]+/g)||[]).map(Number);
  const style=getComputedStyle(element),foreground=channels(style.color);
  let background=[255,255,255],parent=element,opacity=1;
  while(parent){
   const css=getComputedStyle(parent),candidate=channels(css.backgroundColor);
   opacity*=Number(css.opacity||1);
   if(candidate.length===3||candidate[3]>=.99){background=candidate.slice(0,3);break;}
   parent=parent.parentElement;
  }
  const lum=rgb=>rgb.map(value=>{value/=255;return value<=.04045?value/12.92:((value+.055)/1.055)**2.4;})
   .reduce((sum,value,index)=>sum+value*[.2126,.7152,.0722][index],0);
  const alpha=(foreground[3]??1)*opacity;
  const ink=foreground.slice(0,3).map((v,i)=>v*alpha+background[i]*(1-alpha));
  const a=lum(ink),b=lum(background);
  return {ratio:(Math.max(a,b)+.05)/(Math.min(a,b)+.05),colour:style.color,background,font:style.fontFamily};
 });
 assert(result.ratio>=4.5,label+' is hard to read: '+JSON.stringify(result));
 assert.match(result.font,/plus jakarta sans|inter/i,label+' must use an approved bundled UI font');
}
async function loadedSheet(page){
 await page.locator('.pkr-record-dialog .pkr-record-body[aria-busy="false"]').waitFor();
 assert.equal(await page.locator('.pkr-record-dialog .pkr-record-error').count(),0,'Fictional records should load without warning');
}
async function closeSheet(page){
 await page.locator('.pkr-record-footer').getByRole('button',{name:'Done',exact:true}).click();
 await page.locator('.pkr-record-dialog').waitFor({state:'detached'});
}
async function screenshot(page,name){await page.screenshot({path:path.join(output,name.replace(/[^a-zA-Z0-9_.-]+/g,'-')+'.png'),fullPage:false});}
const fixtureApiActivity=new WeakMap();
function observeFixtureApi(page){
 const activity={pending:new Set(),changedAt:Date.now()};fixtureApiActivity.set(page,activity);
 page.on('request',request=>{
  if(new URL(request.url()).origin===API){activity.pending.add(request);activity.changedAt=Date.now();}
 });
 const completed=request=>{if(activity.pending.delete(request))activity.changedAt=Date.now();};
 page.on('requestfinished',completed);page.on('requestfailed',completed);
}
async function waitForFixtureApi(page){
 const activity=fixtureApiActivity.get(page);assert(activity,'Synthetic API observation must be installed before navigation');
 const started=Date.now();
 // Require a NEW quiet period, including React work queued by the previous
 // action. An earlier document load-state notification is not a data-ready gate.
 while(activity.pending.size||Date.now()-Math.max(started,activity.changedAt)<250){
  assert(Date.now()-started<10000,'Synthetic API requests did not settle: '+
    [...activity.pending].map(request=>request.method()+' '+request.url()).join(', '));
  await new Promise(resolve=>setTimeout(resolve,25));
 }
}
async function gotoFixturePage(page,url){
 // These deliberately start fresh documents. Let the routed API/preflight chain
 // finish first so WebKit does not cancel an old document's mocked fetches.
 // Real app button navigations stay untouched and retain all error assertions.
 await waitForFixtureApi(page);
 await page.goto(url,{waitUntil:'domcontentloaded'});
 await page.waitForLoadState('networkidle',{timeout:10000});
 await waitForFixtureApi(page);
}


async function checkCompactHomeActions(page,label){
 const original=page.viewportSize();
 try{
  await gotoFixturePage(page,BASE+'/dashboard?room='+room.id);
  await page.getByRole('group',{name:'Home view'}).getByRole('button',{name:'Game night',exact:true}).click();
  const hub=page.getByTestId('private-club-host-home');
  await hub.waitFor({state:'visible'});
  assert.equal(await hub.locator('.pkr-no-tools-grid button').count(),4,'All four approved host shortcuts must work');
  assert.equal(await hub.locator('.pkr-no-stats button').count(),3,'Three club record links required');
  assert(await hub.locator('.pkr-no-next-ticket').isVisible(),'Real next-game ticket must render');
  for(const width of [320,390,430,768,1440]){
   await page.setViewportSize({width,height:844});
   await hub.locator('.pkr-no-tools-grid').scrollIntoViewIfNeeded();
   const geometry=await hub.evaluate(node=>{
    const bounds=el=>el.getBoundingClientRect();
    const buttons=[...node.querySelectorAll('.pkr-no-tools-grid button')],hero=node.querySelector('.pkr-no-hero'),ticket=node.querySelector('.pkr-no-next-ticket');
    return {screen:innerWidth,overflow:Math.max(document.documentElement.scrollWidth,document.body.scrollWidth)>innerWidth+4,
      hero:hero?getComputedStyle(hero).backgroundColor:null,
      buttons:buttons.map(el=>({width:bounds(el).width,height:bounds(el).height,left:bounds(el).left,right:bounds(el).right,clip:el.scrollWidth>el.clientWidth+4})),
      ticket:ticket?getComputedStyle(ticket).backgroundColor:null};
   });
   assert(!geometry.overflow,'Host Home overflow at '+width+': '+JSON.stringify(geometry));
   assert.equal(geometry.hero,'rgb(16, 70, 248)','Approved PKR host hero must be blue');
   assert.equal(geometry.ticket,'rgb(23, 36, 61)','Real branded game pass missing');
   assert(geometry.buttons.every(b=>b.width>90&&b.height>=44&&b.left>=-1&&b.right<=width+2&&!b.clip),
    'Host shortcuts must remain sharp and tappable '+width+' '+JSON.stringify(geometry));
   if(width===430)await screenshot(page,label+'-night-is-on-home-430');
  }
 }finally{await page.setViewportSize(original);}
}


async function checkFullDashboards(page,state,label){
 await gotoFixturePage(page,BASE+'/dashboard?room='+room.id);
 await page.getByRole('group',{name:'Home view'}).getByRole('button',{name:'Full dashboard',exact:true}).click();
 const dashboard=page.getByTestId('dual-dashboard');
 await dashboard.waitFor({state:'visible'});
 const choice=page.getByRole('group',{name:'Host poker room appearance'});
 for(const mode of ['command','live']){
  const name=mode==='command'?'Command Centre':'Live Poker';
  await choice.getByRole('button',{name:new RegExp(name)}).click();
  await page.locator('[data-testid="dual-dashboard"][data-layout="'+mode+'"]').waitFor();
  assert.equal(await colour(page.locator('.pkr-app.pkr-dashboard'),'backgroundColor'),'rgb(11, 13, 20)','All command layouts must use PKR ink');
  assert.equal(await choice.getByRole('button',{name:new RegExp(name)}).getAttribute('aria-pressed'),'true');
  await readable(dashboard.locator('.pkr-dual-heading h2'),name+' heading');
  const tools=dashboard.locator('.pkr-dual-secondary-tools .pkr-dual-utility-strip button');
  assert(await tools.count()>=3,'Club management shortcuts must survive both layouts');
  await readable(tools.first(),name+' shortcut');
  const cta=dashboard.locator('.pkr-dual-gold-button').first();
  assert.equal(await colour(cta,'backgroundColor'),'rgb(199, 255, 58)','Primary action uses PKR citron');
  assert.equal(await colour(cta,'backgroundImage'),'none','No button illustration/gradient');
  await readable(cta,name+' action');
  const hero=dashboard.locator('.pkr-dual-hero');
  assert.equal(await colour(hero,'backgroundColor'),'rgb(24, 42, 72)','Dashboard must retain the PKR slate hero');
  assert.equal(await colour(hero,'backgroundImage'),'none','No abstract image in full dashboard');
  await readable(hero.locator('h3'),name+' hero');
  if(mode==='command'){
   const tiles=dashboard.locator('.pkr-dual-metrics>button');assert.equal(await tiles.count(),4);
   for(const tile of await tiles.all()){
    await readable(tile.locator('strong'),'Financial metric');
    await readable(tile.locator('small'),'Financial metric label');
   }
  }
  await screenshot(page,label+'-branded-dashboard-'+mode);
 }
 assert.equal(state.layoutWrites,1,'Changing layout must save only the chosen setting');
 await choice.getByRole('button',{name:/Command Centre/}).click();
}


async function checkDashboardStatusContrast(page,state,label){
 const prior=state.layout,writes=state.layoutWrites;
 try{
  for(const [kind,title] of [['live','LIVE NOW'],['upcoming','UP NEXT'],['empty','NO GAME SCHEDULED']]){
   state.upcoming=kind!=='empty';state.live=kind==='live';
   for(const mode of ['command','live']){
    state.layout=mode;
    await gotoFixturePage(page,BASE+'/dashboard?room='+room.id);
    await page.getByRole('group',{name:'Home view'}).getByRole('button',{name:'Full dashboard',exact:true}).click();
    const status=page.locator('[data-testid="dual-dashboard"][data-layout="'+mode+'"] .pkr-dual-status[data-game-state="'+kind+'"]');
    await status.waitFor({state:'visible'});
    assert.equal((await status.innerText()).trim(),title,'Status wording must match the real game');
    await readable(status,label+' '+mode+' '+kind+' status');
    const bounds=await status.evaluate(el=>{
     const r=el.getBoundingClientRect(),hero=el.closest('.pkr-dual-hero').getBoundingClientRect();
     return {inside:r.left>=hero.left-1&&r.right<=hero.right+1&&r.top>=hero.top-1&&r.bottom<=hero.bottom+1,
      clipped:el.scrollWidth>el.clientWidth+2||el.scrollHeight>el.clientHeight+2,image:getComputedStyle(el).backgroundImage};
    });
    assert(bounds.inside&&!bounds.clipped&&bounds.image==='none','Game state must stay readable within hero: '+JSON.stringify(bounds));
   }
  }
 }finally{state.upcoming=true;state.live=false;state.layout=prior;state.layoutWrites=writes;}
}

async function checkOutstandingDashboardRecords(page){
 const openDashboard=async()=>{
  await gotoFixturePage(page,BASE+'/dashboard?room='+room.id);
  await page.getByRole('group',{name:'Home view'}).getByRole('button',{name:'Full dashboard',exact:true}).click();
  const card=page.getByTestId('dual-dashboard').getByTestId('room-outstanding');
  await card.getByRole('button',{name:'View underlying records: outstanding room payments',exact:true}).waitFor();
  await page.waitForFunction(()=>document.querySelector('.pkr-room-outstanding-total')?.textContent.includes('$82'));
  return card;
 };
 const card=await openDashboard();
 const missing=card.locator('.pkr-room-outstanding-no-transfers');
 await missing.locator('summary').click();
 assert.equal(await missing.getByRole('button').count(),1,'The no-instructions disclosure lists the actual saved game');
 assert.match(await missing.getByRole('button').innerText(),/View saved game/);
 await card.getByRole('button',{name:'View underlying records: outstanding room payments',exact:true}).click();
 await page.locator('.pkr-gn-payment-totals[aria-busy="false"]').waitFor();
 assert.equal(new URL(page.url()).searchParams.get('paymentsScope'),'club');
 assert.equal(new URL(page.url()).searchParams.get('payments'),'outstanding');
 assert.deepEqual((await page.locator('.pkr-gn-payment-card .pkr-gn-payment-amount').allTextContents()).sort(),['$12','$23','$47']);
 for(const [label,status,amounts] of [
  ['pending payments','owed',['$12','$47']],
  ['payments awaiting receipt','payer_claimed',['$23']],
 ]){
  const source=await openDashboard();
  await source.getByRole('button',{name:'View underlying records: '+label,exact:true}).click();
  await page.locator('.pkr-gn-payment-totals[aria-busy="false"]').waitFor();
  assert.equal(new URL(page.url()).searchParams.get('paymentsScope'),'club');
  assert.equal(new URL(page.url()).searchParams.get('paymentStatus'),status);
  assert.deepEqual((await page.locator('.pkr-gn-payment-card .pkr-gn-payment-amount').allTextContents()).sort(),amounts);
 }
}


async function checkPlayers(page,label){
 await gotoFixturePage(page,BASE+'/events/'+room.id+'?tab=members');
 const brand=page.getByTestId('private-club-players');await brand.waitFor({state:'visible'});
 assert.equal(await colour(brand,'backgroundColor'),'rgb(21, 31, 53)','Players must use the official PKR slate banner');
 assert.match(await brand.locator('h1').innerText(),/THE CREW/);
 assert.equal((await brand.locator('.pkr-pc-members-count strong').innerText()).trim(),'4','Real member count from fixture is preserved');
 assert.match(await brand.locator('.pkr-pc-members-count').innerText(),/club members/);
 await readable(brand.locator('h1'),'PKR players heading');
 const roster=page.locator('.pkr-member-roster');await roster.waitFor();
 await page.getByRole('searchbox',{name:'Search members'}).fill('Jordan');
 await page.getByRole('group',{name:'Filter members by role'}).getByRole('button',{name:'Admins',exact:true}).click();
 await page.locator('.pkr-member-no-results').waitFor();
 // Role-filter controls and real member histories remain usable.
 await page.getByRole('group',{name:'Filter members by role'}).getByRole('button',{name:'All',exact:true}).click();
 await page.getByRole('searchbox',{name:'Search members'}).fill('');
 assert.deepEqual(await roster.locator('.pkr-member-history-link strong').allTextContents(),members.map(m=>m.name));
 assert.equal(await roster.locator('img').first().getAttribute('src'),photo,'Existing member photo must survive');
 await roster.getByText('🦊',{exact:true}).waitFor();
 assert.match(await roster.innerText(),/🦊/u,'User-selected avatar emoji remains');
 const row=roster.locator(':scope > div').first();await row.hover();
 await readable(row.locator('.pkr-member-history-link strong'),'Player name');
 await row.locator('.pkr-member-history-link').focus();await readable(row.locator('strong'),'Keyboard-focused player name');
 await screenshot(page,label+'-players-official');
 await roster.locator('.pkr-directory-player').first().getByRole('button',{name:/Details/}).click();
 await page.locator('.pkr-member-push-state').filter({hasText:'Registered on 2 devices'}).waitFor();
 assert(await page.locator('.pkr-members-panel svg[data-pkr-icon="bell"]').count()>0,'Notification registration remains');
 assert(await page.locator('.pkr-members-shortcuts svg[data-pkr-icon="members"]').count()>0,'Player actions remain');
 assert(await page.locator('.pkr-primary-mobile-utility svg[data-pkr-icon="account"], .pkr-persistent-nav svg[data-pkr-icon="account"]').count()>0,'Account access remains');
 const stage=page.getByTestId('players-command-stage');
 if(await stage.isVisible()){
  await stage.getByRole('button',{name:'View underlying records: Awaiting approval',exact:true}).click();
  await page.locator('.pkr-member-empty-approvals').waitFor({state:'visible'});
  assert.match(await page.locator('.pkr-member-empty-approvals').innerText(),/No approvals waiting/);
  await stage.getByRole('button',{name:'View underlying records: Completed games',exact:true}).click();await loadedSheet(page);
  assert.equal(await page.locator('.pkr-record-row').count(),2,'Completed games must open two settled records');
  await closeSheet(page);
  await stage.getByRole('button',{name:'View underlying records: Players in club',exact:true}).click();
 }
 await roster.locator('.pkr-member-history-link').first().click();await loadedSheet(page);
 const sheet=page.locator('.pkr-record-dialog');
 assert(await sheet.evaluate(element=>element.matches(':modal')),'Record details must be native modal');
 assert.equal(await colour(sheet,'backgroundColor'),'rgb(21, 29, 46)','Record sheets must use PKR dark slate');
 assert.equal(await sheet.locator('.pkr-record-row').count(),2);
 for(const [tone,value] of [['positive','+$75'],['negative','-$25']]){
  const amount=sheet.locator('.pkr-record-row b[data-money-tone="'+tone+'"]');
  assert.equal(await amount.innerText(),value,'Signed financial results unchanged');
  await readable(amount,tone+' amount');
 }
 await screenshot(page,label+'-player-records');await closeSheet(page);
}

async function checkRsvps(page,state,label){
 state.upcoming=false;
 await gotoFixturePage(page,BASE+'/events/'+room.id+'?tab=night');
 const empty=page.locator('.pkr-night-empty').filter({hasText:'No game night to manage'});await empty.waitFor();
 for(const selector of ['strong','p'])await readable(empty.locator(selector),'RSVP empty '+selector);
 for(const name of [/Schedule a game/,/View completed games/,/Notification settings/]){
  const action=empty.getByRole('button',{name});assert(await action.isVisible());await readable(action,'RSVP empty action');
 }
 assert.doesNotMatch(await page.locator('.pkr-night-hub').innerText(),/[🔔♟♙]/u);
 await screenshot(page,label+'-rsvp-empty');
 await empty.getByRole('button',{name:'Schedule a game',exact:true}).click();
 await page.getByRole('dialog',{name:'Schedule a game',exact:true}).waitFor();
 await page.getByRole('button',{name:'Close game scheduler',exact:true}).click();
 state.upcoming=true;
 await gotoFixturePage(page,BASE+'/events/'+room.id+'?tab=night');
 await page.locator('.pkr-night-stats').waitFor();
 assert.equal(await page.locator('.pkr-night-stats > button').count(),4);
 for(const [title,name] of [['Confirmed RSVPs','Jordan Lee'],['Interested RSVPs','Casey Brooks'],['Not coming RSVPs','Riley Gray']]){
  await page.getByRole('button',{name:'View underlying records: '+title,exact:true}).click();await loadedSheet(page);
  assert.equal(await page.locator('.pkr-record-row').count(),1,title+' must open its exact status records');
  assert.equal(await page.locator('.pkr-record-row strong').innerText(),name);
  await closeSheet(page);
 }
 const unmatched=page.getByRole('button',{name:'View 1 members with no matching RSVP',exact:true});await unmatched.click();
 assert.equal(await page.locator('#pkr-unmatched-rsvp-rows .pkr-night-followup strong').innerText(),'Taylor Reed');
 assert(await page.locator('#pkr-unmatched-rsvp-rows').evaluate(element=>element===document.activeElement));
 await page.getByRole('button',{name:'View seat availability: 6 of 8 places',exact:true}).click();
 await page.waitForURL('**/games/'+upcoming.id+'/rsvp');
 // .pkr-guest also exists on the loading skeleton. Verify the actual board and
 // its role-dependent controls before the fixture replaces this document.
 await page.locator('.pkr-guest-hero').getByRole('heading',{name:room.name,exact:true}).waitFor();
 assert.equal(await page.locator('.pkr-guest-stats > div').last().locator('strong').innerText(),'6');
 await page.getByRole('region',{name:'RSVP settings',exact:true}).waitFor();
}

async function checkPayments(page,state,label){
 await gotoFixturePage(page,BASE+'/payments?room='+room.id+'&paymentsScope=mine');
 const totals=page.locator('.pkr-gn-payment-totals');await page.locator('.pkr-gn-payment-totals[aria-busy="false"]').waitFor();
 const toPay=totals.locator('.pkr-gn-payment-total.is-pay');
 const toReceive=totals.locator('.pkr-gn-payment-total.is-receive');
 assert.equal(await colour(toPay,'backgroundColor'),'rgb(65, 36, 47)','Payable record uses dark branded coral-red');
 assert.equal(await colour(toReceive,'backgroundColor'),'rgb(18, 58, 51)','Receivable record uses dark branded gain-green');
 await readable(toPay.locator('strong'),'Payable total');
 await readable(toReceive.locator('strong'),'Receivable total');
 const assertAmounts=async expected=>assert.deepEqual(await page.locator('.pkr-gn-payment-card .pkr-gn-payment-amount').allTextContents(),expected);
 assert.equal(await totals.getByRole('button',{name:'View underlying records: To pay',exact:true}).locator('strong').innerText(),'$12');
 assert.equal(await totals.getByRole('button',{name:'View underlying records: To receive',exact:true}).locator('strong').innerText(),'$23');
 // A summary deliberately clears narrower search/date/status filters so its rows reconcile to its amount.
 await page.getByRole('searchbox',{name:/Counterparty/}).fill('nobody');
 await totals.getByRole('button',{name:'View underlying records: To pay',exact:true}).click();
 await page.getByRole('heading',{name:'To pay — underlying records',exact:true}).waitFor();
 assert.equal(new URL(page.url()).searchParams.get('paymentGroup'),'pay');
 assert.equal(await page.getByRole('searchbox',{name:/Counterparty/}).inputValue(),'');
 await assertAmounts(['$12']);assert.doesNotMatch(await page.locator('.pkr-gn-payment-list').innerText(),/Taylor Reed/);
 await totals.getByRole('button',{name:'View underlying records: To receive',exact:true}).click();
 await page.getByRole('heading',{name:'To receive — underlying records',exact:true}).waitFor();
 assert.equal(new URL(page.url()).searchParams.get('paymentGroup'),'receive');
 await assertAmounts(['$23']);assert.match(await page.locator('.pkr-gn-payment-list').innerText(),/From Casey Brooks/);
 await page.getByRole('button',{name:'Confirm received',exact:true}).waitFor();
 await screenshot(page,label+'-mine-receiving-records');
 await page.getByRole('group',{name:'Payment view'}).getByRole('button',{name:'Club',exact:true}).click();
 await totals.getByRole('button',{name:'View underlying records: Awaiting payment',exact:true}).click();
 await page.getByRole('heading',{name:'Awaiting payment — underlying records',exact:true}).waitFor();
 assert.deepEqual((await page.locator('.pkr-gn-payment-card .pkr-gn-payment-amount').allTextContents()).sort(),['$12','$47']);
 assert.equal(await totals.getByRole('button',{name:'View underlying records: Awaiting payment',exact:true}).locator('strong').innerText(),'$59');
 await totals.getByRole('button',{name:'View underlying records: Awaiting receipt',exact:true}).click();
 await page.getByRole('heading',{name:'Awaiting receipt — underlying records',exact:true}).waitFor();
 await assertAmounts(['$23']);
 state.noOwnPay=true;
 await gotoFixturePage(page,BASE+'/payments?room='+room.id+'&paymentsScope=mine');
 await page.locator('.pkr-gn-payment-totals[aria-busy="false"]').waitFor();
 const zero=page.getByRole('button',{name:'View underlying records: To pay',exact:true});
 assert.equal(await zero.locator('strong').innerText(),'$0');await zero.click();
 await page.getByRole('heading',{name:'Nothing to pay',exact:true}).waitFor();
 assert.equal(await page.locator('.pkr-gn-payment-card').count(),0,'Zero total opens an honest empty record set');
 assert.equal(await totals.getByRole('button',{name:'View underlying records: To receive',exact:true}).locator('strong').innerText(),'$23');
 await screenshot(page,label+'-zero-payment-records');
}

async function checkFinancialIntegrityReview(page,state,label){
 state.integrityIssue=false;state.memberMode=false;
 await gotoFixturePage(page,BASE+'/payments?room='+room.id+'&paymentsScope=club');
 await page.locator('.pkr-gn-payment-totals[aria-busy="false"]').waitFor();
 const toggle=page.getByRole('button',{name:/Saved game integrity review/});
 await toggle.waitFor({state:'visible'});
 assert.equal(await toggle.getAttribute('aria-expanded'),'false','Host audit is collapsed by default');
 assert.equal(await page.getByTestId('pkr-finance-integrity').count(),0,'No audit requests until the host opens it');
 await toggle.click();
 const review=page.getByTestId('pkr-finance-integrity');
 await review.waitFor({state:'visible'});
 await page.waitForFunction(()=>document.querySelector('[data-testid="pkr-finance-integrity"] .pkr-finance-integrity-metrics strong')?.textContent==='2 / 2');
 await review.getByText('No differences detected against the available figures.',{exact:false}).waitFor();
 assert.equal(await toggle.getAttribute('aria-expanded'),'true');
 assert.equal(await review.getByRole('link',{name:'Open saved game'}).count(),0);
 await screenshot(page,label+'-payments-host-integrity-balanced');
 // Synthetic in-memory mismatch only: no production data, no Worker writes.
 state.integrityIssue=true;
 await review.getByRole('button',{name:'Recheck'}).click();
 await page.waitForFunction(()=>document.querySelector('[data-testid="pkr-finance-integrity"] .pkr-finance-integrity-metrics strong')?.textContent==='2 / 2'
  && document.querySelectorAll('[data-testid="pkr-finance-integrity"] .pkr-finance-integrity-row').length===1);
 assert.equal(await review.getByRole('link',{name:'Open saved game'}).count(),1);
 assert.match(await review.innerText(),/1 saved arithmetic difference/);
  const details=review.locator('.pkr-finance-integrity-players');
  assert.equal(await details.count(),1);
  await details.locator('summary').click();
  assert.match(await details.innerText(),/Saved buy-in total/);
  assert.match(await details.innerText(),/Comparison basis/);
 await screenshot(page,label+'-payments-host-integrity-review');
 state.integrityIssue=false;state.memberMode=true;
 await gotoFixturePage(page,BASE+'/payments?room='+room.id);
 await page.locator('.pkr-gn-payment-totals[aria-busy="false"]').waitFor();
 assert.equal(await page.getByRole('button',{name:/Saved game integrity review/}).count(),0,
  'Ordinary member must not see the host audit');
 state.memberMode=false;
}

async function checkInviteDirectory(page,state,label){
 state.inviteAudit=true;
 try{
  await gotoFixturePage(page,BASE+'/events/'+room.id+'?tab=members&view=invite');
  const joined=page.getByRole('region',{name:'Joined players',exact:true});
  await joined.waitFor();
  assert.match(await joined.innerText(),/Jordan Lee[\s\S]*Joined/);
  assert.match(await joined.innerText(),/Casey Brooks[\s\S]*Joined/);
  assert.equal(await joined.getByRole('button',{name:'Recover access',exact:true}).count(),2);
  assert.equal(await joined.getByRole('button',{name:'Invite again',exact:true}).count(),0);
  assert.equal(await joined.getByText(/waiting for (player|host)/i).count(),0,'Linked active members must not appear pending');
  const outstanding=page.getByRole('region',{name:'Outstanding invitations',exact:true});
  assert.match(await outstanding.innerText(),/New Guest[\s\S]*Waiting for host approval/);
  assert.match(await outstanding.innerText(),/Expired Guest[\s\S]*Invitation expired/);
  assert.equal(await outstanding.getByText(/Jordan Lee|Casey Brooks/).count(),0);
  const former=page.getByRole('region',{name:'Former members',exact:true});
  assert.match(await former.innerText(),/Former Guest[\s\S]*original account retained/);
  assert.equal(await former.getByRole('button',{name:'Invite to rejoin',exact:true}).count(),1);
  await screenshot(page,label+'-invite-membership-lifecycle');
 }finally{state.inviteAudit=false;}
}


async function checkReportedVisualIssues(page,state,label){
 const original=page.viewportSize();
 state.historical=true;
 try{
  await gotoFixturePage(page,BASE+'/events/'+room.id+'?tab=members&view=roster');
  const cards=page.locator('.pkr-history-player-card');
  await cards.first().waitFor({state:'visible'});
  assert.equal(await cards.count(),2,'Actual former member history must be retained');
  const historical=cards.filter({hasText:'Christopher Nguyen'});
  for(const width of [320,360,390,430,768,1440]){
   await page.setViewportSize({width,height:844});
   await readable(historical.locator('.pkr-historical-player-name strong'),'Saved player name '+width);
   await readable(historical.locator('.pkr-historical-player-name small'),'Saved games '+width);
   const actions=historical.locator('.pkr-history-player-actions>button');
   assert.equal(await actions.count(),3);
   for(const button of await actions.all())await readable(button,'Former player action '+width);
   const geom=await historical.evaluate(node=>{
    const c=node.getBoundingClientRect(),buttons=[...node.querySelectorAll('.pkr-history-player-actions>button')];
    return {within:buttons.every(b=>{const r=b.getBoundingClientRect();return r.width>0&&r.height>=43&&r.left>=c.left-1&&r.right<=c.right+1&&r.bottom<=c.bottom+1}),overflow:document.documentElement.scrollWidth>innerWidth+3};
   });
   assert(geom.within&&!geom.overflow,'History action outside card at '+width+': '+JSON.stringify(geom));
  }
  await page.setViewportSize(original);await screenshot(page,label+'-historical-player-polish');
  state.historical=false;state.upcoming=false;state.layout='command';
  await gotoFixturePage(page,BASE+'/dashboard?room='+room.id);
  await page.getByTestId('private-club-host-home').waitFor({state:'visible'});
  const action=page.locator('.pkr-no-hero-cta');
  await readable(action,'New no-session PKR schedule action');
  assert.match(await action.innerText(),/SCHEDULE YOUR GAME|GAME CALENDAR/i);
  assert.equal(await colour(action,'color'),'rgb(11, 13, 20)','Schedule action needs dark ink on citron');
  await screenshot(page,label+'-no-session-contrast');
  state.upcoming=true;state.noConfirmed=true;
  await gotoFixturePage(page,BASE+'/dashboard?room='+room.id);
  const ticket=page.locator('.pkr-no-next-ticket');await ticket.waitFor({state:'visible'});
  const count=page.locator('.pkr-no-stat').first();
  await count.waitFor({state:'visible'});
  await readable(ticket.locator('.pkr-no-ticket-copy h3'),'PKR game pass title');
  const heading=await colour(ticket,'backgroundColor');
  assert.equal(heading,'rgb(23, 36, 61)','Approved PKR ticket surface is not displayed');
  const confirmed=await count.locator('strong').innerText();
  assert.equal(confirmed,'0','Real RSVP count must show zero, never fictional players');
  const nav=page.locator('.pkr-primary-mobile-utility:visible,.pkr-primary-sidebar:visible').first();
  assert.equal(await colour(nav,'backgroundColor'),'rgb(13, 20, 36)','App header/navigation should be solid PKR navy');
  await readable(ticket.locator('.pkr-no-ticket-copy h3'),'Branded upcoming game summary');
  await screenshot(page,label+'-assigned-with-no-rsvps');
 }finally{
  state.historical=false;state.upcoming=true;state.noConfirmed=false;
  await page.setViewportSize(original);
 }
}

async function checkSettledResultShare(page,state,label){
 await gotoFixturePage(page,BASE+'/games/'+finished.id);
 const action=page.getByRole('button',{name:'Share group-safe results',exact:true});
 await action.waitFor();
 const reads=state.resultReads||0;
 await action.click();
 const dialog=page.getByRole('dialog',{name:'Share group-safe results',exact:true});
 await dialog.waitFor();
 const message=dialog.getByRole('textbox',{name:'Group results message'});
 await message.waitFor();
 assert((state.resultReads||0)>reads,'Read the exact settled result on opening');
 assert.equal(new URL(page.url()).pathname,'/games/'+finished.id,'Sharing must stay on the settled game');
 const safe=await message.inputValue();
 assert.match(safe,/Alex Morgan/);assert.match(safe,/Jordan Lee/);
 assert.doesNotMatch(safe,/\$|Transfer|Taylor Reed|polish-results/);
 const link=dialog.getByRole('link',{name:'Open WhatsApp'});
 assert.equal(new URL(await link.getAttribute('href')).searchParams.get('text'),safe);
 await dialog.getByRole('checkbox',{name:'Include player net winnings and losses'}).check();
 assert.match(await message.inputValue(),/\$75\.00/);
 assert.doesNotMatch(await message.inputValue(),/Taylor Reed|polish-results/);
 await screenshot(page,label+'-settled-results-share');
 await dialog.getByRole('button',{name:'Close results sharing'}).click();
 await dialog.waitFor({state:'hidden'});
 state.unreconciled=true;
 try{
  await action.click();await dialog.getByRole('alert').waitFor();
  assert.match(await dialog.getByRole('alert').innerText(),/reconciled/);
  assert.equal(await dialog.getByRole('link',{name:'Open WhatsApp'}).count(),0);
  await dialog.getByRole('button',{name:'Close results sharing'}).click();
 }finally{state.unreconciled=false;}
}


async function checkPersonalAppearance(page,state,label){
 const original=page.viewportSize();
 await gotoFixturePage(page,BASE+'/account');
 const appearance=page.getByTestId('personal-appearance');
 await appearance.waitFor({state:'visible'});
 assert.match(await appearance.innerText(),/PKR identity/);
 assert.match(await appearance.innerText(),/THE NIGHT IS ON/);
 assert.equal(await appearance.locator('[data-style-option]').count(),0,'One approved PKR identity, no casino picker');
 assert.equal(await appearance.locator('img').first().getAttribute('src'),'/brand/pkr-night-logo.svg');
 await page.evaluate(()=>{
  localStorage.setItem('pkr_personal_appearance_v1','light');
  localStorage.setItem('pkr_personal_visual_style_v1','noir');
 });
 await page.reload({waitUntil:'domcontentloaded'});
 await appearance.waitFor({state:'visible'});
 assert.equal(await page.locator('html').getAttribute('data-pkr-personal-theme'),'dark','Saved light mode must not overpaint the brand');
 assert.equal(await page.locator('html').getAttribute('data-pkr-personal-style'),'private-club','Saved Noir mode must not create a new variant');
 const routes=[
  ['/account','.pkr-account-page','.pkr-personal-appearance h2'],
  ['/dashboard','.pkr-app.pkr-dashboard','.pkr-no-hero h1'],
  ['/events/'+room.id+'?tab=games','.pkr-app.pkr-event','.pkr-no-games-hero h1'],
  ['/events/'+room.id+'?tab=members','.pkr-app.pkr-event','.pkr-no-members h1'],
  ['/events/'+room.id+'?tab=night','.pkr-app.pkr-event','.pkr-gn-page-head,.pkr-night-title,.pkr-club-header h3'],
  ['/results?room='+room.id,'.pkr-results-page','.pkr-no-results h1'],
  ['/payments?room='+room.id+'&paymentsScope=mine','.pkr-gn-payment-workspace','.pkr-no-payments-hero h1'],
  ['/schedule','.pkr-schedule-page','.pkr-schedule-hero h1'],
  ['/games/'+finished.id,'.pkr-app.pkr-game-detail','.pkr-casino-game-summary h1,.pkr-casino-game-summary .display']
 ];
 for(const size of [{width:Math.min(original.width,390),height:original.height},original]){
  await page.setViewportSize(size);
  for(const [route,container,heading] of routes){
   await gotoFixturePage(page,BASE+route);
   await page.locator(container).first().waitFor();
   assert.equal(await page.locator('html').getAttribute('data-pkr-personal-theme'),'dark',route+' official dark brand');
   assert.equal(await page.locator('html').getAttribute('data-pkr-personal-style'),'private-club',route+' official brand only');
   const canvas=await colour(page.locator(container).first(),'backgroundColor');
   assert.equal(canvas,'rgb(11, 13, 20)',route+' must use PKR ink, not an older casino theme');
   const headings=page.locator(heading+':visible');
   if(await headings.count())await readable(headings.first(),route+' branded text');
   const nav=page.locator('.pkr-primary-mobile-utility:visible,.pkr-primary-sidebar:visible').first();
   await nav.waitFor();assert.equal(await colour(nav,'backgroundColor'),'rgb(13, 20, 36)',route+' must use opaque PKR navigation');
   const audit=await page.locator(container).first().evaluate(root=>{
    const visible=el=>{const r=el.getBoundingClientRect(),s=getComputedStyle(el);return r.width>0&&r.height>0&&s.display!=='none'&&s.visibility!=='hidden';};
    const controls=[...root.querySelectorAll('button:not([disabled]),a.btn,summary,input:not([type=hidden]),select,textarea')].filter(visible);
    const overflow=controls.filter(el=>{
     const r=el.getBoundingClientRect(),s=getComputedStyle(el);
     if(el.closest('.pkr-section-tabs,[role=tablist],.pkr-rsvp-seat-grid,[data-pkr-horizontal-scroll]'))return false;
     if(r.width<2||r.height<2)return false;
     return r.left< -2||r.right>innerWidth+2||
      (el.matches('button,a.btn,summary')&&s.whiteSpace!=='nowrap'&&el.scrollHeight>el.clientHeight+3&&s.overflowY==='hidden');
    }).map(el=>({text:(el.innerText||el.getAttribute('aria-label')||el.tagName).trim().slice(0,80),width:el.clientWidth,scroll:el.scrollWidth}));
    return {overflow,bodyWidth:Math.max(document.documentElement.scrollWidth,document.body.scrollWidth),viewport:innerWidth};
   });
   assert(audit.bodyWidth<=audit.viewport+4,route+' page overflow '+JSON.stringify(audit));
   assert.deepEqual(audit.overflow,[],route+' clipped action');
   if(route.startsWith('/games/')){
    await page.getByRole('button',{name:'Share group-safe results',exact:true}).click();
    const dialog=page.getByRole('dialog',{name:'Share group-safe results'});
    await dialog.getByRole('textbox',{name:'Group results message'}).waitFor();
    await readable(dialog.getByRole('link',{name:'Open WhatsApp'}),'Brand WhatsApp share action');
    await readable(dialog.getByRole('textbox',{name:'Group results message'}),'Branded message preview');
    await screenshot(page,label+'-brand-results-share-'+size.width);
    await dialog.getByRole('button',{name:'Close results sharing'}).click();
   }
   if(size.width===original.width)await screenshot(page,label+'-official-'+route.split('?')[0].split('/').filter(Boolean).join('-'));
  }
 }
 await page.setViewportSize(original);
 await gotoFixturePage(page,BASE+'/account');
 assert.equal(await appearance.locator('[data-style-option]').count(),0);
}

// Regression for the reported iPhone/PWA snapshot: check the actual text
// ranges, not only document width. An overflowing label can be entirely
// inside the viewport and still overlap the adjacent action.

async function checkDashboardCardReadability(page,state,label){
 const original=page.viewportSize();
 try{
  state.layout='live';state.live=false;
  await gotoFixturePage(page,BASE+'/account');
  await page.evaluate(()=>{
   localStorage.setItem('pkr_personal_appearance_v1','light');
   localStorage.setItem('pkr_personal_visual_style_v1','luxe');
  });
  for(const upcoming of [false,true]){
   state.upcoming=upcoming;
   await gotoFixturePage(page,BASE+'/dashboard?room='+room.id);
   assert.equal(await page.locator('html').getAttribute('data-pkr-personal-theme'),'dark');
   assert.equal(await page.locator('html').getAttribute('data-pkr-personal-style'),'private-club');
   await page.getByRole('group',{name:'Home view'}).getByRole('button',{name:'Full dashboard',exact:true}).click();
   const panel=page.locator('.pkr-dual-table-panel');await panel.waitFor();
   if(upcoming){
    await panel.getByRole('button',{name:'View underlying records: Table seats',exact:true}).first().waitFor();
    await page.waitForFunction(()=>document.querySelector('.pkr-dual-table-count')?.textContent.includes('players'));
   }else{
    assert.equal(await panel.getByRole('button',{name:/View table/}).count(),0);
    assert.equal(await panel.locator('.pkr-dual-table-count').count(),0);
    assert.equal(await page.getByRole('button',{name:/See all RSVPs/}).count(),0);
    await panel.getByRole('button',{name:'Schedule a game',exact:true}).waitFor();
    await readable(panel.locator('.pkr-dual-felt-empty'),'Empty table message');
    await readable(page.locator('.pkr-dual-no-rsvps'),'Empty RSVP message');
   }
   for(const width of [320,375,430,768,1024,1440]){
    await page.setViewportSize({width,height:original.height});
    await page.waitForTimeout(100);
    const issues=await page.locator('.pkr-dual-root').evaluate(root=>{
     const issues=[],visible=el=>{const r=el.getBoundingClientRect(),s=getComputedStyle(el);return r.width>0&&r.height>0&&s.visibility!=='hidden'&&s.display!=='none'};
     for(const row of root.querySelectorAll('.pkr-dual-section-title,.pkr-dual-panel-actions,.pkr-dual-attendance-summary')){
      if(!visible(row))continue;
      const children=[...row.children].filter(visible),parent=row.getBoundingClientRect();
      for(const child of children){
       const b=child.getBoundingClientRect();
       if(b.left<parent.left-2||b.right>parent.right+2||b.top<parent.top-2||b.bottom>parent.bottom+2)issues.push('outside header '+child.textContent);
       if(child.matches('button,h3,small,span')){
        const range=document.createRange();range.selectNodeContents(child);
        for(const rect of range.getClientRects()){
         if(rect.width>0&&(rect.left<b.left-2||rect.right>b.right+2||rect.top<b.top-2||rect.bottom>b.bottom+2))issues.push('clipped text '+child.textContent);
        }
       }
      }
      for(let a=0;a<children.length;a++)for(let b=a+1;b<children.length;b++){
       const x=children[a].getBoundingClientRect(),y=children[b].getBoundingClientRect();
       if(Math.min(x.right,y.right)-Math.max(x.left,y.left)>2&&Math.min(x.bottom,y.bottom)-Math.max(x.top,y.top)>2)issues.push('overlap '+children[a].textContent+' / '+children[b].textContent);
      }
     }
     return issues;
    });
    assert.deepEqual(issues,[],label+' '+width+' upcoming='+upcoming+' PKR dashboard controls must not overlap');
    await readable(panel.locator('h3'),'Snapshot title');
    for(const button of await panel.locator('.pkr-dual-panel-actions>button').all())await readable(button,'Snapshot action');
    if(upcoming)for(const button of await page.locator('.pkr-dual-attendance-summary>button').all())await readable(button,'Real RSVP metric');
    if(width===430)await screenshot(page,label+'-official-snapshot-'+(upcoming?'scheduled':'empty'));
   }
   assert.equal(await panel.locator('.pkr-dual-panel-actions button:disabled').count(),0);
  }
 }finally{
  state.upcoming=true;state.live=false;state.layout='command';
  await page.setViewportSize(original);
 }
}

async function run(){
 const failures=[];
 for(const [label,type,width,height] of [['chromium-phone',chromium,390,844],['chromium-desktop',chromium,1440,900],['webkit-phone',webkit,390,844]]){
  const browser=await type.launch({headless:true});
  const context=await browser.newContext({viewport:{width,height},deviceScaleFactor:1,serviceWorkers:'block'});
  const state=fixtureState(),unexpected=[],requestFailures=[];
  await context.addInitScript(()=>{localStorage.setItem('pkr_token','synthetic-polish-test-only');localStorage.setItem('pkr_preferred_room','polish-room');localStorage.setItem('pkr_personal_visual_style_v1','standard');sessionStorage.setItem('pkr_setup_compact_v1','1');});
  await context.route('**/*',async route=>{
   const request=route.request(),url=new URL(request.url());
   if(url.origin===BASE)return route.continue();
   // Exercise the existing offline QR fallback without fetching third-party code.
   // Only this exact presentation script is expected; every other origin stays blocked.
   if(request.method()==='GET'&&request.resourceType()==='script'&&url.href===QR_LIBRARY)return route.abort('blockedbyclient');
   if(url.origin!==API){unexpected.push('Blocked unexpected external origin: '+url.origin);return route.abort();}
   try{const response=fixture(state,url,request.method(),request.postData());
    await route.fulfill({status:200,contentType:'application/json',headers:{'access-control-allow-origin':BASE,'access-control-allow-credentials':'true','access-control-allow-headers':'Content-Type,Authorization','access-control-allow-methods':'GET,POST,PUT,OPTIONS'},body:JSON.stringify(response)});
   }catch(error){unexpected.push(error.message);await route.abort();}
  });
  const page=await context.newPage();page.setDefaultTimeout(20000);observeFixtureApi(page);
  page.on('pageerror',error=>unexpected.push(new Date().toISOString()+' '+page.url()+': '+(error.stack||error.message)));
  page.on('requestfailed',request=>{if(new URL(request.url()).origin===API)requestFailures.push({at:new Date().toISOString(),page:page.url(),url:request.url(),method:request.method(),error:request.failure()?.errorText});});
  try{
   if(process.argv.includes('--dashboard-overflow')){
    await checkDashboardCardReadability(page,state,label);
    assert.deepEqual(unexpected,[],'Unexpected API request or runtime error');
    console.log('PASS',label,'empty and scheduled dashboard card bounds and contrast');
    continue;
   }
   await checkCompactHomeActions(page,label);
   await checkFullDashboards(page,state,label);
   await checkDashboardStatusContrast(page,state,label);
   await checkOutstandingDashboardRecords(page);
   await checkPlayers(page,label);
   await checkInviteDirectory(page,state,label);
   await checkRsvps(page,state,label);
   await checkReportedVisualIssues(page,state,label);
   await checkSettledResultShare(page,state,label);
   await checkPayments(page,state,label);
   await checkFinancialIntegrityReview(page,state,label);
   const canvas=await page.locator('.pkr-gn-payment-workspace').evaluate(node=>({colour:getComputedStyle(node).backgroundColor,image:getComputedStyle(node).backgroundImage}));
   assert.equal(canvas.colour,'rgb(11, 13, 20)','Payments shares approved PKR ink canvas');
   assert.equal(canvas.image,'none','Payments screen must not have scenic background images');
   assert.equal(await page.evaluate(()=>document.body.style.overflow),'','Modal scroll locks must be released');
   await checkPersonalAppearance(page,state,label);
   assert.deepEqual(unexpected,[],'Unexpected API request or runtime error');
   console.log('PASS',label,'appearance, SVG icons, exact records and payment scope');
  }catch(error){failures.push(label+': '+error.stack);if(requestFailures.length)console.error(label+' failed API requests: '+JSON.stringify(requestFailures));await screenshot(page,label+'-failure').catch(()=>{});}
  finally{await context.close();await browser.close();}
 }
 if(failures.length)throw new Error(failures.join('\n\n'));
 console.log('PASS: full dashboards, preserved avatars, readable rosters and record sheets, all Players metrics, RSVP totals and Mine/Club payment groups.');
}
run().catch(error=>{console.error(error);process.exitCode=1;});
