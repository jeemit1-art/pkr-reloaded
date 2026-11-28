'use strict';
/* Authenticated browser proof with fictional, isolated PKR data.
 * No external service, real room or real payment record is contacted. */
const {chromium,webkit}=require('playwright');
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {BASE,API,room,settled,initialStorage,createFixture,FIXED_TIME}=require('../scripts/launch-fixture.cjs');
const output=path.resolve(__dirname,'../../artifacts/private-club');
fs.mkdirSync(output,{recursive:true});
const devices=[['small-phone',320,700],['iphone',430,873],['tablet',768,1024],['desktop',1440,900]];
const cases=[];
async function boot(browser,w,h,role='host',appearance='dark'){
 const fixture=createFixture();fixture.state.role=role;
 const ctx=await browser.newContext({viewport:{width:w,height:h},deviceScaleFactor:1,serviceWorkers:'block',reducedMotion:'reduce',locale:'en-AU',timezoneId:'Australia/Brisbane',isMobile:w<=430,hasTouch:w<=430});
 await ctx.addInitScript(({stored,appearance})=>{
  for(const [key,value] of Object.entries(stored))localStorage.setItem(key,value);
  localStorage.setItem('pkr_personal_visual_style_v1','private-club');
  localStorage.setItem('pkr_personal_appearance_v1',appearance);
  if(window.innerWidth<=430)Object.defineProperty(navigator,'standalone',{configurable:true,get:()=>true});
 },{stored:initialStorage,appearance});
 const failures=[],page=await ctx.newPage();page.setDefaultTimeout(19000);
 await page.clock.setFixedTime(new Date(FIXED_TIME));
 page.on('pageerror',error=>failures.push(error.message));
 await ctx.route('**/*',async route=>{
  const request=route.request(),url=new URL(request.url());
  if(url.origin===BASE)return route.continue();
  if(url.origin!==API)return route.abort();
  try{
   const body=fixture.resolve(url,request.method(),request.postData());
   return route.fulfill({status:200,body:JSON.stringify(body),contentType:'application/json',
    headers:{'access-control-allow-origin':BASE,'access-control-allow-credentials':'true','access-control-allow-headers':'Content-Type,Authorization','access-control-allow-methods':'GET,POST,PUT,OPTIONS'}});
  }catch(error){failures.push(String(error));return route.fulfill({status:404,body:'{"error":"No fictional record"}',contentType:'application/json'});}
 });
 return {page,ctx,fixture,failures};
}
async function validate(page,label,ignoreClipped=[]){
 await page.evaluate(()=>document.fonts.ready);
 const issues=await page.evaluate(ignore=>{
  const all=[...document.querySelectorAll('.pkr-no-hero-cta,.pkr-no-tools-grid button,.pkr-no-ticket-footer button,.pkr-no-player-next-actions button,.pkr-pc-lobby-filter button,.pkr-pc-lobby-actions button,.pkr-pc-rsvp-quick button,.pkr-no-player-links button')];
  const visible=all.filter(el=>{const r=el.getBoundingClientRect();return r.width>0&&r.height>0&&getComputedStyle(el).visibility!=='hidden'});
  return {width:innerWidth,scroll:document.documentElement.scrollWidth,
   clipped:visible.filter(el=>!ignore.some(t=>el.textContent?.includes(t))&&(el.scrollWidth>el.clientWidth+4||el.scrollHeight>el.clientHeight+4)).map(el=>({text:el.textContent,w:el.clientWidth,scroll:el.scrollWidth,h:el.clientHeight,sh:el.scrollHeight})),
   offscreen:visible.filter(el=>{const r=el.getBoundingClientRect();return r.left< -2||r.right>innerWidth+2}).map(el=>el.textContent)
  };
 },ignoreClipped);
 assert(issues.scroll<=issues.width+4,label+' document overflow '+JSON.stringify(issues));
 assert.equal(issues.clipped.length,0,label+' clipped text '+JSON.stringify(issues.clipped));
 assert.equal(issues.offscreen.length,0,label+' horizontal control '+JSON.stringify(issues.offscreen));
}
async function verifyBrandMark(page,context,selector){
 const emblem=page.locator(selector);
 await emblem.waitFor({state:'visible'});
 const result=await emblem.evaluate(el=>{
  const rect=el.getBoundingClientRect(),style=getComputedStyle(el);
  const image=el;
  return {src:image.getAttribute('src'),width:rect.width,height:rect.height,
    intrinsic:image.naturalWidth,opacity:Number(style.opacity),
    left:rect.left,right:rect.right,top:rect.top};
 });
 assert.equal(result.src,'/brand/pkr-night-mark.svg',context+' must use approved Open Chip K');
 assert(result.intrinsic>0,context+' logo must load correctly: '+JSON.stringify(result));
 assert(result.width>=24&&result.height>=24,context+' mark is too small: '+JSON.stringify(result));
 assert(result.opacity>0&&result.opacity<=1,context+' logo must be visible and not obstruct copy');
 assert(result.left>=-1&&result.right<=await page.evaluate(()=>innerWidth)+1,
  context+' logo must not stick out of phone viewport '+JSON.stringify(result));
}
async function runHost(browser,device){
 const [name,w,h]=device;const {page,ctx,failures}=await boot(browser,w,h);
 try{
  await page.goto(BASE+'/dashboard',{waitUntil:'domcontentloaded'});
  // The approved lounge is the default, and its legacy Home-view switch is intentionally hidden.
  try{await page.getByTestId('private-club-host-home').waitFor({state:'visible'});}catch(error){
   const info=await page.evaluate(()=>({url:location.href,style:document.documentElement.getAttribute('data-pkr-personal-style'),theme:document.documentElement.getAttribute('data-pkr-personal-theme'),body:document.body.innerText.slice(0,1600),rendered:!!document.querySelector('[data-testid="private-club-host-home"]'),display:document.querySelector('.pkr-privateclub-host-surface')?getComputedStyle(document.querySelector('.pkr-privateclub-host-surface')).display:null}));
   console.error('PRIVATE CLUB HOME DIAGNOSTICS',JSON.stringify({info,failures}));
   await page.screenshot({path:path.join(output,'failed-host-'+name+'.png')}).catch(()=>{});throw error;
  }
  assert(await page.locator('.pkr-privateclub-original-host').isHidden(),'Old host dashboard should not overlay approved UI');
  assert(await page.locator('.pkr-no-hero').isVisible(),'Approved blue game-night banner must be visible');
  assert(await page.locator('.pkr-no-next-ticket').isVisible(),'Real branded game-night pass must be visible');
  await verifyBrandMark(page,name+' Home','.pkr-no-ticket-mark');
   const hero=await page.locator('.pkr-no-hero').evaluate(el=>getComputedStyle(el).backgroundColor);
   assert.equal(hero,'rgb(16, 70, 248)',name+' Home must use official PKR blue');
  await validate(page,name+' host');
  await page.screenshot({path:path.join(output,'host-'+name+'.png')});
  await page.goto(BASE+'/events/'+room.id+'?tab=games',{waitUntil:'domcontentloaded'});
  await page.getByTestId('private-club-games').waitFor({state:'visible'});
  assert(await page.locator('.pkr-pc-old-games').isHidden(),'The old generic dashboard must not be visible beneath lobby');
  assert(await page.locator('.pkr-no-games-hero').isVisible(),'Games must use the official PKR blue banner');
  assert(await page.getByRole('heading',{name:/THE NIGHT IS ON/i}).isVisible(),'Approved PKR brand heading must be readable');
  assert(await page.locator('.pkr-cf-hero-metrics button').count()===3,'Real game metrics must be in the hero');
  assert.equal(await page.locator('.pkr-pc-lobby-filter button').count(),3);
  assert.equal(await page.locator('.pkr-cf-hero-photo').count(),0,name+' Games cannot show casino stock photography');
  await validate(page,name+' Games');
  await page.screenshot({path:path.join(output,'games-'+name+'.png')});
  await page.getByRole('navigation',{name:'Game lobby filters'}).getByRole('button',{name:/Live/}).click();
  assert.equal(await page.locator('.pkr-pc-lobby-ticket.is-live').count(),1,'Live tab must show the true active game');
  await page.getByRole('navigation',{name:'Game lobby filters'}).getByRole('button',{name:/Completed/}).click();
  assert((await page.locator('.pkr-pc-lobby-ticket').count())>=1,'Completed must display saved games');
  await page.getByRole('navigation',{name:'Game lobby filters'}).getByRole('button',{name:/Upcoming/}).click();
  const going=page.getByRole('button',{name:/Going/}).first();
  await going.waitFor({state:'visible'});
  await going.click();
  await page.waitForURL(url=>url.pathname.endsWith('/rsvp')&&url.searchParams.get('choice')==='yes',{timeout:12000});
  assert(new URL(page.url()).searchParams.get('choice')==='yes','Going must navigate to authorised RSVP form');
  assert(!failures.some(e=>/Forbidden fixture mutation|Unexpected API write/.test(e)),'No RSVP may be submitted automatically');
  // Keep Safari's existing RSVP flow separate from the dedicated directory test:
  // rapid WebKit navigation can cancel unsettled fixture requests.
  if(name!=='safari-iphone'){
  // Player directory must show one action pathway, not a second hero menu and podium.
  await page.goto(BASE+'/events/'+room.id+'?tab=members',{waitUntil:'domcontentloaded'});
  await page.getByTestId('private-club-players').waitFor({state:'visible'});
  assert(await page.locator('.pkr-no-members-stamps').isVisible(),name+' Players must show brand-numbered member badges');
  assert.equal(await page.locator('.pkr-pc-members-hero .pkr-pc-podium').count(),0,
   'Player rankings belong in Results; do not duplicate podium in Directory');
  assert.equal(await page.locator('.pkr-pc-members-hero .pkr-pc-members-actions button').count(),0,
   'No View Players / Invite Player buttons above the real Players navigation');
  const directoryNav=page.getByRole('navigation',{name:'Members quick actions'});
  assert.equal(await directoryNav.locator('button').count(),3,'Keep exactly one Directory, Invite & QR, Approvals action bar for host');
  assert(await page.locator('#pkr-member-search').isVisible(),'The searchable member list must appear beneath the action bar');
  const searchRect=await page.locator('.pkr-member-search-label').boundingBox();
  assert(searchRect&&searchRect.height>=43&&searchRect.height<=62,
   'Member search must remain a compact single-line control, never a 250px desktop panel: '+JSON.stringify(searchRect));
  assert(await page.getByRole('group',{name:'Filter members by role'}).isVisible(),'All / Admins / Players filters remain available');
  const heroRect=await page.getByTestId('private-club-players').boundingBox();
  assert(heroRect&&heroRect.height<=195,'Compact Players header must not consume the entire mobile fold: '+JSON.stringify(heroRect));
  await validate(page,'compact Players '+name);
  await page.screenshot({path:path.join(output,'players-'+name+'.png')});
  await directoryNav.getByRole('button',{name:/Invite & QR/}).click();
  assert(await page.locator('#pkr-mobile-name').isVisible(),'Invitation and WhatsApp/QR flow remains accessible');
  await directoryNav.getByRole('button',{name:/Directory/}).click();
  assert(await page.locator('#pkr-member-search').isVisible(),'Directory must reopen without losing filters or records');
  }
  if(w>=768){
   await page.goto(BASE+'/results?room='+room.id);
   await page.locator('.pkr-results-page').waitFor();
   await page.screenshot({path:path.join(output,'results-'+name+'.png')});
   await page.goto(BASE+'/payments?room='+room.id);
   await page.locator('.pkr-gn-payment-workspace').waitFor();
   await page.screenshot({path:path.join(output,'payments-'+name+'.png')});
  }
  assert.deepEqual(failures,[],name+' browser/API errors');
  cases.push('host-'+name);
 }finally{await ctx.close();}
}
async function runEmptyHost(browser,width=390,height=844){
 const {page,ctx,failures}=await boot(browser,width,height,'host');
 try{
  await page.route('**/events/'+room.id+'/games',route=>route.fulfill({
   status:200,contentType:'application/json',body:JSON.stringify(settled),
   headers:{'access-control-allow-origin':BASE,'access-control-allow-credentials':'true',
   'access-control-allow-headers':'Content-Type,Authorization',
   'access-control-allow-methods':'GET,POST,PUT,OPTIONS'}
  }));
  await page.goto(BASE+'/events/'+room.id+'?tab=games',{waitUntil:'domcontentloaded'});
  const button=page.locator('.pkr-cf-schedule');
  await button.waitFor({state:'visible'});
  await page.evaluate(()=>document.fonts.ready);
  assert(await page.locator('.pkr-no-empty-icon').isVisible(),'The official PKR mark must replace the old casino scenery');
  assert.equal(await page.locator('.pkr-cf-table-rim').count(),0,'No illustrated fake poker table in empty state');
  assert(await page.getByText('Ready for the next deal?').isVisible(),'The new empty-state heading must be visible');
  const computed=await button.evaluate(el=>{
   const text=el.querySelector('span'),style=getComputedStyle(el),foreground=text?getComputedStyle(text):null;
   return {background:style.backgroundColor,image:style.backgroundImage,ink:style.color,
    text:foreground?.color,fill:foreground?.getPropertyValue('-webkit-text-fill-color'),
    font:style.fontFamily,height:el.getBoundingClientRect().height,
    width:el.getBoundingClientRect().width};
  });
  assert.equal(computed.background,'rgb(199, 255, 58)','The primary host CTA must use approved PKR citron: '+JSON.stringify(computed));
  assert.equal(computed.image,'none','Do not use gradient imagery for buttons');
  assert.equal(computed.ink,'rgb(11, 13, 20)','Dark solid ink is required on a light CTA');
  assert(/Inter|bodyFont/i.test(computed.font),'Use crisp bundled UI typography: '+JSON.stringify(computed));
  assert(computed.height>=44&&computed.width>=140,'Tap target must be accessible: '+JSON.stringify(computed));
  await button.scrollIntoViewIfNeeded();
  const fold=await page.evaluate(()=>{
   const btn=document.querySelector('.pkr-cf-schedule')?.getBoundingClientRect();
   const nav=document.querySelector('.pkr-universal-bottom-nav')?.getBoundingClientRect();
   return {button:btn?.toJSON(),navigation:nav?.toJSON()};
  });
  assert(fold.button&&fold.navigation,'Host action and fixed bottom navigation must exist');
  assert(fold.button.top>=0&&fold.button.bottom<=fold.navigation.top+2,
    'Host CTA must be reachable without the fixed footer covering it: '+JSON.stringify(fold));
  await validate(page,'empty-host-'+width);
  await page.screenshot({path:path.join(output,'empty-host-'+width+'-night.png')});
  assert.deepEqual(failures,[],'Empty-screen browser errors');
  cases.push('official-empty-'+width);
 }finally{await ctx.close();}
}

