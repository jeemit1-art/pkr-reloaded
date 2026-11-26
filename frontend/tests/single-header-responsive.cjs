'use strict';
// Browser-only visual regression for the single responsive PKR header.
// All user, room, games and payment data is fictional and Worker API calls
// are intercepted: this script never contacts production or staging D1.
const {chromium,webkit}=require('playwright');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const BASE='http://127.0.0.1:3000';
const API='https://pkr-reloaded-worker-staging.jeemit1.workers.dev';
const output=path.resolve(__dirname,'../../artifacts/single-header-responsive');
fs.mkdirSync(output,{recursive:true});
const now=Math.floor(Date.now()/1000);
const room={id:'synthetic-room',name:'Friday Night Poker With A Very Long Club Name',
  description:'Private synthetic club',status:'active',role:'member',host_id:'synthetic-host',
  member_count:5,game_count:1,buy_in:2500,created_at:now-90000};
const game={id:'synthetic-game',event_id:room.id,status:'scheduled',seats:9,
  scheduled_at:now+86400,location:'Fictional club',notes:'',
  created_at:now-86400,player_count:5,results_token:null,live_token:null};
const user={id:'synthetic-member',name:'Example Player',email:'player@example.invalid',
  avatar_url:null,plan:'lifetime',is_active:true,trial_active:false,trial_days_left:0,
  free_game_available:false,free_game_in_progress:false};
// Only the extended installed case needs a scrollable records dialog. These
// balanced, fictional games exercise the real record loader without API writes.
const completed=Array.from({length:12},(_,index)=>({...game,id:'synthetic-finished-'+index,
  status:'settled',scheduled_at:now-(index+1)*86400,buy_in:2500,player_count:1}));
const leaders=[{user_id:user.id,display_name:user.name,games_played:completed.length,
  games_won:0,total_net:0,biggest_win:0,biggest_loss:0,last_played:completed[0].scheduled_at}];
