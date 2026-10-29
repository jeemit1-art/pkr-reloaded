/* Fully synthetic UI regression for the real in-game table.
 * No request may reach the production Worker or real player data. */
'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const {chromium,webkit}=require('playwright');
const BASE='http://127.0.0.1:3000';
const API='https://pkr-reloaded-worker-staging.jeemit1.workers.dev';
const output=path.resolve(__dirname,'../../artifacts/seat-table');
fs.mkdirSync(output,{recursive:true});
const now=Math.floor(Date.now()/1000);
const game={
 id:'seat-test-game',event_id:'seat-test-room',name:'Poker Night',
 status:'active',seats:9,buy_in:2500,starting_chips:100,chip_value:25,
 bank_size:25,hand_tracking:1,live_token:'synthetic-live',results_token:null,
 scheduled_at:now,created_at:now,location:'Synthetic testing only',
};
const roster=[
 {game_id:game.id,user_id:'member-one',display_name:'Test',seat_number:7,
 buy_ins:1,buy_in_total:2500,cashout:null,revision:1},
 {game_id:game.id,user_id:'member-two',display_name:'Alex',seat_number:3,
 buy_ins:1,buy_in_total:2500,cashout:null,revision:1},
];
const event={id:game.event_id,name:'Poker Night',role:'host',status:'active',buy_in:2500,
 members:[{id:'host-test',name:'Test Host',role:'host'}]};
const actions=[
 {id:'action-one',display_name:'Test',street:'pre',action:'post',chips:5},
 {id:'action-two',display_name:'Alex',street:'pre',action:'call',chips:5},
];
const inputGame={name:'Poker Night',seats:9,defaultBuyin:25,bank_size:25,
 chip_value:25,starting_chips:100,hand_tracking:1};
