'use strict';
// All identities and responses are synthetic. No production API requests are made.
const assert=require('node:assert/strict');
const {chromium,webkit}=require('playwright');
const BASE='http://127.0.0.1:3000';
const API='https://pkr-reloaded-worker-staging.jeemit1.workers.dev';
const member={id:'member-existing',name:'Returning Player',email:'',plan:'trial',is_active:false};
const keys={valid:'synthetic-old-valid-jwt',restored:'synthetic-restored-jwt'};
async function run(engine){
  const browser=await engine.launch({headless:true});
  try{
    for(const variant of ['not-signed-in','previously-working','expired','transfer']){
      const context=await browser.newContext({viewport:{width:390,height:844},serviceWorkers:'block'});
      const errors=[],requests=[];
      if(variant==='previously-working'||variant==='expired')await context.addInitScript(token=>localStorage.setItem('pkr_token',token),keys.valid);
      const page=await context.newPage();
      page.setDefaultTimeout(16000);
      page.on('pageerror',error=>errors.push(error.message));
      await page.route('**/*.workers.dev/**',async route=>{
        const req=route.request(),url=new URL(req.url());
        if(url.origin!==API)throw Error('Unexpected API origin');
        requests.push(req.method()+' '+url.pathname);
        let status=200,response={};
        if(req.method()==='GET'&&url.pathname==='/auth/me'){
          if(variant==='expired') {status=401;response={error:'Expired session'};}
          else response=member;
        }else if(req.method()==='GET'&&url.pathname==='/events')response=[];
        else if(req.method()==='POST'&&url.pathname==='/auth/device-session/start'){
          response={refresh_token:'a'.repeat(64),expires_in:45*86400};
        }else if(req.method()==='POST'&&url.pathname==='/auth/transfer/redeem'){
          response={token:keys.restored};
        }else {
          errors.push('Unexpected API request: '+req.method()+' '+url.pathname);
          status=404;response={error:'No synthetic fixture'};
        }
        await route.fulfill({status,contentType:'application/json',
          headers:{'access-control-allow-origin':BASE,'access-control-allow-credentials':'true','access-control-allow-headers':'Content-Type,Authorization'},
          body:JSON.stringify(response)});
      });
      await page.goto(BASE+'/mobile-login',{waitUntil:'domcontentloaded'});
      if(variant==='previously-working'){
        await page.waitForURL('**/dashboard',{timeout:15000});
        assert(requests.includes('GET /auth/me'),'must validate old member JWT');
        await page.waitForTimeout(200);
        assert(requests.includes('POST /auth/device-session/start'),'old valid member must receive a renewable session');
      }else if(variant==='expired'){
        await page.getByRole('heading',{name:'Get back into PKR'}).waitFor();
        await page.getByRole('button',{name:/I cannot open PKR anywhere/}).waitFor();
        assert(new URL(page.url()).pathname==='/mobile-login','invalid JWT must not produce a login redirect loop');
        assert(!requests.some(x=>x.includes('/transfer/redeem')),'never auto-recover without claimant proof');
      }else if(variant==='not-signed-in'){
        await page.getByRole('button',{name:/I cannot open PKR anywhere/}).click();
        await page.getByRole('heading',{name:'Restore your original membership'}).waitFor();
        await page.getByRole('button',{name:/PKR still works in another browser/}).click();
        await page.getByRole('heading',{name:'Transfer your existing account'}).waitFor();
        assert.equal(requests.length,0,'new visitor must not make an authenticated request without credentials');
      }else{
        await page.getByRole('button',{name:/PKR still works in another browser/}).click();
        await page.locator('#pkr-transfer-code').fill('ABCDEFGHJKLMNPQR');
        await page.getByRole('button',{name:'Restore my existing account'}).click();
        await page.waitForURL('**/dashboard',{timeout:15000});
        assert(requests.includes('POST /auth/transfer/redeem'),'transfer must use secure server code');
      }
      assert.deepEqual(errors,[],'no JS errors or unexpected network writes');
      console.log('PASS '+engine.name()+' '+variant+' returning-member access');
      await context.close();
    }
  }finally{await browser.close();}
}
(async()=>{for(const engine of [chromium,webkit])await run(engine);})().catch(e=>{console.error(e);process.exitCode=1;});
