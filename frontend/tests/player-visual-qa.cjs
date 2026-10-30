const {chromium}=require('playwright');
const fs=require('node:fs'),path=require('node:path');
const assert=require('node:assert/strict');
const BASE='http://127.0.0.1:3000';
const API='https://pkr-reloaded-worker-staging.jeemit1.workers.dev';
const output=path.resolve(__dirname,'../../artifacts/player-release-qa');
fs.mkdirSync(output,{recursive:true});
const now=Math.floor(Date.now()/1000);
const room={id:'qa-room',name:'Friday Night Poker',description:'Private group',status:'active',role:'member',host_id:'host-1',member_count:9,game_count:14,buy_in:2500,created_at:now-864000};
const upcoming={id:'qa-upcoming',event_id:room.id,scheduled_at:now+86400*2,status:'scheduled',location:'Indooroopilly',notes:'',seats:9,created_at:now-86400,player_count:8,results_token:null,live_token:null};
const finished={...upcoming,id:'qa-finished',status:'settled',scheduled_at:now-86400*7,results_token:'qa-results',player_count:6};
const active={...upcoming,id:'qa-active',status:'active',scheduled_at:now,live_token:'qa-live',player_count:6};
const members=[{id:'host-1',name:'Host Smith',role:'host',joined_at:now-864000,avatar_url:null},{id:'player-1',name:'Alex Morgan',role:'member',joined_at:now-864000,avatar_url:null},{id:'player-2',name:'Jordan Lee',role:'member',joined_at:now-864000,avatar_url:null}];
const user={id:'player-1',name:'Alex Morgan',email:'alex@example.invalid',plan:'free',avatar_url:null,is_active:true,trial_active:false,trial_days_left:0};
const leaders=[{user_id:'player-1',display_name:'Alex Morgan',games_played:7,games_won:4,total_net:12000,biggest_win:7500,biggest_loss:-2500,last_played:now-60000},{user_id:'player-2',display_name:'Jordan Lee',games_played:8,games_won:2,total_net:-10000,biggest_win:1200,biggest_loss:-8000,last_played:now-60000}];
const transfers=[
{id:'pay-alex',game_id:'qa-finished',from_user:'player-1',to_user:'player-2',from:'player-1',to:'player-2',from_name:'Alex Morgan',to_name:'Jordan Lee',amount:2500,status:'owed',paid_at:null},
{id:'receive-alex',game_id:'qa-finished',from_user:'player-3',to_user:'player-1',from:'player-3',to:'player-1',from_name:'Casey Brooks',to_name:'Alex Morgan',amount:7500,status:'payer_claimed',paid_at:null},
{id:'not-alex',game_id:'qa-finished',from_user:'player-2',to_user:'player-3',from:'player-2',to:'player-3',from_name:'Jordan Lee',to_name:'Casey Brooks',amount:990000,status:'owed',paid_at:null}
];
const players=[
{game_id:'qa-finished',user_id:'player-1',display_name:'Alex Morgan',seat_number:1,buy_ins:1,cashout:3700,net:1200,settled_at:now-12000},
{game_id:'qa-finished',user_id:'player-2',display_name:'Jordan Lee',seat_number:2,buy_ins:2,cashout:3500,net:-1500,settled_at:now-12000}
];
let rsvpRequests=0;
const responseFor=(url,method,body)=>{
 const p=url.pathname;
 if(method==='OPTIONS')return {};
 if(p==='/auth/me')return user;
 if(p==='/events')return [room];
 if(p==='/events/qa-room')return {...room,members};
 if(p==='/events/qa-room/games')return [upcoming,active,finished];
 if(p==='/events/qa-room/history')return [{...finished,top_players:[{display_name:'Alex Morgan',net:1200},{display_name:'Jordan Lee',net:-1500}]}];
 if(p==='/events/qa-room/leaderboard')return leaders;
 if(p==='/events/qa-room/settlement-ledger')return {games:[finished],transfers};
 if(p==='/events/qa-room/players')return [];
 if(p==='/events/qa-room/profiles')return {profiles:[]};
 if(p==='/events/qa-room/join-requests')return {requests:[]};
 if(p==='/events/qa-room/phone-contacts')return {contacts:[]};
 if(p==='/events/qa-room/push-registrations')return {members:[],definition:'registered_devices_not_delivery_confirmation'};
 if(p==='/events/qa-room/dashboard-layout')return {event_id:room.id,layout:'command',updated_at:null};
 if(p==='/games/qa-upcoming/rsvp-board' && method==='POST'){rsvpRequests++;return {id:'qa-rsvp',edit_token:'a'.repeat(64),ok:true};}
 if(p==='/games/qa-upcoming/rsvp-board')return {event:room,game:upcoming,players:[],guests:[],options:['19:00','20:00','21:00']};
 if(p==='/games/qa-upcoming')return {...upcoming,players:[],rsvps:[],transfers:[],event_name:room.name};
 if(p==='/games/qa-active')return {...active,players,rsvps:[],transfers:[],event_name:room.name};
 if(p==='/games/qa-finished')return {...finished,players,rsvps:[],transfers,event_name:room.name};
 if(p==='/games/qa-finished/settlement-control')return {game_id:'qa-finished',enabled:true,reminders_enabled:true,last_broadcast_at:now-1000,outstanding_count:3,can_manage:false};
 if(p==='/games/results/qa-results')return {game:finished,event:{name:room.name},players,transfers};
 if(p==='/games/live/qa-live')return {game:{...active,name:room.name,buy_in:2500},event:{name:room.name},players:players.map(x=>({...x,game_id:'qa-active',cashout:null,net:null})),totalIn:7500,totalOut:0,bank:7500};
 if(p==='/push/vapid-key')return {key:'test-only'};
 if(p.includes('subscribe'))return {};
 throw Error('Unmocked endpoint '+method+' '+p);
};
const sizes=[{name:'small-phone',width:320,height:700},{name:'phone',width:390,height:844},{name:'tablet',width:768,height:1024},{name:'tablet-landscape',width:1024,height:768},{name:'desktop',width:1440,height:900}];
async function main(){
 const browser=await chromium.launch({headless:true,args:['--no-sandbox']});
 const failures=[],results=[];
 try{
  for(const size of sizes){
   const ctx=await browser.newContext({viewport:{width:size.width,height:size.height},deviceScaleFactor:1});
   await ctx.addInitScript(()=>localStorage.setItem('pkr_token','qa-only-mocked-token'));
   const page=await ctx.newPage();
   page.on('pageerror',e=>failures.push(size.name+' JS error: '+e.message));
   page.on('request',req=>{if(req.url().includes('pkr-reloaded-worker.jeemit1.workers.dev'))failures.push(size.name+' reached PROD Worker');});
   await page.route('**/*.workers.dev/**',async route=>{
    const u=new URL(route.request().url());
    if(u.origin!==API){failures.push('Unrecognised API origin '+u.origin);await route.abort();return;}
    let result,status=200;
    try{result=responseFor(u,route.request().method(),route.request().postData());}
    catch(e){failures.push(size.name+' '+e.message);result={error:e.message};status=404;}
    await route.fulfill({status,contentType:'application/json',headers:{'access-control-allow-origin':BASE,'access-control-allow-credentials':'true','access-control-allow-headers':'Content-Type,Authorization','access-control-allow-methods':'GET,POST,PUT,DELETE,OPTIONS'},body:JSON.stringify(result)});
   });
   async function visit(route,selector){
    await page.goto(BASE+route,{waitUntil:'domcontentloaded',timeout:40000});
    await page.locator(selector).first().waitFor({state:'visible',timeout:18000});
    await page.waitForTimeout(550);
   }
   async function noOverflow(label){
    const widths=await page.evaluate(()=>({sw:document.documentElement.scrollWidth,cw:document.documentElement.clientWidth}));
    if(widths.sw>widths.cw+6)failures.push(size.name+' '+label+' horizontal overflow '+JSON.stringify(widths));
   }
   async function check(label,fn){try{await fn();results.push('PASS '+size.name+' '+label);}catch(e){failures.push('FAIL '+size.name+' '+label+': '+e.message);}}
   await check('member dashboard',async()=>{
    await visit('/dashboard','[data-testid="player-dashboard"]');
    assert.equal(await page.getByText('Welcome, Alex',{exact:false}).count()>=1,true);
    assert.equal(await page.locator('[data-testid="dual-dashboard"]').count(),0);
    assert.equal(await page.getByText('Quick Buy-in').count(),0);
    assert.equal(await page.getByText('Create a Game').count(),0);
    await page.getByText('My payments',{exact:true}).last().waitFor();
    const panel=page.locator('#pkr-my-payments');
    await panel.getByText('Pay Jordan Lee').waitFor();
    await panel.getByText('Receive from Casey Brooks').waitFor();
    assert.equal(await panel.getByText('Jordan Lee to Casey Brooks',{exact:false}).count(),0);
    const amount=await panel.innerText();
    assert(amount.includes('$25')&&amount.includes('$75'));
    assert(!amount.includes('$9,900'));
    if(size.width<1100){
      assert.equal(await page.locator('.pkr-player-universal-nav button').count(),4,'Player bottom navigation');
      assert.equal(await page.locator('.pkr-persistent-nav').isVisible(),false,'Desktop sidebar must stay hidden on mobile');
      assert.equal(await page.locator('.pkr-player-universal-nav').getByRole('button',{name:'More'}).count(),1);
    } else {
      const sidebar=page.locator('.pkr-persistent-nav');
      assert.equal(await sidebar.isVisible(),true,'Player desktop gets limited sidebar');
      assert.equal(await sidebar.getByRole('button',{name:'Members'}).count(),1);
      assert.equal(await sidebar.getByRole('button',{name:'My payments'}).count(),1);
      assert.equal(await sidebar.getByRole('button',{name:'Settlements'}).count(),0);
      assert.equal(await sidebar.getByRole('button',{name:'Schedule'}).count(),0);
    }
    await noOverflow('dashboard');
    await page.screenshot({path:path.join(output,size.name+'-player-dashboard.png'),fullPage:true});
   });
   if(size.name==='phone'){
    await check('scan navigation',async()=>{
      await page.locator('.pkr-player-universal-nav').getByRole('button',{name:'More'}).click();
      await page.locator('.pkr-navigation-more-panel').getByRole('button',{name:'Scan invitation'}).click();
      await page.locator('#scanVideo').waitFor({state:'visible',timeout:10000});
    });
   }
   if(size.name==='desktop'){
    await check('self profile',async()=>{
      await page.getByRole('button',{name:/My profile/}).first().click();
      await page.locator('.pkr-player-profile-sheet').waitFor({state:'visible',timeout:15000});
      assert.equal(await page.getByText('Remove member',{exact:false}).count(),0);
    });
   }
   await check('room role visibility',async()=>{
    await visit('/events/qa-room','.pkr-room-games-intro');
    assert.equal(await page.locator('[data-testid="dual-dashboard"]').count(),0);
    assert.equal(await page.getByText('Quick Buy-in').count(),0);
    await noOverflow('room');
   });
   await check('player insights',async()=>{
    await visit('/insights?room=qa-room','[data-testid="player-dashboard"]');
    assert.equal(await page.getByText('Settlement Centre',{exact:false}).count(),0);
    assert.equal(await page.getByText('Mark selected paid',{exact:false}).count(),0);
    await noOverflow('insights');
   });
   await check('RSVP seat selection',async()=>{
    await visit('/games/qa-upcoming/rsvp','.pkr-guest-hero');
    assert.equal(await page.getByText('HOST CONTROLS',{exact:false}).count(),0);
    await page.locator('#pkr-rsvp-name').fill('Alex Morgan');
    await page.getByRole('button',{name:/7(?:\:00)?\s*pm/i}).first().click();
    await page.getByRole('button',{name:/Seat 4, available/}).click();
    await page.getByRole('button',{name:/Confirm my RSVP/}).click();
    await page.getByText('RSVP saved',{exact:false}).waitFor({timeout:15000});
    assert(rsvpRequests>0);
    await noOverflow('rsvp');
    await page.screenshot({path:path.join(output,size.name+'-player-rsvp.png'),fullPage:true});
   });
   await check('live read-only',async()=>{
    await visit('/games/live/qa-live','#liveTableWrap');
    assert.equal(await page.getByText('Quick Buy-in').count(),0);
    assert.equal(await page.getByText('End Game').count(),0);
    await noOverflow('live');
    await page.screenshot({path:path.join(output,size.name+'-player-live.png'),fullPage:true});
   });
   await check('results / authorised payments',async()=>{
    await visit('/games/results/qa-results','.section-header');
    assert.equal(await page.getByText('Mark paid',{exact:false}).count(),0);
    await page.getByRole('button',{name:/I have paid \$25/}).waitFor();
    assert.equal(await page.getByRole('button',{name:/Confirm received/}).count(),1);
    await noOverflow('results');
    await page.screenshot({path:path.join(output,size.name+'-player-results.png'),fullPage:true});
   });
   await check('host console redirects member',async()=>{
    await page.goto(BASE+'/games/qa-active/play',{waitUntil:'domcontentloaded',timeout:40000});
    await page.waitForURL('**/games/live/qa-live',{timeout:14000});
    assert.equal(await page.locator('#gameScreen').count(),0);
   });
   await ctx.close();
  }
  // Host and co-host must retain their management dashboard after member-shell changes.
  members.push({id:'cohost-1',name:'Cohost Demo',role:'cohost',joined_at:now-864000,avatar_url:null});
  for(const role of ['host','cohost']){
   room.role=role;
   user.id=role==='host'?'host-1':'cohost-1';
   user.name=role==='host'?'Host Smith':'Cohost Demo';
   const ctx=await browser.newContext({viewport:{width:1440,height:900},deviceScaleFactor:1});
   await ctx.addInitScript(()=>localStorage.setItem('pkr_token','qa-only-mocked-token'));
   const page=await ctx.newPage();
   page.on('pageerror',e=>failures.push(role+' JS error: '+e.message));
   await page.route('**/*.workers.dev/**',async route=>{
    const url=new URL(route.request().url());
    let value,status=200;
    try{value=responseFor(url,route.request().method(),route.request().postData());}
    catch(e){value={error:e.message};status=404;}
    await route.fulfill({status,contentType:'application/json',headers:{'access-control-allow-origin':BASE,'access-control-allow-credentials':'true','access-control-allow-headers':'Content-Type,Authorization','access-control-allow-methods':'GET,POST,PUT,DELETE,OPTIONS'},body:JSON.stringify(value)});
   });
   try{
    await page.goto(BASE+'/dashboard',{waitUntil:'domcontentloaded',timeout:40000});
    await page.locator('[data-testid="dual-dashboard"]').waitFor({state:'visible',timeout:16000});
    assert.equal(await page.locator('[data-testid="player-dashboard"]').count(),0);
    assert.equal(await page.locator('.pkr-persistent-nav').count(),1);
    assert.equal(await page.locator('.pkr-dual-switch-actions').count(),role==='host'?1:0);
    results.push('PASS '+role+' management dashboard preserved');
    await page.goto(BASE+'/events/qa-room?tab=members',{waitUntil:'domcontentloaded',timeout:40000});
    await page.locator('.pkr-member-summary').waitFor({state:'visible',timeout:16000});
    await page.waitForTimeout(450);
    const removes=await page.getByRole('button',{name:'Remove',exact:true}).count();
    assert.equal(role==='host'?removes>0:removes===0,true);
    results.push('PASS '+role+' member-removal permission');
   }catch(e){failures.push('FAIL '+role+' role isolation: '+e.message);}
   await ctx.close();
  }
 }finally{await browser.close();}
 console.log(JSON.stringify({pass:results.length,fail:failures.length,failures,results,output},null,2));
 if(failures.length)process.exitCode=1;
}
main().catch(e=>{console.error(e);process.exitCode=1;});

