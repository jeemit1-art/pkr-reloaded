'use strict';
/* Real compiled gameplay UI, synthetic fixtures only. No production API writes. */
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const {chromium,webkit}=require('playwright');
const BASE='http://127.0.0.1:3000';
const API='https://pkr-reloaded-worker-staging.jeemit1.workers.dev';
const out=path.resolve(__dirname,'../../artifacts/reference-parity');
fs.mkdirSync(out,{recursive:true});
const now=Math.floor(Date.now()/1000);
async function check(browser,width,height,count){
 const id='reference-table',room='reference-room';
 const game={id,event_id:room,name:'Poker Night',status:'active',seats:count,buy_in:2500,
  starting_chips:100,chip_value:25,bank_size:25,defaultBuyin:25,hand_tracking:0,scheduled_at:now};
 const players={},roster=[];
 for(let i=1;i<=count;i++){
  const cashout=i%4===0?0:i%4===1?null:i%4===2?40:10;
  const name=i===1?'Alex':i===2?'Blair':i===3?'Casey':'Player '+i;
  players['seat'+i]={name,userId:'ref-'+i,transactions:[{type:'buyin',amount:25,ts:Date.now()},
   ...(cashout===null?[]:[{type:'cashout',amount:cashout,ts:Date.now()}])]};
  roster.push({seat_number:i,user_id:'ref-'+i,display_name:name,buy_ins:1,buy_in_total:2500,
   cashout:cashout===null?null:cashout*100,revision:1});
 }
 const ctx=await browser.newContext({viewport:{width,height},serviceWorkers:'block'});
 await ctx.addInitScript(({game,players,API})=>{
  localStorage.setItem('pkr_token','fixture-only');
  localStorage.setItem('pkrCtx',JSON.stringify({gameId:game.id,eventId:game.event_id,userId:'host-test',userName:'Host',token:'fixture-only',apiUrl:API}));
  localStorage.setItem('pokerState_'+game.id+'_host-test',JSON.stringify({game,players}));
 },{game,players,API});
 const page=await ctx.newPage();page.setDefaultTimeout(14000);
 const failures=[],browserErrors=[];
 page.on('pageerror',e=>browserErrors.push(e.message));
 await page.route('**/fixture-avatar-missing.png',route=>route.fulfill({status:404,contentType:'text/plain',body:'Synthetic missing image'}));
 await page.route('**/*.workers.dev/**',async route=>{
  const request=route.request(),u=new URL(request.url());
  if(u.origin!==API||request.method()!=='GET'){
   failures.push(request.method()+' '+u.origin+u.pathname);return route.abort();
  }
  let body;
  if(u.pathname==='/games/'+id)body={...game,players:roster};
  else if(u.pathname==='/events/'+room)body={id:room,name:'Reference test',role:'host',members:[
   {id:'host-test',name:'Host',role:'host'},...roster.map(p=>({id:p.user_id,name:p.display_name,role:'member',avatar_url:null}))]};
  else if(u.pathname==='/auth/me')body={id:'host-test',name:'Host'};
  else{failures.push(u.pathname);body={error:'unmapped synthetic API'};}
  return route.fulfill({status:body.error?404:200,contentType:'application/json',body:JSON.stringify(body),
   headers:{'access-control-allow-origin':BASE,'access-control-allow-credentials':'true'}});
 });
 try{
  await page.goto(BASE+'/games/'+id+'/play',{waitUntil:'domcontentloaded'});
  await page.locator('#seat1 .pkr-game-seat-card').waitFor();
  await page.waitForFunction(()=>!!window._eventMembers);
  const expectedAuto=(width<700&&height>=width)?'mobile':width<1024?'compact':'balanced';
  assert.equal(await page.evaluate(()=>window.pkrGetResolvedSeatLayout()),expectedAuto);
  assert.equal(await page.locator('#seatsContainer>.pkr-layout-'+expectedAuto).count(),count,
    'Auto view must match the device.');
  assert.equal(await page.locator('#bbBankQuick').isVisible(),true);
  assert.equal(await page.locator('#bbIn').isVisible(),true);
  assert.equal(await page.locator('#bbOut').isVisible(),true);
  assert.match(await page.locator('#bbBankQuick').textContent(),/\$/);
  assert.equal(await page.locator('#bbBanks').count(),0);
  if(expectedAuto==='mobile'&&(count===9||count===13))
   await page.screenshot({path:path.join(out,browser.browserType().name()+'-'+width+'-'+count+'-mobile-auto.png')});
  for(const mode of ['balanced','compact']){
   await page.getByRole('button',{name:'Open table controls'}).click();
   const dialog=page.locator('.pkr-table-tools-dialog');await dialog.waitFor();
   assert(await dialog.evaluate(e=>e.matches(':modal')),'Tools must remain top-layer');
   assert.equal(await dialog.locator('.pkr-reference-tool-grid button').count(),6);
   assert.equal(await dialog.locator('.pkr-responsive-view-select button').count(),4);
   if(mode==='balanced'&&count===13&&width===390)await page.screenshot({path:path.join(out,browser.browserType().name()+'-390-tools.png')});
   await page.getByRole('button',{name:mode==='compact'?'Compact table view':'Balanced table view',exact:true}).click();
   const expected='pkr-layout-'+mode;
   assert.equal(await page.locator('#seatsContainer>.pkr-mockup-player-seat.'+expected).count(),count,
    'Every seat count and device must use the same renderer');
   assert.equal(await page.locator('#pkrSeatSummary').isVisible(),false);
   const compact=mode==='compact';
   const bank=compact?'.pkr-game-compact-bank':'.pkr-game-seat-bank';
   assert.equal(await page.locator('#seat1 '+bank).evaluate(e=>getComputedStyle(e).color),'rgb(255, 93, 114)');
   assert.equal(await page.locator('#seat1 .pkr-game-seat-result').evaluate(e=>getComputedStyle(e).color),'rgb(255, 93, 114)');
   assert.equal(await page.locator('#seat2 .pkr-game-seat-result').evaluate(e=>getComputedStyle(e).color),'rgb(61, 220, 151)');
   assert.equal(await page.locator('#seat3 .pkr-game-seat-result').evaluate(e=>getComputedStyle(e).color),'rgb(255, 93, 114)');
   assert.equal(await page.locator('#seat4').getAttribute('data-status'),'cashed','Zero-dollar cashout still marks player cashed out');
   assert.match(await page.locator('#seat4 .pkr-game-seat-result').textContent(),/-\$25/);
   const geometry=await page.evaluate(()=>{
    const seats=[...document.querySelectorAll('#seatsContainer>.pkr-mockup-player-seat')];
    const cards=seats.map(e=>({id:e.id,r:e.getBoundingClientRect().toJSON(),
      content:[...e.querySelectorAll('.pkr-game-seat-name,.pkr-game-seat-bank,.pkr-game-compact-bank,.pkr-game-seat-result')].map(n=>{
       const range=document.createRange();range.selectNodeContents(n);
       const r=range.getBoundingClientRect();
       return {text:n.textContent,width:n.clientWidth,textWidth:r.width,left:r.left,right:r.right,top:r.top,bottom:r.bottom};
      }),
      status:[...e.querySelectorAll('.pkr-game-seat-status,.pkr-game-compact-status')].map(n=>{
       const range=document.createRange();range.selectNodeContents(n);
       return {text:n.textContent,bottom:range.getBoundingClientRect().bottom};
      })}));
    const overlap=[];
    for(let i=0;i<cards.length;i++)for(let j=i+1;j<cards.length;j++){
      const a=cards[i].r,b=cards[j].r;
      const x=Math.min(a.right,b.right)-Math.max(a.left,b.left),y=Math.min(a.bottom,b.bottom)-Math.max(a.top,b.top);
      if(x>3&&y>3)overlap.push(cards[i].id+' overlaps '+cards[j].id);
    }
    return {cards,overlap,w:innerWidth,scroll:document.documentElement.scrollWidth};
   });
   assert.deepEqual(geometry.overlap,[],'Seat cards overlap: '+JSON.stringify({width,height,count,compact,geometry}));
   assert(geometry.scroll<=geometry.w+3,'No page horizontal overflow');
   for(const c of geometry.cards){
    assert(c.r.left>=-2&&c.r.right<=width+2,'Seat extends past phone edge: '+JSON.stringify(c));
    for(const n of c.content){
     assert(n.textWidth<=n.width+3,'Name or amount is clipped: '+JSON.stringify({width,count,compact,card:c.id,...n}));
     assert(n.left>=c.r.left-1&&n.right<=c.r.right+1&&n.top>=c.r.top-1&&n.bottom<=c.r.bottom+1,
      'Name/amount sits outside its player card: '+JSON.stringify({width,count,compact,card:c.id,cardBox:c.r,...n}));
    }
    for(const st of c.status)assert(st.bottom<=c.r.bottom+1,'Status falls below its card: '+JSON.stringify({width,count,compact,card:c.id,cardBottom:c.r.bottom,...st}));
   }
   if(count===13||count===9)await page.screenshot({path:path.join(out,browser.browserType().name()+'-'+width+'-'+count+'-'+mode+'.png')});
  }
  // A failed member photo must not display a broken image over the initials.
  await page.evaluate(()=>{
   const member=window._eventMembers.find(m=>m.id==='ref-1');
   member.avatar_url='/fixture-avatar-missing.png';
   window.renderTable();
  });
  await page.locator('#seat1 .pkr-game-seat-avatar img[hidden]').waitFor({state:'attached'});
  assert.equal(await page.locator('#seat1 .pkr-game-seat-avatar img').isVisible(),false);
  assert.equal(await page.locator('#seat1 .pkr-avatar-fallback').isVisible(),true);
  // Changing view may not write or change the transaction ledger.
  const actual=await page.evaluate(()=>JSON.parse(JSON.stringify(window.state.players)));
  for(const [sid,p] of Object.entries(players)){
   assert.equal(actual[sid].name,p.name);
   assert.deepEqual(actual[sid].transactions.map(t=>[t.type,t.amount]),p.transactions.map(t=>[t.type,t.amount]));
  }
  assert.equal(await page.locator('#saveResultsBtn').isVisible(),false);
  assert.deepEqual(failures,[]);assert.deepEqual(browserErrors,[]);
  console.log('PASS responsive layout '+browser.browserType().name()+' '+width+'x'+height+' '+count+' seats, Auto/'+expectedAuto+', Balanced/Compact overrides, bank totals, no financial writes');
 }finally{await ctx.close();}
}
(async()=>{
 for(const engine of [chromium,webkit]){
  const browser=await engine.launch({headless:true});
  try{
   for(const count of [6,9,13])await check(browser,390,844,count);
   await check(browser,320,720,13);
   if(engine===chromium){await check(browser,844,390,13);await check(browser,1440,900,13);}
  }finally{await browser.close();}
 }
})().catch(e=>{console.error(e);process.exitCode=1;});
