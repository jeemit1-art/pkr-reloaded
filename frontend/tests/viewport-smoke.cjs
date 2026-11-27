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
const room={id:'test-room',name:'Friday Night Poker',description:'Private game room',status:'active',role:'host',host_id:'test-user',member_count:4,game_count:2,buy_in:5000,created_at:past};
const archivedRoom={id:'synthetic-ended-room',name:'Sunday Social Room',description:'Archived test room',status:'ended',role:'host',host_id:'test-user',member_count:1,game_count:1,buy_in:2500,created_at:past-9000};
const upcoming={id:'test-game',event_id:room.id,scheduled_at:future,status:'scheduled',location:'Private home game',notes:'',seats:8,created_at:past,player_count:2,results_token:null,live_token:null};
const finished={...upcoming,id:'test-finished',status:'settled',scheduled_at:past,player_count:4,results_token:'synthetic-results'};
const oldUnfinished={...upcoming,id:'test-old-unfinished',status:'active',scheduled_at:past-90*86400,created_at:past-90*86400,player_count:0};
const syntheticMemberAvatar='data:image/svg+xml;charset=utf-8,'+encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64"><rect width="64" height="64" fill="#2d292b"/><circle cx="32" cy="25" r="13" fill="#f0a18c"/><path d="M10 64c0-30 44-30 44 0" fill="#f0a18c"/></svg>');
const members=[{id:'test-user',name:'Alex Morgan',role:'host',email:'test@invalid.example',avatar_url:syntheticMemberAvatar,joined_at:past},{id:'member-2',name:'Jordan Lee',role:'member',email:'demo@invalid.example',avatar_url:null,joined_at:past}];
const leaders=[{user_id:'test-user',display_name:'Alex Morgan',games_played:1,games_won:1,total_net:7500,biggest_win:7500,biggest_loss:0,last_played:past},{user_id:'member-2',display_name:'Jordan Lee',games_played:1,games_won:0,total_net:-7500,biggest_win:0,biggest_loss:-7500,last_played:past},...Array.from({length:12},(_,i)=>({user_id:'synthetic-'+(i+3),display_name:['Sam Patel','Taylor Reed','Chris Martin','Riley Chen','Casey Brooks','Morgan Price','Jamie Wilson','Drew Foster','Avery James','Blake Smith','Harper Quinn','Cameron Scott'][i],games_played:2,games_won:0,total_net:-9000-i*500,biggest_win:0,biggest_loss:-9000-i*500,last_played:past}))];
const results={game:finished,event:{name:room.name},players:[],transfers:[{id:'synthetic-transfer',from:'member-2',from_name:'Jordan Lee',to:'test-user',to_name:'Alex Morgan',amount:7500,status:'owed'},{id:'synthetic-owner-paid-historical',from:'historical-payer',from_name:'Historical Player A',to:'historical-recipient',to_name:'Historical Player B',amount:7605900,status:'paid'}]};
const user={id:'test-user',name:'Alex Morgan',email:'test@invalid.example',avatar_url:null,plan:'pro',is_active:true,trial_active:false,trial_days_left:0};
let savedPreviewLayout='command',layoutWrites=0;
const fixture=(pathname,method,body)=>{
  if(pathname==='/events/test-room/dashboard-layout'&&method==='PUT'){
    const input=JSON.parse(body||'{}');
    if(!['command','live'].includes(input.layout)||Object.keys(input).length!==1)
      return {error:'Invalid saved preview choice'};
    savedPreviewLayout=input.layout;layoutWrites++;
    return {event_id:'test-room',layout:savedPreviewLayout,updated_at:future};
  }
  if(pathname==='/auth/device-session/start'&&method==='POST')
    return {refresh_token:'a'.repeat(64),expires_in:45*86400}; // synthetic approved account
  if(method==='OPTIONS')return {};
  if(pathname==='/auth/me')return user;
  if(pathname==='/events')return [room,archivedRoom];
  if(pathname==='/events/'+archivedRoom.id+'/reopen'&&method==='POST')return {ok:true};
  if(pathname==='/events/'+room.id)return {...room,members};
  if(pathname==='/events/'+room.id+'/profiles')return {profiles:[]};
  if(pathname==='/events/'+room.id+'/players')return [];
  if(pathname==='/events/'+room.id+'/games')return [upcoming,finished,oldUnfinished];
  if(pathname==='/events/'+room.id+'/dashboard-layout')return {event_id:room.id,layout:savedPreviewLayout,updated_at:null};
  if(pathname==='/events/'+room.id+'/leaderboard')return leaders;
  if(pathname==='/events/'+room.id+'/history')return [{
    ...finished,top_players:[
      {display_name:'Alex Morgan',net:7500},
      {display_name:'Jordan Lee',net:-7500},
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
  if(pathname==='/games/'+upcoming.id+'/rsvp-board')return {event:room,game:upcoming,players:[],guests:[],options:['19:00','20:00'],
    responses:[{value:'late',label:'Running late',status:'yes'},
      {value:'maybe',label:'May not come',status:'maybe'},
      {value:'not-coming',label:'Out',status:'no'},
      {value:'custom-abc12345',label:'Coming after work',status:'yes'}]};
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
      // The launch page shows real screenshots of the current app, using fictional data.
      await guestPage.locator('.pkr-hero-desktop img').evaluate(async image=>{
        if(image instanceof HTMLImageElement){image.loading='eager';await image.decode().catch(()=>{});}
      });
      const landing=await guestPage.evaluate(()=>{
        const hero=document.querySelector('.pkr-hero-desktop img');
        return {
          scrollWidth:document.documentElement.scrollWidth,
          viewportWidth:document.documentElement.clientWidth,
          imageReady:hero instanceof HTMLImageElement&&hero.complete&&hero.naturalWidth>0,
        };
      });
      if(landing.scrollWidth>landing.viewportWidth+5)
        errors.push(size.name+' landing horizontal overflow '+landing.scrollWidth+' > '+landing.viewportWidth);
      if(!landing.imageReady)errors.push(size.name+' genuine PKR hero screenshot failed to load');
      if(await guestPage.locator('.pkr-l2-hero-art').count())
        errors.push(size.name+' redundant legacy illustrated hero still rendered');
      const closer=await guestPage.locator('.pkr-l2-closing-art').evaluate(async image=>{
        if(!(image instanceof HTMLImageElement))return {ok:false};
        image.loading='eager';await image.decode().catch(()=>{});
        return {ok:image.complete&&image.naturalWidth>500&&getComputedStyle(image).display!=='none',
                src:image.getAttribute('src')};
      });
      if(!closer.ok||closer.src!=='/demo/launch-20261127/desktop-live-table.webp')
        errors.push(size.name+' launch closing lacks the current real poker-table screenshot');
      const landingCTAColour=await guestPage.locator('.pkr-l2-btn-gold').first().evaluate(el=>getComputedStyle(el).backgroundColor);
      if(landingCTAColour!=='rgb(62, 99, 221)')
        errors.push(size.name+' launch CTA does not match Chip Blue: '+landingCTAColour);
      if(await guestPage.locator('.pkr-l2-step').count()!==4)
        errors.push(size.name+' launch planning, invitations, game and records explanation is incomplete');
      const theme=await guestPage.evaluate(()=>{
        const root=getComputedStyle(document.querySelector('.pkr-launch'));
        const price=document.querySelector('.pkr-l2-price');
        const pro=document.querySelector('.pkr-l2-plan-featured');
        return {
          background:root.backgroundColor,
          primary:root.getPropertyValue('--launch-coral').trim(),
          ink:root.getPropertyValue('--launch-ink').trim(),
          priceFont:price?getComputedStyle(price).fontFamily:'',
          priceColor:price?getComputedStyle(price).color:'',
          proBorder:pro?getComputedStyle(pro).borderTopColor:'',
          logo:!!document.querySelector('.pkr-l2-brand-emblem svg[data-pkr-icon=spade]'),
          font:getComputedStyle(document.querySelector('.pkr-l2-hero h1')).fontFamily,
        };
      });
      if(theme.background!=='rgb(244, 241, 234)'||theme.primary.toLowerCase()!=='#3e63dd'||theme.ink.toLowerCase()!=='#1b1f2a')
        errors.push(size.name+' current launch palette mismatch: '+JSON.stringify(theme));
      if(theme.proBorder!=='rgb(62, 99, 221)')
        errors.push(size.name+' Pro pricing card lacks the Chip Club border: '+theme.proBorder);
      if(theme.priceColor!=='rgb(27, 31, 42)'||!theme.priceFont.toLowerCase().includes('plus jakarta sans'))
        errors.push(size.name+' prices must use readable slate numbers in the bundled Inter font: '+JSON.stringify(theme));
      if(!theme.logo)errors.push(size.name+' current vector spade brand is missing');
      if(!theme.font.toLowerCase().includes('plus jakarta sans'))
        errors.push(size.name+' landing headings must use the bundled Inter font: '+theme.font);
      const planText=await guestPage.locator('.pkr-l2-plan-grid').innerText();
      if(!planText.includes('$9.99')||!planText.includes('$19.99'))
        errors.push(size.name+' Theme A must preserve Starter and Pro prices');

      // Marketing must show AUTHENTIC app screenshots, not an illustrated placeholder.
      const actualHero=guestPage.locator('.pkr-hero-desktop img');
      await actualHero.waitFor({state:'visible',timeout:10000});
      await actualHero.evaluate(async img=>{
        if(img instanceof HTMLImageElement)await img.decode().catch(()=>{});
      });
      const actualHeroOk=await actualHero.evaluate(img=>img instanceof HTMLImageElement&&img.complete&&img.naturalWidth>1000);
      if(!actualHeroOk)errors.push(size.name+' real live-table hero screenshot missing');
      if(await guestPage.locator('.pkr-proof-card img').count()!==3)
        errors.push(size.name+' product screenshot proof cards missing');
      if(await guestPage.locator('.pkr-mobile-device img').count()!==3)
        errors.push(size.name+' authentic mobile screenshot gallery missing');
      const tabs=guestPage.getByRole('tablist',{name:'PKR app features'});
      if(await tabs.getByRole('tab').count()!==8)
        errors.push(size.name+' product tour must show all eight current app feature groups');
      await tabs.getByRole('tab',{name:'Payments',exact:true}).click();
      const insightsImage=guestPage.locator('#pkr-tour-panel picture img');
      await insightsImage.waitFor({state:'visible',timeout:10000});
      const selectedImage=await insightsImage.getAttribute('src');
      if(selectedImage!=='/demo/launch-20261127/mobile-payments.webp')
        errors.push(size.name+' interactive product tour did not switch to the current Payments screen');
      await tabs.getByRole('tab',{name:/Live poker table/i}).click();
      if(await guestPage.locator('#pkr-tour-panel picture img').getAttribute('src')!=='/demo/launch-20261127/desktop-live-table.webp')
        errors.push(size.name+' interactive product tour did not switch back to live table');
      await guestPage.getByRole('button',{name:'Enlarge screenshot: Live poker table',exact:true}).click();
      const preview=guestPage.getByRole('dialog',{name:'Live poker table',exact:true});
      await preview.waitFor({state:'visible'});
      const previewImage=preview.locator('.pkr-launch-preview-image img');
      await previewImage.evaluate(async image=>{if(image instanceof HTMLImageElement)await image.decode();});
      if(!(await previewImage.evaluate(image=>image instanceof HTMLImageElement&&image.naturalWidth>0)))
        errors.push(size.name+' enlarged current app screenshot failed to load');
      await preview.getByRole('button',{name:'Close screenshot',exact:true}).click();
      if(await preview.count())errors.push(size.name+' screenshot preview did not close');
      await tabs.getByRole('tab',{name:'Live poker table',exact:true}).focus();
      await guestPage.keyboard.press('End');
      if(await tabs.getByRole('tab',{name:'Your setup',exact:true}).getAttribute('aria-selected')!=='true')
        errors.push(size.name+' app tour End key failed');
      await guestPage.keyboard.press('Home');
      if(await tabs.getByRole('tab',{name:'Home',exact:true}).getAttribute('aria-selected')!=='true')
        errors.push(size.name+' app tour Home key failed');
      const productWidth=await guestPage.evaluate(()=>({scroll:document.documentElement.scrollWidth,viewport:document.documentElement.clientWidth}));
      if(productWidth.scroll>productWidth.viewport+5)
        errors.push(size.name+' product screenshot gallery introduces horizontal overflow');
      if(size.name==='desktop'){
        // Production social artwork is generated as a branded PNG — old gold
        // share imagery must not be advertised in OpenGraph metadata.
        const share=await guestPage.request.get(BASE+'/opengraph-image');
        if(!share.ok()||!(share.headers()['content-type']||'').includes('image/png')||
           (await share.body()).length<5000)
          errors.push('Theme A 1200×630 share artwork unavailable as PNG');
        const social=await guestPage.locator('meta[property="og:image"]').getAttribute('content');
        if(!social?.includes('/opengraph-image'))
          errors.push('Theme A social share metadata still points to legacy gold image');
        for(const name of ['desktop-home','mobile-home','desktop-live-table','mobile-live-table','mobile-rsvp','mobile-tournament','mobile-players','mobile-results','mobile-payments','mobile-records','mobile-account','desktop-command-centre','desktop-live-dashboard']){
          const asset='/demo/launch-20261127/'+name+'.webp';
          const response=await guestPage.request.get(BASE+asset);
          if(!response.ok()||(await response.body()).length<10000)
            errors.push('Real product screenshot not available: '+asset);
        }
      }

      await guestPage.getByRole('button',{name:/Host sign in/i}).first().click();
      await guestPage.getByRole('dialog',{name:'Host sign in'}).waitFor({state:'visible'});
      await guestPage.keyboard.press('Escape');
      if(await guestPage.getByRole('dialog',{name:'Host sign in'}).count())
        errors.push(size.name+' landing host sign-in dialog did not close');
      await guestPage.screenshot({path:path.join(output,size.name+'-landing-v2.png'),fullPage:(size.name==='desktop'||size.name==='phone')});
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
   savedPreviewLayout='command';layoutWrites=0;
   await context.addInitScript(()=>localStorage.setItem('pkr_token','synthetic-viewport-test-only'));
   const page=await context.newPage();
   let delayedResults=null;
   function holdResultsResponse(){
     let release;
     const wait=new Promise(resolve=>{release=resolve;});
     const requested=page.waitForRequest(request=>request.method()==='GET'&&
       new URL(request.url()).pathname==='/events/'+room.id+'/leaderboard',{timeout:12000});
     const gate={wait,requested,release:()=>{if(delayedResults===gate)delayedResults=null;release();}};
     delayedResults=gate;
     return gate;
   }
   page.on('pageerror',e=>errors.push(size.name+' runtime exception: '+(e.stack||e.message)));
   page.on('request',request=>{if(request.url().includes('pkr-reloaded-worker.jeemit1.workers.dev'))errors.push('PRODUCTION API REQUEST BLOCKED: '+request.url());});
   await page.route('**/*.workers.dev/**',async route=>{
    const url=new URL(route.request().url());
    if(url.origin!==API){errors.push('Unexpected Worker origin: '+url.origin);return route.abort();}
    if(delayedResults&&url.pathname==='/events/'+room.id+'/leaderboard'&&route.request().method()==='GET')
      await delayedResults.wait;
    const response=fixture(url.pathname,route.request().method(),route.request().postData());
    const status=response?.error?404:200;
    await route.fulfill({status,contentType:'application/json',headers:{'access-control-allow-origin':BASE,'access-control-allow-credentials':'true','access-control-allow-headers':'Content-Type,Authorization','access-control-allow-methods':'GET,POST,PUT,DELETE,OPTIONS'},body:JSON.stringify(response)});
   });
   for(const item of [{id:'dashboard',url:'/dashboard',ready:'[data-testid="dual-dashboard"]'},{id:'insights',url:'/insights',ready:'.pkr-vnext-insights'},{id:'schedule',url:'/schedule',ready:'.pkr-schedule-page'},{id:'room',url:'/events/test-room',ready:'.pkr-room-games-intro'},{id:'game-detail',url:'/games/test-game',ready:'.pkr-game-detail'},{id:'rsvp',url:'/games/test-game/rsvp',ready:'.pkr-guest'},{id:'live-table',url:'/games/test-game/play',ready:'#gameScreen'},{id:'install',url:'/install?group=test-room',ready:'.pkr-install-vnext'}]){
    try{
     await page.goto(BASE+item.url,{waitUntil:'domcontentloaded',timeout:40000});
     if(item.id==='dashboard'){
       await page.locator('[data-testid="game-night-host-home"]').waitFor({state:'visible'});
       const classicPaint=await page.evaluate(()=>{
         const pick=s=>{const el=document.querySelector(s);return el?getComputedStyle(el):null;};
         return {headline:pick('.pkr-gn-page-head h1>span')?.color||'',
           primary:pick('.pkr-gn-home .pkr-gn-primary')?.backgroundColor||'',
           mobileMark:pick('.pkr-primary-mobile-mark')?.color||'',
           approval:pick('.pkr-approval-alert')?.backgroundColor||''};
       });
       if(classicPaint.headline&&classicPaint.headline!=='rgb(62, 99, 221)')
         errors.push(size.name+' Chip Club Game Night headline wrong: '+JSON.stringify(classicPaint));
       if(classicPaint.primary&&classicPaint.primary!=='rgb(255, 197, 61)')
         errors.push(size.name+' Chip Club Game Night button wrong: '+JSON.stringify(classicPaint));
       if(classicPaint.approval&&classicPaint.approval!=='rgb(227, 233, 255)')
         errors.push(size.name+' Chip Club approval banner wrong: '+JSON.stringify(classicPaint));
       // The host's payment attention card must show its record text and a
       // genuinely usable Review button, not a narrow blue overflow strip.
       const paymentCard=await page.evaluate(()=>{
         const card=document.querySelector('.pkr-gn-attention');
         const details=card?.querySelector('.pkr-gn-attention-record');
         const review=card?.querySelector('button:last-child');
         if(!card||!details||!review)return {present:false};
         const box=el=>{const b=el.getBoundingClientRect();return {left:b.left,right:b.right,width:b.width,top:b.top,bottom:b.bottom};};
         return {present:true,card:box(card),details:box(details),review:box(review),
           detailsBackground:getComputedStyle(details).backgroundColor,
           reviewBackground:getComputedStyle(review).backgroundColor,
           reviewText:review.textContent?.trim()};
       });
       if(!paymentCard.present||paymentCard.detailsBackground!=='rgba(0, 0, 0, 0)'||
          paymentCard.reviewBackground!=='rgb(62, 99, 221)'||
          paymentCard.review.width<80||paymentCard.reviewText!=='Review'||
          paymentCard.details.left<paymentCard.card.left-1||
          paymentCard.review.right>paymentCard.card.right+1||
          paymentCard.details.right>paymentCard.review.left+1&&size.width>500)
         errors.push(size.name+' host payment Review card has clipped/overlapping content: '+JSON.stringify(paymentCard));
       await page.getByRole('group',{name:'Home view'}).getByRole('button',{name:'Full dashboard',exact:true}).click();
     }
     await page.locator(item.ready).waitFor({state:'visible',timeout:25000});
     await page.waitForTimeout(350);
     // One consistent primary navigation: no stacked sticky banners or lost
     // room actions on mobile/tablet; the sidebar owns desktop navigation.
     if(item.id==='dashboard'||item.id==='room'){
       const nav=await page.evaluate(()=>{
         const visible=node=>!!node&&getComputedStyle(node).display!=='none'&&
           node.getBoundingClientRect().height>0;
         const mobile=document.querySelector('.pkr-primary-mobile-utility');
         const legacy=document.querySelector('.pkr-app.pkr-dashboard > .nav.pkr-topbar');
         const roomBar=document.querySelector('.pkr-app.pkr-event > .pkr-topbar');
         return {mobile:visible(mobile),legacy:visible(legacy),roomBar:visible(roomBar),
           sidebar:visible(document.querySelector('.pkr-persistent-nav')),
           roomActions:visible(document.querySelector('.pkr-room-mobile-actions')),
           width:document.documentElement.clientWidth,scroll:document.documentElement.scrollWidth};
       });
       if(nav.scroll>nav.width+4)
         errors.push(size.name+' '+item.id+' primary navigation overflow '+JSON.stringify(nav));
       if(nav.legacy)
         errors.push(size.name+' duplicate dashboard top banner is visible');
       if(size.width<1100){
         if(!nav.mobile||nav.sidebar)
           errors.push(size.name+' '+item.id+' responsive header/sidebar mismatch '+JSON.stringify(nav));
         if(item.id==='room'&&(nav.roomBar||!nav.roomActions))
           errors.push(size.name+' room renders a second top bar or lost quick actions '+JSON.stringify(nav));
         if(item.id==='room'){
           for(const buttonName of ['Share PKR']){
             const action=page.locator('.pkr-room-mobile-actions').getByRole('button',{name:new RegExp(buttonName)});
             if(!await action.isVisible())errors.push(size.name+' room missing '+buttonName+' quick action');
           }
         }
       }else if(nav.mobile||!nav.sidebar)
         errors.push(size.name+' '+item.id+' desktop navigation mismatch '+JSON.stringify(nav));
     }
     // Chip Club visual contract: classic Game Night must not keep the old coral
     // approval action, home primary button or active bottom navigation.
     if(item.id==='dashboard'){
       const paint=await page.evaluate(()=>{
         const alert=document.querySelector('.pkr-approval-alert');
         const primary=alert?.querySelector('.btn-primary');
         const game=document.querySelector('.pkr-gn-home .pkr-gn-primary');
         const selected=document.querySelector('.pkr-primary-bottom-nav button.active');
         const style=el=>el?getComputedStyle(el):null;
         return {
           approvalBackground:style(alert)?.backgroundColor||'',
           approvalButton:style(primary)?.backgroundColor||'',
           gameButton:style(game)?.backgroundColor||'',
           activeNav:style(selected)?.color||'',
         };
       });
       if(paint.approvalBackground&&paint.approvalBackground!=='rgb(227, 233, 255)')
         errors.push(size.name+' old approval palette remained: '+JSON.stringify(paint));
       if(paint.approvalButton&&paint.approvalButton!=='rgb(62, 99, 221)')
         errors.push(size.name+' old approval button colour remained: '+JSON.stringify(paint));
       if(paint.gameButton&&paint.gameButton!=='rgb(255, 197, 61)')
         errors.push(size.name+' old Game Night primary colour remained: '+JSON.stringify(paint));
     }
     // Publish dashboard before mutation tests (which reopen an archived room).
     if(item.id==='dashboard'){
       await page.locator('[data-testid="dual-dashboard"][data-layout="command"]').waitFor();
       await page.waitForFunction(()=>document.documentElement.getAttribute('data-pkr-room-experience')==='command');
       await page.locator('.pkr-dual-switch-actions button[aria-pressed="true"]').first().waitFor();
       await page.locator('.pkr-dual-hero-command').waitFor({state:'visible'});
       await page.locator('.pkr-dual-root .pkr-room-outstanding-total').waitFor({state:'visible'});
       if(await page.locator('.pkr-pro-hero').count())
         errors.push(size.name+' old dashboard hero still rendered');
       await page.screenshot({path:path.join(output,size.name+'-dashboard-command.png'),fullPage:false});
       // Approval contract: visual hierarchy matches the supplied dual-dashboard prototype.
       // These are computed-style assertions, not just existence/overflow checks.
       const visualContract=await page.evaluate(()=>{
         const payment=document.querySelector('.pkr-dual-command .pkr-room-outstanding');
         const hero=document.querySelector('.pkr-dual-hero-command');
         const oldTopbar=document.querySelector('.pkr-app.pkr-dashboard > .pkr-topbar');
         const brand=document.querySelector('.pkr-dual-brand-copy strong');
         return {
           brandVisible:brand instanceof HTMLElement&&brand.getBoundingClientRect().width>20,
           oldTopbarHidden:!oldTopbar||getComputedStyle(oldTopbar).display==='none',
           paymentBackground:payment?getComputedStyle(payment).backgroundColor:'',
           paymentText:payment?getComputedStyle(payment).color:'',
           heroArtwork:hero?getComputedStyle(hero,'::before').backgroundImage:'',
           heroSurface:hero?getComputedStyle(hero).backgroundColor:'',
           heroGradient:hero?getComputedStyle(hero).backgroundImage:'',
           heroHeading:hero?.querySelector('h3')?getComputedStyle(hero.querySelector('h3')).color:'',
           heroOverlays:hero?['::before','::after'].map(p=>{const s=getComputedStyle(hero,p);return {content:s.content,display:s.display,background:s.backgroundImage};}):[],
           accountVisible:!!document.querySelector('.pkr-dual-account-trigger'),
         };
       });
       if(!visualContract.brandVisible||!visualContract.oldTopbarHidden||!visualContract.accountVisible)
         errors.push(size.name+' mockup header/branding contract failed '+JSON.stringify(visualContract));
       if(visualContract.paymentBackground!=='rgb(255, 255, 255)')
         errors.push(size.name+' full dashboard payment card retained the previous dark palette: '+JSON.stringify(visualContract));
       // The Lounge redesign deliberately retires the pale photographic wash.
       // Verify the actual saturated surface, white heading and absence of
       // overlay pseudo-elements, rather than simply removing visual coverage.
       if(visualContract.heroSurface!=='rgb(19, 44, 83)'||
          !visualContract.heroGradient.includes('radial-gradient')||
          !visualContract.heroGradient.includes('54, 91, 157')||
          visualContract.heroHeading!=='rgb(240, 246, 255)'||
          visualContract.heroArtwork!=='none'||visualContract.heroOverlays.length!==2||
          !visualContract.heroOverlays.every(p=>p.content==='none'&&p.display==='none'&&p.background==='none'))
         errors.push(size.name+' Lounge dashboard hero visual contract failed: '+JSON.stringify(visualContract));

       // Host switches between BOTH approved variants on every viewport.
       const toggle=page.getByRole('button',{name:/Live Poker/});
       if(!await toggle.isVisible())errors.push(size.name+' host layout chooser missing');
       else {
         await toggle.click();
         await page.locator('[data-testid="dual-dashboard"][data-layout="live"]').waitFor();
         await page.waitForFunction(()=>document.documentElement.getAttribute('data-pkr-room-experience')==='live');
         if(size.name==='small-phone'||size.name==='desktop'){
           await page.goto(BASE+'/results?room=test-room',{waitUntil:'domcontentloaded'});
           await page.locator('[data-testid="live-results-stage"]').waitFor({state:'visible'});
           await page.waitForFunction(()=>document.documentElement.getAttribute('data-pkr-room-experience')==='live');
           await page.locator('.pkr-results-live-player').first().waitFor({state:'visible',timeout:15000});
           if(await page.locator('.pkr-results-live-player').count()!==leaders.length)
             errors.push(size.name+' Live Poker lost ranked players');
           if(await page.locator('.pkr-results-ledger-row').count()!==0)
             errors.push(size.name+' Live Poker is still rendering the Command Centre ledger');
           if(!await page.locator('.pkr-results-live-table').isVisible())
             errors.push(size.name+' Live Poker top player felt is missing');
           const livePaint=await page.locator('[data-testid="live-results-stage"]').evaluate(node=>{
             const title=getComputedStyle(node.querySelector('h1')),paint=getComputedStyle(node);
             return {surface:paint.backgroundColor,ink:title.color,weight:Number(title.fontWeight),font:title.fontFamily};
           });
           if(livePaint.surface!=='rgb(13, 89, 71)'||livePaint.ink!=='rgb(255, 255, 255)'||livePaint.weight<780||!livePaint.font.toLowerCase().includes('plus jakarta sans'))
             errors.push(size.name+' Live Results needs a strong emerald hero with bold white heading: '+JSON.stringify(livePaint));
           await page.getByRole('navigation',{name:'Results sections'}).getByRole('button',{name:'History'}).click();
           await page.locator('.pkr-results-history-card').first().waitFor({state:'visible'});
           if(!await page.locator('.pkr-results-history-view .pkr-results-section-head').isVisible())
             errors.push(size.name+' Live Poker History lost shared section heading');
           if(!await page.locator('.pkr-results-history-marker').first().isVisible())
             errors.push(size.name+' Live Poker History lost poker-themed session marker');
           await page.screenshot({path:path.join(output,size.name+'-results-live-history.png'),fullPage:false});
           await page.getByRole('navigation',{name:'Results sections'}).getByRole('button',{name:'Insights'}).click();
           await page.locator('.pkr-results-net-row').first().waitFor({state:'visible'});
           if(!await page.locator('.pkr-results-insights-layout').isVisible()||
             await page.locator('.pkr-results-insight-kpi').count()!==3)
             errors.push(size.name+' Live Poker Insights is missing redesigned analytics cards');
           await page.screenshot({path:path.join(output,size.name+'-results-live-insights.png'),fullPage:false});
           await page.getByRole('navigation',{name:'Results sections'}).getByRole('button',{name:'Standings'}).click();
           await page.locator('.pkr-results-live-player').first().waitFor({state:'visible'});
           const photo=await page.locator('[data-testid="live-results-stage"]').evaluate(node=>
             getComputedStyle(node).backgroundImage);
           if(!photo.includes('linear-gradient')&&!photo.includes('radial-gradient'))
             errors.push(size.name+' Live Poker artwork not applied to Results page');
            await page.screenshot({path:path.join(output,size.name+'-results-live-first-screen.png'),fullPage:false});
            await page.screenshot({path:path.join(output,size.name+'-results-live.png'),fullPage:true});
           await page.goto(BASE+'/dashboard',{waitUntil:'domcontentloaded'});
           await page.locator('[data-testid="dual-dashboard"][data-layout="live"]').waitFor();
         }
         const liveSeatCount=await page.locator('.pkr-dual-felt-stage .pkr-dual-table-seat').count();
         if(liveSeatCount!==8) errors.push(size.name+' approved perimeter seating count '+liveSeatCount+' !== 8');
         if(!await page.locator('.pkr-dual-stage-note').isVisible())
           errors.push(size.name+' missing read-only pot/chip-stack disclaimer');
         if(!await page.locator('.pkr-dual-table-panel').isVisible())
           errors.push(size.name+' live table preview missing');
         const geometry=await page.evaluate(()=>({
           scroll:document.documentElement.scrollWidth,
           width:document.documentElement.clientWidth,
           controls:[...document.querySelectorAll('.pkr-dual-switch-actions button')].map(b=>{
             const r=b.getBoundingClientRect();return {left:r.left,right:r.right,w:r.width}
           })
         }));
         if(geometry.scroll>geometry.width+5)
           errors.push(size.name+' live dashboard horizontal overflow '+JSON.stringify(geometry));
         if(geometry.controls.some(q=>q.w<70||q.left<0||q.right>geometry.width+1))
           errors.push(size.name+' live dashboard switch controls clipped '+JSON.stringify(geometry));
         await page.screenshot({path:path.join(output,size.name+'-dashboard-live.png'),fullPage:false});
         await page.getByRole('button',{name:/Command Centre/}).click();
         await page.locator('[data-testid="dual-dashboard"][data-layout="command"]').waitFor();
         await page.waitForFunction(()=>document.documentElement.getAttribute('data-pkr-room-experience')==='command');
         if(layoutWrites!==2)errors.push(size.name+' layout toggle should save exactly two preferences');
       }
     }

     if(item.id==='dashboard' && size.width<=700){
      // On iPhones, the fixed nav must never cover a confirmation dialog.
      const open=page.getByRole('button',{name:'End poker room Friday Night Poker'});
      if(await open.count()){
       await open.click();
       const modal=page.locator('.pkr-app .modal-overlay').filter({hasText:'End Event?'});
       await modal.waitFor({state:'visible',timeout:6000});
       const geo=await modal.evaluate(root=>{
        const buttons=[...root.querySelectorAll('button')];
        const action=buttons.find(b=>b.textContent?.trim()==='End Event');
        const cancel=buttons.find(b=>b.textContent?.trim()==='Cancel');
        const r=action?.getBoundingClientRect(),c=cancel?.getBoundingClientRect();
        const hit=r?document.elementFromPoint(r.left+r.width/2,r.top+r.height/2):null;
        const nav=document.querySelector('.pkr-universal-bottom-nav');
        return {
         bottom:r?.bottom,top:r?.top,cancelBottom:c?.bottom,viewport:innerHeight,
         actionTopmost:!!action&&!!hit&&(action===hit||action.contains(hit)),
         navVisibility:nav?getComputedStyle(nav).visibility:'none'
        };
       });
       if(!geo.actionTopmost||!Number.isFinite(geo.bottom)||geo.bottom>geo.viewport-5
          ||!Number.isFinite(geo.cancelBottom)||geo.cancelBottom>geo.viewport-5)
        errors.push(size.name+' End Event dialog buttons obstructed: '+JSON.stringify(geo));
       if(geo.navVisibility!=='hidden')
        errors.push(size.name+' mobile bottom nav not inert behind dialog: '+JSON.stringify(geo));
       await page.screenshot({path:path.join(output,size.name+'-end-event-dialog.png'),fullPage:false});
       await modal.getByRole('button',{name:'Cancel'}).click();
       await modal.waitFor({state:'hidden',timeout:5000});
      }
     }

     const x=await page.evaluate(()=>({scroll:document.documentElement.scrollWidth,viewport:document.documentElement.clientWidth}));
     if(x.scroll>x.viewport+5)errors.push(size.name+' '+item.id+' horizontal overflow '+x.scroll+' > '+x.viewport);

     if(item.id==='live-table'){
       // Approved game chrome: six viewport checks without touching real games.
       const visual=await page.evaluate(async()=>{
         const outer=document.querySelector('#gameScreen');
         const head=document.querySelector('.pkr-approved-topbar');
         const bank=document.getElementById('bankBar');
         const dock=document.querySelector('.pkr-approved-game-dock');
         const table=document.getElementById('tableFelt');
         const chips=bank?.querySelector('.bank-icon img');
         if(chips instanceof HTMLImageElement)await chips.decode().catch(()=>{});
         const bounds=el=>{const r=el.getBoundingClientRect();return {left:r.left,right:r.right,top:r.top,bottom:r.bottom,width:r.width,height:r.height}};
         return {
           viewport:innerWidth,height:innerHeight,
           root:outer?bounds(outer):null,head:head?bounds(head):null,
           bank:bank?bounds(bank):null,dock:dock?bounds(dock):null,
           table:table?bounds(table):null,
           chipsLoaded:chips instanceof HTMLImageElement&&chips.complete&&chips.naturalWidth>0,
           theme:getComputedStyle(outer).getPropertyValue('--pkr-chrome-green').trim(),
           title:document.getElementById('topbarTitle')?.textContent,
           footerControls:[...document.querySelectorAll('.pkr-approved-game-dock .game-tab')].map(el=>el.id),
         };
       });
       if(!visual.head||!visual.bank||!visual.dock||!visual.table)
         errors.push(size.name+' missing approved game header/bank/dock/table');
       else{
         for(const [name,rect] of [['header',visual.head],['bank',visual.bank],['dock',visual.dock]]){
           if(rect.left < -1 || rect.right > size.width+1)
             errors.push(size.name+' gameplay '+name+' clipped: '+JSON.stringify(rect));
         }
         if(visual.head.bottom>visual.bank.top+2||visual.bank.bottom>visual.dock.top)
           errors.push(size.name+' gameplay chrome overlaps: '+JSON.stringify(visual));
         if(visual.theme.toLowerCase()!=='#4ade9a')errors.push(size.name+' gameplay chrome Chip Club win accent mismatch: '+visual.theme);
         if(!visual.chipsLoaded)errors.push(size.name+' real poker chips asset not loaded in bank summary');
         if(!visual.footerControls.includes('settleBtn')||!visual.footerControls.includes('endGameBtn'))
           errors.push(size.name+' gameplay settlement/end-game control missing');
       }
       const toolsButton=page.getByRole('button',{name:'Open table controls'});
       await toolsButton.click();
       const toolSheet=page.locator('.pkr-table-tools-dialog');
       await toolSheet.waitFor({state:'visible'});
       if(!await toolSheet.evaluate(el=>el.matches(':modal')))
         errors.push(size.name+' game controls must open in a top-layer dialog');
       if(!await toolSheet.getByRole('button',{name:/Add seat/i}).isVisible())
         errors.push(size.name+' seat controls inaccessible in game tools sheet');
       await toolSheet.getByRole('button',{name:'Close table controls'}).click();
       await toolSheet.waitFor({state:'detached'});
       await page.locator('#bankBar').click();
       if(!await page.locator('#bankPanel').evaluate(el=>el.classList.contains('open')))
         errors.push(size.name+' bank summary did not expand');
       await page.locator('#bankBar').click();
       await page.screenshot({path:path.join(output,size.name+'-approved-live-table.png'),fullPage:false});
     }

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
       const state=await page.evaluate(()=>({
         hasGames:!!document.querySelector('.pkr-room-games-intro'),
         hasDuplicateDashboard:!!document.querySelector('.pkr-event .pkr-dual-root'),
         hasDuplicateTabs:!!document.querySelector('.pkr-event-tabs'),
         width:document.documentElement.clientWidth,scrollWidth:document.documentElement.scrollWidth
       }));
       if(!state.hasGames||state.hasDuplicateDashboard||state.hasDuplicateTabs)
         errors.push(size.name+' room navigation repeats Home: '+JSON.stringify(state));
       if(state.scrollWidth>state.width+6)errors.push(size.name+' room overflow: '+JSON.stringify(state));
     }
     if(item.id==='room'){
       // The redesigned game scheduler must expose the essentials immediately,
       // keep optional controls accessible, and never create a game just by opening.
       const openScheduler=page.getByRole('button',{name:'+ Schedule game',exact:true});
       if(!await openScheduler.isVisible())errors.push(size.name+' room create-game action unavailable');
       else{
         await openScheduler.click();
         const scheduler=page.getByRole('dialog',{name:'Schedule a game'});
         await scheduler.waitFor({state:'visible',timeout:5000});

          if(size.width<=700){
           const geo=await scheduler.evaluate(dialog=>{
            const r=dialog.getBoundingClientRect(),nav=document.querySelector('.pkr-universal-bottom-nav');
            return {top:r.top,bottom:r.bottom,viewport:innerHeight,
             navVisibility:nav?getComputedStyle(nav).visibility:'none',
             dialogOverflow:getComputedStyle(dialog).overflowY};
           });
           if(geo.top < -1 || geo.bottom>geo.viewport+1 || geo.navVisibility!=='hidden'
              ||geo.dialogOverflow!=='auto')
             errors.push(size.name+' scheduler obstructed on phone: '+JSON.stringify(geo));
          }

         const arrivalDetails=scheduler.locator('.pkr-create-game-details').first();
         if(await arrivalDetails.evaluate(node=>node.hasAttribute('open')))
           errors.push(size.name+' optional arrivals expanded before user request');
         await arrivalDetails.locator('summary').click();
         if(await scheduler.getByLabel('RSVP arrival time 1').count()!==1)
           errors.push(size.name+' editable RSVP arrival times missing');
         await scheduler.getByRole('button',{name:'Tournament',exact:true}).click();
         if(await scheduler.getByRole('button',{name:'Tournament',exact:true}).getAttribute('aria-pressed')!=='true')
           errors.push(size.name+' tournament format was not selected');
         await scheduler.getByRole('button',{name:'Close game scheduler'}).click();
         await scheduler.waitFor({state:'hidden',timeout:5000});
       }
     }
     // Verify the actual shared page canvas across the existing viewport matrix.
     const canvasSelectors={dashboard:'.pkr-app.pkr-dashboard',insights:'.pkr-vnext-insights',schedule:'.pkr-schedule-page',room:'.pkr-app.pkr-event','game-detail':'.pkr-app.pkr-game-detail',install:'.pkr-install-vnext'};
     if(canvasSelectors[item.id]){
       await page.locator('.pkr-primary-sidebar').waitFor({state:'attached'});
       const canvas=await page.locator(canvasSelectors[item.id]).first().evaluate(node=>{
         const s=getComputedStyle(node);
         return {colour:s.backgroundColor,image:s.backgroundImage,repeat:s.backgroundRepeat,attachment:s.backgroundAttachment};
       });
       if(canvas.colour!=='rgb(229, 236, 239)'||!canvas.image.includes('212, 229, 224')||
          !canvas.image.includes('214, 224, 239')||!canvas.image.includes('radial-gradient')||
          !canvas.repeat.includes('no-repeat')||!canvas.attachment.includes('scroll'))
         errors.push(size.name+' '+item.id+' shared lounge canvas missing: '+JSON.stringify(canvas));
     }
     if(item.id==='game-detail'){
       const summary=await page.locator('.pkr-casino-game-summary').evaluate(el=>{
         const s=getComputedStyle(el),r=el.getBoundingClientRect();
         const heading=getComputedStyle(el.querySelector('h1,h2,.display')||el);
         return {height:r.height,image:s.backgroundImage,background:s.backgroundColor,colour:heading.color,
           surface:s.getPropertyValue('--pkr-a-surface').trim(),
           font:heading.fontFamily};
       });
       if(summary.height<245||summary.image!=='none'||summary.background!=='rgb(255, 255, 255)'||summary.colour!=='rgb(27, 31, 42)')
         errors.push(size.name+' game detail header must retain its geometry with a white surface, slate heading and no old gradient: '+JSON.stringify(summary));
       // Production CSS may shorten white from #ffffff to the equivalent #fff.
       if(!['#fff','#ffffff'].includes(summary.surface.toLowerCase())||!summary.font.toLowerCase().includes('plus jakarta sans'))
         errors.push(size.name+' game detail header must use Game night surface tokens and Inter: '+JSON.stringify(summary));
     }
     if(item.id==='install'&&size.width>=1100){
       const card=await page.locator('.pkr-install-card').first().boundingBox();
       const sidebar=await page.locator('.pkr-persistent-nav').boundingBox();
       if(card&&sidebar&&card.x<sidebar.x+sidebar.width-1)errors.push(size.name+' install card hidden under sidebar');
     }
     if(['dashboard','insights'].includes(item.id)){
       const heroSelector=item.id==='dashboard'
         ?'.pkr-dual-hero':'.pkr-vnext-insights-top';
       const visual=await page.locator(heroSelector).evaluate(node=>{
         const s=getComputedStyle(node),r=node.getBoundingClientRect();
         return {width:r.width,height:r.height,background:s.backgroundImage,colour:s.backgroundColor,
           art:getComputedStyle(node,'::before').backgroundImage,border:s.borderTopColor,
           heading:node.querySelector('h3')?getComputedStyle(node.querySelector('h3')).color:'',
           overlays:['::before','::after'].map(p=>{const a=getComputedStyle(node,p);return {content:a.content,display:a.display,background:a.backgroundImage};})};
       });
       if(item.id==='insights'){
         if(visual.colour!=='rgb(255, 255, 255)'||visual.background!=='none')
           errors.push(size.name+' Insights header must use the solid light app surface');
         const insightsTheme=await page.locator('.pkr-vnext-insights').evaluate(node=>{
           const card=node.querySelector('.pkr-insights-kpi');
           return {background:getComputedStyle(node).backgroundColor,
             card:card?getComputedStyle(card).backgroundColor:null};
         });
         if(insightsTheme.background!=='rgb(229, 236, 239)'||insightsTheme.card!=='rgb(255, 255, 255)')
           errors.push(size.name+' standalone Insights retains the previous theme: '+JSON.stringify(insightsTheme));
       }else{
         const isCommand=visual.colour==='rgb(19, 44, 83)'&&visual.background.includes('54, 91, 157');
         const isLive=visual.colour==='rgb(11, 89, 70)'&&visual.background.includes('25, 135, 106');
         if((!isCommand&&!isLive)||!visual.background.includes('radial-gradient')||
            visual.heading!=='rgb(240, 246, 255)'||visual.art!=='none'||
            !visual.overlays.every(p=>p.content==='none'&&p.display==='none'&&p.background==='none'))
           errors.push(size.name+' '+item.id+' Lounge saturated hero or heading regressed: '+JSON.stringify(visual));
       }
       if(visual.width<250||visual.height<140)
         errors.push(size.name+' '+item.id+' premium hero too small: '+JSON.stringify(visual));
     }
     if(['dashboard','room'].includes(item.id)){
       const prop=page.locator('.pkr-casino-art-asset .pkr-casino-art-props').first();
       if(await prop.count()){
         const valid=await prop.evaluate(async image=>{
           if(!(image instanceof HTMLImageElement))return false;
           image.loading='eager';await image.decode().catch(()=>{});
           return image.complete&&image.naturalWidth>500&&
             image.getAttribute('src')==='/images/pkr-approved-hero-desktop.webp';
         });
         if(!valid)errors.push(size.name+' '+item.id+' missing recognisable poker chips/cards image');
       }
     }
     if(item.id==='dashboard'){
       const primary=await page.locator('.pkr-dual-hero .pkr-dual-gold-button').first().evaluate(el=>{
         const style=getComputedStyle(el),rect=el.getBoundingClientRect();
         return {image:style.backgroundImage,background:style.backgroundColor,color:style.color,height:rect.height,width:rect.width};
       });
       if(primary.image!=='none'||!['rgb(62, 99, 221)','rgb(47, 75, 184)'].includes(primary.background)||primary.color!=='rgb(255, 255, 255)'||primary.height<44||primary.width<85)
         errors.push(size.name+' full dashboard Chip Blue action is unreadable or too small: '+JSON.stringify(primary));
     }
     if(item.id==='dashboard'){
       const hostPhoto=page.locator('.pkr-dual-leader').filter({hasText:'Alex Morgan'}).locator('.pkr-dual-avatar img');
       const fallback=page.locator('.pkr-dual-leader').filter({hasText:'Jordan Lee'}).locator('.pkr-dual-avatar');
       if(await hostPhoto.count()!==1)errors.push(size.name+' dashboard missing room-member avatar_url');
       else {
         const details=await hostPhoto.evaluate(img=>({src:img.getAttribute('src'),fit:getComputedStyle(img).objectFit}));
         if(!details.src?.startsWith('data:image/svg+xml')||details.fit!=='cover')
           errors.push(size.name+' dashboard member avatar not displayed correctly: '+JSON.stringify(details));
       }
       if(await fallback.count()!==1 || (await fallback.textContent())?.trim()!=='JL'||await fallback.locator('img').count())
         errors.push(size.name+' dashboard member without an avatar lost its initials');
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
         if(await archivedCard.count()!==1 || !(await archivedCard.textContent())?.includes('Sunday Social Room'))
           errors.push(size.name+' archived room not available after expanding');
         if(size.width>=1100){
           // Reopening uses a mocked, host-authorised Worker route; no real D1 updates.
           await page.getByRole('button',{name:'Reopen poker room Sunday Social Room'}).click();
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

       if(size.width<=700){
        const top=await page.locator('.pkr-vnext-insights-top').evaluate(el=>{
         const header=document.querySelector('.pkr-primary-mobile-utility');
         return {top:el.getBoundingClientRect().top,headerBottom:header?.getBoundingClientRect().bottom??null,
           padding:getComputedStyle(document.querySelector('.pkr-insights-refresh')).paddingTop};
        });
        // Keep content close to the single header, including its safe-area inset.
        if(top.headerBottom===null||top.top<top.headerBottom-1||top.top>top.headerBottom+16)
          errors.push(size.name+' Insights heading overlaps the header or leaves an unexpected gap: '+JSON.stringify(top));
       }

       await page.locator('#pkr-insights-room').waitFor({state:'visible'});
       await page.locator('.pkr-insights-settle-tabs').waitFor({state:'visible'});
       if(await page.locator('.pkr-insights-kpis .pkr-insights-kpi').count()!==5)errors.push(size.name+' insights KPI count mismatch');
       // Owner-authorised paid historical transfers must count as paid, not as
       // an outstanding balance. No obsolete warning remains after the audit.
       const current=await page.getByTestId('current-outstanding').textContent();
       if(current?.trim()!=='$75')
        errors.push(size.name+' recorded paid history incorrectly included in outstanding: '+current);
       if(await page.getByTestId('legacy-settlement-notice').count())
        errors.push(size.name+' obsolete historical warning still visible');
       if(await page.locator('.pkr-payment-status-select').count()!==2)
        errors.push(size.name+' two synthetic payments should be available with recorded statuses');
       if(await page.getByLabel('Payment status for Historical Player A to Historical Player B').inputValue()!=='paid')
        errors.push(size.name+' owner-recorded paid historical transfer not shown as paid');
       if((await page.locator('.pkr-insights-payment-summary').count())&&
          (await page.locator('.pkr-insights-payment-summary').textContent())?.includes('Legacy'))
        errors.push(size.name+' old historical disclaimer still appears');

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
         const paidNotice=settlement.getByText('Payment status updated to Paid.');
         await paidNotice.waitFor({state:'visible',timeout:12000}).catch(()=>
           errors.push(size.name+' payment update confirmation missing'));
         if(await paymentSelect.inputValue()!=='paid')
           errors.push(size.name+' payment status did not update to paid');
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
       const choices=page.locator('.pkr-guest-options');
       const maybe=choices.getByRole('button',{name:/May not come/});
       const out=choices.getByRole('button',{name:/Out/});
       const coming=choices.getByRole('button',{name:/Coming after work/});
       const found={maybe:await maybe.count(),out:await out.count(),coming:await coming.count()};
       if(found.maybe!==1||found.out!==1||found.coming!==1)
         errors.push(size.name+' host-configured RSVP labels are missing: '+JSON.stringify({
           found,visible:await choices.locator('button').allTextContents()
         }));
       else{
         await maybe.click();
         if(await page.locator('.pkr-guest-seat-map').isVisible())
           errors.push(size.name+' Maybe incorrectly offered a reserved seat');
         await out.click();
         if(await page.locator('.pkr-guest-seat-map').isVisible())
           errors.push(size.name+' Out incorrectly offered a reserved seat');
         await coming.click();
         if(!await page.locator('.pkr-guest-seat-map').isVisible())
           errors.push(size.name+' a custom confirmed RSVP cannot choose a seat');
       }
       const settings=page.locator('#pkr-rsvp-settings');
       await settings.waitFor({state:'visible',timeout:10000}).catch(()=>
         errors.push(size.name+' host RSVP settings are not accessible'));
       if(await settings.count()){
         if(!await settings.getByLabel('RSVP response label maybe').isVisible())
           errors.push(size.name+' RSVP free-text reply editor is missing');
         const layout=await settings.evaluate(card=>{
           const rect=card.getBoundingClientRect();
           return {width:rect.width,right:rect.right,viewport:document.documentElement.clientWidth};
         });
         if(layout.right>layout.viewport+4)
           errors.push(size.name+' RSVP settings editor overflows the screen: '+JSON.stringify(layout));
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
       const liveCanvas=await page.evaluate(()=>({body:getComputedStyle(document.body).backgroundColor,image:getComputedStyle(document.body).backgroundImage}));
       if(liveCanvas.body!=='rgb(8, 19, 36)'||liveCanvas.image!=='none')
         errors.push(size.name+' live-game page canvas changed: '+JSON.stringify(liveCanvas));
       const chrome=await page.locator('#gameScreen .topbar').evaluate(node=>getComputedStyle(node).backgroundColor);
       if(chrome!=='rgb(8, 19, 36)')errors.push(size.name+' live table header should use the Lounge navy surface: '+chrome);
       const share=page.locator('#gameScreen #publishBtn');
       if(!await share.isVisible())errors.push(size.name+' live game Share action is hidden');
       const shareColour=await share.evaluate(el=>getComputedStyle(el).color);
       if(shareColour!=='rgb(198, 215, 222)')
         errors.push(size.name+' live game Share action must use readable neutral text: '+shareColour);
       if(!await page.locator('#gameScreen #settleBtn').isVisible())errors.push(size.name+' live game settle action hidden');
       const settleColour=await page.locator('#gameScreen #settleBtn').evaluate(el=>getComputedStyle(el).backgroundColor);
       if(settleColour!=='rgb(255, 197, 61)')errors.push(size.name+' live game settle action must use Chip Gold: '+settleColour);
       const feltTheme=await page.locator('#tableFelt').evaluate(node=>{
         const s=getComputedStyle(node);
         const rail=getComputedStyle(document.querySelector('#tableOuter'));
         return {felt:s.backgroundImage,rail:rail.backgroundImage,railColour:rail.backgroundColor,
                 moneyFont:getComputedStyle(document.querySelector('#gameScreen #bbIn')).fontFamily,
                 legacyBankFont:getComputedStyle(document.querySelector('.bank-pill b')).fontFamily,
                 numericMatches:document.querySelectorAll('#gameScreen .bank-pill b').length,
                 feltWidth:node.getBoundingClientRect().width};
       });
       // Restored green felt and gold-rail gradients are an explicit visual
       // requirement; this strict assertion replaces the retired slate rail.
       if(!feltTheme.felt.includes('16, 132, 102')||!feltTheme.felt.includes('7, 94, 74')||
           !feltTheme.rail.includes('190, 147, 67')||!feltTheme.rail.includes('210, 163, 75'))
         errors.push(size.name+' live felt/gold rail does not match the approved casino table: '+JSON.stringify(feltTheme));
       if(!feltTheme.moneyFont.toLowerCase().includes('jetbrains mono')){
         let diagnostic='';
         if(size.name==='small-phone')diagnostic=JSON.stringify(await page.evaluate(()=>{
           const el=document.querySelector('#gameScreen #bbIn'),root=document.documentElement,cs=el&&getComputedStyle(el);
           const matched=[];let checked=0;
           const visit=rules=>{for(const rule of rules){
             if(rule.selectorText&&rule.style?.fontFamily){
               checked++;
               try{if(el?.matches(rule.selectorText))matched.push({selector:rule.selectorText.slice(0,160),font:rule.style.fontFamily,important:rule.style.getPropertyPriority('font-family')});}catch{}
             }
             if(rule.cssRules)try{visit(rule.cssRules)}catch{}
           }};
           for(const sheet of document.styleSheets)try{visit(sheet.cssRules)}catch{}
           return {rootClass:root.className,rootMatches:root.matches('html.pkr-game-night.pkr-chip-club'),
             el:el?.outerHTML?.slice(0,250),bankBarClass:el?.closest('#bankBar')?.className,
             inline:el?.getAttribute('style'),font:cs?.fontFamily,variable:cs?.getPropertyValue('--font-num'),
             matches:matched.slice(-22),ruleCount:checked};
         }));
         errors.push(size.name+' bank amounts do not use the bundled JetBrains Mono font: '+feltTheme.moneyFont+' '+diagnostic);
       }

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
       // Await the synthetic asynchronous game-list fetch before testing filters.
       await page.waitForFunction(()=>{
         const summary=document.querySelector('.pkr-schedule-counts')?.textContent||'';
         const loading=document.querySelector('.pkr-schedule-empty[role="status"]')?.textContent||'';
         return !loading.includes('Loading your poker nights') && summary.includes('1 unfinished');
       },null,{timeout:15000});
       const liveCount=await page.locator('.pkr-schedule-counts').textContent();
       if(liveCount&&!liveCount.includes('0 live now'))
         errors.push(size.name+' historical unfinished game counted as live');
       await page.getByLabel('Filter by game status').selectOption('unfinished');
       try {
         await page.getByText('Unfinished',{exact:true}).first().waitFor({state:'visible',timeout:5000});
       } catch {
         errors.push(size.name+' unfinished game not discoverable via Schedule');
       }
       await page.getByLabel('Filter by game status').selectOption('all');
     }
     if(item.id==='room'&&size.width<=700){
      if(await page.locator('.pkr-event-tabs').count())
        errors.push(size.name+' old sticky room tabs are still rendered');
     }
     if(item.id==='room'&&size.width<1100){
       const nav=page.getByRole('navigation',{name:/main navigation|Player navigation/});
       for(const label of ['Home','Games','Players','Results','Payments']){
         if(!await page.locator('.pkr-universal-bottom-nav').getByRole('button',{name:label,exact:true}).isVisible())
           errors.push(size.name+' '+label+' is hidden from the five-area mobile navigation');
       }
       if(await page.locator('.pkr-universal-bottom-nav').getByRole('button',{name:'More'}).count())
         errors.push(size.name+' core features remain hidden in More');
     }
     if(item.id==='room'){
       const nav=size.width>=1100?page.locator('.pkr-persistent-nav'):page.locator('.pkr-universal-bottom-nav');
       await page.locator('.pkr-room-games-intro').waitFor({state:'visible'});
       if(size.width<=740){
         const geometry=await page.locator('[data-testid="games-command-stage"]').evaluate(stage=>{
           const copy=stage.querySelector('.pkr-experience-command-copy');
           const stats=stage.querySelector('.pkr-experience-command-stats');
           if(!copy||!stats)return null;
           const box=stage.getBoundingClientRect(),title=copy.getBoundingClientRect(),tiles=stats.getBoundingClientRect();
           return {height:box.height,width:box.width,copyWidth:title.width,
             tilesTop:tiles.top,copyBottom:title.bottom,tilesRight:tiles.right,stageRight:box.right,
             properClass:stage.classList.contains('pkr-experience-command'),
             columns:getComputedStyle(stats).gridTemplateColumns};
         });
         if(!geometry||!geometry.properClass||geometry.height>460||
             geometry.copyWidth<175||geometry.tilesTop<geometry.copyBottom-3||
             geometry.tilesRight>geometry.stageRight+3)
           errors.push(size.name+' Games Command hero collapsed or overflowed: '+JSON.stringify(geometry));
       }
       const secondary=page.getByRole('navigation',{name:'Games sections'});
       if(!await secondary.getByRole('button',{name:'RSVPs & Sharing'}).isVisible())
         errors.push(size.name+' Games is missing the RSVP secondary tab');
       if(!await page.getByRole('button',{name:/RSVP settings/}).first().isVisible())
         errors.push(size.name+' RSVP settings not directly discoverable from Games');
       else{
         await secondary.getByRole('button',{name:'RSVPs & Sharing'}).click();
         await page.getByTestId('game-night-hub').waitFor({state:'visible',timeout:10000});
         if(new URL(page.url()).searchParams.get('tab')!=='night')
           errors.push(size.name+' RSVP secondary tab did not open the live hub');
         await page.getByRole('heading',{name:'Share once. Always up to date.'})
           .waitFor({state:'visible',timeout:12000}).catch(()=>
             errors.push(size.name+' the current live RSVP board is not visible'));
         const selectedNight=await page.getByLabel('Choose game night').inputValue();
         if(selectedNight!=='test-game')errors.push(size.name+' old unfinished game displaced current RSVP board');
         if(await page.getByLabel('Member notification registrations').count())
           errors.push(size.name+' settings still clutter the RSVP screen');
       }
       await nav.getByRole('button',{name:'Players',exact:true}).click();
       await page.locator('.pkr-member-summary').waitFor({state:'visible'});
       if(size.width<=740){
         const playerHero=await page.locator('[data-testid="players-command-stage"]').evaluate(stage=>{
           const copy=stage.querySelector('.pkr-experience-command-copy')?.getBoundingClientRect();
           const stats=stage.querySelector('.pkr-experience-command-stats')?.getBoundingClientRect();
           return {height:stage.getBoundingClientRect().height,copyBottom:copy?.bottom,
             tilesTop:stats?.top,properClass:stage.classList.contains('pkr-experience-command')};
         });
         if(!playerHero||!playerHero.properClass||playerHero.height>330||
             playerHero.tilesTop<playerHero.copyBottom-3)
           errors.push(size.name+' Players Command hero collapsed: '+JSON.stringify(playerHero));
       }
       if(new URL(page.url()).searchParams.get('tab')!=='members')
         errors.push(size.name+' Players tab did not open the member roster');
       if(await page.getByLabel('Member notification registrations').count())
         errors.push(size.name+' settings are still in Players');
       const inviteChoice=page.getByRole('button',{name:/Invite & QR/});
       await inviteChoice.click();
       if(!await page.locator('.pkr-member-invite').isVisible())
         errors.push(size.name+' private invitations missing from Players');
       if(await page.locator('.pkr-member-roster').isVisible())
         errors.push(size.name+' invitation area did not hide the player roster');
       await page.getByRole('button',{name:/Players \(/}).click();
       await page.locator('.pkr-member-roster').waitFor({state:'visible'});
       if(size.width>=1100){
         await page.getByRole('button',{name:'+ Invite Member by Mobile'}).click();
         await page.getByLabel('WhatsApp mobile number').waitFor({state:'visible',timeout:5000});
         await page.getByRole('button',{name:/Players \(/}).click();
         await page.locator('.pkr-member-roster').waitFor({state:'visible'});
       }
       const search=page.locator('#pkr-member-search');
       if(await search.count()){
         await search.fill('Jordan');
         const roster=page.locator('.pkr-member-roster');
         if(!await roster.getByText('Jordan Lee').isVisible())
           errors.push(size.name+' player search missing Jordan');
         await search.fill('');
       }
       const delayedInitialResults=size.name==='landscape-phone'?holdResultsResponse():null;
       try{
         await nav.getByRole('button',{name:'Results',exact:true}).click();
         await page.getByRole('heading',{name:'Results',exact:true}).waitFor({state:'visible',timeout:12000});
         if(delayedInitialResults){
           await delayedInitialResults.requested;
           await page.locator('.pkr-results-page[aria-busy="true"]').waitFor({state:'visible'});
           // Model browser restoration after the initial mount/paint while saved
           // results are still loading. No user input should cancel the reset.
           await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>{
             window.scrollTo({top:140,behavior:'instant'});resolve();
           }))));
           await page.waitForFunction(()=>window.scrollY>24,null,{timeout:3000});
         }
       }finally{delayedInitialResults?.release();}
       await page.locator('.pkr-results-page[aria-busy="false"]').waitFor({state:'visible',timeout:15000});
       await page.locator('.pkr-results-ledger-row').first().waitFor({state:'visible',timeout:15000});
        await page.waitForTimeout(180);
        const resultsLanding=await page.evaluate(()=>{
          const heading=document.querySelector('.pkr-results-page h1');
          const utility=document.querySelector('.pkr-primary-mobile-utility');
          return {scrollY:window.scrollY,headingTop:heading?.getBoundingClientRect().top??null,
            headerBottom:utility&&getComputedStyle(utility).display!=='none'?utility.getBoundingClientRect().bottom:0};
        });
        if(resultsLanding.scrollY>24||resultsLanding.headingTop===null||
           resultsLanding.headingTop<resultsLanding.headerBottom-1)
          errors.push(size.name+' Results opened mid-page instead of at the header: '+JSON.stringify(resultsLanding));

        if(size.name==='landscape-phone'){
          // A deliberate user scroll during the same delayed load must win.
          const userScrolledResults=holdResultsResponse();
          try{
            await page.reload({waitUntil:'domcontentloaded'});
            await userScrolledResults.requested;
            await page.locator('.pkr-results-page[aria-busy="true"]').waitFor({state:'visible'});
            await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
            await page.mouse.move(size.width/2,size.height/2);
            await page.mouse.wheel(0,140);
            await page.waitForFunction(()=>window.scrollY>24,null,{timeout:3000});
          }finally{userScrolledResults.release();}
          await page.locator('.pkr-results-page[aria-busy="false"]').waitFor({state:'visible',timeout:15000});
          await page.locator('.pkr-results-ledger-row').first().waitFor({state:'visible',timeout:15000});
          await page.waitForTimeout(180);
          if(await page.evaluate(()=>window.scrollY)<=24)
            errors.push(size.name+' loaded Results overrode the user scroll');
          // Keep exercising the existing section action and its top reset.
          await page.getByRole('navigation',{name:'Results sections'}).getByRole('button',{name:'Standings'}).click();
          await page.waitForFunction(()=>window.scrollY<=24,null,{timeout:3000});
        }

        if(await page.locator('.pkr-results-ledger-row').count()!==leaders.length)
          errors.push(size.name+' Command Centre lost ledger players');
        const commandPaint=await page.locator('[data-testid="command-results-stage"]').evaluate(node=>{
          const title=getComputedStyle(node.querySelector('h1')),paint=getComputedStyle(node);
          const name=getComputedStyle(document.querySelector('.pkr-results-ledger-person strong'));
          return {surface:paint.backgroundColor,ink:title.color,weight:Number(title.fontWeight),nameWeight:Number(name.fontWeight)};
        });
        if(commandPaint.surface!=='rgb(36, 59, 121)'||commandPaint.ink!=='rgb(255, 255, 255)'||commandPaint.weight<780||commandPaint.nameWeight<750)
          errors.push(size.name+' Command Centre Results colour or typography hierarchy regressed: '+JSON.stringify(commandPaint));
        if(size.width<=740){
          const winner=await page.locator('.pkr-results-command-stats>div:last-child').evaluate(tile=>{
            const value=tile.querySelector('strong');
            return {layout:getComputedStyle(tile).display,
              valueWidth:value?.getBoundingClientRect().width||0,
              tileWidth:tile.getBoundingClientRect().width};
          });
          if(winner.layout!=='grid'||winner.valueWidth<45)
            errors.push(size.name+' Command Centre top player label squeezed: '+JSON.stringify(winner));
        }
        if(await page.locator('.pkr-results-live-player').count()!==0)
          errors.push(size.name+' Command Centre is still rendering the Live Poker board');
         await page.screenshot({path:path.join(output,size.name+'-results-command-first-screen.png'),fullPage:false});
         await page.screenshot({path:path.join(output,size.name+'-results-command.png'),fullPage:true});
        if(size.width<1100){
          await page.evaluate(()=>window.scrollTo(0,document.documentElement.scrollHeight));
          await page.waitForTimeout(120);
          const spacing=await page.evaluate(()=>{
            const nav=document.querySelector('.pkr-primary-bottom-nav');
            const last=document.querySelector('.pkr-results-ledger-row:last-child');
            if(!nav||!last)return null;
            const nr=nav.getBoundingClientRect(),rr=last.getBoundingClientRect();
            return {navTop:nr.top,rowBottom:rr.bottom,
             scrollWidth:document.documentElement.scrollWidth,viewportWidth:document.documentElement.clientWidth};
          });
          if(!spacing||spacing.rowBottom>spacing.navTop-5)
            errors.push(size.name+' last Results row obscured by bottom tabs: '+JSON.stringify(spacing));
          if(spacing&&spacing.scrollWidth>spacing.viewportWidth+4)
            errors.push(size.name+' Results standings overflow horizontally');
           await page.screenshot({path:path.join(output,size.name+'-results-command-last-row.png'),fullPage:false});
        }
        if(!await page.getByRole('navigation',{name:'Results sections'}).getByRole('button',{name:'History'}).isVisible())
         errors.push(size.name+' Results is missing History');
       await page.getByRole('navigation',{name:'Results sections'}).getByRole('button',{name:'History'}).click();
       await page.locator('.pkr-results-history-card').first().waitFor({state:'visible'});
       if(!await page.locator('.pkr-results-history-view .pkr-results-section-head').isVisible())
         errors.push(size.name+' History uses a different heading structure');
       const sessionCards=await page.locator('.pkr-results-history-card').count();
       if(sessionCards!==1)errors.push(size.name+' settled session history cards missing: '+sessionCards);
       const historyCard=page.locator('.pkr-results-history-card').first();
       if(!await historyCard.getByRole('button',{name:/View results/}).isVisible())
         errors.push(size.name+' History lost saved results deep link');
       await historyCard.locator('summary').click();
       if(!await historyCard.getByRole('button',{name:/Share in WhatsApp/}).isVisible()||
          !await historyCard.getByRole('button',{name:'Results image'}).isVisible())
         errors.push(size.name+' History sharing and image actions not visible');
       const historyGeometry=await historyCard.evaluate(card=>{
         const r=card.getBoundingClientRect();
         return {left:r.left,right:r.right,scroll:document.documentElement.scrollWidth,
           viewport:document.documentElement.clientWidth};
       });
       if(historyGeometry.left<0||historyGeometry.right>historyGeometry.viewport+4||
          historyGeometry.scroll>historyGeometry.viewport+4)
         errors.push(size.name+' Results History card clipped: '+JSON.stringify(historyGeometry));
       await page.screenshot({path:path.join(output,size.name+'-results-command-history.png'),fullPage:false});
       await page.getByRole('navigation',{name:'Results sections'}).getByRole('button',{name:'Insights'}).click();
       await page.locator('.pkr-results-net-row').first().waitFor({state:'visible',timeout:10000});
       const bars=await page.locator('.pkr-results-net-row').count();
       if(!await page.locator('.pkr-results-insights-view .pkr-results-section-head').isVisible()||
          await page.locator('.pkr-results-insight-kpi').count()!==3||
          !await page.locator('.pkr-results-trend-panel').isVisible())
         errors.push(size.name+' Results Insights does not match shared dashboard');
       const zeroLine=await page.locator('.pkr-results-net-track').first().evaluate(node=>{
         const style=getComputedStyle(node,'::after');
         return {content:style.content,left:style.left};
       });
       if(zeroLine.content==='none'||!zeroLine.left)
         errors.push(size.name+' Insights graph lost the central zero axis');
       await page.screenshot({path:path.join(output,size.name+'-results-command-insights.png'),fullPage:false});
       const gains=await page.locator('.pkr-results-net-track i.gain').count();
       const losses=await page.locator('.pkr-results-net-track i.loss').count();
       if(bars!==leaders.length||!gains||!losses)
         errors.push(size.name+' Results Insights lost red/green player graphs: '+JSON.stringify({bars,gains,losses}));
       if(size.width<1100){
         const graph=await page.locator('.pkr-results-net-row').first().evaluate(row=>{
           const style=getComputedStyle(row),person=row.querySelector('.pkr-results-net-person')?.getBoundingClientRect(),
             track=row.querySelector('.pkr-results-net-track')?.getBoundingClientRect();
           return {display:style.display,nameWidth:person?.width,trackWidth:track?.width,
             scrollWidth:document.documentElement.scrollWidth,viewportWidth:document.documentElement.clientWidth};
         });
         if(!graph||graph.display!=='grid'||graph.nameWidth<70||graph.trackWidth<30||
             graph.scrollWidth>graph.viewportWidth+4)
           errors.push(size.name+' Results Insights bars not responsive: '+JSON.stringify(graph));
         await page.evaluate(()=>window.scrollTo(0,document.documentElement.scrollHeight));
         const lastGraph=await page.locator('.pkr-results-net-row').last().evaluate(row=>{
           const nav=document.querySelector('.pkr-primary-bottom-nav');
           return {rowBottom:row.getBoundingClientRect().bottom,navTop:nav?.getBoundingClientRect().top};
         });
         if(lastGraph.rowBottom>lastGraph.navTop-5)
           errors.push(size.name+' last Insights graph row hidden by navigation: '+JSON.stringify(lastGraph));
       }
       await nav.getByRole('button',{name:'Payments',exact:true}).click();
       await page.getByRole('navigation',{name:'Payment sections'}).getByRole('link',{name:'Ledger & tools',exact:true}).click();
       await page.getByRole('heading',{name:'Payments',exact:true}).waitFor({state:'visible',timeout:12000});
       try{await page.locator('#pkr-settlement').waitFor({state:'visible',timeout:15000})}
       catch{errors.push(size.name+' settlement ledger did not load in Payments')}
       if(!await page.getByRole('button',{name:/Send private reminders/}).isVisible())
         errors.push(size.name+' Payments reminder action is hidden');
       if(!await page.getByRole('button',{name:/Automatic 24-hour reminders/}).isVisible())
         errors.push(size.name+' automatic reminders link is hidden');
       if(size.width<=740){
         const paymentStage=await page.locator('.pkr-payments-stage [data-testid="payments-command-stage"]').evaluate(stage=>{
           const copy=stage.querySelector('.pkr-experience-command-copy')?.getBoundingClientRect();
           const cards=stage.querySelector('.pkr-experience-command-stats')?.getBoundingClientRect();
           const rect=stage.getBoundingClientRect();
           return {width:rect.width,height:rect.height,copyWidth:copy?.width,
             copyBottom:copy?.bottom,cardsTop:cards?.top,cardsRight:cards?.right,
             stageRight:rect.right};
         }).catch(()=>null);
         if(!paymentStage||paymentStage.copyWidth<175||
             paymentStage.cardsTop<paymentStage.copyBottom-3||
             paymentStage.cardsRight>paymentStage.stageRight+3||
             paymentStage.height>340)
           errors.push(size.name+' Payments Command hero squashed or clipped: '+JSON.stringify(paymentStage));
       }
       await page.goto(BASE+'/account',{waitUntil:'domcontentloaded'});
       await page.getByRole('heading',{name:'Notifications for this club'}).waitFor({state:'visible',timeout:12000});
       await page.getByRole('heading',{name:'Sounds & accessibility'}).waitFor();
     }
     // Preserve the legacy Standings link alongside the new Results area.
     if(item.id==='room'){
      await page.goto(BASE+'/events/test-room?tab=leaderboard',{waitUntil:'domcontentloaded'});
      await page.locator('.pkr-standings-board').waitFor({state:'visible',timeout:5000});
      if(await page.locator('.pkr-standings-row').count()!==leaders.length)
        errors.push(size.name+' Standings did not show every synthetic player');
      const playerSearch=page.getByLabel('Search standings by player name');
      await playerSearch.fill('Jordan');
      if(await page.locator('.pkr-standings-row').count()!==1)
        errors.push(size.name+' Standings search did not filter players');
      await playerSearch.fill('');
      await page.getByLabel('Sort player standings').selectOption('average');
      // Regression: player buttons must OPEN the profile, not just set internal state.
      await page.locator('.pkr-standings-row').first().click();
      const profile=page.getByRole('dialog',{name:/Player history for/});
      await profile.waitFor({state:'visible',timeout:5000});
      if(!await profile.getByText('Alex Morgan',{exact:true}).count())
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
     if(item.id!=='dashboard') await page.screenshot({path:path.join(output,size.name+'-'+item.id+'.png'),fullPage:false});
    }catch(e){errors.push(size.name+' '+item.id+': '+(e?.message||e));}
   }
   await context.close();
  }
 }finally{await browser.close();}
 if(errors.length){console.error(errors.join('\n'));process.exitCode=1;}
 else console.log('PKR public/PWA and synthetic-authenticated viewport checks passed for '+sizes.length+' device sizes.');
}
test().catch(e=>{console.error(e);process.exitCode=1});