async function runSafariMembers(browser){
 const {page,ctx,failures}=await boot(browser,390,844,'host');
 try{
  await page.goto(BASE+'/events/'+room.id+'?tab=members',{waitUntil:'domcontentloaded'});
  await page.getByTestId('private-club-players').waitFor({state:'visible'});
  assert.equal(await page.locator('.pkr-pc-members-hero .pkr-pc-podium').count(),0,
   'Safari directory must not show the duplicate top-three ranking');
  assert.equal(await page.locator('.pkr-pc-members-hero .pkr-pc-members-actions button').count(),0,
   'Safari directory must not show duplicate View/Invite actions');
  const nav=page.getByRole('navigation',{name:'Members quick actions'});
  assert.equal(await nav.locator('button').count(),3,'Safari must retain all member destinations');
  const rect=await page.locator('.pkr-member-search-label').boundingBox();
  assert(rect&&rect.height>=43&&rect.height<=62,'Safari member search must be a normal single-line field: '+JSON.stringify(rect));
  await validate(page,'safari directory');
  await page.screenshot({path:path.join(output,'players-safari-iphone.png')});
  await nav.getByRole('button',{name:/Invite & QR/}).click();
  assert(await page.locator('#pkr-mobile-name').isVisible(),'Safari invitation must be accessible');
  await nav.getByRole('button',{name:'Directory',exact:true}).click();
  assert(await page.locator('#pkr-member-search').isVisible(),'Safari directory must return');
  assert.deepEqual(failures,[],'Standalone Safari directory browser/API errors');
  cases.push('players-safari-iphone');
 }finally{await ctx.close()}
}

