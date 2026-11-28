'use strict';
// Browser regression: every PKR theme resolves the same room-bound saved avatars.
// Fictional fixtures only: no live user, room, database, payment or external service.
const {chromium,webkit}=require('playwright');
const assert=require('node:assert/strict');
const {BASE,API,room,members,leaders,createFixture,initialStorage}=require('../scripts/launch-fixture.cjs');
const ranked=[...leaders].sort((a,b)=>b.total_net-a.total_net||b.games_won-a.games_won);
const styles=['private-club','luxe','neon','vip','tournament','standard','noir','clubhouse','studio'];
const saved={
 [ranked[0].user_id]:{type:'photo'},
 [ranked[1].user_id]:{type:'emoji',emoji:'🃏'},
 [ranked[2].user_id]:{type:'account'},
};
function contrast(a,b){
 const channels=s=>{const found=s.match(/[\d.]+/g)||[];return found.slice(0,3).map(Number)};
 const light=s=>{
  const c=channels(s).map(x=>{const v=x/255;return v<=0.04045?v/12.92:((v+.055)/1.055)**2.4;});
  return c[0]*.2126+c[1]*.7152+c[2]*.0722;
 };
 const x=light(a),y=light(b);return(Math.max(x,y)+.05)/(Math.min(x,y)+.05);
}
async function scenario(browser,style,mode,screen,kind){
 const fixture=createFixture();
 const ctx=await browser.newContext({viewport:screen,serviceWorkers:'block',colorScheme:mode,locale:'en-AU',timezoneId:'Australia/Brisbane',deviceScaleFactor:1});
 const photoCtx=await ctx.newPage();
 const dataPhoto=await photoCtx.evaluate(()=>{
  const canvas=document.createElement('canvas');canvas.width=64;canvas.height=64;
  const pen=canvas.getContext('2d');pen.fillStyle='#9e3156';pen.fillRect(0,0,64,64);
  pen.fillStyle='#f7e5ba';pen.beginPath();pen.arc(32,24,14,0,Math.PI*2);pen.fill();
  return canvas.toDataURL('image/jpeg',.73);
 });
 await photoCtx.close();
 await ctx.addInitScript(({storage,style,mode})=>{
  Object.entries(storage).forEach(([key,value])=>localStorage.setItem(key,value));
  localStorage.setItem('pkr_personal_visual_style_v1',style);
  localStorage.setItem('pkr_personal_appearance_v1',mode);
 },{storage:initialStorage,style,mode});
 const failures=[];
 const page=await ctx.newPage();page.setDefaultTimeout(16000);
 page.on('pageerror',error=>failures.push(error.message));
 await ctx.route('**/*',async route=>{
  const request=route.request(),url=new URL(request.url());
  if(url.origin===BASE)return route.continue();
  if(url.origin!==API)return route.abort();
  try{
   let value;
   if(request.method()==='GET'&&url.pathname==='/events/'+room.id){
    const details=fixture.resolve(url,request.method(),request.postData());
    value={...details,members:details.members.map(m=>m.id===ranked[2].user_id?{...m,avatar_url:'/images/casino/real-poker-chips.webp'}:m)};
   }else if(request.method()==='GET'&&url.pathname==='/events/'+room.id+'/profiles'){
    value={profiles:[
     {profile_key:'member:'+ranked[0].user_id,screen_name:null,avatar_data:dataPhoto,avatar_emoji:null},
     {profile_key:'member:'+ranked[1].user_id,screen_name:null,avatar_data:null,avatar_emoji:'🃏'},
    ]};
   }else value=fixture.resolve(url,request.method(),request.postData());
   return route.fulfill({status:200,body:JSON.stringify(value),contentType:'application/json',headers:{
    'access-control-allow-origin':BASE,'access-control-allow-credentials':'true',
    'access-control-allow-headers':'Content-Type,Authorization','access-control-allow-methods':'GET,POST,PUT,OPTIONS'
   }});
  }catch(e){failures.push(String(e));return route.fulfill({status:404,body:'{"error":"No fictional record"}',contentType:'application/json'});}
 });
 try{
  await page.goto(BASE+'/results?room='+room.id,{waitUntil:'domcontentloaded'});
  const podium=page.locator('.pkr-pc-results-rank .pkr-pc-results-face');
  await podium.first().waitFor({state:'attached'});
  await page.waitForFunction(()=>{
   const avatars=[...document.querySelectorAll('.pkr-pc-results-rank .pkr-pc-results-face')];
   return avatars.length===3&&avatars[0].getAttribute('data-avatar-source')==='profile-photo'&&
    avatars[1].getAttribute('data-avatar-source')==='profile-emoji'&&
    avatars[2].getAttribute('data-avatar-source')==='account-photo';
  });
  assert.equal(await podium.nth(0).locator('img').count(),1,'Saved JPEG photo should render');
  assert.equal(await podium.nth(1).innerText(),'🃏','Saved emoji should render');
  assert.equal(await podium.nth(2).locator('img').count(),1,'Member account photo should render');
  const rank=page.locator('.pkr-results-ledger-person .pkr-results-inline-avatar,.pkr-results-live-person .pkr-results-inline-avatar');
  await rank.first().waitFor({state:'attached'});
  // Same data source must power the original and casino Results presentations.
  await page.waitForFunction(()=>[...document.querySelectorAll(
   '.pkr-results-ledger-person .pkr-results-inline-avatar,.pkr-results-live-person .pkr-results-inline-avatar'
  )].some(el=>el.getAttribute('data-avatar-source')==='profile-photo'));
  const initial=page.locator('.pkr-pc-results-podium [data-avatar-source="initials"]');
  const fallback=page.locator('.pkr-results-ledger-person [data-avatar-source="initials"],.pkr-results-live-person [data-avatar-source="initials"]');
  await fallback.first().waitFor({state:'attached'});
  const score=await fallback.first().evaluate(el=>{
   const avatar=getComputedStyle(el),letters=getComputedStyle(el.querySelector('.pkr-shared-player-initials'));
   return {background:avatar.backgroundColor,foreground:letters.color,fill:letters.webkitTextFillColor,
    opacity:letters.opacity,width:el.getBoundingClientRect().width};
  });
  assert(contrast(score.background,score.foreground)>=4.5,'Default initials contrast should be accessible: '+JSON.stringify(score));
  assert(score.width>=29&&score.opacity==='1','Default initials must be clearly visible: '+JSON.stringify(score));
  if(style==='private-club'){
   assert(await podium.first().isVisible(),'The Private Club podium should be on screen');
   const [photo,emoji,account]=await Promise.all([podium.nth(0).locator('img').isVisible(),podium.nth(1).isVisible(),podium.nth(2).locator('img').isVisible()]);
   assert(photo&&emoji&&account,'Top three saved avatars must be visible on the Private Club podium');
  }
  if(style==='private-club'||style==='standard'){
   await page.goto(BASE+'/events/'+room.id+'?tab=leaderboard',{waitUntil:'domcontentloaded'});
   const secondary=page.locator('.pkr-standings-podium-card .pkr-standings-podium-avatar');
   await page.waitForFunction(()=>document.querySelector('.pkr-standings-podium-card .pkr-standings-podium-avatar[data-avatar-source="profile-photo"]'));
   assert(await secondary.first().isVisible(),'Room standings must show avatars as well as global Results');
   const rows=page.locator('.pkr-standings-row .pkr-standings-avatar');
   assert(await rows.first().isVisible(),'Room standings player rows must also display avatars');
  }
  assert.deepEqual(failures,[],kind+' '+style+' '+mode+' browser/API failures');
  return kind+' '+style+' '+mode;
 }finally{await ctx.close()}
}
(async()=>{
 const outputs=[];
 const chromiumBrowser=await chromium.launch({headless:true});
 try{
  for(const style of styles){
   for(const mode of ['light','dark'])outputs.push(await scenario(chromiumBrowser,style,mode,{width:390,height:844},'chromium'));
  }
  outputs.push(await scenario(chromiumBrowser,'private-club','light',{width:1440,height:900},'chromium'));
 }finally{await chromiumBrowser.close()}
 const safari=await webkit.launch({headless:true});
 try{
  outputs.push(await scenario(safari,'private-club','light',{width:390,height:844},'webkit'));
  outputs.push(await scenario(safari,'private-club','dark',{width:390,height:844},'webkit'));
 }finally{await safari.close()}
 console.log('PASS universal player avatars: '+outputs.join(', '));
})().catch(error=>{console.error(error.stack||error);process.exitCode=1});
