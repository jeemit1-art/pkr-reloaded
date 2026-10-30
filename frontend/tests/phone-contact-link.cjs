'use strict';
// Synthetic browser regression for matching an existing authorised player to a
// previously invited private phone contact. Never uses production records.
const {chromium}=require('playwright');
const assert=require('node:assert/strict');
const BASE='http://127.0.0.1:3000';
const API='https://pkr-reloaded-worker-staging.jeemit1.workers.dev';
const now=Math.floor(Date.now()/1000);
const room={id:'member-sync-test',name:'Friday Night Poker',status:'active',
 host_id:'host-1',role:'host',buy_in:2500,created_at:now-86400,member_count:2,game_count:0};
const host={id:'host-1',name:'Test Host',role:'host',email:'host@invalid.example',avatar_url:null,joined_at:now-86400};
const member={id:'member-1',name:'Pintoo Bhai',role:'member',email:'player@invalid.example',avatar_url:null,joined_at:now-3600};
const contact={id:'contact-1',display_name:'Pintoo Bhai',phone:'+61400000000',status:'invited',user_id:null};
async function main(){
 const browser=await chromium.launch({headless:true,args:['--no-sandbox']});
 const result=[];
 try{
  for(const width of [390,1440]){
   let linked=false,requests=0;
   const ctx=await browser.newContext({viewport:{width,height:844},serviceWorkers:'block'});
   await ctx.addInitScript(()=>localStorage.setItem('pkr_token','synthetic-test-only'));
   const page=await ctx.newPage();
   page.setDefaultTimeout(20000);
   const exceptions=[];page.on('pageerror',e=>exceptions.push(e.message));
   await page.route('**/*.workers.dev/**',async route=>{
    const req=route.request(),u=new URL(req.url()),p=u.pathname,method=req.method();
    if(u.origin!==API){return route.abort();}
    let value,status=200;
    if(method==='GET'){
      if(p==='/auth/me')value=host;
      else if(p==='/events')value=[room];
      else if(p==='/events/member-sync-test')value={...room,members:[host,member]};
      else if(p==='/events/member-sync-test/games'||p==='/events/member-sync-test/history'||p==='/events/member-sync-test/leaderboard'||p==='/events/member-sync-test/players')value=[];
      else if(p==='/events/member-sync-test/profiles')value={profiles:[]};
      else if(p==='/events/member-sync-test/join-requests')value={requests:[]};
      else if(p==='/events/member-sync-test/phone-contacts')value={contacts:[{...contact,status:linked?'joined':'invited',user_id:linked?'member-1':null}]};
      else if(p==='/events/member-sync-test/push-registrations')value={members:[]};
      else if(p==='/games')value=[];
      else value={error:'No fixture for '+p};
    }else if(method==='POST'&&p==='/events/member-sync-test/phone-contacts/contact-1/link-member'){
      const body=JSON.parse(req.postData()||'{}');
      assert.equal(body.user_id,'member-1');
      linked=true;requests++;value={ok:true,status:'joined',user_id:'member-1'};
    }else{throw Error('Unexpected request '+method+' '+p);}
    await route.fulfill({status,contentType:'application/json',headers:{'access-control-allow-origin':BASE,'access-control-allow-credentials':'true'},body:JSON.stringify(value)});
   });
   await page.goto(BASE+'/events/member-sync-test?tab=members&view=invite',{waitUntil:'domcontentloaded'});
   const label=page.getByText('Invitation sent — not yet joined',{exact:false}).first();
   try{await label.waitFor({state:'visible',timeout:6500});}catch(e){
    console.log('DEBUG URL',page.url());
    console.log('DEBUG BODY',(await page.locator('body').innerText()).slice(0,5000));
    console.log('DEBUG EXCEPTIONS',exceptions);
    throw e;
   }
   const match=page.getByRole('button',{name:'Match existing member'});
   await match.click();
   const selector=page.locator('#pkr-link-member-choice');
   await selector.waitFor({state:'visible'});
   assert.equal(await selector.locator('option').count(),2);
   await selector.selectOption('member-1');
   await page.getByRole('button',{name:'Confirm member match'}).click();
   await page.getByText('+61400000000 · Joined',{exact:false}).waitFor({state:'visible'});
   assert.equal(requests,1);
   assert.equal(await page.getByRole('button',{name:'Match existing member'}).count(),0);
   const overflow=await page.evaluate(()=>document.documentElement.scrollWidth>window.innerWidth+5);
   assert.equal(overflow,false,'horizontal scroll on '+width);
   assert.deepEqual(exceptions,[],'no JS runtime errors');
   result.push('PASS '+width+'px existing member link, confirmed Joined status, no unintended mutation');
   await ctx.close();
  }
 }finally{await browser.close();}
 console.log(result.join('\n'));
}
main().catch(e=>{console.error(e);process.exitCode=1});

