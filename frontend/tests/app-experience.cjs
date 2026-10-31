/* Browser regression tests. Synthetic responses only; all external API writes are blocked. */
'use strict';
const {chromium,webkit}=require('playwright');
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const BASE='http://127.0.0.1:3000',API='https://pkr-reloaded-worker-staging.jeemit1.workers.dev';
const output=path.resolve(__dirname,'../../artifacts/app-experience');fs.mkdirSync(output,{recursive:true});
const now=Math.floor(Date.now()/1000);
const room={id:'test-room',name:'Friday Night Poker',role:'host',host_id:'test-user',status:'active',member_count:2,game_count:3,buy_in:5000,created_at:now-86400,description:'Synthetic test room'};
const user={id:'test-user',name:'Alex Morgan',email:'test@invalid.example',plan:'pro',is_active:true,trial_active:false,trial_days_left:0,avatar_url:null};
const members=[{id:'test-user',name:'Alex Morgan',role:'host',joined_at:now-86400},{id:'member-2',name:'Jordan Lee',role:'member',joined_at:now-86400}];
const upcoming={id:'test-game',event_id:room.id,status:'scheduled',scheduled_at:now+86400,location:'Test venue',notes:'',seats:8,buy_in:5000,created_at:now,player_count:2,live_token:'synthetic-live',results_token:null};
const finished={...upcoming,id:'test-finished',status:'settled',scheduled_at:now-86400,results_token:'synthetic-results',variance:0};
const old={...finished,id:'test-old',scheduled_at:now-120*86400,results_token:'synthetic-old-results'};
const players=[{game_id:finished.id,user_id:'test-user',display_name:'Alex Morgan',buy_ins:1,buy_in_total:5000,cashout:12500,net:7500,seat_number:1,settled_at:now-86400,whatsapp:null},{game_id:finished.id,user_id:'member-2',display_name:'Jordan Lee',buy_ins:2,buy_in_total:10000,cashout:2500,net:-7500,seat_number:2,settled_at:now-86400,whatsapp:null}];
const leaders=players.map(p=>({...p,games_played:2,games_won:p.net>0?2:0,total_net:p.net*2,biggest_win:Math.max(0,p.net),biggest_loss:Math.min(0,p.net),last_played:now-86400}));
const transfers=[{id:'pending',from:'member-2',from_name:'Jordan Lee',to:'test-user',to_name:'Alex Morgan',amount:7500,status:'owed'},{id:'paid',from:'member-2',from_name:'Jordan Lee',to:'test-user',to_name:'Alex Morgan',amount:12500,status:'paid'}];
let simulateMissingSettledGames=false;
let selectedLayout='command',layoutWrites=0,simulateMember=false;
function fixture(url,method,body){
 if(method==='OPTIONS')return {};
 if(method==='PUT'&&url.pathname==='/events/test-room/dashboard-layout'){
  const data=JSON.parse(body||'{}');
  assert(['command','live'].includes(data.layout));
  assert.deepEqual(Object.keys(data),['layout']);
  layoutWrites++;selectedLayout=data.layout;
  return {event_id:'test-room',layout:selectedLayout,updated_at:now};
 }
 if(method!=='GET')throw new Error('Unexpected API write: '+method+' '+url.pathname);
 const p=url.pathname;
 if(p==='/auth/me')return user;
 if(p==='/events')return [simulateMember?{...room,role:'member'}:room];
 if(p==='/events/test-room')return {...room,members:simulateMember
  ?members.map(m=>m.id===user.id?{...m,role:'member'}:m):members};
 if(p==='/events/test-room/profiles')return {profiles:[]};
 if(p==='/events/test-room/players')return [];
 if(p==='/events/test-room/games')return [upcoming,finished,old];
 if(p==='/events/test-room/dashboard-layout')return {event_id:'test-room',layout:selectedLayout,updated_at:now};
 if(p==='/events/test-room/settlement-ledger'){
  if(simulateMissingSettledGames)return {error:'Synthetic legacy Worker has no room-ledger route'};
  return {games:[finished,old],transfers:[
    {...transfers[0],game_id:finished.id},
    {...transfers[1],game_id:finished.id},
    {...transfers[0],id:'old-pending',amount:2500,game_id:old.id},
  ]};
 }
 if(p==='/events/test-room/history')return [finished,old];
 if(p==='/events/test-room/leaderboard')return leaders;
 if(p==='/events/test-room/join-requests')return {requests:[]};
 if(p==='/events/test-room/push-registrations')return {members:[],definition:'registered_devices_not_delivery_confirmation'};
 if(p==='/events/test-room/phone-contacts')return {contacts:[]};
 if(p==='/games/results/synthetic-results'){
  if(simulateMissingSettledGames)return {error:'Synthetic historical results link inaccessible'};
  return {game:finished,event:room,players,transfers};
 }
 if(p==='/games/results/synthetic-old-results'){
  if(simulateMissingSettledGames)return {error:'Synthetic older results inaccessible'};
  return {game:old,event:room,players,transfers:[{...transfers[0],id:'old-pending',amount:2500}]};
 }
 if(p==='/games/live/synthetic-live')return {game:upcoming,event:room,players,totalIn:15000,totalOut:15000,bank:0};
 if(p==='/games/test-game')return {...upcoming,players,rsvps:[{id:'r1',game_id:upcoming.id,display_name:'Jordan Lee',status:'yes',created_at:now}]};
 if(p==='/games/test-finished')return simulateMissingSettledGames?{error:'Synthetic details unavailable'}:{...finished,players,rsvps:[],transfers};
 if(p==='/games/test-old')return {error:'Synthetic old game details unavailable'};
 if(p==='/games/test-game/rsvp-board')return {game:upcoming,event:room,players:[],guests:[],options:['19:00','20:00']};
 if(p==='/push/vapid-key')return {key:'synthetic-not-a-real-key'};
 return {error:'No synthetic fixture for '+p};
}
const sizes=[['small-phone',320,700],['phone',390,844],['short-phone',390,400],['landscape',844,390],['tablet',768,1024],['desktop',1440,900]];
async function hitVisible(locator){
 await locator.scrollIntoViewIfNeeded();
 const result=await locator.evaluate(el=>{
   const b=el.getBoundingClientRect(),x=b.left+b.width/2,y=b.top+b.height/2;
   const top=document.elementFromPoint(x,y);
   return {visible:b.width>0&&b.height>0&&b.top>=-1&&b.bottom<=innerHeight+1&&b.left>=-1&&b.right<=innerWidth+1,hit:!!top&&(el===top||el.contains(top)),box:{x:b.x,y:b.y,w:b.width,h:b.height}};
 });
 assert(result.visible&&result.hit,'Control is obscured or out of viewport: '+JSON.stringify(result));
}
async function loaded(page){await page.locator('.pkr-record-dialog .pkr-record-body[aria-busy="false"]').waitFor();assert.equal(await page.locator('.pkr-record-error').count(),0);}
async function closeSheet(page){await hitVisible(page.locator('.pkr-record-footer').getByRole('button',{name:'Done',exact:true}));await page.locator('.pkr-record-footer').getByRole('button',{name:'Done',exact:true}).click();await page.locator('.pkr-record-dialog').waitFor({state:'detached'});}
async function run(){
 const errors=[];
 for(const [engine,type] of [['chromium',chromium],['webkit',webkit]]){
  const browser=await type.launch({headless:true});
  try{for(const [name,width,height] of engine==='webkit'?sizes.filter(x=>['phone','short-phone','landscape'].includes(x[0])):sizes){
   selectedLayout='command';layoutWrites=0;simulateMember=false;
   const context=await browser.newContext({viewport:{width,height},serviceWorkers:'block'});
   await context.addInitScript(()=>localStorage.setItem('pkr_token','synthetic-ui-test-only'));
   const page=await context.newPage();page.setDefaultTimeout(15000);
   const unexpected=[];
   page.on('pageerror',error=>unexpected.push('Client runtime error: '+(error.stack||error.message)));
   await page.route('**/*.workers.dev/**',async route=>{
    const req=route.request(),url=new URL(req.url());
    if(url.origin!==API){unexpected.push('Unexpected API origin '+url.origin);return route.abort();}
    try{const data=fixture(url,req.method(),req.postData());await route.fulfill({status:data.error?404:200,contentType:'application/json',headers:{'access-control-allow-origin':BASE,'access-control-allow-credentials':'true','access-control-allow-headers':'Content-Type,Authorization','access-control-allow-methods':'GET,OPTIONS'},body:JSON.stringify(data)});}
    catch(error){unexpected.push(error.message);await route.abort();}
   });
   try{
    await page.goto(BASE+'/insights',{waitUntil:'domcontentloaded'});
    await page.locator('[data-testid="current-outstanding"]').filter({hasText:'$100'}).waitFor();
    const nav=page.locator('.pkr-universal-bottom-nav');
    const primary=width<1100?page.locator('.pkr-universal-bottom-nav'):page.locator('.pkr-persistent-nav');
    await primary.waitFor({state:'visible'});
    for(const label of ['Home','Games','Players','Results','Payments']){
      assert.equal(await primary.getByRole('button',{name:label,exact:true}).count(),1,
        'The '+label+' primary tab must be visible on every screen');
    }
    assert.equal(await primary.getByRole('button',{name:'More'}).count(),0,
      'Primary features must not be hidden behind More');

    if(width<1100){await nav.waitFor({state:'visible'});const b=await nav.boundingBox();assert(b.y>height/2&&b.y+b.height<=height+1,'Bottom navigation is at the top or outside viewport');}
    assert.equal(await page.locator('.pkr-insights-kpis .pkr-metric-trigger').count(),5);
    for(const [index,count] of [[0,3],[1,2],[2,2],[3,2],[4,2]]){
     await page.locator('.pkr-insights-kpis .pkr-metric-trigger').nth(index).click();await loaded(page);
     assert.equal(await page.locator('.pkr-record-row').count(),count);
     assert(await page.locator('.pkr-record-dialog').evaluate(el=>el.matches(':modal')),'Record sheet must occupy the browser top layer');
     if(index===4)assert.match(await page.locator('.pkr-record-heading').innerText(),/\$100/);
     await closeSheet(page);
    }
    if(width<=700){
      const card=page.locator('.pkr-insights-player-mobile-row').first();
      const action=card.locator('button.pkr-metric-trigger');
      await action.waitFor({state:'visible'});
      await action.scrollIntoViewIfNeeded();
      const geometry=await card.evaluate(row=>{
        const button=row.querySelector('button.pkr-metric-trigger');
        const info=button?.querySelector('.pkr-insights-player-mobile-info');
        const amount=button?.querySelector('.pkr-vnext-positive,.pkr-vnext-negative');
        if(!button||!info||!amount)return {ok:false,reason:'missing name or net'};
        const a=row.getBoundingClientRect(),b=button.getBoundingClientRect();
        const n=info.getBoundingClientRect(),m=amount.getBoundingClientRect();
        const collision=n.left<m.right-2&&n.right>m.left+2&&n.top<m.bottom-2&&n.bottom>m.top+2;
        return {ok:b.width>=a.width-3&&b.height<=180&&
          n.width>=80&&m.width>20&&!collision&&
          n.left>=a.left-2&&n.right<=a.right+2&&m.left>=a.left-2&&m.right<=a.right+2,
          reason:JSON.stringify({row:a.toJSON(),button:b.toJSON(),name:n.toJSON(),net:m.toJSON(),collision})};
      });
      assert(geometry.ok,'Mobile player data must not overlap and the full card must be clickable: '+geometry.reason);
      await action.click();await loaded(page);
      assert.match(await page.locator('.pkr-record-heading').innerText(),/game history/i);
      assert.match(await page.locator('.pkr-record-heading').innerText(),/2 settled games/);
      assert.equal(await page.locator('.pkr-record-row').count(),2);
      assert.match(await page.locator('.pkr-record-row').first().innerText(),/Buy-ins.*Cash-out/);
      await closeSheet(page);
    }
    await page.locator('.pkr-insights-balance-tiles .pkr-metric-trigger').nth(0).click();await loaded(page);
    assert.equal(await page.locator('.pkr-record-row').count(),1);await page.locator('.pkr-record-row').click();await loaded(page);
    assert.equal(await page.locator('.pkr-record-row').count(),2);await page.getByRole('button',{name:'Back to breakdown'}).click();await loaded(page);await closeSheet(page);
    await page.getByLabel('Settlement reporting period').selectOption('90d');
    await page.locator('.pkr-insights-kpis .pkr-metric-trigger').nth(4).click();await loaded(page);
    assert.equal(await page.locator('.pkr-record-row').count(),1);assert.match(await page.locator('.pkr-record-heading').innerText(),/\$75/);
    await page.screenshot({path:path.join(output,engine+'-'+name+'-records.png')});await closeSheet(page);
    await page.locator('.pkr-insights-kpis .pkr-metric-trigger').nth(0).click();await loaded(page);
    await page.setViewportSize({width,height:Math.min(height,380)});await page.waitForTimeout(100);
    await hitVisible(page.getByRole('button',{name:'Close record details'}));await closeSheet(page);await page.setViewportSize({width,height});
    await page.goto(BASE+'/dashboard',{waitUntil:'domcontentloaded'});
    await page.locator('[data-testid="dual-dashboard"][data-layout="command"]').waitFor();
    await page.locator('.pkr-dual-switcher-compact summary').click();
    await page.locator('.pkr-dual-switch-actions button[aria-pressed="true"]').first().waitFor();
    assert.equal(await page.getByRole('button',{name:/Command Centre/}).getAttribute('aria-pressed'),'true');
    assert.equal(await page.getByRole('button',{name:/Live Poker/}).getAttribute('aria-pressed'),'false');
    await page.getByTestId('room-outstanding-amount').filter({hasText:'$100'}).waitFor();
    if(engine==='chromium'&&name==='phone'){
      // Regression for the real screenshot: when the old Worker and both old
      // game detail endpoints fail, $0 must not be presented as final.
      simulateMissingSettledGames=true;
      try{
        await page.reload({waitUntil:'domcontentloaded'});
        await page.getByTestId('room-payment-unverified').waitFor();
        assert.equal(await page.getByTestId('room-outstanding-amount').innerText(),'—',
          'Two unverified settled games must NEVER show a final $0 total');
        assert.match(await page.getByTestId('room-payment-unverified').innerText(),/2 settled games/i);
        const missing=await page.locator('.pkr-room-outstanding-footer').evaluate(footer=>{
          const b=footer.querySelector('.pkr-room-outstanding-open').getBoundingClientRect();
          const f=footer.getBoundingClientRect();
          return {w:b.width,h:b.height,footer:f.height};
        });
        assert(missing.w>145&&missing.h<80&&missing.footer<160,
          'An unverified settlement warning must never make the payment link vertical: '+JSON.stringify(missing));
        assert.match(await page.getByTestId('room-payment-unverified').innerText(),/Game settled/i,
          'Game settlement status and payment verification must be clearly distinguished');
      }finally{simulateMissingSettledGames=false;}
      await page.reload({waitUntil:'domcontentloaded'});
      await page.getByTestId('room-outstanding-amount').filter({hasText:'$100'}).waitFor();
    }
    const footerGeometry=await page.locator('.pkr-dual-root .pkr-room-outstanding').evaluate(card=>{
      const footer=card.querySelector('.pkr-room-outstanding-footer');
      const actions=card.querySelector('.pkr-room-outstanding-controls');
      const button=card.querySelector('.pkr-room-outstanding-open');
      const refresh=card.querySelector('.pkr-room-outstanding-refresh');
      if(!footer||!actions||!button||!refresh)return null;
      const area=card.getBoundingClientRect(),f=footer.getBoundingClientRect();
      const a=actions.getBoundingClientRect(),b=button.getBoundingClientRect();
      const r=refresh.getBoundingClientRect(),style=getComputedStyle(button);
      return {card:area.width,footer:f.height,controls:a.width,
        button:b.width,buttonHeight:b.height,refresh:r.width,
        oneCharacterColumn:b.width<110,buttonsInside:b.left>=area.left-2&&b.right<=area.right+2,
        wrapStyle:style.wordBreak};
    });
    assert(footerGeometry&&footerGeometry.footer<160&&
      !footerGeometry.oneCharacterColumn&&footerGeometry.buttonHeight<80&&
      footerGeometry.buttonsInside&&footerGeometry.controls>=footerGeometry.card-60,
      'Payment footer must stay compact and button legible on every viewport: '+JSON.stringify(footerGeometry));
    assert.equal(footerGeometry.wrapStyle,'normal','Do not force per-letter breaking in the payment action');
    assert.equal(await page.locator('.pkr-dual-root .pkr-room-outstanding-row').count(),2,
      'Command Centre must show actual pending transfers from the settled ledger');
    assert.equal(await page.getByTestId('dual-dashboard').count(),1);
    assert.equal(await page.locator('.pkr-dual-nextgame').count(),1);
    const prioritised=await page.evaluate(()=>{
      const money=document.querySelector('.pkr-dual-root .pkr-room-outstanding');
      const actions=document.querySelector('.pkr-dual-quick-grid');
      return !!money&&!!actions&&!!(money.compareDocumentPosition(actions)&Node.DOCUMENT_POSITION_FOLLOWING);
    });
    assert(prioritised,'Outstanding payments must appear before action shortcuts');
    // A preceding payment-error regression deliberately reloads the page and
    // closes the compact dashboard selector. Reopen it before changing layouts.
    if(await page.locator('.pkr-dual-switcher-compact').getAttribute('open')===null)
      await page.locator('.pkr-dual-switcher-compact summary').click();
    await page.getByRole('button',{name:/Live Poker/}).click();
    await page.getByTestId('dual-dashboard').locator('.pkr-dual-table-panel').waitFor();
    if(height>=700)await page.screenshot({path:path.join(output,engine+'-'+name+'-dual-live.png'),fullPage:false});
    assert.equal(layoutWrites,1,'Changing layout must issue one saved preference update');
    assert.equal(await page.getByTestId('dual-dashboard').getAttribute('data-layout'),'live');
    await page.reload({waitUntil:'domcontentloaded'});
    await page.locator('[data-testid="dual-dashboard"][data-layout="live"]').waitFor();
    await page.locator('.pkr-dual-switcher-compact summary').click();
    assert.equal(layoutWrites,1,'Reload must reuse the saved server layout, not write again');
    await page.getByRole('button',{name:/Command Centre/}).click();
    await page.locator('[data-testid="dual-dashboard"][data-layout="command"]').waitFor();
    assert.equal(layoutWrites,2,'Returning to Command Centre must save exactly once');
    if(height>=700)await page.screenshot({path:path.join(output,engine+'-'+name+'-dual-command.png'),fullPage:false});
    if(engine==='chromium'&&name==='phone'){
      // A regular member sees the host-selected variant but has no choice controls.
      simulateMember=true;
      await page.reload({waitUntil:'domcontentloaded'});
      await page.getByTestId('player-dashboard').waitFor();
      assert.equal(await page.getByTestId('dual-dashboard').count(),0,'Members now have a dedicated player dashboard');
      assert.equal(await page.getByRole('button',{name:/Live Poker/}).count(),0);
      assert.equal(await page.getByRole('button',{name:/Command Centre/}).count(),0);
      assert.equal(layoutWrites,2,'Member must not issue layout writes');
      simulateMember=false;
      await page.reload({waitUntil:'domcontentloaded'});
      await page.locator('[data-testid="dual-dashboard"][data-layout="command"]').waitFor();
    }
    await page.evaluate(()=>window.dispatchEvent(new CustomEvent('pkr:financial-update',{detail:{kind:'buyin',gameId:'test-game',at:Date.now()}})));
    await page.locator('.pkr-financial-notice').waitFor();await hitVisible(page.locator('.pkr-financial-notice').getByRole('button',{name:'Dismiss',exact:true}));
    if(width<1100){const a=await page.locator('.pkr-financial-notice').boundingBox(),b=await nav.boundingBox();assert(a.y+a.height<=b.y,'Notice is behind the bottom navigation');}
    await page.locator('.pkr-financial-notice').getByRole('button',{name:'Dismiss',exact:true}).click();
    await page.evaluate(()=>window.dispatchEvent(new CustomEvent('pkr:upgrade_required',{detail:{error:'Synthetic upgrade dialog test'}})));
    const upgrade=page.locator('.pkr-native-dialog');await upgrade.waitFor();assert(await upgrade.evaluate(el=>el.matches(':modal')));
    await page.screenshot({path:path.join(output,engine+'-'+name+'-action-dialog.png')});await page.keyboard.press('Escape');await upgrade.waitFor({state:'detached'});
    // Full settlement preview stays on Home. Room pages now open directly
    // to Games, Members, Standings or History instead of repeating the hub.
    await page.goto(BASE+'/dashboard',{waitUntil:'domcontentloaded'});
    await page.locator('[data-testid="dual-dashboard"][data-layout="command"]').waitFor();
    await page.getByTestId('room-outstanding-amount').filter({hasText:'$100'}).waitFor();
    assert.equal(await page.locator('.pkr-dual-root .pkr-room-outstanding-row').count(),2);
    if(height>=700){
      await page.getByRole('button',{name:/View full payment schedule/}).click();
      await page.locator('#pkr-insights-room').waitFor();
      await page.getByTestId('current-outstanding').filter({hasText:'$100'}).waitFor();
      assert.equal(await page.locator('#pkr-insights-room').inputValue(),'test-room');
      assert.equal(await page.locator('.pkr-settlement-record-filters button.active').getAttribute('aria-pressed'),'true');
      assert.match(await page.locator('.pkr-settlement-record-filters button.active').innerText(),/Outstanding/);
      await page.locator('#pkr-settlement .pkr-vnext-data-table tbody tr').first().waitFor();
      assert.equal(await page.locator('#pkr-settlement .pkr-vnext-data-table tbody tr').count(),2);
      await page.locator('.pkr-settlement-record-filters button').filter({hasText:'Paid'}).click();
      await page.locator('#pkr-settlement .pkr-vnext-data-table tbody tr').first().waitFor();
      assert.equal(await page.locator('#pkr-settlement .pkr-vnext-data-table tbody tr').count(),1);
      assert.equal(await page.locator('#pkr-settlement [data-testid="settlement-partial-note"]').count(),0);
      if(name==='phone'||name==='desktop'||name==='tablet')
        await page.screenshot({path:path.join(output,engine+'-'+name+'-paid-schedule.png'),fullPage:false});
    }
    await page.goto(BASE+'/events/test-room?tab=games',{waitUntil:'domcontentloaded'});
    await page.locator('.pkr-room-games-intro').waitFor({state:'visible'});
    assert.equal(await page.locator('.pkr-event .pkr-dual-root').count(),0,
      'Room Games must not duplicate the Home dashboard');
    assert.equal(await page.locator('.pkr-event-tabs').count(),0,
      'Old nested sticky room tabs must be removed');
    await page.goto(BASE+'/events/test-room?tab=leaderboard',{waitUntil:'domcontentloaded'});
    await page.locator('.pkr-standings-board').waitFor({state:'visible'});
    await page.goto(BASE+'/events/test-room?tab=games',{waitUntil:'domcontentloaded'});
    await page.locator('.pkr-room-games-intro').waitFor({state:'visible'});
    await page.getByRole('button',{name:'+ Schedule game',exact:true}).click();
    await page.locator('.pkr-native-dialog').waitFor();
    assert(await page.locator('.pkr-native-dialog').evaluate(el=>el.matches(':modal')));
    await page.keyboard.press('Escape');
    await page.locator('.pkr-native-dialog').waitFor({state:'detached'});
    await page.goto(BASE+'/games/test-game',{waitUntil:'domcontentloaded'});await page.locator('.pkr-game-metrics .pkr-metric-trigger').first().waitFor();
    await page.locator('.pkr-game-metrics .pkr-metric-trigger').nth(0).click();await loaded(page);assert.equal(await page.locator('.pkr-record-row').count(),8);await closeSheet(page);
    await page.locator('.pkr-game-metrics .pkr-metric-trigger').nth(2).click();await loaded(page);assert.equal(await page.locator('.pkr-record-row').count(),1);await closeSheet(page);
    if(engine==='chromium'&&name==='phone'){
      // The host uses PKR for up-to-date game information, not an editable
      // WhatsApp message composer. No real WhatsApp/network calls are needed.
      await page.goto(BASE+'/events/test-room?tab=night&game=test-game',{waitUntil:'domcontentloaded'});
      await page.getByTestId('game-night-hub').waitFor();
      await page.getByRole('heading',{name:'Game Night',exact:true}).waitFor();
      await page.getByRole('heading',{name:'Share once. Always up to date.'}).waitFor();
      await page.getByRole('button',{name:/View live RSVP board/}).waitFor();
      assert.equal(await page.locator('#pkr-share-text').count(),0,'Message composer must be removed');
      assert.equal(await page.getByRole('button',{name:/Share current RSVP update/}).isEnabled(),true);
      assert.equal(await page.locator('.pkr-night-stats strong').count(),4,'RSVP totals must come from PKR');
      await page.screenshot({path:path.join(output,'chromium-phone-game-night.png'),fullPage:false});
      await page.goto(BASE+'/results?room=test-room',{waitUntil:'domcontentloaded'});
      await page.getByRole('heading',{name:'Player standings'}).waitFor();
      await page.getByLabel('Search results by player').fill('Jordan');
      assert.equal(await page.locator('.pkr-results-rank').count(),1,'Results search must filter recorded players');
      await page.getByLabel('Search results by player').fill('');
      await page.getByLabel('Sort results standings').selectOption('games');
      assert.equal(await page.locator('.pkr-results-podium-card').count(),2,'Results retains the top-player podium');
      await page.goto(BASE+'/results?room=test-room&view=history',{waitUntil:'domcontentloaded'});
      await page.getByRole('heading',{name:'Completed games'}).waitFor();
      assert.equal(await page.getByRole('button',{name:/Share in WhatsApp/}).count()>0,true);
      assert.equal(await page.getByRole('checkbox',{name:/Include player net amounts/}).isChecked(),false);
      await page.goto(BASE+'/payments?room=test-room&payments=outstanding',{waitUntil:'domcontentloaded'});
      await page.getByRole('heading',{name:'Payments',exact:true}).waitFor();
      await page.getByRole('button',{name:/Private reminder/}).first().waitFor();
      await page.goto(BASE+'/account',{waitUntil:'domcontentloaded'});
      await page.getByRole('heading',{name:'Account & settings'}).waitFor();
      await page.getByRole('heading',{name:'Notifications for this club'}).waitFor();
      await page.goto(BASE+'/events/test-room?tab=games',{waitUntil:'domcontentloaded'});
      const sections=page.getByRole('navigation',{name:'Games sections'});
      for(const name of ['Sessions','RSVPs & Sharing','Calendar'])
        assert.equal(await sections.getByRole('button',{name}).count(),1);
      await page.goto(BASE+'/games/test-game/share',{waitUntil:'domcontentloaded'});
      await page.getByTestId('game-night-hub').waitFor();
      assert.match(page.url(),/tab=night/,'Old sharing URLs must redirect to Game Night');
      await page.goto(BASE+'/games/test-game',{waitUntil:'domcontentloaded'});
      await page.locator('.pkr-game-metrics .pkr-metric-trigger').first().waitFor();
    }
    assert(!/\blegacy\b/i.test(await page.locator('body').innerText()),'Obsolete status terminology visible');
    assert.equal(await page.evaluate(()=>document.body.style.overflow),'','Dialog scroll lock leaked');
    // WebKit can report an aborted synthetic CORS fetch as a runtime error
    // when the test navigates away during its pending join-request poll.
    // Keep every unrelated exception fatal.
    const unexpectedReal=unexpected.filter(message=>
      !(engine==='webkit'&&message.includes('Fetch API cannot load')&&
        message.includes('/join-requests due to access control checks')));
    assert.deepEqual(unexpectedReal,[]);console.log('PASS',engine,name);
   }catch(error){errors.push(engine+' '+name+': '+error.stack);await page.screenshot({path:path.join(output,engine+'-'+name+'-failure.png')}).catch(()=>{});}
   finally{await context.close();}
  }}finally{await browser.close();}
 }
 if(errors.length)throw new Error(errors.join('\n\n'));
 console.log('PASS: synthetic Chromium and WebKit navigation, records, payments, dialogs, short viewports and popup hit tests.');
}
run().catch(error=>{console.error(error);process.exitCode=1;});
