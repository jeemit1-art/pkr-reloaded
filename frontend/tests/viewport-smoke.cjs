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
const archivedRoom={id:'synthetic-ended-room',name:'Synthetic Closed Room',description:'Archived test room',status:'ended',role:'host',host_id:'test-user',member_count:1,game_count:1,buy_in:2500,created_at:past-9000};
const upcoming={id:'test-game',event_id:room.id,scheduled_at:future,status:'scheduled',location:'Test room',notes:'',seats:8,created_at:past,player_count:2,results_token:null,live_token:null};
const finished={...upcoming,id:'test-finished',status:'settled',scheduled_at:past,player_count:4,results_token:'synthetic-results'};
const oldUnfinished={...upcoming,id:'test-old-unfinished',status:'active',scheduled_at:past-90*86400,created_at:past-90*86400,player_count:0};
const syntheticMemberAvatar='data:image/svg+xml;charset=utf-8,'+encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64"><rect width="64" height="64" fill="#214b37"/><circle cx="32" cy="25" r="13" fill="#e9c783"/><path d="M10 64c0-30 44-30 44 0" fill="#e9c783"/></svg>');
const members=[{id:'test-user',name:'Test Host',role:'host',email:'test@invalid.example',avatar_url:syntheticMemberAvatar,joined_at:past},{id:'member-2',name:'Demo Player',role:'member',email:'demo@invalid.example',avatar_url:null,joined_at:past}];
const leaders=[{user_id:'test-user',display_name:'Test Host',games_played:1,games_won:1,total_net:7500,biggest_win:7500,biggest_loss:0,last_played:past},{user_id:'member-2',display_name:'Demo Player',games_played:1,games_won:0,total_net:-7500,biggest_win:0,biggest_loss:-7500,last_played:past},...Array.from({length:12},(_,i)=>({user_id:'synthetic-'+(i+3),display_name:'Guest '+String(i+3).padStart(2,'0'),games_played:2,games_won:0,total_net:-9000-i*500,biggest_win:0,biggest_loss:-9000-i*500,last_played:past}))];
const results={game:finished,event:{name:room.name},players:[],transfers:[{id:'synthetic-transfer',from:'member-2',from_name:'Demo Player',to:'test-user',to_name:'Test Host',amount:7500,status:'owed'}]};
const user={id:'test-user',name:'Test Host',email:'test@invalid.example',avatar_url:null,plan:'pro',trial_active:false,trial_days_left:0};
const fixture=(pathname,method)=>{
  if(method==='OPTIONS')return {};
  if(pathname==='/auth/me')return user;
  if(pathname==='/events')return [room,archivedRoom];
  if(pathname==='/events/'+archivedRoom.id+'/reopen'&&method==='POST')return {ok:true};
  if(pathname==='/events/'+room.id)return {...room,members};
  if(pathname==='/events/'+room.id+'/games')return [upcoming,finished,oldUnfinished];
  if(pathname==='/events/'+room.id+'/leaderboard')return leaders;
  if(pathname==='/events/'+room.id+'/history')return [{
    ...finished,top_players:[
      {display_name:'Test Host',net:7500},
      {display_name:'Demo Player',net:-7500},
    ],
  }];
  if(pathname==='/events/'+room.id+'/join-requests')return {requests:[]};
  if(pathname==='/events/'+room.id+'/push-registrations')return {
    members:[{user_id:'test-user',device_count:2},{user_id:'member-2',device_count:0}],
    definition:'registered_devices_not_delivery_confirmation'
  };
  if(pathname==='/events/'+room.id+'/phone-contacts')return {contacts:[]};
  if(pathname==='/games/'+upcoming.id)return {...upcoming,players:[],rsvps:[]};
  if(pathname==='/games/'+finished.id)return {...finished,players:[],rsvps:[]};
  if(pathname==='/games/results/synthetic-results')return results;
  if(pathname==='/games/test-finished/transfers/synthetic-transfer/status'&&method==='PUT')return {ok:true,status:'paid'};
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
   // Check the public landing page before adding the synthetic logged-in token.
    const guestContext=await browser.newContext({viewport:{width:size.width,height:size.height},deviceScaleFactor:1});
    const guestPage=await guestContext.newPage();
    try{
      await guestPage.goto(BASE+'/',{waitUntil:'domcontentloaded',timeout:40000});
      await guestPage.locator('.pkr-l2-hero').waitFor({state:'visible',timeout:25000});
      await guestPage.locator('.pkr-l2-hero-art').evaluate(async image=>{
        if(image instanceof HTMLImageElement && !image.complete){
          await new Promise(resolve=>{
            image.addEventListener('load',resolve,{once:true});
            image.addEventListener('error',resolve,{once:true});
          });
        }
      });
      const landing=await guestPage.evaluate(()=>{
        const hero=document.querySelector('.pkr-l2-hero-art');
        return {
          scrollWidth:document.documentElement.scrollWidth,
          viewportWidth:document.documentElement.clientWidth,
          imageReady:hero instanceof HTMLImageElement&&hero.complete&&hero.naturalWidth>0,
        };
      });
      if(landing.scrollWidth>landing.viewportWidth+5)
        errors.push(size.name+' landing horizontal overflow '+landing.scrollWidth+' > '+landing.viewportWidth);
      if(!landing.imageReady)errors.push(size.name+' landing hero illustration failed to load');
      if(await guestPage.locator('.pkr-l2-feature-card').count()!==3)
        errors.push(size.name+' landing visual feature cards missing');
      await guestPage.getByRole('button',{name:/Host sign in/i}).first().click();
      await guestPage.getByRole('dialog',{name:'Host sign in'}).waitFor({state:'visible'});
      await guestPage.keyboard.press('Escape');
      if(await guestPage.getByRole('dialog',{name:'Host sign in'}).count())
        errors.push(size.name+' landing host sign-in dialog did not close');
      await guestPage.screenshot({path:path.join(output,size.name+'-landing-v2.png'),fullPage:false});
      if(size.name==='phone'||size.name==='desktop'){
        for(const route of ['/pricing','/home-poker-game-tracker','/poker-tournament-manager','/home-poker-settlement']){
          await guestPage.goto(BASE+route,{waitUntil:'domcontentloaded',timeout:40000});
          await guestPage.locator('.pkr-marketing-hero h1').waitFor({state:'visible',timeout:25000});
          const measured=await guestPage.evaluate(()=>({
            width:document.documentElement.scrollWidth,
            viewport:document.documentElement.clientWidth,
            canonical:document.querySelector('link[rel=canonical]')?.getAttribute('href')||''
          }));
          if(measured.width>measured.viewport+5)errors.push(size.name+' marketing '+route+' horizontal overflow');
          if(!measured.canonical.endsWith(route))errors.push(size.name+' marketing '+route+' canonical missing');
        }
        await guestPage.goto(BASE+'/pricing',{waitUntil:'domcontentloaded'});
        await guestPage.getByRole('link',{name:/Choose Starter/i}).click();
        await guestPage.getByRole('dialog',{name:'Host sign in'}).waitFor({state:'visible',timeout:5000});
        if(!(await guestPage.getByRole('dialog',{name:'Host sign in'}).textContent())?.includes('Starter'))
          errors.push(size.name+' Starter selection not preserved through marketing sign-in');
      }
      if(size.name==='desktop'){
        const map=await guestPage.request.get(BASE+'/sitemap.xml');
        if(!map.ok()||!(await map.text()).includes('/poker-tournament-manager'))
          errors.push('Public marketing sitemap missing tournament manager');
        const robots=await guestPage.request.get(BASE+'/robots.txt');
        if(!robots.ok()||!(await robots.text()).includes('Sitemap:'))
          errors.push('robots.txt missing sitemap declaration');
      }
    }catch(e){errors.push(size.name+' landing: '+(e?.message||e));}
    finally{await guestContext.close();}

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
     if(item.id==='game-detail'){
       const summary=await page.locator('.pkr-casino-game-summary').evaluate(el=>{
         const s=getComputedStyle(el),r=el.getBoundingClientRect();
         return {height:r.height,image:s.backgroundImage};
       });
       const imageName='pkr-approved-hero-'+(size.width<=700?'mobile':'desktop')+'.webp';
       if(summary.height<245||!summary.image.includes(imageName))
         errors.push(size.name+' game detail hero not matching approved banner: '+JSON.stringify(summary));
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
     if(item.id==='dashboard'){
       const hostPhoto=page.locator('.pkr-pro-member').filter({hasText:'Test Host'}).locator('.pkr-pro-member-avatar img');
       const fallback=page.locator('.pkr-pro-member').filter({hasText:'Demo Player'}).locator('.pkr-pro-member-avatar');
       if(await hostPhoto.count()!==1)errors.push(size.name+' dashboard not displaying member avatar_url');
       else {
         const details=await hostPhoto.evaluate(img=>({src:img.getAttribute('src'),fit:getComputedStyle(img).objectFit,position:getComputedStyle(img).position}));
         if(!details.src?.startsWith('data:image/svg+xml')||details.fit!=='cover'||details.position!=='absolute')
           errors.push(size.name+' dashboard member portrait is not properly displayed: '+JSON.stringify(details));
       }
       if(await fallback.count()!==1 || (await fallback.textContent())?.trim()!=='D'||await fallback.locator('img').count())
         errors.push(size.name+' dashboard member without a photo did not retain initials');
     }
     if(item.id==='dashboard'){
       const archivedToggle=page.getByRole('button',{name:'Show archived rooms (1)'});
       const archivedCard=page.locator('#pkr-archived-rooms .pkr-room-archived');
       if(await page.locator('#pkr-active-rooms .pkr-room-card').count()!==1)
         errors.push(size.name+' ended room appeared in the active list');
       if(await page.locator('#pkr-archived-rooms').count()!==0)
         errors.push(size.name+' archived section visible before opening');
       if(!await archivedToggle.isVisible())
         errors.push(size.name+' archived rooms toggle missing');
       else{
         await archivedToggle.click();
         if(await archivedCard.count()!==1 || !(await archivedCard.textContent())?.includes('Synthetic Closed Room'))
           errors.push(size.name+' archived room not available after expanding');
         if(size.width>=1100){
           // Reopening uses a mocked, host-authorised Worker route; no real D1 updates.
           await page.getByRole('button',{name:'Reopen poker room Synthetic Closed Room'}).click();
           await page.waitForTimeout(180);
           if(await page.locator('#pkr-active-rooms .pkr-room-card').count()!==2 ||
              await page.locator('#pkr-archived-rooms').count()!==0)
             errors.push(size.name+' reopened room did not return to active list');
         }else{
           await page.getByRole('button',{name:'Hide archived rooms'}).click();
           if(await page.locator('#pkr-archived-rooms').count()!==0 ||
              await page.locator('#pkr-active-rooms .pkr-room-card').count()!==1)
             errors.push(size.name+' hiding archived rooms changed active list');
         }
       }
     }
     if(item.id==='dashboard'&&size.width<=700){
       const feature=page.locator('.pkr-mobile-featured');
       if(await feature.count() && !(await feature.isVisible()))errors.push(size.name+' mobile next-game feature hidden');
     }
     if(item.id==='insights'){
       await page.locator('#pkr-insights-room').waitFor({state:'visible'});
       await page.locator('.pkr-insights-settle-tabs').waitFor({state:'visible'});
       if(await page.locator('.pkr-insights-kpis .pkr-insights-kpi').count()!==5)errors.push(size.name+' insights KPI count mismatch');
        // Regression: both sections must show ALL 14 synthetic players, not the first 8/10.
        await page.locator('.pkr-vnext-performance-row').first().waitFor({state:'visible',timeout:10000});
        if(await page.locator('.pkr-vnext-performance-row').count()!==leaders.length)
          errors.push(size.name+' net results truncated to fewer than '+leaders.length+' players');
        if(size.width<=700){
          if(await page.locator('.pkr-insights-player-mobile-row').count()!==leaders.length)
            errors.push(size.name+' mobile player performance truncated to fewer than '+leaders.length+' players');
          const first=page.locator('.pkr-insights-player-mobile-row').first();
          if(!await first.isVisible())errors.push(size.name+' mobile player performance invisible');
        }else{
          if(await page.locator('.pkr-insights-players tbody tr').count()!==leaders.length)
            errors.push(size.name+' desktop player performance truncated to fewer than '+leaders.length+' players');
        }
       await page.getByRole('tab',{name:'Player Balances'}).click();
       if(!await page.getByRole('tab',{name:'Player Balances'}).getAttribute('aria-selected').then(v=>v==='true'))errors.push(size.name+' settlement balances tab did not activate');
       await page.getByRole('tab',{name:'Who Pays Who'}).click();
       const settlement=page.locator('#pkr-settlement');
       if(!await settlement.isVisible())errors.push(size.name+' settlement centre disappeared');
       const paymentSelect=page.locator('.pkr-payment-status-select').first();
       if(await paymentSelect.count()){
         page.once('dialog',dialog=>dialog.accept());
         await paymentSelect.selectOption('paid');
         await page.waitForTimeout(120);
         if(await paymentSelect.inputValue()!=='paid')errors.push(size.name+' payment status did not update to paid');
         if(!await settlement.getByText('Payment status updated to Paid.').count())errors.push(size.name+' payment update confirmation missing');
       }else errors.push(size.name+' host cannot select payment status in Insights');
       if(size.width>=1100){
         const nav=page.locator('.pkr-persistent-nav button');
         const settle=nav.getByText('Settle',{exact:true});
         if(await settle.count()){
           await settle.click();
           await page.waitForTimeout(180);
           const active=page.locator('.pkr-persistent-nav button.active');
           if(await active.count()!==1||!(await active.first().textContent())?.includes('Settle'))
             errors.push(size.name+' Insights and Settle are highlighted together');
         }
       }
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
       if(size.width<=700){
         const clipped=await page.locator('#gameScreen .seat-label').evaluateAll(nodes=>
           nodes.filter(node=>{const r=node.getBoundingClientRect();return r.left<-1||r.right>innerWidth+1;}).length
         );
         if(clipped)errors.push(size.name+' '+clipped+' live game seat labels clipped outside viewport');
       }
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
     if(item.id==='schedule'){
       const liveCount=await page.locator('.pkr-schedule-counts').textContent();
       if(liveCount&&!liveCount.includes('0 live now'))
         errors.push(size.name+' historical unfinished game counted as live');
       await page.getByLabel('Filter by game status').selectOption('unfinished');
       if(!await page.getByText('Unfinished',{exact:true}).count())
         errors.push(size.name+' unfinished game not discoverable via Schedule');
       await page.getByLabel('Filter by game status').selectOption('all');
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
       if(size.width>=1100){
         const nav=page.locator('.pkr-persistent-nav button');
         const active=page.locator('.pkr-persistent-nav button.active');
         if(await active.count()!==1||!(await active.first().textContent())?.includes('Members'))
           errors.push(size.name+' Games and Members highlighted at once');
         await nav.filter({hasText:'Players'}).first().click();
         await page.waitForTimeout(130);
         const playersActive=page.locator('.pkr-persistent-nav button.active');
         if(await playersActive.count()!==1||!(await playersActive.first().textContent())?.includes('Players'))
           errors.push(size.name+' Games and Players highlighted at once');
         await nav.filter({hasText:'Games'}).first().click();
         await page.waitForTimeout(130);
         const gamesActive=page.locator('.pkr-persistent-nav button.active');
         if(await gamesActive.count()!==1||!(await gamesActive.first().textContent())?.includes('Games'))
           errors.push(size.name+' Games is not the sole active menu after return');
         await nav.filter({hasText:'Members'}).first().click();
         await page.waitForTimeout(130);
       }
       const registration=page.getByLabel('Member notification registrations');
       await registration.waitFor({state:'visible',timeout:5000});
       if(!await registration.getByText('1 of 2 members have a registered notification device').count())
         errors.push(size.name+' host notification summary did not show synthetic registration count');
       const badges=page.locator('.pkr-member-push-state');
       if(await badges.count()!==2 || !await badges.first().getByText('Registered on 2 devices').count()
          || !await badges.last().getByText('Notifications not enabled on this member’s device').count())
         errors.push(size.name+' registered/unregistered member badges were not rendered');
       await registration.getByRole('button',{name:'↻ Refresh'}).click();
       await registration.getByText('1 of 2 members have a registered notification device').waitFor({state:'visible',timeout:5000});
       const search=page.locator('#pkr-member-search');
       if(await search.count()){
         await search.fill('Demo');
         const roster=page.locator('.pkr-member-roster');
         if(!await roster.getByText('Demo Player').isVisible())errors.push(size.name+' filtered member missing');
         if(await roster.getByText('Test Host').count())errors.push(size.name+' member search did not filter');
         await search.fill('');
       }
      }
      await page.locator('.pkr-event-tabs .tab').filter({hasText:'Standings'}).click();
      await page.locator('.pkr-standings-board').waitFor({state:'visible',timeout:5000});
      if(await page.locator('.pkr-standings-row').count()!==leaders.length)
        errors.push(size.name+' Standings did not show every synthetic player');
      const playerSearch=page.getByLabel('Search standings by player name');
      await playerSearch.fill('Demo');
      if(await page.locator('.pkr-standings-row').count()!==1)
        errors.push(size.name+' Standings search did not filter players');
      await playerSearch.fill('');
      await page.getByLabel('Sort player standings').selectOption('average');
      // Regression: player buttons must OPEN the profile, not just set internal state.
      await page.locator('.pkr-standings-row').first().click();
      const profile=page.getByRole('dialog',{name:/Player history for/});
      await profile.waitFor({state:'visible',timeout:5000});
      if(!await profile.getByText('Test Host',{exact:true}).count())
        errors.push(size.name+' Standings player profile shows the wrong player');
      if(!await profile.getByText('Settled games',{exact:true}).count())
        errors.push(size.name+' Standings player profile missing settled-game statistics');
      await page.screenshot({path:path.join(output,size.name+'-player-history.png'),fullPage:false});
      await profile.getByRole('button',{name:'Close player history'}).click();
      await profile.waitFor({state:'hidden',timeout:5000});
      await page.locator('.pkr-standings-podium-card').first().click();
      await profile.waitFor({state:'visible',timeout:5000});
      await page.keyboard.press('Escape');
      await profile.waitFor({state:'hidden',timeout:5000});
      await page.screenshot({path:path.join(output,size.name+'-standings.png'),fullPage:false});
     }
     // Interactions may scroll the page: capture consistently at its top.
     if(item.id!=='live-table')await page.evaluate(()=>window.scrollTo({top:0,behavior:'instant'}));
     if(size.width>=1100&&['dashboard','insights','schedule','room','game-detail','install'].includes(item.id)){
       const number=await page.locator('.pkr-persistent-nav button.active').count();
       if(number!==1)errors.push(size.name+' '+item.id+' has '+number+' selected sidebar items');
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
