'use strict';
// Synthetic browser-only regression. Never calls a production Worker, stores
// personal information or grants private-group membership from a room URL.
const assert=require('node:assert/strict');
const {chromium,webkit}=require('playwright');
const BASE='http://127.0.0.1:3000';
const API='https://pkr-reloaded-worker-staging.jeemit1.workers.dev';
const now=Math.floor(Date.now()/1000);
const member={id:'synthetic-player',name:'Test Player',email:'test@example.invalid',
  plan:'trial',is_active:true,trial_active:true,trial_days_left:10,avatar_url:null};
const firstRoom={id:'room-one',name:'First Test Club',role:'member',status:'active',
  host_id:'host-one',buy_in:2000,description:'',created_at:now-10000,member_count:3,game_count:1};
const secondRoom={...firstRoom,id:'room-two',name:'Second Test Club'};
const game={id:'upcoming-two',event_id:'room-two',scheduled_at:now+86400,
  status:'scheduled',location:'Synthetic venue',notes:'',seats:9,live_token:null,results_token:null};
const receiptToken='a'.repeat(64);
async function run(engine){
  const browser=await engine.launch({headless:true});
  try{
    for(const authorised of [true,false]){
      const ctx=await browser.newContext({viewport:{width:390,height:844},serviceWorkers:'block',acceptDownloads:true});
      await ctx.addInitScript(()=>localStorage.setItem('pkr_token','synthetic-authorised-jwt'));
      const page=await ctx.newPage();
      page.setDefaultTimeout(16000);
      const errors=[],requests=[],writes=[];
      let guests=[];
      page.on('pageerror',error=>errors.push(error.message));
      await page.route('**/*.workers.dev/**',async route=>{
        const req=route.request(),url=new URL(req.url()),method=req.method(),p=url.pathname;
        if(url.origin!==API){errors.push('Unexpected API origin '+url.origin);await route.abort();return;}
        requests.push(method+' '+p);
        let data={},status=200;
        if(method==='POST'&&p==='/auth/device-session/start')data={refresh_token:'b'.repeat(64),expires_in:45*86400};
        else if(method==='GET'&&p==='/auth/me')data=member;
        else if(method==='GET'&&p==='/events')data=authorised?[firstRoom,secondRoom]:[firstRoom];
        else if(method==='GET'&&p==='/events/room-one')data={...firstRoom,members:[]};
        else if(method==='GET'&&p==='/events/room-one/games')data=[];
        else if(method==='GET'&&p==='/events/room-one/history')data=[];
        else if(method==='GET'&&p==='/events/room-one/leaderboard')data=[];
        else if(method==='GET'&&p==='/events/room-one/settlement-ledger')data={games:[],transfers:[]};
        else if(authorised&&method==='GET'&&p==='/events/room-two')data={...secondRoom,members:[]};
        else if(authorised&&method==='GET'&&p==='/events/room-two/games')data=[game];
        else if(authorised&&method==='GET'&&p==='/events/room-two/history')data=[];
        else if(authorised&&method==='GET'&&p==='/events/room-two/leaderboard')data=[];
        else if(authorised&&method==='GET'&&p==='/events/room-two/settlement-ledger')data={games:[],transfers:[]};
        else if(authorised&&method==='GET'&&p==='/games/upcoming-two/rsvp-board')data={
          event:secondRoom,game,version:1,guests,players:[],options:['19:00']};
        else if(authorised&&method==='POST'&&p==='/games/upcoming-two/rsvp-board'){
          const body=JSON.parse(req.postData()||'{}');
          writes.push(body);
          if(guests.length&&!('edit_token' in body)){
            status=409;data={error:'Missing edit token'};
          }else if(guests.length&&body.edit_token!==receiptToken){
            status=403;data={error:'Invalid edit token'};
          }else{
            guests=[{id:'synthetic-guest',display_name:body.display_name,
              arrival_option:body.arrival_option,seat_number:body.seat_number,
              status:body.arrival_option==='not-coming'?'no':'yes',updated_at:now}];
            data={ok:true,id:'synthetic-guest',edit_token:receiptToken,status:guests[0].status,
              arrival_option:body.arrival_option,seat_number:body.seat_number};
          }
        }else{
          status=404;data={error:'Synthetic endpoint not defined'};
          errors.push('Unexpected '+method+' '+p);
        }
        await route.fulfill({status,contentType:'application/json',headers:{
          'access-control-allow-origin':BASE,
          'access-control-allow-credentials':'true',
          'access-control-allow-headers':'Content-Type,Authorization',
          'access-control-allow-methods':'GET,POST,OPTIONS'},body:JSON.stringify(data)});
      });
      await page.goto(BASE+'/instant?room=room-two',{waitUntil:'domcontentloaded'});
      await page.waitForURL('**/dashboard*');
      await page.locator('[data-testid="player-dashboard"]').waitFor();
      assert.equal(await page.getByText('PKR Instant',{exact:true}).count(),0,
        'Legacy link must not open a second player experience');
      if(authorised){
        // Target the actual player dashboard; the mobile-hidden desktop sidebar also has this text.
        await page.locator('[data-testid="player-dashboard"]').getByText('Second Test Club',{exact:false}).first().waitFor({state:'visible'});
        await page.locator('[data-testid="unified-player-rsvp"]').waitFor();
        await page.getByText('My payments',{exact:true}).first().waitFor();
        await page.getByRole('button',{name:'Results',exact:true}).first().waitFor();
        await page.getByRole('button',{name:'My profile',exact:false}).first().waitFor();
        const download=page.waitForEvent('download');
        await page.getByRole('button',{name:'Add to calendar'}).click();
        assert.match((await download).suggestedFilename(),/PKR-poker-night\.ics/);
        await page.locator('.pkr-player-rsvp-choices button').first().click();
        await page.locator('.pkr-player-rsvp-seat select').selectOption('2');
        await page.getByRole('button',{name:'Save my RSVP'}).click();
        await page.getByText('Your RSVP and seat choice have been saved.').waitFor();
        assert.equal(writes.length,1);
        assert.equal(writes[0].seat_number,2);
        assert.equal(guests.length,1);
        assert.equal(await page.evaluate(()=>Boolean(localStorage.getItem('pkr:rsvp:v2:upcoming-two'))),true);
        // Simulate an old PKR Instant RSVP browser that has only its legacy edit token.
        await page.evaluate(()=>localStorage.removeItem('pkr:rsvp:v2:upcoming-two'));
        assert.equal(await page.evaluate(()=>Boolean(localStorage.getItem('pkr:instant:rsvp:upcoming-two'))),true);
        await page.goto(BASE+'/instant?room=room-two',{waitUntil:'domcontentloaded'});
        await page.waitForURL('**/dashboard*');
        await page.getByRole('button',{name:'Update my RSVP'}).waitFor();
        await page.getByRole('button',{name:'Not coming'}).click();
        await page.getByRole('button',{name:'Update my RSVP'}).click();
        await page.getByText('Your host can see that you cannot attend.').waitFor();
        assert.equal(writes.length,2);
        assert.equal(writes[1].edit_token,receiptToken,'Editing must reuse existing proof');
        assert.equal(guests.length,1,'Revisiting a saved RSVP must not duplicate it');
        assert.equal(guests[0].status,'no');
      }else{
        assert.equal(requests.some(x=>x.includes('/events/room-two/')||x.includes('/games/upcoming-two/')),false,
          'Unapproved user must not access private room data using only a shared URL');
        assert.equal(await page.getByText('Second Test Club').count(),0);
      }
      assert.deepEqual(errors,[],'No script errors or unexpected network calls');
      console.log('PASS '+engine.name()+' '+(authorised?'approved player':'unapproved link')+' unified dashboard');
      await ctx.close();
    }
  }finally{await browser.close();}
}
(async()=>{for(const engine of [chromium,webkit])await run(engine);})()
  .catch(error=>{console.error(error);process.exitCode=1;});
