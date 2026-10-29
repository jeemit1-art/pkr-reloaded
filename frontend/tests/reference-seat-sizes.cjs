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
  const expectedAuto=(width<355||(width<930&&height<width&&count>=10))?'compact':'balanced';
  assert.equal(await page.evaluate(()=>window.pkrGetResolvedSeatLayout()),expectedAuto);
  assert.equal(await page.locator('#seatsContainer>.pkr-layout-'+expectedAuto).count(),count,
    'Approved responsive view must match the device.');
  assert.equal(await page.locator('.pkr-table-view-toolbar').count(),0,'Approved game header has no view selector');
  if(width===390&&height===844&&count===13){
   const approved=await page.evaluate(()=>{
    const felt=document.getElementById('tableFelt').getBoundingClientRect();
    const left=document.getElementById('seat4').getBoundingClientRect();
    const right=document.getElementById('seat11').getBoundingClientRect();
    return {felt:{left:felt.left,right:felt.right,width:felt.width,height:felt.height},
      left:{right:left.right},right:{left:right.left}};
   });
   assert(approved.felt.width>=165&&approved.felt.width<=205,'Approved phone felt must leave space for full player names: '+JSON.stringify(approved));
   assert(approved.felt.height>=300&&approved.felt.height<=365,'Approved phone felt must not stretch vertically: '+JSON.stringify(approved));
   const ratio=approved.felt.height/approved.felt.width;
   assert(ratio>=1.6&&ratio<=1.9,'Approved felt aspect ratio regressed: '+JSON.stringify({ratio,approved}));
   assert(approved.left.right<=approved.felt.left+22,'Left player cards must sit off the felt: '+JSON.stringify(approved));
   assert(approved.right.left>=approved.felt.right-22,'Right player cards must sit off the felt: '+JSON.stringify(approved));
  }
  if(width===768&&height===1024){
   const dimensions=await page.evaluate(()=>{
    const felt=document.getElementById('tableFelt').getBoundingClientRect();
    return {width:felt.width,height:felt.height};
   });
   assert(dimensions.height>dimensions.width*1.25,
    'Portrait tablet must use a taller portrait felt, not the broken horizontal layout: '+JSON.stringify(dimensions));
  }
  if(width===1024&&height===768){
   const dimensions=await page.evaluate(()=>{
    const felt=document.getElementById('tableFelt').getBoundingClientRect();
    return {width:felt.width,height:felt.height};
   });
   assert(dimensions.width>dimensions.height*1.3,
    'Landscape tablet must use a horizontal felt: '+JSON.stringify(dimensions));
  }
  assert.equal(await page.locator('#bbBankQuick').isVisible(),true);
  assert.equal(await page.locator('#bbIn').isVisible(),true);
  assert.equal(await page.locator('#bbOut').isVisible(),true);
  assert.match(await page.locator('#bbBankQuick').textContent(),/\$/);
  assert.equal(await page.locator('#bbBanks').count(),0);
  if(count===9||count===13)
   await page.screenshot({path:path.join(out,browser.browserType().name()+'-'+width+'x'+height+'-'+count+'-auto.png')});
  const modes=['balanced','compact'];
  for(const mode of modes){
   await page.getByRole('button',{name:'Open table controls'}).click();
   const dialog=page.locator('.pkr-table-tools-dialog');await dialog.waitFor();
   assert(await dialog.evaluate(e=>e.matches(':modal')),'Tools must remain top-layer');
   assert.equal(await dialog.locator('.pkr-reference-tool-grid button').count(),6);
   assert.equal(await dialog.locator('.pkr-responsive-view-select').count(),0,'Legacy four-mode selector remains removed');
   assert.equal(await dialog.locator('.pkr-approved-view-buttons button').count(),3,'Tools offers Auto, Full and Compact');
   const toolSpacing=await dialog.evaluate(root=>{
    const grid=root.querySelector('.pkr-reference-tool-grid').getBoundingClientRect();
    const note=root.querySelector('.pkr-tools-reconciliation-note').getBoundingClientRect();
    return {gridBottom:grid.bottom,noteTop:note.top,noteBottom:note.bottom};
   });
   assert(toolSpacing.noteTop>=toolSpacing.gridBottom+3,
    'Tools note overlaps the last row of controls: '+JSON.stringify(toolSpacing));
   const selected=mode==='balanced'?'Full table view':'Compact table view';
   await dialog.getByRole('button',{name:selected,exact:true}).click();
   assert.equal(await dialog.getByRole('button',{name:selected,exact:true}).getAttribute('aria-pressed'),'true');
   if(mode==='balanced'&&count===13&&width===390)await page.screenshot({path:path.join(out,browser.browserType().name()+'-390-tools.png')});
   await page.getByRole('button',{name:'Close table controls'}).click();
   await page.waitForFunction(m=>document.querySelectorAll('#seatsContainer>.pkr-layout-'+m).length>0,mode);
   assert.equal(await page.evaluate(()=>localStorage.getItem('pkrTableViewChoice_reference-table')),
     mode==='balanced'?'full':'compact','Manual view selection must be persisted');
   const expected='pkr-layout-'+mode;
   assert.equal(await page.locator('#seatsContainer>.pkr-mockup-player-seat.'+expected).count(),count,
    'Every seat count and device must use the same renderer');
   assert.equal(await page.locator('#pkrSeatSummary').isVisible(),false);
   const compact=mode==='compact';
   if(compact){
    const name=page.locator('#seat1 .pkr-game-compact-name');
    assert.equal(await name.isVisible(),true,'Compact seats must have visible names');
    assert.equal(await name.textContent(),'Alex');
    assert((await name.boundingBox()).width>=30,'Compact player name has readable width');
    assert.equal(await page.locator('#seat1 .pkr-game-compact-name').getAttribute('title'),'Alex');
   }
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
   if(count===13||count===9)await page.screenshot({path:path.join(out,browser.browserType().name()+'-'+width+'x'+height+'-'+count+'-'+(mode==='balanced'?'full':'compact')+'.png')});
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

  // Critical production regression: a real newly-created table has zero
  // seated players. Earlier populated-only screenshots missed detached
  // legacy labels and made Full / Compact appear identical.
  await page.evaluate(()=>{
    window.state.players={};
    window.pkrSetSeatLayout('auto');
    window.renderTable();
  });
  assert.equal(await page.locator('#seatsContainer>.pkr-empty-seat').count(),count);
  const emptyModes=['auto','full','compact'];
  const modeMetrics={};
  for(const selection of emptyModes){
    await page.getByRole('button',{name:'Open table controls'}).click();
    const sheet=page.locator('.pkr-table-tools-dialog');
    await sheet.waitFor();
    const button=sheet.getByRole('button',{name:(selection==='auto'?'Auto':selection==='full'?'Full':'Compact')+' table view',exact:true});
    await button.click();
    assert.equal(await button.getAttribute('aria-pressed'),'true');
    await page.getByRole('button',{name:'Close table controls'}).click();
    const effective=selection==='auto'?expectedAuto:selection==='full'?'balanced':'compact';
    await page.waitForFunction(m=>document.querySelectorAll('#seatsContainer>.pkr-empty-seat.pkr-layout-'+m).length===document.querySelectorAll('#seatsContainer>.pkr-empty-seat').length,effective);
    const metrics=await page.evaluate(()=>{
      const seats=[...document.querySelectorAll('#seatsContainer>.pkr-empty-seat')];
      return seats.map(s=>{
        const a=s.querySelector('.pkr-empty-seat-add');
        const n=s.querySelector('.pkr-empty-seat-number');
        if(!a||!n)return {error:'Empty seat control missing'};
        const parent=s.getBoundingClientRect(),plus=a.getBoundingClientRect(),label=n.getBoundingClientRect();
        const contained=r=>r.left>=parent.left-2&&r.right<=parent.right+2&&r.top>=parent.top-2&&r.bottom<=parent.bottom+2;
        return {id:s.id,text:n.textContent,plus:a.textContent,
          width:parent.width,height:parent.height,
          direction:getComputedStyle(s).flexDirection,
          inside:contained(plus)&&contained(label),
          visible:getComputedStyle(n).display!=='none'&&label.width>=22,
          left:parent.left,right:parent.right,
          plusCenterX:(plus.left+plus.right)/2,labelCenterX:(label.left+label.right)/2};
      });
    });
    assert.equal(metrics.length,count);
    for(const [i,m] of metrics.entries()){
      assert(!m.error,'Empty seat markup incomplete: '+JSON.stringify(m));
      assert.equal(m.text,'Seat '+(i+1));
      assert.equal(m.plus,'+');
      assert(m.inside&&m.visible,'Seat number detached or clipped from plus: '+JSON.stringify({width,height,count,selection,m}));
      assert(m.left>=-2&&m.right<=width+2,'Empty seat card outside viewport: '+JSON.stringify({width,height,count,selection,m}));
    }
    assert(metrics.every(m=>m.direction===(effective==='compact'?'row':'column')),
      'Auto / Full / Compact must have visibly different empty-card presentations: '+JSON.stringify({width,height,count,selection,metrics}));
    modeMetrics[selection]=metrics[0];
    if(count===9||count===13)await page.screenshot({path:path.join(out,browser.browserType().name()+'-'+width+'x'+height+'-'+count+'-empty-'+selection+'.png')});
  }
  assert(Math.abs(modeMetrics.full.width-modeMetrics.compact.width)>=15,
    'Full / Compact toggle must resize an empty game even before players join: '+JSON.stringify(modeMetrics));
  assert.deepEqual(failures,[]);assert.deepEqual(browserErrors,[]);
  console.log('PASS approved table layout '+browser.browserType().name()+' '+width+'x'+height+' '+count+' seats, approved default/'+expectedAuto+', full/compact renderers, bank totals, no financial writes');
 }finally{await ctx.close();}
}
(async()=>{
 for(const engine of [chromium,webkit]){
  const browser=await engine.launch({headless:true});
  try{
   // Chromium: 9 and 13 players on every practical device size.
   // WebKit: phone and tablet cross-browser regression coverage.
   const dimensions=engine===chromium?[
    [320,720],[390,844],[844,390],[768,1024],[1024,768],[1440,900],[1780,864]
   ]:[[390,844],[768,1024]];
   for(const [w,h] of dimensions){
    for(const count of [9,13])await check(browser,w,h,count);
   }
  }finally{await browser.close();}
 }
})().catch(e=>{console.error(e);process.exitCode=1;});
