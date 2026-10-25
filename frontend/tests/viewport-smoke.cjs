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
     if(item.id==='live-table'){const box=await page.locator('#gameScreen').boundingBox();if(box&&size.width>=1100&&box.x<210)errors.push(size.name+' live table overlaps sidebar');}
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