async function runCanonicalFromLegacyPreference(browser){
 // A member with an old saved light preference must still get ONE approved PKR identity.
 const {page,ctx,failures}=await boot(browser,390,844,'host','light');
 try{
  await page.goto(BASE+'/events/'+room.id+'?tab=members',{waitUntil:'domcontentloaded'});
  await page.getByTestId('private-club-players').waitFor({state:'visible'});
  assert.equal(await page.locator('html').getAttribute('data-pkr-personal-theme'),'dark','Legacy light preference must not override official PKR design');
  assert.equal(await page.locator('html').getAttribute('data-pkr-personal-style'),'private-club','The approved brand is canonical');
  const colours=await page.evaluate(()=>{
   const app=document.querySelector('.pkr-app.pkr-event'),nav=document.querySelector('.pkr-primary-bottom-nav.pkr-universal-bottom-nav');
   const hero=document.querySelector('.pkr-no-members');
   return {canvas:getComputedStyle(app).backgroundColor,nav:getComputedStyle(nav).backgroundColor,hero:getComputedStyle(hero).backgroundColor};
  });
  assert.equal(colours.canvas,'rgb(11, 13, 20)','Official PKR canvas must use ink');
  assert.equal(colours.nav,'rgb(13, 20, 36)','Official PKR navigation must be opaque');
  assert.equal(colours.hero,'rgb(21, 31, 53)','Official Players card must use branded slate');
  const player=page.locator('.pkr-directory-player').first();
  assert(await player.isVisible(),'At least one member card must render');
  assert(await player.locator('.pkr-directory-history').isVisible(),'Game history is one tap away');
  const details=player.getByRole('button',{name:/Details/});
  await details.click();assert(await player.locator('.pkr-directory-extra').isVisible(),'Member editing must expand when authorised');
  assert(await player.getByRole('button',{name:/Edit player profile/}).isVisible(),'The host keeps edit actions');
  await player.getByRole('button',{name:/Less/}).click();
  assert.equal(await player.locator('.pkr-directory-extra').count(),0,'Member details must collapse');
  await validate(page,'official brand members');
  await page.screenshot({path:path.join(output,'players-official-iphone.png')});
  await page.goto(BASE+'/dashboard',{waitUntil:'domcontentloaded'});
  await page.getByTestId('private-club-host-home').waitFor({state:'visible'});
  const host=await page.locator('.pkr-no-hero').evaluate(el=>getComputedStyle(el).backgroundColor);
  assert.equal(host,'rgb(16, 70, 248)','Host hero must be official blue');
  await page.goto(BASE+'/events/'+room.id+'?tab=games',{waitUntil:'domcontentloaded'});
  await page.getByTestId('private-club-games').waitFor({state:'visible'});
  const games=await page.locator('.pkr-no-games-hero').evaluate(el=>getComputedStyle(el).backgroundColor);
  assert.equal(games,'rgb(16, 70, 248)','Games hero must use exactly the same blue');
  await page.goto(BASE+'/results?room='+room.id,{waitUntil:'domcontentloaded'});
  await page.getByTestId('private-club-results').waitFor({state:'visible'});
  assert(await page.locator('.pkr-no-results').isVisible(),'Results must use official branded header');
  await page.goto(BASE+'/payments?room='+room.id,{waitUntil:'domcontentloaded'});
  await page.locator('.pkr-no-payments-hero').waitFor({state:'visible'});
  assert(await page.locator('.pkr-gn-payment-workspace').isVisible(),'Payments remain interactive');
  await page.goto(BASE+'/account',{waitUntil:'domcontentloaded'});
  const settings=page.getByTestId('personal-appearance');
  await settings.waitFor({state:'visible'});
  assert(await settings.getByText('PKR identity').isVisible(),'Account should describe the official brand');
  assert.equal(await settings.locator('[data-style-option]').count(),0,'There must not be another casino theme picker');
  assert.deepEqual(failures,[],'Brand parity browser/API errors');
  cases.push('single-brand-legacy-preference');
 }finally{await ctx.close();}
}

