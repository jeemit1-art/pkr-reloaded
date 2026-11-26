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
const fixtures=(u,method)=>{
 const p=u.pathname;
 if(method==='OPTIONS')return {};
 if(p==='/auth/me')return user;
 if(p==='/events')return [room];
 if(p==='/events/'+room.id)return {...room,members:[]};
 if(p==='/events/'+room.id+'/dashboard-layout')return {event_id:room.id,layout:'command',updated_at:null};
 if(p==='/events/'+room.id+'/games')return [game];
 if(p==='/events/'+room.id+'/leaderboard')return [];
 if(p==='/events/'+room.id+'/history')return [];
 if(p==='/events/'+room.id+'/settlement-ledger')return {games:[],transfers:[]};
 if(p==='/events/'+room.id+'/profiles')return {profiles:[]};
 if(p==='/events/'+room.id+'/players')return [];
 if(p==='/games/'+game.id+'/rsvp-board')return {game,event:room,players:[],guests:[],options:['19:00']};
 if(p==='/push/vapid-key')return {key:'synthetic-only'};
 if(p==='/auth/device-session/start')return {refresh_token:'a'.repeat(64),expires_in:3888000};
 return {error:'Unexpected synthetic API: '+method+' '+p};
};
const sizes=[
 {name:'small-phone',width:320,height:700},
 {name:'regular-phone',width:360,height:780},
 {name:'iphone',width:390,height:844},
 {name:'large-phone',width:430,height:932},
 {name:'phone-landscape',width:844,height:390},
 {name:'tablet',width:768,height:1024},
 {name:'tablet-landscape',width:1024,height:768},
 {name:'desktop-small',width:1100,height:800},
 {name:'desktop',width:1440,height:900},
];
async function check(engine,size){
 const browser=await engine.launch({headless:true});
 try{
  const context=await browser.newContext({
    viewport:{width:size.width,height:size.height},deviceScaleFactor:1,
    serviceWorkers:'block',
    isMobile:engine===webkit&&size.width<=430,
    hasTouch:engine===webkit&&size.width<=430
  });
  await context.addInitScript(()=>localStorage.setItem('pkr_token','synthetic-only-session'));
  const page=await context.newPage();
  page.setDefaultTimeout(22000);
  const problems=[];
  page.on('pageerror',error=>problems.push('JS: '+error.message));
  await page.route('**/*.workers.dev/**',async route=>{
   const url=new URL(route.request().url()),method=route.request().method();
   if(url.origin!==API){problems.push('Unexpected Worker origin');await route.abort();return;}
   const data=fixtures(url,method),bad=!!data.error;
   if(bad)problems.push(data.error);
   await route.fulfill({status:bad?404:200,contentType:'application/json',
     headers:{'access-control-allow-origin':BASE,'access-control-allow-credentials':'true',
       'access-control-allow-headers':'Content-Type,Authorization',
       'access-control-allow-methods':'GET,POST,PUT,DELETE,OPTIONS'},
     body:JSON.stringify(data)});
  });
  await page.goto(BASE+'/dashboard',{waitUntil:'domcontentloaded'});
  await page.getByTestId('player-dashboard').waitFor({state:'visible'});
  const geometry=await page.evaluate(()=>{
    const visible=(element)=>!!element&&getComputedStyle(element).display!=='none'&&
      element.getBoundingClientRect().width>0&&element.getBoundingClientRect().height>0;
    const primary=document.querySelector('.pkr-primary-mobile-utility');
    const sidebar=document.querySelector('.pkr-persistent-nav');
    const old=document.querySelector('.pkr-dashboard > .nav.pkr-topbar');
    const content=document.querySelector('.pkr-dashboard > .pkr-content');
    const acc=document.querySelector('.pkr-primary-account');
    const client=document.documentElement.clientWidth;
    const rect=node=>{if(!node)return null;const r=node.getBoundingClientRect();
      return {left:r.left,right:r.right,top:r.top,bottom:r.bottom,width:r.width,height:r.height};};
    return {width:client,scrollWidth:document.documentElement.scrollWidth,
      primaryVisible:visible(primary),primary:rect(primary),position:primary?getComputedStyle(primary).position:'',
      sidebarVisible:visible(sidebar),oldVisible:visible(old),content:rect(content),
      account:rect(acc),bottomVisible:visible(document.querySelector('.pkr-primary-bottom-nav')),
      clubText:primary?.textContent||'',
    };
  });
  assert(!geometry.oldVisible,'Two dashboard header bars are visible');
  assert(geometry.scrollWidth<=geometry.width+3,'Page overflows horizontally: '+JSON.stringify(geometry));
  if(size.width<1100){
    assert(geometry.primaryVisible,'Club/Account header not visible');
    assert(!geometry.sidebarVisible,'Desktop sidebar visible on phone/tablet');
    assert(geometry.bottomVisible,'Bottom primary navigation was removed');
    assert.equal(geometry.position,'sticky');
    assert(geometry.primary.left>=-1&&geometry.primary.right<=geometry.width+1,
      'Header extends beyond viewport');
    assert(geometry.primary.top>=-1&&geometry.primary.top<=2,'Header starts outside safe viewport');
    assert(geometry.account.width>=41&&geometry.account.height>=42,'Account action is too small');
    assert(geometry.content.top>=geometry.primary.bottom-1,
      'Dashboard content starts behind the club header');
    assert(geometry.clubText.includes('Account'),'Account action lost');
    await page.evaluate(()=>window.scrollTo({top:480,behavior:'instant'}));
    await page.waitForTimeout(150);
    const scrolled=await page.locator('.pkr-primary-mobile-utility').boundingBox();
    assert(scrolled&&scrolled.y>=-1&&scrolled.y<=2,'Sticky header overlaps the system status area');
    assert(scrolled.x>=-1&&scrolled.x+scrolled.width<=size.width+2,'Scrolled header clipped');
    await page.evaluate(()=>window.scrollTo({top:0,behavior:'instant'}));
    await page.getByRole('button',{name:'Account, notifications and installation'}).click();
  }else{
    assert(!geometry.primaryVisible,'Desktop still shows extra mobile header');
    assert(geometry.sidebarVisible,'Desktop sidebar was removed');
    await page.locator('.pkr-primary-sidebar-footer').getByRole('button',{name:'Account and notification settings'}).click();
  }
  await page.getByRole('heading',{name:'Account & settings'}).waitFor({state:'visible'});
  await page.getByRole('button',{name:'Sign out',exact:true}).waitFor({state:'visible'});
  // Ensure this is the mocked signed-in account, not a stale PWA/API response.
  assert.equal(await page.evaluate(()=>localStorage.getItem('pkr_token')),
    'synthetic-only-session','The account navigation lost its approved session');
  await page.locator('.pkr-account-plan').waitFor({state:'visible'});
  assert.equal((await page.locator('.pkr-account-plan').innerText()).trim(),
    'Plan: LIFETIME','Account must retain the member plan');
  assert.deepEqual(problems,[]);
  await page.goto(BASE+'/dashboard',{waitUntil:'domcontentloaded'});
  await page.getByTestId('player-dashboard').waitFor({state:'visible'});
  await page.screenshot({path:path.join(output,engine.name()+'-'+size.name+'.png'),fullPage:false});
  console.log('PASS '+engine.name()+' '+size.name+' single header, account access and overflow');
  await context.close();
 }finally{await browser.close();}
}
(async()=>{
  for(const size of sizes)await check(chromium,size);
  for(const size of sizes.filter(s=>['small-phone','iphone','phone-landscape','tablet','desktop'].includes(s.name)))
    await check(webkit,size);
})().catch(error=>{console.error(error);process.exitCode=1;});