const localPlayers={
 seat7:{name:'Test',userId:'member-one',transactions:[{type:'buyin',amount:25,ts:Date.now()}]},
 seat3:{name:'Alex',userId:'member-two',transactions:[{type:'buyin',amount:25,ts:Date.now()}]},
};
const expectClose=(a,b,msg)=>assert(Math.abs(a-b)<3,msg+': '+a+' vs '+b);
async function requireColour(page,selector,colour){
 // Chip audit completion can replace a seat between locator resolution and
 // evaluate. Read the current connected element in one browser task, retaining
 // the exact required colour rather than accepting a detached-node empty style.
 await page.waitForFunction(({selector,colour})=>{
  const element=document.querySelector(selector);
  return !!element?.isConnected&&getComputedStyle(element).color===colour;
 },{selector,colour},{timeout:16000});
}
async function check(browser,name,width,height){
 const context=await browser.newContext({viewport:{width,height},serviceWorkers:'block'});
 await context.addInitScript(({inputGame,localPlayers,API})=>{
  localStorage.setItem('pkr_token','synthetic-token-only');
  localStorage.setItem('pkrCtx',JSON.stringify({gameId:'seat-test-game',
   eventId:'seat-test-room',userId:'host-test',userName:'Test Host',
   token:'synthetic-token-only',apiUrl:API}));
  localStorage.setItem('pokerState_seat-test-game_host-test',
   JSON.stringify({game:inputGame,players:localPlayers}));
 },{inputGame,localPlayers,API});
 const page=await context.newPage();
 page.setDefaultTimeout(16000);
 const errors=[],writes=[];let winner='Test';
 const simulatedPlayers=roster.map(p=>({...p}));
 page.on('request',request=>{
  if(request.url().includes('pkr-reloaded-worker.jeemit1.workers.dev'))
   errors.push('Production API request attempted: '+request.url());
 });
 await page.route('**/*.workers.dev/**',async route=>{
  const req=route.request(),url=new URL(req.url());
  if(url.origin!==API){errors.push('Unknown API origin: '+url.origin);return route.abort();}
  let result=null;
  if(req.method()==='OPTIONS'){
   await route.fulfill({status:204,headers:{
    'access-control-allow-origin':BASE,'access-control-allow-credentials':'true',
    'access-control-allow-headers':'Content-Type,Authorization',
    'access-control-allow-methods':'GET,POST,PUT,OPTIONS'}});
   return;
  }
  if(req.method()==='GET'&&url.pathname==='/games/'+game.id)
   result={...game,players:simulatedPlayers};
  else if(req.method()==='PUT'&&url.pathname==='/games/'+game.id+'/buyin/member-one'){
   const payload=JSON.parse(req.postData()||'{}'),player=simulatedPlayers[0];
   if(payload.expected_count!==player.buy_ins||payload.expected_total!==player.buy_in_total||
      payload.expected_revision!==player.revision||
      !Number.isSafeInteger(payload.count)||!Number.isSafeInteger(payload.total)){
    errors.push('Unsafe synthetic buy-in request: '+JSON.stringify(payload));
    result={error:'Expected-version mismatch in synthetic test'};
   }else{
    writes.push({type:'buyin',...payload});
    player.buy_ins=payload.count;player.buy_in_total=payload.total;player.revision++;
    result={ok:true,revision:player.revision};
   }
  }
  else if(req.method()==='GET'&&url.pathname==='/events/'+event.id)
   result=event;
  else if(req.method()==='GET'&&url.pathname==='/events/'+event.id+'/profiles')
   result={profiles:[]};
  else if(req.method()==='GET'&&url.pathname==='/games/'+game.id+'/hands')
   result=[{id:'hand-one',game_id:game.id,mode:'full',hand_no:1,voided:0,
    pot_chips:10,actions,result:{winner_name:winner,pot_chips:10,
    pot_winners:[{potIdx:0,label:'Main Pot',winnerName:winner,chips:10}],
    uncalled_returns:[]}}];
  else if(req.method()==='GET'&&url.pathname==='/games/'+game.id+'/hands/hand-one/stack-baseline')
   result={enabled:true,confirmed:true,players:roster.map(p=>({user_id:p.user_id,
    display_name:p.display_name,seat_number:p.seat_number,opening_chips:100}))};
  else if(req.method()==='POST'&&url.pathname==='/games/'+game.id+'/hands/hand-one/audit-stacks')
   result={ok:true,persisted_baseline:true,audit:{unsettled_pot_chips:0,
    stacks:[{display_name:'Test',seat_number:7,closing_chips:winner==='Test'?105:95},
      {display_name:'Alex',seat_number:3,closing_chips:winner==='Test'?95:105}]}};
  else if(req.method()==='GET'&&url.pathname==='/auth/me')
   result={id:'host-test',name:'Test Host'};
  else {errors.push('Unmapped '+req.method()+' '+url.pathname);result={error:'Synthetic API path missing'};}
  await route.fulfill({status:result.error?404:200,contentType:'application/json',
   headers:{'access-control-allow-origin':BASE,'access-control-allow-credentials':'true',
    'access-control-allow-headers':'Content-Type,Authorization',
    'access-control-allow-methods':'GET,POST,OPTIONS'},body:JSON.stringify(result)});
 });
 try{
  await page.goto(BASE+'/games/'+game.id+'/play',{waitUntil:'domcontentloaded'});
  await page.locator('#seat7 .seat-money').filter({hasText:'$25'}).waitFor();
  await page.locator('#seat7 .seat-stack.verified').filter({hasText:'105 chips'}).waitFor({timeout:18000});
  const resolvedView=await page.evaluate(()=>window.pkrGetResolvedSeatLayout());
  const seatMoney=await page.locator('#seat7 .seat-money').innerText();
  if(resolvedView==='compact')assert.match(seatMoney,/\$25/);
  else assert.match(seatMoney,/1b.*\$25/);
  await requireColour(page,'#seat7 .seat-money','rgb(255, 93, 114)');
  assert.equal(await page.locator('#seat7').getByText('Result pending').count(),0);
  assert.match(await page.locator('#seat3 .seat-stack').innerText(),/95 chips/);
  assert.match(await page.locator('#bbBank').innerText(),/2b/);
  assert.equal(await page.locator('#bbBankQuick').isVisible(),true);
  assert.match(await page.locator('#bbBankQuick').innerText(),/\$50/);
  assert.equal(await page.locator('#bbIn').isVisible(),true);
  assert.equal(await page.locator('#bbOut').isVisible(),true);
  assert.equal(await page.locator('#bbBanks').count(),0,'Bank count must not be repeated');
  assert.equal(await page.locator('#bbInPlay').isVisible(),false,'In Play duplicate must stay hidden');
  if(width<=700)assert.equal(await page.locator('.pkr-bank-quick').isVisible(),true);
  const tools=page.getByRole('button',{name:'Open table controls'});
  await tools.click();
  const sheet=page.locator('.pkr-table-tools-dialog');
  await sheet.waitFor({state:'visible'});
  assert(await sheet.evaluate(el=>el.matches(':modal')),'Table menu must be above bottom dock');
  assert.equal(await sheet.getByRole('button',{name:/Hand tracker/}).count(),1);
  assert.equal(await sheet.getByRole('button',{name:/Tournament/}).count(),1);
  assert.equal(await sheet.getByRole('button',{name:'Add seat'}).count(),1);
  assert.equal(await sheet.getByRole('button',{name:'Remove empty seat'}).count(),1);
  await page.screenshot({path:path.join(output,name+'-menu.png')});
  await sheet.getByRole('button',{name:'Close table controls'}).click();
  await sheet.waitFor({state:'detached'});
  winner='Alex';
  await page.evaluate(()=>window.dispatchEvent(new CustomEvent('pkr:hand-state-changed',
   {detail:{gameId:'seat-test-game',path:'/games/seat-test-game/hands/hand-one/result'}})));
  await page.locator('#seat7 .seat-stack.verified').filter({hasText:'95 chips'}).waitFor();
  await page.locator('#seat3 .seat-stack.verified').filter({hasText:'105 chips'}).waitFor();
  // The phone/tablet player details must overlay the canvas rather than
  // shrinking the table and causing seated players to overlap.
  const beforePanel=await page.locator('#tableArea').boundingBox();
  const beforeFelt=await page.locator('#tableFelt').boundingBox();
  await page.locator('#seat7').click();
  await page.locator('.side-panel.open #pNetDisplay')
   .filter({hasText:/\$25/}).waitFor({state:'visible',timeout:15000});
  assert.match((await page.locator('.side-panel.open #pNetDisplay').textContent())||'',/\$25/);
  await requireColour(page,'.side-panel.open #pNetDisplay','rgb(255, 93, 114)');
  await requireColour(page,'.side-panel.open .pkr-panel-buyin','rgb(255, 93, 114)');
  assert.equal(await page.locator('.side-panel.open .pkr-quick-metric.result.pending').count(),1,'Pending is the correct status until cash-out');
  await page.locator('.side-panel.open #pkrSeatChipSummary')
   .filter({hasText:/95 chips/}).waitFor({state:'visible',timeout:15000});
  assert.match((await page.locator('#pkrSeatChipSummary').textContent())||'',/95 chips/);
  // New player management retains the original financial and chip records.
  await page.locator('.side-panel.open .pkr-quick-metrics').waitFor({state:'visible'});
  assert.equal(await page.locator('.pkr-quick-metric.result.pending').count(),1,
    'Uncashed buy-in must not be misrepresented as a final profit or loss');
  assert.match(await page.locator('.pkr-quick-metric.money-in').innerText(),/\$25/);
  const playerLinks=page.locator('.side-panel.open .pkr-quick-link');
  await playerLinks.filter({hasText:'Transactions'}).click();
  await page.locator('.side-panel.open .pkr-quick-section .tx-row').first().waitFor();
  assert.equal(await page.locator('.side-panel.open .pkr-quick-section .tx-row').count(),1);
  await page.locator('.side-panel.open .pkr-quick-back').click();
  await page.locator('.side-panel.open .pkr-quick-link').filter({hasText:'More actions'}).click();
  await page.locator('.side-panel.open .pkr-host-danger').waitFor();
  assert.equal(await page.locator('.side-panel.open .pkr-host-danger').isDisabled(),true,
    'Players with buy-ins cannot be removed from their financial record');
  await page.locator('.side-panel.open .pkr-quick-back').click();

  if(width<=900){
   // The drawer slides into place over 250ms. Wait for its final on-screen
   // location before evaluating geometry; never mistake transition frames for overflow.
   await page.waitForFunction(()=>{
    const el=document.querySelector('#sidePanel.open');
    if(!el)return false;
    const rect=el.getBoundingClientRect();
    return rect.left>=-2&&rect.right<=innerWidth+2;
   },null,{timeout:7000});
   const afterPanel=await page.locator('#tableArea').boundingBox();
   const afterFelt=await page.locator('#tableFelt').boundingBox();
   const playerDrawer=await page.locator('.side-panel.open').boundingBox();
   assert(beforePanel&&afterPanel&&beforeFelt&&afterFelt&&playerDrawer,'Table and player drawer must have geometry');
   expectClose(afterPanel.width,beforePanel.width,'Player drawer must not shrink mobile/tablet table width');
   expectClose(afterFelt.width,beforeFelt.width,'Player drawer must not shrink the poker felt');
   assert(playerDrawer.x>=-2&&playerDrawer.x+playerDrawer.width<=width+2,
     'Player drawer must fit the phone/tablet: '+JSON.stringify(playerDrawer));
   const stage=await page.locator('#pkrGameTableStage');
   assert(await stage.evaluate(el=>el.classList.contains('pkr-player-panel-open')),
     'Backdrop should be shown with mobile/tablet player drawer');
   assert.equal(await page.locator('.side-panel.open').getAttribute('aria-hidden'),'false');
   assert.equal(await page.locator('.side-panel.open .panel-body').evaluate(el=>getComputedStyle(el).overflowY),'auto');
  }
  if(width<=700){
   const geometry=await page.locator('#gameScreen .topbar').evaluate(el=>{
    const r=el.getBoundingClientRect();
    return {w:r.width,scroll:el.scrollWidth,viewport:innerWidth};
   });
   assert(geometry.scroll<=geometry.w+3,'Top controls overflow horizontal viewport: '+JSON.stringify(geometry));
  }
  const fit=await page.evaluate(()=>({w:document.documentElement.scrollWidth,viewport:innerWidth}));
  expectClose(fit.w,fit.viewport,'No page-width overflow');
  await page.screenshot({path:path.join(output,name+'-player.png')});
  if(width<=900){
   if(width>600){
    await page.locator('#playerPanelScrim').click({position:{x:18,y:18}});
   } else {
    await page.locator('#panelCloseBtn').click();
   }
   await page.locator('.side-panel.open').waitFor({state:'detached'});
   const restored=await page.locator('#tableArea').boundingBox();
   assert(beforePanel&&restored,'Table must remain visible after closing the player drawer');
   expectClose(restored.width,beforePanel.width,'Closing player drawer must not resize table');
   assert.equal(await page.locator('#sidePanel').getAttribute('aria-hidden'),'true');
  }
  if(width===390){
   await page.locator('#seat7').click();
   const quick=page.locator('.side-panel.open .pkr-quick-buyin-presets');
   await quick.waitFor({state:'visible'});
   assert.equal(await quick.getByRole('button').count(),3,'One-tap amounts must be available on first player screen');
   await page.waitForFunction(()=>{
    const ctx=JSON.parse(localStorage.getItem('pkrCtx')||'{}');
    return ctx.isHost===true;
   });
   await page.evaluate(()=>window.refreshPlayerPanel?.());
   await page.locator('.side-panel.open .pkr-quick-bank:not([disabled])').first().waitFor({state:'visible'});
   const baseWrites=writes.length;
   // Fire two DOM taps in the same task: it must record ONE bank, not two.
   await page.evaluate(()=>{
    const button=document.querySelector('.side-panel.open .pkr-quick-bank');
    if(!button)throw new Error('Quick buy-in action was not rendered');
    button.click();button.click();
   });
   await page.locator('.side-panel.open .pkr-quick-metric.money-in').filter({hasText:'$50.00'}).waitFor();
   assert.equal(await page.locator('.side-panel.open .pkr-quick-view > .pkr-quick-metrics').count(),1,
    'One tap must return directly to the main player view, without a review dialog');
   await page.waitForFunction(()=>!window.pkrHasPendingActions?.(),null,{timeout:10000});
   assert.equal(writes.length,baseWrites+1,'Exactly one aggregate PUT for one-tap buy-in');
   assert.equal(writes[writes.length-1].count,2);
   assert.equal(writes[writes.length-1].total,5000);
   // The first click is the only change; the immediate second was ignored.
   const currentCount=writes.length;
   assert.equal(currentCount,baseWrites+1,'Accidental double tap must not record a second bank');
   // Other amount uses one submit, accepts legitimate decimals and needs no second approval.
   await page.locator('.side-panel.open .pkr-quick-custom').click();
   const amount=page.locator('.side-panel.open input[aria-label="Transaction amount in dollars"]');
   await amount.fill('12.50');
   await page.locator('.side-panel.open button[type="submit"]').filter({hasText:'Add custom buy-in'}).click();
   await page.locator('.side-panel.open .pkr-quick-metric.money-in').filter({hasText:'$62.50'}).waitFor();
   await page.waitForFunction(()=>!window.pkrHasPendingActions?.(),null,{timeout:10000});
   assert.equal(writes.length,currentCount+1,'Custom amount should record with one submit');
   assert.equal(writes[writes.length-1].total,6250,'Custom decimal cents must be exact');
   assert.equal(await page.locator('div[style*="z-index:700"]').count(),0,
    'Custom buy-in must not open another confirmation modal');
   // Synthetic touch movement from the sheet header must close the mobile panel.
   await page.locator('.side-panel.open .panel-hdr').evaluate(el=>{
    function send(type,y){
     const event=new Event(type,{bubbles:true,cancelable:true});
     Object.defineProperty(event,'touches',{value:type==='touchend'?[]:[{clientX:165,clientY:y}]});
     el.dispatchEvent(event);
    }
    send('touchstart',390);send('touchmove',496);send('touchend',496);
   });
   await page.locator('.side-panel.open').waitFor({state:'detached'});
   assert.equal(await page.locator('#sidePanel').getAttribute('aria-hidden'),'true',
    'Swipe down must dismiss the player sheet');
   assert.deepEqual(errors,[],'No production or unexpected API writes during quick-action tests');
  }
  assert.deepEqual(errors,[]);
  console.log('PASS synthetic gameplay '+name+'; restored buy-ins, verified stacks, winner changes, table menu, bank bar');
 }finally{await context.close();}
}
(async()=>{
 const run=[['phone-320',320,720],['iphone-390',390,844],['landscape-844',844,390],['desktop-1440',1440,900]];
 for(const [browserName,cls] of [['chromium',chromium],['webkit',webkit]]){
  const browser=await cls.launch({headless:true});
  try{
   for(const [name,w,h] of run.filter(row=>browserName==='chromium'||row[0].includes('phone')||row[0].includes('iphone')))
    await check(browser,browserName+'-'+name,w,h);
  }finally{await browser.close();}
 }
 console.log('PASS: all synthetic seat and menu UI cases');
})().catch(err=>{console.error(err);process.exitCode=1;});