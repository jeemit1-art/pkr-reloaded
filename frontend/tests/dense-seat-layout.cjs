'use strict';
/* Synthetic 13-seat browser test. No live game or financial requests. */
const assert=require('node:assert/strict');
const {chromium,webkit}=require('playwright');
const fs=require('node:fs'),path=require('node:path');
const screenshots=path.resolve(__dirname,'../../artifacts/mockup-gameplay');
fs.mkdirSync(screenshots,{recursive:true});
const url='http://127.0.0.1:3000';
const api='https://pkr-reloaded-worker-staging.jeemit1.workers.dev';
const now=Math.floor(Date.now()/1000);
async function check(browser,width){
 const ctx=await browser.newContext({viewport:{width,height:844},serviceWorkers:'block'});
 const game={id:'seat-test-game',event_id:'seat-test-room',name:'Poker Night',status:'active',
  seats:13,buy_in:2500,starting_chips:100,chip_value:25,bank_size:25,hand_tracking:0,
  scheduled_at:now};
 const local={seat3:{name:'Alex',userId:'member-one',transactions:[{type:'buyin',amount:25,ts:Date.now()}]},
  seat7:{name:'Blair',userId:'member-two',transactions:[{type:'buyin',amount:25,ts:Date.now()},{type:'cashout',amount:10,ts:Date.now()}]}};
 await ctx.addInitScript(({api,game,local})=>{
  localStorage.setItem('pkr_token','synthetic-token');
  localStorage.setItem('pkrCtx',JSON.stringify({gameId:game.id,eventId:game.event_id,
   userId:'host-test',userName:'Test Host',token:'synthetic-token',apiUrl:api}));
  localStorage.setItem('pokerState_'+game.id+'_host-test',JSON.stringify({game,players:local}));
 },{api,game,local});
 const page=await ctx.newPage(),unexpected=[];
 page.setDefaultTimeout(17000);
 await page.route('**/*.workers.dev/**',async route=>{
  const req=route.request(),u=new URL(req.url());
  if(u.origin!==api){unexpected.push(u.href);return route.abort();}
  let body;
  if(u.pathname==='/games/'+game.id)body={...game,players:[
    {seat_number:3,user_id:'member-one',display_name:'Alex',buy_ins:1,buy_in_total:2500,cashout:null,revision:1},
    {seat_number:7,user_id:'member-two',display_name:'Blair',buy_ins:1,buy_in_total:2500,cashout:1000,revision:1}]};
  else if(u.pathname==='/events/'+game.event_id)body={id:game.event_id,name:'Poker Night',role:'host',
    members:[{id:'host-test',name:'Host',role:'host'},
     {id:'member-one',name:'Alex',role:'member',avatar_url:'/images/casino/real-poker-chips.webp'},
     {id:'member-two',name:'Blair',role:'member',avatar_url:null}]};
  else if(u.pathname==='/auth/me')body={id:'host-test',name:'Host'};
  else {unexpected.push(u.pathname);body={error:'not a supported test route'};}
  await route.fulfill({status:body.error?404:200,contentType:'application/json',
   headers:{'access-control-allow-origin':url,'access-control-allow-credentials':'true'},
   body:JSON.stringify(body)});
 });
 try{
  await page.goto(url+'/games/'+game.id+'/play',{waitUntil:'domcontentloaded'});
  await page.locator('#seat3 .pkr-game-seat-card').waitFor({state:'visible'});
  assert.equal(await page.locator('#pkrSeatSummary').isVisible(),false,
    'No detached player-strip overlay is allowed in either layout.');
  assert.equal(await page.locator('#seat3').getAttribute('class').then(x=>x.includes('pkr-layout-full')),true,
    'The approved mockup defaults to Full details.');
  await page.locator('#seat3 .pkr-seat-photo').waitFor();
  const inPlay=page.locator('#seat3');
  assert.match(await inPlay.locator('.pkr-game-seat-status').innerText(),/IN PLAY/);
  assert.match(await inPlay.locator('.pkr-game-seat-result').textContent(),/-\$25/);
  assert.equal(await inPlay.locator('.pkr-game-seat-result').evaluate(el=>getComputedStyle(el).color),
    'rgb(255, 93, 114)','In-play buy-in must be red.');
  const cashed=page.locator('#seat7');
  assert.match(await cashed.locator('.pkr-game-seat-status').innerText(),/CASHED OUT/);
  assert.match(await cashed.locator('.pkr-game-seat-result').textContent(),/-\$15/);
  for(const label of ['.bank-right>.bank-pill.g','.bank-right>.pkr-bank-out','.bank-right>.pkr-bank-current']){
    assert.equal(await page.locator(label).isVisible(),true,
      'Bank, IN and OUT segments must all be visible on the phone.');
  }
  assert.equal(await page.locator('#saveResultsBtn').isVisible(),false,
    'Do not show Save Results before all cash-outs reconcile.');
  const sheet=page.locator('.pkr-mockup-tools-sheet');
  await page.getByRole('button',{name:'Open table controls'}).click();
  await sheet.waitFor({state:'visible'});
  assert.equal(await page.locator('.pkr-table-tools-dialog').evaluate(el=>el.matches(':modal')),true);
  assert.equal(await page.getByRole('button',{name:'Full details'}).getAttribute('aria-pressed'),'true');
  await page.screenshot({path:path.join(screenshots,'webkit-or-chromium-'+browser.browserType().name()+'-'+width+'-tools.png')});
  await page.getByRole('button',{name:'Close table controls'}).click();
  // Recreate the actual 13 occupied positions with no production Worker calls.
  await page.evaluate(()=>{
    const s=window.state;
    for(let i=1;i<=13;i++){
      const sid='seat'+i;
      const existing=s.players[sid];
      const result=i%3===0?null:i%2===0?35:15;
      s.players[sid]=existing||{
        name:'Player '+i,userId:'synthetic-member-'+i,transactions:[
          {type:'buyin',amount:25,ts:Date.now()},
          ...(result===null?[]:[{type:'cashout',amount:result,ts:Date.now()}]),
        ],
      };
    }
    window.renderTable();
  });
  const seats=page.locator('#seatsContainer>.pkr-mockup-player-seat');
  assert.equal(await seats.count(),13,'Full mode must have thirteen attached cards.');
  async function geometry(mode){
    return page.evaluate(mode=>{
      const items=[...document.querySelectorAll('#seatsContainer>.pkr-mockup-player-seat')];
      const bounds=items.map(e=>({n:Number(e.id.slice(4)),x:e.getBoundingClientRect().x,
        y:e.getBoundingClientRect().y,w:e.getBoundingClientRect().width,h:e.getBoundingClientRect().height,
        text:e.textContent,bank:e.querySelector('.pkr-game-seat-bank,.pkr-game-compact-bank')?.textContent||'',
        display:getComputedStyle(e).display}));
      const overlaps=[];
      for(let i=0;i<items.length;i++)for(let j=i+1;j<items.length;j++){
        const a=bounds[i],b=bounds[j];
        const ow=Math.min(a.x+a.w,b.x+b.w)-Math.max(a.x,b.x);
        const oh=Math.min(a.y+a.h,b.y+b.h)-Math.max(a.y,b.y);
        if(ow>7&&oh>7)overlaps.push(a.n+':'+b.n);
      }
      return {mode,bounds,overlaps,viewport:innerWidth,scroll:document.documentElement.scrollWidth,
        stripVisible:document.getElementById('pkrSeatSummary').getBoundingClientRect().height>0};
    },mode);
  }
  const full=await geometry('full');
  assert.equal(full.stripVisible,false,'Mockup has no horizontal roster strip.');
  assert.equal(full.bounds.length,13);
  assert(full.bounds.every(p=>p.bank.includes('1b')||p.bank.includes('2b')),
    'All occupied full cards show bank figures.');
  assert.deepEqual(full.overlaps,[],'Full cards must not overlap: '+JSON.stringify(full));
  assert(full.scroll<=full.viewport+3,'Full mode must not overflow the phone width.');
  assert.equal(await page.locator('.pkr-game-seat-status.cashed').count()>0,true);
  assert.equal(await page.locator('.pkr-game-seat-status.inplay').count()>0,true);
  await page.screenshot({path:path.join(screenshots,browser.browserType().name()+'-'+width+'-full.png')});
  await page.getByRole('button',{name:'Open table controls'}).click();
  await page.getByRole('button',{name:'Compact seats'}).click();
  assert.equal(await page.locator('.pkr-mockup-player-seat.pkr-layout-compact').count(),13);
  const compact=await geometry('compact');
  assert.deepEqual(compact.overlaps,[],'Compact cards must not overlap: '+JSON.stringify(compact));
  assert(compact.scroll<=compact.viewport+3,'Compact mode must not widen the page.');
  assert.equal(await page.locator('.pkr-game-compact-status.cashed').count()>0,true);
  assert.equal(await page.locator('.pkr-game-compact-status.inplay').count()>0,true);
  await page.screenshot({path:path.join(screenshots,browser.browserType().name()+'-'+width+'-compact.png')});
  await page.getByRole('button',{name:'Open table controls'}).click();
  await page.getByRole('button',{name:'Full details'}).click();
  assert.equal(await page.locator('.pkr-mockup-player-seat.pkr-layout-full').count(),13);
  assert.equal(await page.locator('#pkrSeatSummary').isVisible(),false);
  // Gated cash-out/save action: no premature CTA for outstanding cashouts,
  // unbalanced money or unsynced edits. No real backend write occurs.
  assert.equal(await page.locator('#saveResultsBtn').isVisible(),false);
  await page.evaluate(()=>{
    for(const p of Object.values(window.state.players)){
      p.transactions=[{type:'buyin',amount:25,ts:Date.now()},
        {type:'cashout',amount:25,ts:Date.now()}];
    }
    window.renderTable();
  });
  await page.waitForFunction(()=>window.getSettlementReadiness()?.ready===true,{timeout:7000});
  assert.equal(await page.locator('#saveResultsBtn').isVisible(),true,
    'Save Results only appears for fully reconciled bank and cash-outs.');
  await page.evaluate(()=>{
    window.state.players.seat2.transactions[1].amount=30;
    window.renderTable();
  });
  assert.equal(await page.locator('#saveResultsBtn').isVisible(),false,
    'Reconciliation mismatch must immediately hide the Save Results action.');
  assert.deepEqual(unexpected,[]);
  console.log('PASS mockup-aligned full/compact 13-seat cards, bank, statuses, safe action gate, modal at '+width+'px');
 }finally{await ctx.close();}
}
(async()=>{for(const engine of [chromium,webkit]){
 const browser=await engine.launch({headless:true});
 try{for(const width of [320,390])await check(browser,width);}finally{await browser.close();}
}})().catch(e=>{console.error(e);process.exitCode=1;});
