// Synthetic-only modal tests. No billing writes, camera access or production data.
const {chromium}=require('playwright');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const BASE='http://127.0.0.1:3000';
const API='https://pkr-reloaded-worker-staging.jeemit1.workers.dev';
const sizes=[{width:320,height:700},{width:390,height:844},{width:844,height:390},{width:768,height:1024},{width:1024,height:768},{width:1440,height:900}];
const output=path.resolve(__dirname,'../../artifacts/plan-dialog');
fs.mkdirSync(output,{recursive:true});
(async()=>{
 const browser=await chromium.launch({headless:true});
 const failures=[];
 try{
  for(const viewport of sizes){
   const context=await browser.newContext({viewport});
   await context.addInitScript(()=>localStorage.setItem('pkr_token','synthetic-modal-only'));
   await context.route('**/*.workers.dev/**',async route=>{
    const request=route.request(),url=new URL(request.url());
    if(url.origin!==API||!['GET','OPTIONS'].includes(request.method())){
     failures.push('Blocked unexpected production or billing mutation');return route.abort();
    }
    let body={};
    if(url.pathname==='/auth/me')body={id:'synthetic-modal-host',name:'Demo Host',email:'demo@invalid.example',plan:'pro',is_active:true,trial_active:false};
    else if(url.pathname==='/events')body=[];
    else if(url.pathname==='/billing/plan')body={is_active:false,has_payment:false,plan:'free'};
    else if(request.method()!=='OPTIONS')return route.fulfill({status:404,contentType:'application/json',headers:{'access-control-allow-origin':BASE},body:'{"error":"No synthetic fixture"}'});
    return route.fulfill({status:200,contentType:'application/json',headers:{'access-control-allow-origin':BASE,'access-control-allow-headers':'Content-Type,Authorization','access-control-allow-methods':'GET,OPTIONS'},body:JSON.stringify(body)});
   });
   const page=await context.newPage();
   try{
    await page.goto(BASE+'/dashboard',{waitUntil:'domcontentloaded',timeout:45000});
    await page.locator('.pkr-dashboard').waitFor({state:'visible',timeout:25000});
    await page.evaluate(()=>window.dispatchEvent(new CustomEvent('pkr:upgrade_required',{detail:{feature:'create_game'}})));
    const dialog=page.getByRole('dialog',{name:'Choose a PKR plan'});
    await dialog.waitFor({state:'visible',timeout:10000});
    const bounds=await dialog.evaluate(el=>{
     const r=el.getBoundingClientRect();
     return {top:r.top,bottom:r.bottom,left:r.left,right:r.right,height:innerHeight,width:innerWidth,overflow:getComputedStyle(el).overflowY,portal:el.parentElement.parentElement===document.body};
    });
    assert.ok(bounds.portal,'Dialog remains trapped in page stacking context');
    assert.ok(bounds.top>=0&&bounds.bottom<=bounds.height&&bounds.left>=0&&bounds.right<=bounds.width,JSON.stringify(bounds));
    assert.equal(bounds.overflow,'auto');
    const close=dialog.getByRole('button',{name:'Close plan options'});
    await close.scrollIntoViewIfNeeded();
    assert.ok(await close.evaluate(el=>{const r=el.getBoundingClientRect(),hit=document.elementFromPoint(r.x+r.width/2,r.y+r.height/2);return hit===el||el.contains(hit);}),'Close action is obstructed');
    const cancel=dialog.getByRole('button',{name:'Maybe later'});
    await cancel.scrollIntoViewIfNeeded();
    assert.ok(await cancel.evaluate(el=>{const r=el.getBoundingClientRect(),hit=document.elementFromPoint(r.x+r.width/2,r.y+r.height/2);return r.bottom<=innerHeight&&(hit===el||el.contains(hit));}),'Footer action is behind navigation');
    await page.screenshot({path:path.join(output,viewport.width+'x'+viewport.height+'-plan-dialog.png'),fullPage:false});
    await cancel.click();
    await dialog.waitFor({state:'hidden',timeout:5000});
    await page.evaluate(()=>window.dispatchEvent(new CustomEvent('pkr:upgrade_required',{detail:{feature:'create_game'}})));
    await dialog.waitFor({state:'visible'});
    await page.keyboard.press('Escape');
    await dialog.waitFor({state:'hidden',timeout:5000});

    // Mirror the existing inline scanner DOM without invoking getUserMedia.
    // This verifies its stacking/scroll geometry, not actual QR decoding.
    await page.evaluate(()=>{
     const container=document.querySelector('.pkr-dashboard .pkr-content');
     if(!container)throw new Error('Dashboard content missing');
     const overlay=document.createElement('div');
     overlay.id='synthetic-scanner-overlay';
     overlay.style.cssText='position:fixed;inset:0;background:rgba(0,0,0,.92);z-index:1000;display:flex;flex-direction:column;align-items:center;justify-content:center;padding:24px';
     overlay.innerHTML='<div data-testid="scanner-frame" style="width:100%;max-width:360px;overflow:hidden;background:#131A1F;border-radius:12px"><div style="display:flex;align-items:center;justify-content:space-between;padding:16px 20px"><span>Scan Invite QR</span><button aria-label="Close test scanner">Close</button></div><div style="padding:20px"><video id="scanVideo" style="width:100%;height:280px;background:#000;display:block"></video><p>Camera placeholder for layout testing only</p></div></div>';
     container.appendChild(overlay);
    });
    const frame=page.getByTestId('scanner-frame');
    const scannerBounds=await frame.evaluate(el=>{const r=el.getBoundingClientRect();return {top:r.top,bottom:r.bottom,height:innerHeight,overflow:getComputedStyle(el).overflowY};});
    assert.ok(scannerBounds.top>=0&&scannerBounds.bottom<=scannerBounds.height,JSON.stringify(scannerBounds));
    assert.equal(scannerBounds.overflow,'auto');
    const scannerClose=page.getByRole('button',{name:'Close test scanner'});
    assert.ok(await scannerClose.evaluate(el=>{const r=el.getBoundingClientRect(),hit=document.elementFromPoint(r.x+r.width/2,r.y+r.height/2);return hit===el||el.contains(hit);}),'Scanner close button is obstructed');
    await page.screenshot({path:path.join(output,viewport.width+'x'+viewport.height+'-scanner-fixture.png'),fullPage:false});
    await page.evaluate(()=>document.getElementById('synthetic-scanner-overlay')?.remove());
   }catch(error){failures.push(viewport.width+'x'+viewport.height+': '+error.message);}
   finally{await context.close();}
  }
 }finally{await browser.close();}
 if(failures.length)throw new Error(failures.join('\n'));
 console.log('PASS: plan and scanner-layout dialogs stay above navigation and scroll within all six viewports. Plan closes by button/Escape. No checkout, production or camera calls.');
})().catch(error=>{console.error(error.message);process.exitCode=1;});
