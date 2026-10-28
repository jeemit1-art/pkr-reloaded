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
  assert.deepEqual(unexpected,[]);
  console.log('PASS 13-seat layout toggle, room photo, money and red loss at '+width+'px');
 }finally{await ctx.close();}
}
(async()=>{for(const engine of [chromium,webkit]){
 const browser=await engine.launch({headless:true});
 try{for(const width of [320,390])await check(browser,width);}finally{await browser.close();}
}})().catch(e=>{console.error(e);process.exitCode=1;});