const fixtures=(u,method,withRecords=false)=>{
 const p=u.pathname;
 if(method==='OPTIONS')return {};
 if(method==='POST'&&p==='/auth/device-session/start')return {refresh_token:'a'.repeat(64),expires_in:3888000};
 if(method!=='GET')return {error:'Unexpected synthetic API mutation: '+method+' '+p};
 if(p==='/auth/me')return user;
 if(p==='/events')return [room];
 if(p==='/events/'+room.id)return {...room,members:[]};
 if(p==='/events/'+room.id+'/dashboard-layout')return {event_id:room.id,layout:'command',updated_at:null};
 if(p==='/events/'+room.id+'/games')return withRecords?[game,...completed]:[game];
 if(p==='/events/'+room.id+'/leaderboard')return withRecords?leaders:[];
 if(p==='/events/'+room.id+'/history')return withRecords?completed:[];
 if(p==='/events/'+room.id+'/settlement-ledger')return {games:[],transfers:[]};
 if(p==='/events/'+room.id+'/profiles')return {profiles:[]};
 if(p==='/events/'+room.id+'/players')return [];
 if(p==='/games/'+game.id+'/rsvp-board')return {game,event:room,players:[],guests:[],options:['19:00']};
 const saved=withRecords&&completed.find(item=>p==='/games/'+item.id);
 if(saved)return {...saved,players:[{game_id:saved.id,user_id:user.id,display_name:user.name,
   buy_ins:1,buy_in_total:2500,cashout:2500,net:0,seat_number:1}],rsvps:[],transfers:[]};
 if(p==='/push/vapid-key')return {key:'synthetic-only'};
 return {error:'Unexpected synthetic API: '+method+' '+p};
};
const sizes=[
 {name:'small-phone',width:320,height:700},
 {name:'regular-phone',width:360,height:780},
 {name:'iphone',width:390,height:844},
 {name:'iphone-safe-area',width:390,height:844,safeTop:59,safeBottom:34},
 {name:'large-phone',width:430,height:932},
 {name:'phone-landscape',width:844,height:390},
 {name:'tablet',width:768,height:1024},
 {name:'tablet-landscape',width:1024,height:768},
 {name:'desktop-small',width:1100,height:800},
 {name:'desktop',width:1440,height:900},
];
const installedSizes=[
 {name:'installed-iphone-dark',width:390,height:844,installed:true},
 {name:'installed-iphone-dark-safe-area',width:390,height:844,installed:true,safeTop:59,safeBottom:34},
 {name:'installed-iphone-native-viewport',width:430,height:873,screen:{width:430,height:932},
   installed:true,safeTop:0,safeBottom:34,containedScenario:true},
];
async function setSafeArea(page,size){
 if(size.safeTop!==undefined||size.safeBottom!==undefined)
  await page.addStyleTag({content:'html.pkr-game-night{--pkr-safe-area-top:'+(size.safeTop||0)+'px!important;--pkr-safe-area-bottom:'+(size.safeBottom||0)+'px!important}'});
}
async function stationaryRoot(page,label){
 const state=await page.evaluate(()=>{
  const root=document.documentElement,body=document.body,bounds=body.getBoundingClientRect();
  return {active:root.classList.contains('pkr-contained-scroll'),window:scrollY,
   document:document.scrollingElement?.scrollTop,root:root.scrollTop,body:body.scrollTop,
   position:getComputedStyle(body).position,overflow:getComputedStyle(body).overflowY,
   rootOverflow:getComputedStyle(root).overflowY,
   top:bounds.top,bottom:bounds.bottom,height:innerHeight,rootHeight:root.scrollHeight,
   rootClient:root.clientHeight,bodyHeight:body.clientHeight,bodyContent:body.scrollHeight};
 });
 assert(state.active,label+': installed primary pages must use contained scrolling');
 assert.equal(state.window,0,label+': window must never scroll behind native status chrome');
 assert.equal(state.document,0,label+': the document scroller must stay stationary');
 assert.equal(state.root,0,label+': the root must stay stationary');
 assert.equal(state.position,'fixed',label+': body must be a separate viewport scroller');
 assert(['hidden','clip'].includes(state.rootOverflow),label+': the document viewport must clip its contents');
 assert(Math.abs(state.top)<=1&&Math.abs(state.bottom-state.height)<=1,
  label+': scrolling content must be clipped to the CSS viewport: '+JSON.stringify(state));
 assert(state.rootHeight<=state.rootClient+1,label+': body content must not make the root scrollable: '+JSON.stringify(state));
 return state;
}
async function bodyWheel(page,amount=480){
 const before=await page.evaluate(()=>document.body.scrollTop),viewport=page.viewportSize();
 // The page gutter avoids accidentally scrolling a nested RSVP panel.
 await page.mouse.move(8,viewport.height/2);
 await page.mouse.wheel(0,amount);
 await page.waitForFunction(value=>document.body.scrollTop>value+40,before,{timeout:5000});
 return stationaryRoot(page,'After real wheel input');
}
async function unobscuredAction(locator,label){
 const placement=await locator.evaluate(element=>{
  const r=element.getBoundingClientRect(),header=document.querySelector('.pkr-primary-mobile-utility').getBoundingClientRect();
  const footer=document.querySelector('.pkr-primary-bottom-nav').getBoundingClientRect();
  return {top:r.top,bottom:r.bottom,headerBottom:header.bottom,footerTop:footer.top,
   hit:element.contains(document.elementFromPoint(r.left+r.width/2,r.top+r.height/2))};
 });
 assert(placement.top>=placement.headerBottom-1&&placement.bottom<=placement.footerTop+1&&placement.hit,
  label+' must be reachable between the fixed header and footer: '+JSON.stringify(placement));
}
async function installedNavigation(page,size,returnOffset){
 // Native scrolling into view must expose the final Account action without
 // signing the fictional user out or moving the document behind the status bar.
 const signOut=page.getByRole('button',{name:'Sign out',exact:true});
 await signOut.scrollIntoViewIfNeeded();await signOut.click({trial:true});
 await unobscuredAction(signOut,'The last Account action');
 assert((await stationaryRoot(page,'Account bottom')).body>100);
 await page.screenshot({path:path.join(output,'webkit-'+size.name+'-account-bottom.png')});

 await page.waitForLoadState('networkidle',{timeout:10000});
 await page.goBack();
 await page.getByTestId('player-dashboard').waitFor();
 await page.waitForLoadState('networkidle',{timeout:10000});
 await page.waitForFunction(offset=>Math.abs(document.body.scrollTop-offset)<=3,returnOffset,{timeout:8000});
 await stationaryRoot(page,'Back restoration');
 await page.getByRole('button',{name:'Account, notifications and installation'}).click();
 await page.getByRole('heading',{name:'Account & settings'}).waitFor();
 await page.waitForLoadState('networkidle',{timeout:10000});
 await page.waitForFunction(()=>document.body.scrollTop<=1);
 await page.getByRole('button',{name:'My poker clubs ↗',exact:true}).click();
 await page.getByTestId('player-dashboard').waitFor();
 await page.waitForLoadState('networkidle',{timeout:10000});
 await page.waitForFunction(()=>{
  const anchor=document.getElementById('pkr-rooms'),header=document.querySelector('.pkr-primary-mobile-utility');
  const footer=document.querySelector('.pkr-primary-bottom-nav');if(!anchor||!header||!footer)return false;
  const a=anchor.getBoundingClientRect();return location.hash==='#pkr-rooms'&&
   a.top>=header.getBoundingClientRect().bottom-1&&a.top<footer.getBoundingClientRect().top;
 },null,{timeout:8000});
 assert((await stationaryRoot(page,'Poker rooms hash anchor')).body>0);
 await page.screenshot({path:path.join(output,'webkit-'+size.name+'-rooms-anchor.png')});

 const trigger=page.getByRole('button',{name:'View underlying records: My game history',exact:true});
 await trigger.scrollIntoViewIfNeeded();await trigger.click({trial:true});await trigger.focus();
 await unobscuredAction(trigger,'The originating records metric');
 const beforeModal=await stationaryRoot(page,'Before records dialog');
 await trigger.click();
 const dialog=page.getByRole('dialog',{name:'My game history',exact:true});
 await dialog.locator('.pkr-record-body[aria-busy="false"]').waitFor();
 assert.equal(await dialog.locator('.pkr-record-row').count(),completed.length);
 assert.equal(await dialog.locator('.pkr-record-error').count(),0);
 assert(await dialog.evaluate(element=>element.matches(':modal')&&element.contains(document.activeElement)),
  'Records must enter the native top layer and own keyboard focus');
 assert.equal((await stationaryRoot(page,'Records dialog open')).overflow,'hidden',
  'Opening a dialog must lock the body even in contained-scroll mode');
 const scrollBody=dialog.locator('.pkr-record-body'),bounds=await scrollBody.boundingBox();
 await page.mouse.move(bounds.x+bounds.width/2,bounds.y+bounds.height/2);
 await page.mouse.wheel(0,700);
 await page.waitForFunction(()=>document.querySelector('.pkr-record-body').scrollTop>0);
 assert.equal((await stationaryRoot(page,'Scrolling inside records')).body,beforeModal.body,
  'Scrolling records must not move the underlying page');
 await page.keyboard.press('Tab');
 assert(await dialog.evaluate(element=>element.contains(document.activeElement)),
  'Keyboard focus must stay inside the modal');
 await page.screenshot({path:path.join(output,'webkit-'+size.name+'-records-modal.png')});
 await page.keyboard.press('Escape');await dialog.waitFor({state:'detached'});
 assert(await trigger.evaluate(element=>document.activeElement===element),'Closing records must restore focus to the originating metric');
 const afterModal=await stationaryRoot(page,'After records close');
 assert.equal(afterModal.body,beforeModal.body,'Closing records must preserve the page position');
 assert(['auto','scroll'].includes(afterModal.overflow),'Dialog close must release body scrolling');

 // Crossing the breakpoint transfers the offset, rather than pinning desktop
 // pages or losing the returning installed page position.
 await page.evaluate(()=>document.body.scrollTo({top:240,behavior:'instant'}));
 await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
 await page.setViewportSize({width:1440,height:900});
 await page.waitForFunction(()=>!document.documentElement.classList.contains('pkr-contained-scroll')&&Math.abs(scrollY-240)<=3);
 assert.notEqual(await page.evaluate(()=>getComputedStyle(document.body).position),'fixed');
 await page.setViewportSize({width:size.width,height:size.height});
 await page.waitForFunction(()=>document.documentElement.classList.contains('pkr-contained-scroll')&&Math.abs(document.body.scrollTop-240)<=3);
 await stationaryRoot(page,'Returning to installed mobile width');
}
async function check(engine,size){
 const browser=await engine.launch({headless:true});
 let page=null;
 try{
  const context=await browser.newContext({
    viewport:{width:size.width,height:size.height},deviceScaleFactor:1,
    ...(size.screen?{screen:size.screen}:{}),
    serviceWorkers:'block',
    ...(size.installed?{colorScheme:'dark'}:{}),
    isMobile:engine===webkit&&size.width<=430,
    hasTouch:engine===webkit&&size.width<=430
  });
  await context.addInitScript(({installed})=>{
    localStorage.setItem('pkr_token','synthetic-only-session');
    if(installed)Object.defineProperty(navigator,'standalone',{configurable:true,get:()=>true});
  },{installed:!!size.installed});
  page=await context.newPage();
  page.setDefaultTimeout(22000);
  const problems=[];
  page.on('pageerror',error=>problems.push('JS: '+error.message));
  await page.route('**/*.workers.dev/**',async route=>{
   const url=new URL(route.request().url()),method=route.request().method();
   if(url.origin!==API){problems.push('Unexpected Worker origin');await route.abort();return;}
   const data=fixtures(url,method,!!size.containedScenario),bad=!!data.error;
   if(bad)problems.push(data.error);
   await route.fulfill({status:bad?404:200,contentType:'application/json',
     headers:{'access-control-allow-origin':BASE,'access-control-allow-credentials':'true',
       'access-control-allow-headers':'Content-Type,Authorization',
       'access-control-allow-methods':'GET,POST,PUT,DELETE,OPTIONS'},
     body:JSON.stringify(data)});
  });
  await page.goto(BASE+'/dashboard',{waitUntil:'domcontentloaded'});
  await page.getByTestId('player-dashboard').waitFor({state:'visible'});
  await setSafeArea(page,size);
  assert.equal(await page.locator('meta[name=apple-mobile-web-app-status-bar-style]').getAttribute('content'),'default','Installed app must request an opaque native status bar');
  if(size.installed){
    await page.waitForFunction(()=>document.documentElement.classList.contains('pkr-installed'));
    const canvas=await page.evaluate(async()=>{
      const root=getComputedStyle(document.documentElement),body=getComputedStyle(document.body);
      const manifestLink=document.querySelector('link[rel="manifest"]');
      const manifest=manifestLink?await fetch(manifestLink.href,{cache:'no-store'}).then(response=>response.json()):null;
      return {standalone:navigator.standalone,dark:matchMedia('(prefers-color-scheme: dark)').matches,
        root:root.backgroundColor,body:body.backgroundColor,rootImage:root.backgroundImage,bodyImage:body.backgroundImage,
        colourScheme:root.colorScheme,metaScheme:document.querySelector('meta[name="color-scheme"]')?.content,
        themeColours:Array.from(document.querySelectorAll('meta[name="theme-color"]')).map(meta=>meta.content.toLowerCase()),manifest};
    });
    assert.equal(canvas.standalone,true,'The installed Safari code path must be exercised');
    assert.equal(canvas.dark,true,'The phone must request dark system appearance');
    assert.equal(canvas.root,'rgb(255, 255, 255)','Native status-bar canvas must stay white in an installed dark-mode session');
    assert.equal(canvas.body,'rgb(255, 255, 255)','The body canvas must match the opaque header');
    assert.equal(canvas.rootImage,'none');assert.equal(canvas.bodyImage,'none');
    assert.equal(canvas.colourScheme,'light');assert.equal(canvas.metaScheme,'light');
    assert(canvas.themeColours.length>0&&canvas.themeColours.every(value=>value==='#ffffff'),'Every native theme-colour hint must be white');
    assert.equal(canvas.manifest?.background_color?.toLowerCase(),'#ffffff');
    assert.equal(canvas.manifest?.theme_color?.toLowerCase(),'#ffffff');
    assert.equal(canvas.manifest?.display,'standalone');
    await page.waitForFunction(()=>document.documentElement.classList.contains('pkr-contained-scroll'));
    await stationaryRoot(page,'Installed initial view');
    if(size.screen)assert.deepEqual(await page.evaluate(()=>({width:screen.width,height:screen.height})),size.screen,
      'The installed fixture must keep native screen height distinct from CSS viewport height');
  }else{
    assert.equal(await page.evaluate(()=>document.documentElement.classList.contains('pkr-contained-scroll')),false,
      'Ordinary browser and desktop pages must keep their existing document scrolling');
  }
  // Mobile WebKit includes its native scrollbar in clientWidth, although fixed
  // CSS boxes and hit testing exclude it. Measure the fixed viewport independently
  // of the header, so a narrow header still fails without sampling browser chrome.
  await page.evaluate(()=>{
    const probe=document.createElement('div');
    probe.id='pkr-browser-viewport-probe';probe.setAttribute('aria-hidden','true');
    probe.style.cssText='position:fixed!important;inset:0 0 auto 0!important;width:auto!important;min-width:0!important;max-width:none!important;height:1px!important;margin:0!important;padding:0!important;border:0!important;visibility:hidden!important;pointer-events:none!important';
    document.documentElement.appendChild(probe);
  });
  const geometry=await page.evaluate(()=>{
    const visible=(element)=>!!element&&getComputedStyle(element).display!=='none'&&
      element.getBoundingClientRect().width>0&&element.getBoundingClientRect().height>0;
    const primary=document.querySelector('.pkr-primary-mobile-utility');
    const sidebar=document.querySelector('.pkr-persistent-nav');
    const old=document.querySelector('.pkr-dashboard > .nav.pkr-topbar');
    const content=document.querySelector('.pkr-dashboard > .pkr-content');
    const acc=document.querySelector('.pkr-primary-account');
    const client=document.querySelector('#pkr-browser-viewport-probe').getBoundingClientRect().width;
    const rect=node=>{if(!node)return null;const r=node.getBoundingClientRect();
      return {left:r.left,right:r.right,top:r.top,bottom:r.bottom,width:r.width,height:r.height};};
    return {width:client,clientWidth:document.documentElement.clientWidth,innerWidth,
      visualWidth:visualViewport?.width,scrollWidth:document.documentElement.scrollWidth,
      primaryVisible:visible(primary),primary:rect(primary),position:primary?getComputedStyle(primary).position:'',
      sidebarVisible:visible(sidebar),oldVisible:visible(old),content:rect(content),
      account:rect(acc),bottomVisible:visible(document.querySelector('.pkr-primary-bottom-nav')),
      footer:rect(document.querySelector('.pkr-primary-bottom-nav')),
      clubText:primary?.textContent||'',
    };
  });
  assert(!geometry.oldVisible,'Two dashboard header bars are visible');
  assert(geometry.width>=size.width-3&&geometry.width<=size.width+1,
    'CSS viewport differs from the requested viewport beyond native scrollbar width: '+JSON.stringify(geometry));
  assert(geometry.scrollWidth<=geometry.width+3,'Page overflows horizontally: '+JSON.stringify(geometry));
  let returnOffset=0;
  if(size.width<1100){
    assert(geometry.primaryVisible,'Club/Account header not visible');
    assert(!geometry.sidebarVisible,'Desktop sidebar visible on phone/tablet');
    assert(geometry.bottomVisible,'Bottom primary navigation was removed');
    assert.equal(geometry.position,'fixed');
    assert(geometry.primary.left>=-1&&geometry.primary.right<=geometry.width+1,
      'Header extends beyond viewport');
    assert(geometry.primary.left<=1&&geometry.primary.right>=geometry.width-1,
      'Header must span the full app content width: '+JSON.stringify(geometry));
    assert(geometry.primary.top>=-1&&geometry.primary.top<=2,'Header starts outside safe viewport');
    assert(geometry.account.width>=41&&geometry.account.height>=42,'Account action is too small');
    assert(geometry.content.top>=geometry.primary.bottom-1,
      'Dashboard content starts behind the club header');
    assert(geometry.clubText.includes('Account'),'Account action lost');
    if(size.installed)await bodyWheel(page);
    else await page.evaluate(()=>window.scrollTo({top:480,behavior:'instant'}));
    await page.waitForTimeout(150);
    const scrolled=await page.locator('.pkr-primary-mobile-utility').boundingBox();
    assert(scrolled&&scrolled.y>=-1&&scrolled.y<=2,'Fixed header moved away from the viewport top');
    assert(scrolled.x>=-1&&scrolled.x+scrolled.width<=size.width+2,'Scrolled header clipped');
    // Use the independently measured CSS viewport for the same exact covered
    // edge points in every engine, excluding only the native scrollbar strip.
    await page.waitForFunction(({safeTop})=>{
      const header=document.querySelector('.pkr-primary-mobile-utility');
      if(!header)return false;
      const r=header.getBoundingClientRect(),width=document.querySelector('#pkr-browser-viewport-probe').getBoundingClientRect().width;
      return [1,Math.max(2,safeTop/2),Math.max(2,safeTop-1),r.bottom-2].every(y=>
        [1,width/2,width-1].every(x=>header.contains(document.elementFromPoint(x,y))));
    },{safeTop:size.safeTop||0},{timeout:3000}).catch(()=>{});
    const masks=await page.evaluate(({safeTop,safeBottom})=>{
      const header=document.querySelector('.pkr-primary-mobile-utility');
      const footer=document.querySelector('.pkr-primary-bottom-nav');
      const s=getComputedStyle(header),f=getComputedStyle(footer),r=header.getBoundingClientRect(),width=document.querySelector('#pkr-browser-viewport-probe').getBoundingClientRect().width;
      const inside=(parent,x,y)=>parent.contains(document.elementFromPoint(x,y));
      const misses=[];
      [1,Math.max(2,safeTop/2),Math.max(2,safeTop-1),r.bottom-2].forEach(y=>
        [1,width/2,width-1].forEach(x=>{
          const hit=document.elementFromPoint(x,y);
          if(!header.contains(hit))misses.push({x,y,hit:hit?hit.tagName+'.'+hit.className:null,
            bounds:hit?hit.getBoundingClientRect().toJSON():null});
        }));
      return {height:r.height,paddingTop:parseFloat(s.paddingTop),colour:s.backgroundColor,
        image:s.backgroundImage,opacity:s.opacity,blur:s.backdropFilter,
        cap:getComputedStyle(header,'::before').backgroundColor,
        misses,viewport:{width:innerWidth,clientWidth:document.documentElement.clientWidth,fixedWidth:width,height:innerHeight,scrollY,visualTop:visualViewport?.offsetTop,visualLeft:visualViewport?.offsetLeft,scale:visualViewport?.scale},
        fullWidth:r.left<=1&&r.right>=width-1,
        // Check the top inset itself after scrolling real content beneath it.
        topCovered:[1,Math.max(2,safeTop/2),Math.max(2,safeTop-1),r.bottom-2].every(y=>
          [1,width/2,width-1].every(x=>inside(header,x,y))),
        bottomCovered:inside(footer,width/2,innerHeight-2),
        footerColour:f.backgroundColor,footerPadding:parseFloat(f.paddingBottom),footerPosition:f.position,
        footerTop:footer.getBoundingClientRect().top,footerBottom:footer.getBoundingClientRect().bottom};
    },{safeTop:size.safeTop||0,safeBottom:size.safeBottom||0});
    assert(Math.abs(masks.height-(64+(size.safeTop||0)))<=1,'Safe area must be reserved once: '+JSON.stringify(masks));
    assert(masks.paddingTop>=(size.safeTop||0)+8,'Header controls intrude into status bar');
    assert.equal(masks.colour,'rgb(255, 255, 255)');
    assert.equal(masks.cap,'rgb(255, 255, 255)');
    assert.equal(masks.image,'none');assert.equal(masks.opacity,'1');assert.equal(masks.blur,'none');
    assert(masks.fullWidth,'Scrolled header must cover the entire app content width: '+JSON.stringify(masks));
    await page.screenshot({path:path.join(output,engine.name()+'-'+size.name+'-scrolled.png'),fullPage:false});
    assert(masks.topCovered,'Scrolled content is exposed in the status-bar inset: '+JSON.stringify(masks));
    assert(masks.bottomCovered,'Scrolled content is exposed beneath bottom navigation');
    assert.equal(masks.footerColour,'rgb(255, 255, 255)');
    assert(masks.footerPadding>=(size.safeBottom||0),'Footer lost home-indicator clearance');
    if(size.installed){
      assert.equal(masks.footerPosition,'fixed','Installed footer must remain fixed while the body scrolls');
      assert(Math.abs(masks.footerTop-geometry.footer.top)<=1&&Math.abs(masks.footerBottom-size.height)<=1,
        'Installed footer moved with scrolling content: '+JSON.stringify(masks));
      await stationaryRoot(page,'After fixed header/footer coverage checks');
    }
    if(size.installed)await page.waitForLoadState('networkidle',{timeout:10000});
    else await page.evaluate(()=>window.scrollTo({top:0,behavior:'instant'}));
    returnOffset=size.installed?await page.evaluate(()=>document.body.scrollTop):0;
    await page.getByRole('button',{name:'Account, notifications and installation'}).click();
  }else{
    assert(!geometry.primaryVisible,'Desktop still shows extra mobile header');
    assert(geometry.sidebarVisible,'Desktop sidebar was removed');
    await page.locator('.pkr-primary-sidebar-footer').getByRole('button',{name:'Account and notification settings'}).click();
  }
  await page.getByRole('heading',{name:'Account & settings'}).waitFor({state:'visible'});
  if(size.installed){
    await page.waitForLoadState('networkidle',{timeout:10000});
    await page.waitForFunction(()=>document.body.scrollTop<=1);
    await stationaryRoot(page,'Account navigation');
    const headingTop=await page.getByRole('heading',{name:'Account & settings'}).evaluate(element=>element.getBoundingClientRect().top);
    const headerBottom=await page.locator('.pkr-primary-mobile-utility').evaluate(element=>element.getBoundingClientRect().bottom);
    assert(headingTop>=headerBottom-1,'Account heading must start below the fixed header after navigation');
  }
  await page.getByRole('button',{name:'Sign out',exact:true}).waitFor({state:'visible'});
  // Ensure this is the mocked signed-in account, not a stale PWA/API response.
  assert.equal(await page.evaluate(()=>localStorage.getItem('pkr_token')),
    'synthetic-only-session','The account navigation lost its approved session');
  await page.locator('.pkr-account-plan').waitFor({state:'visible'});
  assert.equal((await page.locator('.pkr-account-plan').innerText()).trim(),
    'Plan: LIFETIME','Account must retain the member plan');
  if(size.containedScenario)await installedNavigation(page,size,returnOffset);
  assert.deepEqual(problems,[]);
  if(size.installed)await page.waitForLoadState('networkidle',{timeout:10000});
  await page.goto(BASE+'/dashboard',{waitUntil:'domcontentloaded'});
  await page.getByTestId('player-dashboard').waitFor({state:'visible'});
  await setSafeArea(page,size);
  await page.screenshot({path:path.join(output,engine.name()+'-'+size.name+'.png'),fullPage:false});
  console.log('PASS '+engine.name()+' '+size.name+' single header, account access and overflow'+
   (size.installed?', stationary root and contained body scrolling':'')+
   (size.containedScenario?', hash/back restoration, last action, dialog focus/lock and resize migration':''));
  await context.close();
 }catch(error){
  if(page&&!page.isClosed()){
   const details=await page.evaluate(()=>({url:location.href,classes:document.documentElement.className,
    window:scrollY,root:document.documentElement.scrollTop,body:document.body.scrollTop,
    rootHeight:document.documentElement.scrollHeight,bodyHeight:document.body.scrollHeight,
    bodyBounds:document.body.getBoundingClientRect().toJSON(),
    activeElement:document.activeElement?.outerHTML.slice(0,300)})).catch(()=>null);
   console.error(engine.name()+' '+size.name+' failure geometry: '+JSON.stringify(details));
   await page.screenshot({path:path.join(output,engine.name()+'-'+size.name+'-failure.png'),fullPage:false}).catch(()=>{});
  }
  throw error;
 }finally{await browser.close();}
}
(async()=>{
  const failures=[];
  const run=async(engine,size)=>{try{await check(engine,size);}catch(error){
    const message=engine.name()+' '+size.name+': '+error.stack;
    failures.push(message);console.error(message);
  }};
  for(const size of sizes)await run(chromium,size);
  for(const size of sizes.filter(s=>['small-phone','iphone','iphone-safe-area','phone-landscape','tablet','desktop'].includes(s.name)))
    await run(webkit,size);
  for(const size of installedSizes)await run(webkit,size);
  assert.deepEqual(failures,[],'Every responsive header must cover its scrolling content');
})().catch(error=>{console.error(error);process.exitCode=1;});
