// Capture the real application UI, never a mockup. All data is fictional.
const fs=require('node:fs'),path=require('node:path'),{createRequire}=require('node:module');
const {chromium}=require('playwright');
const smoke=path.resolve(__dirname,'../tests/viewport-smoke.cjs');
const source=fs.readFileSync(smoke,'utf8');
const boundary=source.indexOf('async function test(){');
if(boundary<0)throw Error('Synthetic fixture boundary changed; review capture script.');
const data=new Function('require','__dirname',source.slice(0,boundary)+'\nreturn {BASE,API,fixture,room,upcoming,finished,user,members,leaders,results};')(createRequire(smoke),path.dirname(smoke));
const {BASE,API}=data;
const output=path.resolve(__dirname,'../../artifacts/theme-a-capture');
fs.mkdirSync(output,{recursive:true});
const mode=process.argv[2]||'app';
const names=['Alex Morgan','Jordan Lee','Sam Patel','Taylor Reed','Chris Martin','Riley Chen','Casey Brooks'];
const amounts=[150,200,150,100,250,100,200],net=[140,85,-100,-40,-30,-25,-30];
const members=names.map((name,i)=>({id:i===0?'test-user':i===1?'member-2':'sample-'+i,name,role:i===0?'host':'member',joined_at:data.room.created_at,avatar_url:null}));
const room={...data.room,member_count:7,game_count:2};
const players=members.map((member,i)=>({user_id:member.id,display_name:member.name,seat_number:i+1,buy_ins:amounts[i]/25,buy_in_total:amounts[i]*100,cashout:null,revision:1}));
const game={...data.upcoming,name:'Friday Night Game',buy_in:2500,seats:8,player_count:7,players};
const finished={...data.finished,name:'Friday Night Game',buy_in:2500,seats:8,player_count:7,players:players.map((p,i)=>({...p,cashout:(amounts[i]+net[i])*100,net:net[i]*100}))};
const leaders=members.map((m,i)=>({user_id:m.id,display_name:m.name,games_played:1,games_won:net[i]>0?1:0,total_net:net[i]*100,biggest_win:Math.max(0,net[i])*100,biggest_loss:Math.min(0,net[i])*100,last_played:finished.scheduled_at}));
function fixture(p,method){
 if(method==='OPTIONS')return {};
 if(p==='/auth/me')return {...data.user,is_active:true,plan:'pro'};
 if(p==='/events')return [room];
 if(p==='/events/'+room.id)return {...room,members};
 if(p==='/events/'+room.id+'/games')return [game,finished];
 if(p==='/events/'+room.id+'/leaderboard')return leaders;
 if(p==='/events/'+room.id+'/history')return [{...finished,top_players:leaders.filter(x=>x.total_net>0).map(x=>({display_name:x.display_name,net:x.total_net}))}];
 if(p==='/games/'+game.id)return game;
 if(p==='/games/'+finished.id)return finished;
 if(p==='/games/results/synthetic-results')return {...data.results,game:finished,players:finished.players};
 if(p==='/games/'+game.id+'/tournament')return {state:{status:'paused',current_level:1,paused_elapsed:300,starting_chips:10000,buy_in_amount:2500,rebuy_allowed:false,rebuy_levels:4,addon_allowed:false,payout_structure:'[{"position":1,"percent":60},{"position":2,"percent":30},{"position":3,"percent":10}]'},levels:Array.from({length:12},(_,i)=>({level_num:i+1,small_blind:25*(i+1),big_blind:50*(i+1),ante:0,duration_secs:1200,is_break:false})),rebuys:[],eliminations:[],payouts:[],prize_pool_cents:17500};
 if(p==='/games/'+game.id+'/rsvp-board')return {event:room,game,players:[],version:1,options:['19:45','20:00','20:15'],guests:members.map((m,i)=>({id:m.id,display_name:m.name,status:i===6?'maybe':'yes',arrival_option:i%2?'20:00':'19:45',seat_number:i===6?null:i+1,updated_at:room.created_at}))};
 return data.fixture(p,method);
}
const errors=[],checks=[];
const rgb={bg:'rgb(11, 15, 18)',surface:'rgb(19, 26, 31)',primary:'rgb(61, 220, 151)'};
async function settle(page){
 await page.evaluate(async()=>{
  await Promise.race([document.fonts.ready,new Promise(r=>setTimeout(r,8000))]);
  await Promise.all([...document.images].map(async img=>{img.loading='eager';await Promise.race([img.decode().catch(()=>{}),new Promise(r=>setTimeout(r,6000))]);}));
 });
 await page.waitForTimeout(300);
}
async function report(page,id,size){
 const view=await page.evaluate(()=>({background:getComputedStyle(document.body).backgroundColor,scroll:document.documentElement.scrollWidth,width:innerWidth,primary:getComputedStyle(document.documentElement).getPropertyValue('--pkr-a-primary').trim(),heading:document.querySelector('h1,h2')?getComputedStyle(document.querySelector('h1,h2')).fontFamily:''}));
 checks.push({page:id,viewport:size,...view});
 if(view.background!==rgb.bg)errors.push(size+' '+id+' body colour '+view.background);
 if(view.primary.toUpperCase()!=='#3DDC97')errors.push(size+' '+id+' wrong primary token');
 if(view.scroll>view.width+3)errors.push(size+' '+id+' horizontal overflow '+view.scroll+'>'+view.width);
 if(view.heading&&!view.heading.toLowerCase().includes('bricolage'))errors.push(size+' '+id+' wrong heading font '+view.heading);
 console.log('CAPTURE '+size+' '+id+' '+view.background);
}
async function run(){
 const browser=await chromium.launch({headless:true});
 try{
  for(const size of [{name:'desktop',width:1440,height:900},{name:'phone',width:390,height:844}]){
   const context=await browser.newContext({viewport:{width:size.width,height:size.height},deviceScaleFactor:1,serviceWorkers:'block',reducedMotion:'reduce'});
   if(mode==='app')await context.addInitScript(()=>{localStorage.setItem('pkr_token','synthetic-viewport-test-only');localStorage.setItem('pkr_preferred_room','test-room');});
   await context.route('**/*',async route=>{
    const url=new URL(route.request().url());
    if(url.origin===BASE)return route.continue();
    if(url.origin===API){const result=fixture(url.pathname,route.request().method());return route.fulfill({status:result?.error?404:200,contentType:'application/json',headers:{'access-control-allow-origin':BASE,'access-control-allow-credentials':'true','access-control-allow-headers':'Content-Type,Authorization','access-control-allow-methods':'GET,POST,PUT,DELETE,OPTIONS'},body:JSON.stringify(result)});}
    if(url.hostname.includes('workers.dev')||url.hostname==='mypkr.app')errors.push('Forbidden live request: '+url.origin);
    return route.abort();
   });
   const page=await context.newPage();page.setDefaultTimeout(12000);
   if(mode==='app'){
    const routes=[['dashboard','/dashboard','.pkr-pro-home'],['room','/events/test-room','.pkr-event-tabs'],['insights','/insights','.pkr-insights-settle-tabs'],['schedule','/schedule','.pkr-schedule-page'],['game-detail','/games/test-game','.pkr-game-detail'],['rsvp','/games/test-game/rsvp','.pkr-guest-card'],['live-table','/games/test-game/play','#tableFelt'],['install','/install?group=test-room','.pkr-install-vnext']];
    for(const [id,url,ready] of routes){
     await page.goto(BASE+url,{waitUntil:'domcontentloaded'});await page.locator(ready).first().waitFor({state:'visible'});
     if(id==='live-table')await page.waitForFunction(()=>document.querySelectorAll('.seat-chip.seated').length===7);
     await settle(page);await report(page,id,size.name);
     if(id==='dashboard'){const value=await page.locator('.pkr-pro-actions .btn-primary').first().evaluate(el=>getComputedStyle(el).backgroundColor);if(value!==rgb.primary)errors.push(size.name+' dashboard action not lime: '+value);}
     if(id==='room'){const contrast=await page.locator('.pkr-event-tabs-inner .tab.active').evaluate(el=>({fg:getComputedStyle(el).color,bg:getComputedStyle(el).backgroundColor}));if(contrast.fg===contrast.bg)errors.push(size.name+' room tab label has no contrast');}
     if(id==='live-table'){const value=await page.locator('#gameScreen .topbar').evaluate(el=>getComputedStyle(el).backgroundColor);if(value!==rgb.surface)errors.push(size.name+' table toolbar not Theme A surface: '+value);if(await page.locator('.pkr-persistent-nav,.pkr-universal-bottom-nav').count())errors.push('Navigation intrudes into gameplay');}
     await page.screenshot({path:path.join(output,size.name+'-'+id+'.png'),fullPage:false});
     if(id==='room'){await page.locator('.pkr-event-tabs .tab').filter({hasText:'Standings'}).click();await page.locator('.pkr-standings-board').waitFor({state:'visible'});await settle(page);await page.evaluate(()=>scrollTo(0,0));await page.screenshot({path:path.join(output,size.name+'-standings.png'),fullPage:false});}
     if(id==='live-table'){await page.waitForFunction(()=>typeof window.openTournament==='function');await page.evaluate(()=>window.openTournament());await page.locator('#tTimerDisplay').waitFor({state:'visible'});await page.screenshot({path:path.join(output,size.name+'-tournament.png'),fullPage:false});}
    }
   }else{
    for(const [id,url] of [['home','/'],['pricing','/pricing'],['game-tracker','/home-poker-game-tracker'],['settlement','/home-poker-settlement'],['tournaments','/poker-tournament-manager'],['player-login','/mobile-login']]){
     await page.goto(BASE+url,{waitUntil:'domcontentloaded'});await settle(page);await report(page,id,size.name);
     const stale=await page.locator('img').evaluateAll(images=>images.filter(img=>{const src=img.getAttribute('src')||'';return src.startsWith('/demo/')&&!src.startsWith('/demo/theme-a/');}).map(img=>img.getAttribute('src')));
     if(stale.length)errors.push('Old screenshot references: '+stale.join(','));
     const broken=await page.locator('img[src^="/demo/theme-a/"]').evaluateAll(images=>images.filter(img=>!img.complete||img.naturalWidth<100).map(img=>img.getAttribute('src')));
     if(broken.length)errors.push('Fresh screenshots unavailable: '+broken.join(','));
     await page.screenshot({path:path.join(output,size.name+'-'+id+'.png'),fullPage:id==='home'});
    }
   }
   await context.close();
  }
 }finally{await browser.close();}
 fs.writeFileSync(path.join(output,'checks-'+mode+'.json'),JSON.stringify({sampleData:true,sourceCommit:process.env.GITHUB_SHA||'local',checks,errors},null,2));
 if(errors.length)throw Error(errors.join('\n'));
 console.log('Theme A '+mode+' screenshots verified against rendered colours and fonts.');
}
run().catch(error=>{console.error(error);process.exitCode=1;});
