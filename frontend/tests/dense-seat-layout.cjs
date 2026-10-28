'use strict';
/* Synthetic 13-seat browser test. No live game or financial requests. */
const assert=require('node:assert/strict');
const {chromium,webkit}=require('playwright');
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
  // Wait for the embedded poker table to complete its async boot and state
  // hydration before checking the dense-seat geometry.
  await page.waitForFunction(()=>!!window.state?.game&&
    typeof window.renderTable==='function',{timeout:17000});
  await page.evaluate(()=>window.renderTable());
  await page.locator('#seat3 .pkr-dense-info').waitFor();
  await page.locator('#seat3 .pkr-seat-photo').waitFor();
  assert.match(await page.locator('#seat3 .pkr-dense-bank').textContent(),/1b.*25/);
  assert.match(await page.locator('#seat7 .pkr-dense-result').textContent(),/-/);
  assert(await page.locator('#seat7 .pkr-dense-result').evaluate(e=>getComputedStyle(e).color==='rgb(255, 104, 118)'));
  const overflow=await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+3);
  assert.equal(overflow,false,'No horizontal page overflow');
  await page.getByRole('button',{name:'Open table controls'}).click();
  await page.getByRole('button',{name:'Full details'}).click();
  await page.locator('#pkrSeatSummary .pkr-seat-summary-card').first().waitFor();
  assert.equal(await page.locator('#pkrSeatSummary .pkr-seat-summary-card').count(),2);
  assert.match(await page.locator('#pkrSeatSummary').innerText(),/Alex/);
  assert.match(await page.locator('#pkrSeatSummary').innerText(),/Blair/);
  await page.getByRole('button',{name:'Open table controls'}).click();
  await page.getByRole('button',{name:'Compact seats'}).click();
  assert.equal(await page.locator('#pkrSeatSummary').isVisible(),false);
  assert(await page.locator('#seat3').getAttribute('class').then(x=>x.includes('pkr-layout-compact')));
  // Original bug: thirteen OCCUPIED seats on a narrow phone, not just
  // thirteen available seats with two players. All data is synthetic.
  await page.evaluate(()=>{
    const s=window.state;
    for(let i=1;i<=13;i++){
      const sid='seat'+i;
      const existing=s.players[sid];
      const money=i%3===0?null:i%2===0?35:15;
      s.players[sid]=existing||{
        name:'Player '+i,userId:'synthetic-member-'+i,transactions:[
          {type:'buyin',amount:25,ts:Date.now()},
          ...(money===null?[]:[{type:'cashout',amount:money,ts:Date.now()}]),
        ],
      };
    }
    window.renderTable();
  });
  const allSeats=page.locator('#seatsContainer>.seat');
  assert.equal(await allSeats.count(),13);
  await page.getByRole('button',{name:'Open table controls'}).click();
  await page.getByRole('button',{name:'Compact seats'}).click();
  const compact=await page.evaluate(()=>{
    const seats=[...document.querySelectorAll('#seatsContainer>.seat')];
    const rect=e=>e.getBoundingClientRect();
    const parts=seats.map((el,i)=>({
      seat:i+1,
      outer:rect(el), info:el.querySelector('.pkr-dense-info')&&rect(el.querySelector('.pkr-dense-info')),
      bank:el.querySelector('.pkr-dense-bank')?.textContent||'',
      result:el.querySelector('.pkr-dense-result')?.textContent||'',
      color:el.querySelector('.pkr-dense-result')?
        getComputedStyle(el.querySelector('.pkr-dense-result')).color:null,
      isVisible:!!el.querySelector('.pkr-dense-info')&&rect(el.querySelector('.pkr-dense-info')).width>35,
    }));
    const sideGroups=[parts.slice(1,7),parts.slice(8,13)];
    const overlaps=[];
    for(const group of sideGroups){
      const sorted=[...group].sort((a,b)=>a.outer.y-b.outer.y);
      for(let i=1;i<sorted.length;i++){
        if(sorted[i].outer.y<sorted[i-1].outer.bottom-3)
          overlaps.push(sorted[i-1].seat+' overlaps '+sorted[i].seat);
      }
    }
    return {
      parts:parts.map(p=>({...p,outer:p.outer.toJSON(),info:p.info?.toJSON()})),
      overlaps,scroll:document.documentElement.scrollWidth,viewport:innerWidth,
    };
  });
  assert.equal(compact.parts.length,13);
  assert(compact.parts.every(p=>p.isVisible&&p.bank.includes('1b')),
   'All 13 occupied seats need visible bank counts: '+JSON.stringify(compact.parts));
  assert.equal(compact.overlaps.length,0,'Compact side seats overlap: '+compact.overlaps.join(', '));
  assert(compact.scroll<=compact.viewport+3,'Compact layout must not overflow the screen');
  assert(compact.parts.some(p=>p.color==='rgb(61, 220, 151)'),
    'At least one profitable seat should show green');
  assert(compact.parts.some(p=>p.color==='rgb(255, 104, 118)'),
    'At least one losing seat should show red');
  await page.getByRole('button',{name:'Open table controls'}).click();
  await page.getByRole('button',{name:'Full details'}).click();
  const cards=page.locator('#pkrSeatSummary .pkr-seat-summary-card');
  assert.equal(await cards.count(),13,'Full mode must retain all thirteen occupied players');
  await cards.last().scrollIntoViewIfNeeded();
  const full=await page.evaluate(()=>{
    const table=document.getElementById('tableWrap').getBoundingClientRect();
    const strip=document.getElementById('pkrSeatSummary').getBoundingClientRect();
    const seat1=document.getElementById('seat1').getBoundingClientRect();
    const cards=[...document.querySelectorAll('#pkrSeatSummary .pkr-seat-summary-card')];
    const bankText=cards.map(c=>c.textContent||'');
    return {table:table.toJSON(),strip:strip.toJSON(),seat1:seat1.toJSON(),
      stripHidden:document.getElementById('pkrSeatSummary').hidden,
      cards:cards.length,banks:bankText,overflow:document.documentElement.scrollWidth>innerWidth+3};
  });
  assert.equal(full.stripHidden,false);
  assert(full.strip.bottom<=full.table.top+2,
    'Full layout summary must not overlay the table: '+JSON.stringify(full));
  assert(full.banks.every(b=>b.includes('1b')),
    'Full layout must show all bank totals, including scrollable cards');
  assert(!full.overflow,'Full balance strip should scroll internally, never widen the page');
  assert.deepEqual(unexpected,[]);
  console.log('PASS synthetic 13-occupied-seat compact/full geometry, colours, and accessible bank totals at '+width+'px');
 }finally{await ctx.close();}
}
(async()=>{for(const engine of [chromium,webkit]){
 const browser=await engine.launch({headless:true});
 try{for(const width of [320,390])await check(browser,width);}finally{await browser.close();}
}})().catch(e=>{console.error(e);process.exitCode=1;});