async function runPlayer(browser){
 const {page,ctx,failures}=await boot(browser,430,873,'member');
 try{
  await page.goto(BASE+'/dashboard');
  try{await page.getByTestId('private-club-player-home').waitFor({state:'visible'});}catch(error){
   console.error('PRIVATE CLUB PLAYER DIAGNOSTICS',JSON.stringify({url:page.url(),body:(await page.locator('body').innerText()).slice(0,1500),failures}));
   await page.screenshot({path:path.join(output,'failed-player.png')}).catch(()=>{});throw error;
  }
  assert(await page.locator('.pkr-no-player-pass').isVisible(),'Player must see the club member pass');
   assert(await page.locator('.pkr-no-player-next').isVisible(),'Player must see their real next game');
  await validate(page,'player');
  await page.screenshot({path:path.join(output,'player-iphone.png')});
  assert.deepEqual(failures,[]);
  cases.push('player-iphone');
 }finally{await ctx.close();}
}
(async()=>{
 const browser=await chromium.launch({headless:true});
 try{
  for(const item of devices)await runHost(browser,item);
  await runEmptyHost(browser,390,844);
  await runEmptyHost(browser,320,700);
  await runPlayer(browser);
  await runCanonicalFromLegacyPreference(browser);
 }finally{await browser.close();}
 const safari=await webkit.launch({headless:true});
 try{
  await runHost(safari,['safari-iphone',390,844]);
  await runSafariMembers(safari);
 }finally{await safari.close();}
 console.log('PASS The Night Is On browser: '+cases.join(', '));
})().catch(error=>{console.error(error.stack||error);process.exitCode=1;});
