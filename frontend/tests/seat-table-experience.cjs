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
 members:[
  {id:'host-test',name:'Test Host',role:'host',avatar_url:null},
  {id:'member-one',name:'Test',role:'member',avatar_url:'https://lh3.googleusercontent.com/pkr-synthetic-test-avatar'},
  {id:'member-two',name:'Alex',role:'member',avatar_url:null},
 ]};
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
 await page.route('https://lh3.googleusercontent.com/**',async route=>{
  await route.fulfill({status:200,contentType:'image/svg+xml',
   body:'<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32"><circle cx="16" cy="16" r="16" fill="#3ddc97"/></svg>'});
 });
 const errors=[];let winner='Test';
 page.on('request',request=>{
  if(request.url().includes('pkr-reloaded-worker.jeemit1.workers.dev'))
   errors.push('Production API request attempted: '+request.url());
 });
 await page.route('**/*.workers.dev/**',async route=>{
  const req=route.request(),url=new URL(req.url());
  if(url.origin!==API){errors.push('Unknown API origin: '+url.origin);return route.abort();}
  let result=null;
  if(req.method()==='GET'&&url.pathname==='/games/'+game.id)
   result={...game,players:roster};
  else if(req.method()==='GET'&&url.pathname==='/events/'+event.id)
   result=event;
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
  const layout=page.getByRole('group',{name:'Seat layout'});
  await layout.getByRole('button',{name:'Full',exact:true}).click();
  assert.equal(await page.locator('#gameScreen').getAttribute('data-seat-layout'),'full');
  await page.locator('#seat7 .seat-money').filter({hasText:'$25.00'}).waitFor();
  await page.locator('#seat7 .seat-stack.verified').filter({hasText:'105 chips'}).waitFor({timeout:18000});
  await page.locator('#seat7 .seat-chip.pkr-has-photo').waitFor({state:'visible'});
  assert.equal(await page.locator('#seat7 .pkr-seat-avatar-photo').getAttribute('alt'),'');
  assert.equal(await page.locator('#seat3 .pkr-seat-avatar-photo').count(),0,'No avatar: keep initials');
  assert.match(await page.locator('#seat7 .seat-net').innerText(),/Live/);
  assert(await page.locator('#seat7 .seat-net').evaluate(el=>getComputedStyle(el).color)!==
    await page.locator('#seat3 .seat-net').evaluate(el=>getComputedStyle(el).color),
    'Win must be green and loss red');
  assert.match(await page.locator('#seat7 .seat-money').innerText(),/1b.*\$25/);
  assert.equal(await page.locator('#seat7').getByText('Result pending').count(),0);
  assert.match(await page.locator('#seat3 .seat-stack').innerText(),/95 chips/);
  assert.match(await page.locator('#bbBank').innerText(),/2b/);
  if(width<=700){
   assert.equal(await page.locator('.bank-right>.bank-pill.g').isVisible(),false);
   assert.equal(await page.locator('.bank-right>.pkr-bank-out').isVisible(),false);
  }
  const tools=page.getByRole('button',{name:'Open table controls'});
  await tools.click();
  const sheet=page.locator('.pkr-table-tools-dialog');
  await sheet.waitFor({state:'visible'});
  assert(await sheet.evaluate(el=>el.matches(':modal')),'Table menu must be above bottom dock');
  assert.equal(await sheet.getByRole('button',{name:/Hand tracker/}).count(),1);
  assert.equal(await sheet.getByRole('button',{name:/Tournament/}).count(),1);
  assert.equal(await sheet.getByRole('button',{name:'＋ Add seat'}).count(),1);
  assert.equal(await sheet.getByRole('button',{name:'－ Remove empty seat'}).count(),1);
  await page.screenshot({path:path.join(output,name+'-menu.png')});
  await sheet.getByRole('button',{name:'Close table controls'}).click();
  await sheet.waitFor({state:'detached'});
  winner='Alex';
  await page.evaluate(()=>window.dispatchEvent(new CustomEvent('pkr:hand-state-changed',
   {detail:{gameId:'seat-test-game',path:'/games/seat-test-game/hands/hand-one/result'}})));
  await page.locator('#seat7 .seat-stack.verified').filter({hasText:'95 chips'}).waitFor();
  await page.locator('#seat3 .seat-stack.verified').filter({hasText:'105 chips'}).waitFor();
  await page.locator('#seat7').click();
  // WebKit can report an empty innerText while the opening panel is
  // mid-transition. Wait for the actual financial text to be committed.
  await page.locator('.side-panel.open #pNetDisplay')
   .filter({hasText:/\$25/}).waitFor({state:'visible',timeout:15000});
  assert.match((await page.locator('.side-panel.open #pNetDisplay').textContent())||'',/\$25/);
  assert.equal(await page.locator('.side-panel').getByText('Pending',{exact:true}).count(),0);
  await page.locator('.side-panel.open #pkrSeatChipSummary')
   .filter({hasText:/95 chips/}).waitFor({state:'visible',timeout:15000});
  assert.match((await page.locator('#pkrSeatChipSummary').textContent())||'',/95 chips/);
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
  await page.locator('#panelCloseBtn').click();
  // Stress a fully occupied 13-seat table without saving any money or seat.
  await page.evaluate(()=>{
    window.state.game.seats=13;
    for(let n=1;n<=13;n++){
      const sid='seat'+n;
      if(window.state.players[sid]?.name)continue;
      window.state.players[sid]={name:'Player '+n,transactions:[{type:'buyin',amount:25,ts:Date.now()}]};
    }
    window.renderTable();
  });
  assert.equal(await page.locator('.seat.pkr-occupied-seat').count(),13);
  for(const variant of ['compact','full']){
    await layout.getByRole('button',{name:variant==='full'?'Full':'Compact',exact:true}).click();
    assert.equal(await page.locator('#gameScreen').getAttribute('data-seat-layout'),variant);
    assert.equal(await layout.getByRole('button',{name:variant==='full'?'Full':'Compact',exact:true}).getAttribute('aria-pressed'),'true');
    const layoutState=await page.locator('.seat.pkr-occupied-seat').evaluateAll(seats=>{
      const parts=seats.map(el=>{
        const r=el.getBoundingClientRect();
        return {side:el.getAttribute('data-side')||'',id:el.id,left:r.left,right:r.right,top:r.top,bottom:r.bottom,
          text:el.textContent,hasPhoto:!!el.querySelector('.pkr-seat-avatar-photo')};
      });
      const viewport=window.innerWidth;
      const outside=parts.filter(p=>p.left<-3||p.right>viewport+3);
      const overlapped=[];
      for(const side of ['left','right']){
        const group=parts.filter(p=>p.side===side).sort((a,b)=>a.top-b.top);
        for(let i=1;i<group.length;i++)if(group[i-1].bottom>group[i].top+3)
          overlapped.push(group[i-1].id+' / '+group[i].id);
      }
      return {outside,overlapped,parts};
    });
    assert.deepEqual(layoutState.outside,[],'Seat cards must stay within phone width: '+JSON.stringify(layoutState.outside));
    assert.deepEqual(layoutState.overlapped,[],'Occupied side cards must not overlap: '+JSON.stringify(layoutState.overlapped));
    assert(layoutState.parts.every(x=>x.text.includes('$25')),
      'Full/compact views must display the bought-in cash at every seat');
    await page.screenshot({path:path.join(output,name+'-13-seats-'+variant+'.png')});
  }
  await page.reload({waitUntil:'domcontentloaded'});
  await page.locator('#gameScreen[data-seat-layout="full"]').waitFor({state:'visible'});
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
