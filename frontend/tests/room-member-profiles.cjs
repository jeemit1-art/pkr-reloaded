'use strict';
// Room profile browser regression. All network responses are synthetic and
// all requests except the one profile PUT are blocked. No live D1 access.
const {chromium,webkit}=require('playwright');
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const BASE='http://127.0.0.1:3000',API='https://pkr-reloaded-worker-staging.jeemit1.workers.dev';
const out=path.resolve(__dirname,'../../artifacts/member-profiles');fs.mkdirSync(out,{recursive:true});
const now=Math.floor(Date.now()/1000);
const room={id:'profile-room',name:'Friday Night Poker',status:'active',host_id:'host-1',buy_in:2500,
 role:'host',created_at:now-86400,member_count:2,game_count:0};
const host={id:'host-1',name:'Test Host',email:'host@example.invalid',role:'host',avatar_url:null,joined_at:now-86400};
const player={id:'guest-2',name:'Dhronal Shah',email:null,role:'member',avatar_url:null,joined_at:now-80000};
const profiles=[{profile_key:'member:guest-2',screen_name:'Pocket Rocket',avatar_data:null,avatar_emoji:'♠️',
 phone:'+61412345678',preferred_contact:'whatsapp',private_notes:'Only host can see this',updated_at:now}];
async function runEngine(engine,browserType,width,height){
 // Each browser/device needs an isolated synthetic fixture. A saved alias
 // from the previous test must not leak into the next test's initial state.
 profiles.splice(0,profiles.length,{profile_key:'member:guest-2',screen_name:'Pocket Rocket',avatar_data:null,avatar_emoji:'♠️',
  phone:'+61412345678',preferred_contact:'whatsapp',private_notes:'Only host can see this',updated_at:now});
 const browser=await browserType.launch({headless:true});
 try{
  const ctx=await browser.newContext({viewport:{width,height},serviceWorkers:'block'});
  await ctx.addInitScript(()=>localStorage.setItem('pkr_token','synthetic-profile-test'));
  const page=await ctx.newPage();page.setDefaultTimeout(18000);
  const unexpected=[];const updates=[];
  await page.route('**/*.workers.dev/**',async route=>{
   const request=route.request(),url=new URL(request.url());
   if(url.origin!==API){unexpected.push('Unexpected API origin '+url.origin);return route.abort();}
   const p=url.pathname,method=request.method();
   let value=null,status=200;
   if(method==='GET'){
    if(p==='/auth/me')value=host;
    else if(p==='/events')value=[room];
    else if(p==='/events/profile-room')value={...room,members:[host,player]};
    else if(p==='/events/profile-room/games'||p==='/events/profile-room/history'||p==='/events/profile-room/leaderboard')value=[];
    else if(p==='/events/profile-room/profiles')value={profiles};
    else if(p==='/events/profile-room/players')value=[];
    else if(p==='/events/profile-room/join-requests')value={requests:[]};
    else if(p==='/events/profile-room/phone-contacts')value={contacts:[]};
    else if(p==='/events/profile-room/push-registrations')value={members:[],definition:'device registration'};
    else if(p==='/games')value=[];
    else{value={error:'Not found'};status=404;}
   }else if(method==='PUT'&&p==='/events/profile-room/profiles'){
    const payload=JSON.parse(request.postData()||'{}');
    updates.push(payload);
    const i=profiles.findIndex(x=>x.profile_key===payload.profile_key);
    const saved={...payload,updated_at:now+1};
    if(i>=0)profiles[i]=saved;else profiles.push(saved);
    value={ok:true,profile:saved};
   }else{unexpected.push(method+' '+p);return route.abort();}
   await route.fulfill({status,contentType:'application/json',body:JSON.stringify(value),
     headers:{'access-control-allow-origin':BASE,'access-control-allow-credentials':'true'}});
  });
  await page.goto(BASE+'/events/profile-room?tab=members&view=roster',{waitUntil:'domcontentloaded'});
  const btn=page.getByRole('button',{name:'Edit player profile for Dhronal Shah'});
  await btn.waitFor({state:'visible'});
  const roomName=page.locator('.pkr-member-roster').getByText('Pocket Rocket',{exact:true});
  try{await roomName.waitFor({state:'visible',timeout:6000});}
  catch(error){
    const debug=await page.evaluate(()=>({
      title:document.title,room:document.querySelector('.pkr-member-roster')?.textContent||'',
      notices:[...document.querySelectorAll('.pkr-member-profile-notice')].map(x=>x.textContent),
      preview:document.body.innerText.slice(0,1800),
    }));
    console.error('PROFILE RENDER DEBUG',JSON.stringify(debug),'unexpected',JSON.stringify(unexpected));
    await page.screenshot({path:path.join(out,engine+'-'+width+'-profile-debug.png')});
    throw error;
  }
  assert.equal(await page.locator('.pkr-member-roster').getByText('Dhronal Shah',{exact:true}).count()>0,true);
  assert.equal((await page.locator('.pkr-member-roster').innerText()).includes('+61412345678'),false,
   'Phone must never appear in public member roster');
  await btn.click();
  const dialog=page.locator('.pkr-player-profile-editor');await dialog.waitFor({state:'visible'});
  assert.equal(await dialog.getByRole('textbox',{name:/Screen name/i}).inputValue(),'Pocket Rocket');
  assert.equal(await dialog.getByRole('textbox',{name:/Mobile number/i}).inputValue(),'+61412345678');
  assert.equal(await dialog.getByRole('textbox',{name:/Host notes/i}).inputValue(),'Only host can see this');
  await dialog.getByRole('textbox',{name:/Screen name/i}).fill('Ace of Spades');
  await dialog.getByRole('button',{name:'Choose 🃏 avatar'}).click();
  await dialog.getByRole('textbox',{name:/Mobile number/i}).fill('+61 412 999 123');
  await dialog.getByRole('textbox',{name:/Host notes/i}).fill('Private updated note');
  const view=await page.evaluate(()=>{
    const root=document.querySelector('.pkr-player-profile-sheet');
    const form=document.querySelector('.pkr-player-profile-editor');
    const inputs=[...document.querySelectorAll('.pkr-player-profile-presets button,.pkr-player-profile-field input,.pkr-player-profile-field textarea')];
    const rect=root.getBoundingClientRect(),formRect=form.getBoundingClientRect();
    return {width:innerWidth,root:[rect.left,rect.right],form:[formRect.left,formRect.right],
      outOfBounds:inputs.filter(el=>{const b=el.getBoundingClientRect();return b.left< -1||b.right>innerWidth+1;}).map(el=>el.outerHTML.slice(0,100))};
  });
  assert(view.root[0]>=-1&&view.root[1]<=view.width+1&&view.form[0]>=-1&&view.form[1]<=view.width+1,
    'Profile editor must fit the phone width: '+JSON.stringify(view));
  assert.deepEqual(view.outOfBounds,[],'Profile editor fields/avatars overflow horizontally: '+JSON.stringify(view));
  await page.screenshot({path:path.join(out,engine+'-'+width+'-editor.png')});
  await dialog.getByRole('button',{name:'Save profile'}).click();
  await dialog.waitFor({state:'detached'});
  assert.equal(updates.length,1,'Profile save must be the only mutation');
  assert.equal(updates[0].profile_key,'member:guest-2');
  assert.equal(updates[0].screen_name,'Ace of Spades');
  assert.equal(updates[0].avatar_emoji,'🃏');
  assert.equal(updates[0].phone,'+61 412 999 123');
  await page.locator('.pkr-member-roster').getByText('Ace of Spades',{exact:true}).waitFor({state:'visible'});
  await page.screenshot({path:path.join(out,engine+'-'+width+'-members.png')});
  assert.equal((await page.locator('.pkr-member-roster').innerText()).includes('Private updated note'),false);
  assert.deepEqual(unexpected,[]);
  await ctx.close();
 }finally{await browser.close();}
}
(async()=>{
 for(const [engine,type,w,h] of [['chromium',chromium,390,844],['chromium',chromium,1440,900],['webkit',webkit,390,844]])
  await runEngine(engine,type,w,h);
 console.log('PASS: synthetic member profile editor on phone/desktop, nickname/avatar changes and private contacts; no financial writes.');
})().catch(error=>{console.error(error);process.exitCode=1;});
