'use strict';
// Synthetic host flow. No real member accounts or production financial requests.
const {chromium}=require('playwright');
const assert=require('node:assert/strict');
const BASE='http://127.0.0.1:3000';
const API='https://pkr-reloaded-worker-staging.jeemit1.workers.dev';
const room={id:'room-merge-demo',name:'Test Poker Room',status:'active',role:'host',host_id:'synthetic-host',member_count:3,game_count:9,buy_in:5000,created_at:100};
const host={id:'synthetic-host',name:'Test Host',email:'host@example.invalid',role:'host',joined_at:100};
const to={id:'member-main',name:'Sam Patel',role:'member',joined_at:100};
const from={id:'member-guest',name:'Sam',role:'member',joined_at:100};
const leader=(id,name,count,total)=>({
  user_id:id,display_name:name,games_played:count,games_won:0,
  total_net:total,biggest_win:0,biggest_loss:Math.abs(total),
  last_played:100,aliases:[name],source_game_players:Array.from({length:count},(_,i)=>({game_id:id+'-game-'+i,user_id:id})),
});
const source=leader('member-guest','Sam',5,-25500);
const target=leader('member-main','Sam Patel',4,-111000);
const combined={...target,display_name:'Sam Patel',games_played:9,total_net:-136500,
  biggest_loss:111000,aliases:['Sam Patel','Sam'],
  source_game_players:[...source.source_game_players,...target.source_game_players]};
const link={from_user_id:source.user_id,to_user_id:target.user_id,
  from_name:source.display_name,to_name:target.display_name,created_at:1700000000000,
  created_by:'synthetic-host'};
async function test(){
  const browser=await chromium.launch({headless:true});
  try{
    let merged=false,posts=0,undos=0;
    const context=await browser.newContext({viewport:{width:390,height:844},serviceWorkers:'block'});
    await context.addInitScript(()=>localStorage.setItem('pkr_token','synthetic-test-only'));
    const page=await context.newPage();
    page.setDefaultTimeout(20000);
    const errors=[];page.on('pageerror',error=>errors.push(error.message));
    page.on('dialog',dialog=>void dialog.accept());
    await page.route('**/*.workers.dev/**',async route=>{
      const request=route.request(),url=new URL(request.url()),p=url.pathname,method=request.method();
      if(url.origin!==API)throw Error('Blocked unexpected API origin');
      let result={};let status=200;
      if(method==='GET'){
        if(p==='/auth/me')result={...host,plan:'pro',is_active:true};
        else if(p==='/events')result=[room];
        else if(p==='/events/room-merge-demo')result={...room,members:[host,from,to]};
        else if(p==='/events/room-merge-demo/leaderboard')result=merged?[combined]:[source,target];
        else if(p==='/events/room-merge-demo/players/merges')result={merges:merged?[link]:[]};
        else if(p==='/events/room-merge-demo/games'||p==='/events/room-merge-demo/history'||
            p==='/events/room-merge-demo/players')result=[];
        else if(p==='/events/room-merge-demo/profiles')result={profiles:[]};
        else if(p==='/events/room-merge-demo/phone-contacts')result={contacts:[]};
        else if(p==='/events/room-merge-demo/join-requests')result={requests:[]};
        else if(p==='/events/room-merge-demo/push-registrations')result={members:[]};
        else if(p==='/events/room-merge-demo/historical-player-visibility')result={hidden_names:[]};
        else result={error:'Unrecognised synthetic read: '+p};
      }else if(method==='POST'&&p==='/auth/device-session/start'){
        result={refresh_token:'a'.repeat(64),expires_in:45*86400};
      }else if(method==='POST'&&p==='/events/room-merge-demo/players/merge'){
        const body=JSON.parse(request.postData()||'{}');
        assert.equal(body.from_user_id,'member-guest');
        assert.equal(body.to_user_id,'member-main');
        assert.equal(body.from_games,5);assert.equal(body.to_games,4);
        assert.equal(body.from_net,-25500);assert.equal(body.to_net,-111000);
        assert.equal(body.confirm_same_person,true);
        merged=true;posts++;
        result={ok:true,leaders:[combined],merge:link};
      }else if(method==='DELETE'&&p==='/events/room-merge-demo/players/merge/member-guest'){
        merged=false;undos++;result={ok:true,leaders:[source,target]};
      }else{
        errors.push('Unexpected API write '+method+' '+p);
        result={error:'No fixture for '+p};
      }
      await route.fulfill({status:result.error?404:status,contentType:'application/json',
        headers:{'access-control-allow-origin':BASE,'access-control-allow-credentials':'true'},
        body:JSON.stringify(result)});
    });
    await page.goto(BASE+'/events/room-merge-demo?tab=members&view=roster',{waitUntil:'domcontentloaded'});
    await page.getByRole('button',{name:/Merge Duplicate Players/}).click();
    const modal=page.locator('.modal-overlay .modal').first();
    await modal.getByRole('heading',{name:/Combine player histories/}).count().catch(()=>{});
    const selects=modal.locator('select');
    assert.equal(await selects.count(),2);
    await selects.nth(0).selectOption('member-guest');
    await selects.nth(1).selectOption('member-main');
    await modal.getByText('9 recorded games').waitFor();
    await modal.getByText('-$1,365',{exact:false}).waitFor();
    const combine=modal.getByRole('button',{name:'Combine histories'});
    assert.equal(await combine.isDisabled(),true,'Host must confirm same person');
    await modal.getByRole('checkbox').check();
    await combine.click();
    await modal.getByText('Combined successfully.',{exact:false}).waitFor();
    assert.equal(posts,1,'Only one alias link may be submitted');
    await modal.getByText('Previous combined histories (1)',{exact:false}).click();
    await modal.getByRole('button',{name:'Undo'}).click();
    await modal.getByText('History link undone.',{exact:false}).waitFor();
    assert.equal(undos,1);
    assert.deepEqual(errors,[],'No accidental financial writes or JS errors');
    console.log('PASS synthetic mobile host merge + explicit consent + reconciled 9-game preview + Undo');
    await context.close();
  }finally{await browser.close();}
}
test().catch(e=>{console.error(e);process.exitCode=1;});
