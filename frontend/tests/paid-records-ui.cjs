// All payment records below are fictitious. No production API or credentials.
const {chromium}=require('playwright');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const BASE='http://127.0.0.1:3000';
const API='https://pkr-reloaded-worker-staging.jeemit1.workers.dev';
const out=path.resolve(__dirname,'../../artifacts/paid-records-ui');
fs.mkdirSync(out,{recursive:true});
const past=Math.floor(Date.now()/1000)-86400;
const room={id:'paid-demo-room',name:'Payment test room',status:'active',role:'host',host_id:'demo-host',member_count:3,game_count:1,buy_in:2500,created_at:past};
const game={id:'paid-demo-game',event_id:room.id,scheduled_at:past,status:'settled',seats:8,player_count:3,created_at:past,results_token:'paid-demo-results',live_token:null};
const history=Array.from({length:334},(_,i)=>({id:'demo-paid-'+i,from:'demo-payer',from_name:'Demo Payer',to:'demo-host',to_name:'Demo Host',amount:i===333?7605900-33300:100,status:'paid',paid_at:past}));
const owed={id:'demo-owed',from:'demo-current',from_name:'Current Payer',to:'demo-host',to_name:'Demo Host',amount:7500,status:'owed'};
const results={game,event:{name:room.name},players:[],transfers:[owed,...history]};
const user={id:'demo-host',name:'Demo Host',email:'demo@invalid.example',plan:'pro',is_active:true,trial_active:false};
const sizes=[{width:360,height:800},{width:390,height:844},{width:430,height:932},{width:768,height:1024},{width:1024,height:768},{width:1440,height:1000}];

function fixture(p){
 if(p==='/auth/me')return user;
 if(p==='/events')return [room];
 if(p==='/events/'+room.id)return {...room,members:[]};
 if(p==='/events/'+room.id+'/games')return [game];
 if(p==='/events/'+room.id+'/leaderboard')return [];
 if(p==='/games/results/paid-demo-results')return results;
 if(p==='/games/'+game.id)return {...game,players:[],rsvps:[]};
 if(p==='/games/'+game.id+'/settlement-control')return {enabled:false,reminders_enabled:false};
 return null;
}

(async()=>{
 const browser=await chromium.launch({headless:true});
 const errors=[];
 try{
  for(const viewport of sizes){
   const context=await browser.newContext({viewport,deviceScaleFactor:1});
   await context.addInitScript(()=>localStorage.setItem('pkr_token','synthetic-paid-records-only'));
   await context.route('**/*',async route=>{
    const url=new URL(route.request().url());
    if(url.origin===BASE)return route.continue();
    if(url.origin!==API){
     if(url.hostname.endsWith('workers.dev'))errors.push('Unexpected Worker origin; request blocked');
     return route.abort();
    }
    const method=route.request().method();
    if(method!=='GET'&&method!=='OPTIONS'){
     errors.push('Unexpected payment mutation; request blocked');
     return route.abort();
    }
    const response=method==='OPTIONS'?{}:fixture(url.pathname);
    if(response===null){errors.push('Missing synthetic endpoint: '+url.pathname);return route.abort();}
    return route.fulfill({status:200,contentType:'application/json',headers:{'access-control-allow-origin':BASE,'access-control-allow-headers':'Content-Type,Authorization','access-control-allow-methods':'GET,OPTIONS'},body:JSON.stringify(response)});
   });
   const page=await context.newPage();
   try{
    await page.goto(BASE+'/insights',{waitUntil:'domcontentloaded',timeout:45000});
    await page.locator('.pkr-insights-balance-tiles').waitFor({state:'visible',timeout:25000});
    await page.waitForFunction(()=>{
     const tiles=document.querySelectorAll('.pkr-insights-balance-tiles>div');
     return [...tiles].some(t=>t.textContent.includes('Transfers paid')&&t.querySelector('strong')?.textContent==='334');
    },null,{timeout:15000});
    assert.equal((await page.getByTestId('current-outstanding').textContent()).trim(),'$75','Paid records inflated outstanding');
    assert.equal(await page.getByTestId('legacy-settlement-notice').count(),0,'Reconciled payments still show a warning');
    assert.doesNotMatch(await page.locator('body').innerText(),/\blegacy\b|Historical transfers|unverified|excludes legacy/i);
    await page.getByRole('tab',{name:'Payment Status',exact:true}).click();
    assert.equal(await page.locator('.pkr-insights-payment-summary>div').count(),3,'Retired historical category remains');
    assert.doesNotMatch(await page.locator('.pkr-insights-payment-summary').innerText(),/legacy|historical|unverified/i);
    await page.screenshot({path:path.join(out,viewport.width+'-payment-summary.png'),fullPage:false});

    await page.goto(BASE+'/games/results/paid-demo-results',{waitUntil:'domcontentloaded',timeout:45000});
    await page.getByText('Who Pays Who',{exact:true}).waitFor({state:'visible',timeout:20000});
    await page.waitForFunction(()=>document.body.innerText.includes('Recorded as paid'),null,{timeout:10000});
    assert.equal(await page.getByText('✓ Recorded as paid',{exact:true}).count(),334,'Paid transfers not rendered from API');
    assert.equal(await page.getByRole('button',{name:'📋 Copy reminder',exact:true}).count(),1,'Paid transfers can still be chased for payment');
    assert.doesNotMatch(await page.locator('body').innerText(),/\blegacy\b|Historical settlement|unverified|Receipt confirmed/i);
    const paidRowsSafe=await page.evaluate(()=>[...document.querySelectorAll('span')]
     .filter(n=>n.textContent==='✓ Recorded as paid')
     .every(n=>![...n.parentElement.parentElement.querySelectorAll('button,a')]
       .some(b=>/Copy reminder|Send via WA|I have paid|Enable my alerts/.test(b.textContent))));
    assert.equal(paidRowsSafe,true,'A paid row has a repayment action');
    await page.screenshot({path:path.join(out,viewport.width+'-paid-results.png'),fullPage:false});
   }catch(e){errors.push(viewport.width+'px: '+e.message);}
   finally{await context.close();}
  }
 }finally{await browser.close();}
 if(errors.length)throw new Error(errors.join('\n'));
 console.log('PASS: all six viewports show 334 paid records, retain current owed balance, omit migration labels and prevent paid reminders. No production requests or mutations.');
})().catch(e=>{console.error(e.message);process.exitCode=1;});
