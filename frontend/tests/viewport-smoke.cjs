// Staging-only visual regression smoke: all API responses are intercepted with synthetic data.
// Never contact a real database or use real player records.
const { chromium } = require('playwright');
const fs = require('node:fs');
const path = require('node:path');
const BASE = 'http://127.0.0.1:3000';
const API = 'https://pkr-reloaded-worker-staging.jeemit1.workers.dev';
const output = path.resolve(__dirname, '../../artifacts/viewport-smoke');
fs.mkdirSync(output,{recursive:true});
const future=Math.floor(Date.now()/1000)+86400;
const past=Math.floor(Date.now()/1000)-86400;
const room={id:'test-room',name:'Friday Night Test',description:'Private game room',status:'active',role:'host',host_id:'test-user',member_count:4,game_count:2,buy_in:5000,created_at:past};
const upcoming={id:'test-game',event_id:room.id,scheduled_at:future,status:'scheduled',location:'Test room',notes:'',seats:8,created_at:past,player_count:2,results_token:null,live_token:null};
const finished={...upcoming,id:'test-finished',status:'settled',scheduled_at:past,player_count:4,results_token:'synthetic-results'};
const members=[{id:'test-user',name:'Test Host',role:'host',email:'test@invalid.example',avatar_url:null,joined_at:past},{id:'member-2',name:'Demo Player',role:'member',email:'demo@invalid.example',avatar_url:null,joined_at:past}];
const leaders=[{user_id:'test-user',display_name:'Test Host',games_played:1,games_won:1,total_net:7500,biggest_win:7500,biggest_loss:0,last_played:past},{user_id:'member-2',display_name:'Demo Player',games_played:1,games_won:0,total_net:-7500,biggest_win:0,biggest_loss:-7500,last_played:past}];
const results={game:finished,event:{name:room.name},players:[],transfers:[{id:'synthetic-transfer',from:'member-2',from_name:'Demo Player',to:'test-user',to_name:'Test Host',amount:7500,status:'owed'}]};
const user={id:'test-user',name:'Test Host',email:'test@invalid.example',avatar_url:null,plan:'pro',trial_active:false,trial_days_left:0};
const fixture=(pathname,method)=>{
  if(method==='OPTIONS')return {};
  if(pathname==='/auth/me')return user;
  if(pathname==='/events')return [room];
  if(pathname==='/events/'+room.id)return {...room,members};
  if(pathname==='/events/'+room.id+'/games')return [upcoming,finished];
  if(pathname==='/events/'+room.id+'/leaderboard')return leaders;
  if(pathname==='/events/'+room.id+'/history')return [finished];
  if(pathname==='/events/'+room.id+'/join-requests')return {requests:[]};
  if(pathname==='/events/'+room.id+'/phone-contacts')return {contacts:[]};
  if(pathname==='/games/'+upcoming.id)return {...upcoming,players:[],rsvps:[]};
  if(pathname==='/games/'+finished.id)return {...finished,players:[],rsvps:[]};
  if(pathname==='/games/results/synthetic-results')return results;
  if(pathname==='/games/'+upcoming.id+'/rsvp-board')return {event:room,game:upcoming,players:[],guests:[],options:['19:00','20:00']};
  if(pathname==='/push/vapid-key')return {key:'test-not-a-real-vapid-key'};
  return {error:'Synthetic fixture not provided: '+pathname};
};
const sizes=[
 {name:'small-phone',width:320,height:700},
 {name:'phone',width:390,height:844},
 {name:'landscape-phone',width:844,height:390},
 {name:'tablet',width:768,height:1024},
 {name:'tablet-landscape',width:1024,height:768},
 {name:'desktop',width:1440,height:900},
];
async function test(){
 const browser=await chromium.launch({headless:true});
 const errors=[];
 try{
  for(const size of sizes){
   const context=await browser.newContext({viewport:{width:size.width,height:size.height},deviceScaleFactor:1});
   await context.addInitScript(()=>localStorage.setItem('pkr_token','synthetic-viewport-test-only'));
   const page=await context.newPage();
   page.on('request',request=>{if(request.url().includes('pkr-reloaded-worker.jeemit1.workers.dev'))errors.push('PRODUCTION API REQUEST BLOCKED: '+request.url());});
   await page.route('**/*.workers.dev/**',async route=>{
    const url=new URL(route.request().url());
    if(url.origin!==API){errors.push('Unexpected Worker origin: '+url.origin);return route.abort();}
    const response=fixture(url.pathname,route.request().method());
    const status=response?.error?404:200;
    await route.fulfill({status,contentType:'application/json',headers:{'access-control-allow-origin':BASE,'access-control-allow-credentials':'true','access-control-allow-headers':'Content-Type,Authorization','access-control-allow-methods':'GET,POST,PUT,DELETE,OPTIONS'},body:JSON.stringify(response)});
   });
   for(const item of [{id:'dashboard',url:'/dashboard',ready:'.pkr-pro-home'},{id:'insights',url:'/insights',ready:'.pkr-vnext-insights'},{id:'schedule',url:'/schedule',ready:'.pkr-schedule-page'},{id:'room',url:'/events/test-room',ready:'.pkr-event-tabs'},{id:'game-detail',url:'/games/test-game',ready:'.pkr-game-detail'},{id:'rsvp',url:'/games/test-game/rsvp',ready:'.pkr-guest'},{id:'live-table',url:'/games/test-game/play',ready:'#gameScreen'},{id:'install',url:'/install?group=test-room',ready:'.pkr-install-vnext'}]){
    try{
     await page.goto(BASE+item.url,{waitUntil:'domcontentloaded',timeout:40000});
     await page.locator(item.ready).waitFor({state:'visible',timeout:25000});
     await page.waitForTimeout(350);
     const x=await page.evaluate(()=>({scroll:document.documentElement.scrollWidth,viewport:document.documentElement.clientWidth}));
     if(x.scroll>x.viewport+5)errors.push(size.name+' '+item.id+' horizontal overflow '+x.scroll+' > '+x.viewport);
     // The old synthetic test missed a real regression: Insights/Schedule rendered
     // underneath the fixed desktop sidebar without causing horizontal overflow.
     if(size.width>=1100 && ['insights','schedule','room','install','game-detail'].includes(item.id)){
       const mainSelector=item.id==='room'?'.pkr-event':item.id==='install'?'.pkr-install-vnext':item.id==='game-detail'?'.pkr-game-detail':item.ready;
       const geometry=await page.evaluate(selector=>{
         const sidebar=document.querySelector('.pkr-persistent-nav');
         const content=document.querySelector(selector);
         if(!sidebar||!content)return null;
         const side=sidebar.getBoundingClientRect(),main=content.getBoundingClientRect();
         return {sideRight:side.right,mainLeft:main.left,mainRight:main.right,windowWidth:innerWidth};
       },mainSelector);
       if(!geometry)errors.push(size.name+' '+item.id+' missing sidebar/content for overlap test');
       else if(geometry.mainLeft<geometry.sideRight-1 || geometry.mainRight>geometry.windowWidth+1)
         errors.push(size.name+' '+item.id+' content clipped/overlaps fixed sidebar: '+JSON.stringify(geometry));
     }
     if(item.id==='room'){
       const rect=await page.evaluate(()=>{
        const hero=document.querySelector('.pkr-event-overview');const tabs=document.querySelector('.pkr-event-tabs');
        if(!hero||!tabs)return null;const h=hero.getBoundingClientRect(),t=tabs.getBoundingClientRect();
        return {heroWidth:h.width,tabsWidth:t.width,heroLeft:h.left,tabsLeft:t.left,heroRight:h.right,tabsRight:t.right};
       });
       if(!rect)errors.push(size.name+' room missing hero/tabs geometry');
       else if(Math.abs(rect.heroLeft-rect.tabsLeft)>18||Math.abs(rect.heroRight-rect.tabsRight)>18) errors.push(size.name+' room banner and tabs misaligned: '+JSON.stringify(rect));
     }
     if(item.id==='install'&&size.width>=1100){
       const card=await page.locator('.pkr-install-card').first().boundingBox();
       const sidebar=await page.locator('.pkr-persistent-nav').boundingBox();
       if(card&&sidebar&&card.x<sidebar.x+sidebar.width-1)errors.push(size.name+' install card hidden under sidebar');
     }
     if(['dashboard','room','insights'].includes(item.id)){
       const heroSelector=item.id==='dashboard'?
         (size.width<=700&&await page.locator('.pkr-mobile-featured').count()?'.pkr-mobile-featured':'.pkr-pro-hero')
         :item.id==='room'?'.pkr-event-overview':'.pkr-vnext-insights-top';
       const visual=await page.locator(heroSelector).evaluate(node=>{
         const s=getComputedStyle(node),r=node.getBoundingClientRect();
         return {width:r.width,height:r.height,background:s.backgroundImage,border:s.borderTopColor};
       });
       const imageName='pkr-approved-hero-'+(size.width<=700?'mobile':'desktop')+'.webp';
       if(!visual.background.includes(imageName))errors.push(size.name+' '+item.id+' approved photographic banner not applied: '+JSON.stringify(visual));
       const imageResponse=await page.request.get('http://127.0.0.1:3000/images/'+imageName);
       if(!imageResponse.ok())errors.push(size.name+' '+item.id+' banner image returned '+imageResponse.status());
       else if((await imageResponse.body()).length<25000)errors.push(size.name+' '+item.id+' photographic banner appears over-compressed');
       if(visual.width<250||visual.height<140)errors.push(size.name+' '+item.id+' premium hero too small: '+JSON.stringify(visual));
     }
     if(item.id==='dashboard'&&size.width<=700){
       const feature=page.locator('.pkr-mobile-featured');
       if(await feature.count() && !(await feature.isVisible()))errors.push(size.name+' mobile next-game feature hidden');
     }
     if(item.id==='insights'){
       await page.locator('#pkr-insights-room').waitFor({state:'visible'});
       await page.locator('.pkr-insights-settle-tabs').waitFor({state:'visible'});
       if(await page.locator('.pkr-insights-kpis .pkr-insights-kpi').count()!==5)errors.push(size.name+' insights KPI count mismatch');
       await page.getByRole('tab',{name:'Player Balances'}).click();
       if(!await page.getByRole('tab',{name:'Player Balances'}).getAttribute('aria-selected').then(v=>v==='true'))errors.push(size.name+' settlement balances tab did not activate');
       await page.getByRole('tab',{name:'Who Pays Who'}).click();
       const settlement=page.locator('#pkr-settlement');
       if(!await settlement.isVisible())errors.push(size.name+' settlement centre disappeared');
     }
     if(item.id==='rsvp'){
       const arrival=page.locator('.pkr-guest-options button').first();
       if(await arrival.count()){
         await arrival.click();
         const seatMap=page.locator('.pkr-guest-seat-map');
         if(!await seatMap.isVisible())errors.push(size.name+' RSVP oval seating diagram missing');
         else if(await seatMap.locator('button').count()!==8)errors.push(size.name+' RSVP seat count is not based on game');
       }
     }
     if(item.id==='live-table'){
       // Gameplay uses the entire viewport, without the global desktop sidebar or mobile bottom navigation.
       const navCount=await page.locator('.pkr-persistent-nav, .pkr-universal-bottom-nav').count();
       if(navCount!==0)errors.push(size.name+' live table includes '+navCount+' global navigation elements');
       const geometry=await page.locator('#gameScreen').evaluate(node=>{
         const r=node.getBoundingClientRect();
         return {left:r.left,top:r.top,right:r.right,bottom:r.bottom,width:innerWidth,height:innerHeight};
       });
       if(Math.abs(geometry.left)>2||Math.abs(geometry.top)>2||
          Math.abs(geometry.right-geometry.width)>2||Math.abs(geometry.bottom-geometry.height)>2)
         errors.push(size.name+' live table is not full-viewport: '+JSON.stringify(geometry));
       if(!await page.locator('#gameScreen #backBtn').isVisible())
         errors.push(size.name+' gameplay back-to-room control unavailable');
       const chrome=await page.locator('#gameScreen .topbar').evaluate(node=>getComputedStyle(node).backgroundImage);
       if(!chrome.includes('linear-gradient'))errors.push(size.name+' live table premium header missing');
       if(!await page.locator('#gameScreen #settleBtn').isVisible())errors.push(size.name+' live game settle action hidden');
       if(size.width>=1100){
         await page.waitForFunction(()=>{
           const felt=document.querySelector('#tableFelt');
           return felt&&felt.getBoundingClientRect().width>100;
         },{timeout:10000});
         const table=await page.locator('#tableFelt').evaluate(node=>{
           const r=node.getBoundingClientRect();
           return {width:r.width,height:r.height,wide:document.querySelector('#gameScreen')?.classList.contains('pkr-wide-table')};
         });
         if(!table.wide||table.width<=table.height)errors.push(size.name+' live table did not change to wide oval: '+JSON.stringify(table));
       }
     }
     if(item.id==='room'&&size.width<=700){
      if(!await page.locator('.pkr-event-tabs').isVisible())errors.push(size.name+' room tabs hidden');
     }
     if(item.id==='room'){
      const selector=size.width>=1100?'.pkr-persistent-nav button':'.pkr-universal-bottom-nav button';
      const memberNav=page.locator(selector).filter({hasText:'Members'}).first();
      if(await memberNav.count() && await memberNav.isVisible()){
       await memberNav.click();
       await page.waitForTimeout(300);
       const selected=await page.locator('.pkr-event-tabs .tab.active').first().textContent().catch(()=>null);
       if(!selected||!selected.toLowerCase().includes('members'))errors.push(size.name+' global Members navigation did not open room Members tab');
       const contrast=await page.locator('.pkr-event-tabs .tab.active').evaluate(node=>getComputedStyle(node).color);
       if(contrast==='rgb(252, 209, 130)')errors.push(size.name+' selected room tab has low-contrast gold text');
       if(!await page.locator('.pkr-member-summary').isVisible())errors.push(size.name+' members summary missing after navigation');
       const search=page.locator('#pkr-member-search');
       if(await search.count()){
         await search.fill('Demo');
         const roster=page.locator('.pkr-member-roster');
         if(!await roster.getByText('Demo Player').isVisible())errors.push(size.name+' filtered member missing');
         if(await roster.getByText('Test Host').count())errors.push(size.name+' member search did not filter');
         await search.fill('');
       }
      }
     }
     await page.screenshot({path:path.join(output,size.name+'-'+item.id+'.png'),fullPage:false});
    }catch(e){errors.push(size.name+' '+item.id+': '+(e?.message||e));}
   }
   await context.close();
  }
 }finally{await browser.close();}
 if(errors.length){console.error(errors.join('\n'));process.exitCode=1;}
 else console.log('PKR public/PWA and synthetic-authenticated viewport checks passed for '+sizes.length+' device sizes.');
}
test().catch(e=>{console.error(e);process.exitCode=1});
