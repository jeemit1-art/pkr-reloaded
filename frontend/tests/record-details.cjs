'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),ts=require('typescript');
const file=path.resolve(__dirname,'../src/lib/record-details.ts');
const code=ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText;
const now=Math.floor(Date.now()/1000),game=(id,status='settled',age=0)=>({id,event_id:'r1',status,scheduled_at:now-age,results_token:'token-'+id,location:'Test room',seats:9,buy_in:10000});
const games=[game('g1'),game('g2','settled',120*86400),game('g3','scheduled')];
const payments=[
 {id:'p1',from:'a',from_name:'Alex',to:'b',to_name:'Blair',amount:1000,status:'paid'},
 {id:'p2',from:'a',from_name:'Alex',to:'b',to_name:'Blair',amount:2000,status:'owed'},
 {id:'p3',from:'a',from_name:'Alex',to:'c',to_name:'Casey',amount:300,status:'payer_claimed'},
 {id:'p4',from:'b',from_name:'Blair',to:'a',to_name:'Alex',amount:400,status:'not_received'},
 {id:'p5',from:'c',from_name:'Casey',to:'a',to_name:'Alex',amount:99999,status:'legacy'},
];
let failResults=false,failSaved=false;let requests=0;
const players=[{user_id:'a',display_name:'Alex',buy_ins:1,cashout:12000,net:2000,seat_number:1},
 {user_id:'different',display_name:'Alex',buy_ins:1,cashout:5000,net:-5000,seat_number:2}];
const api={events:{
 list:async()=>[{id:'r1',name:'Room 1',member_count:2,status:'active'},{id:'r2',name:'Archived room',status:'ended'}],
 get:async id=>{if(id!=='r1')throw new Error('Permission denied');return {id,name:'Room 1',buy_in:10000,members:[{id:'a',name:'Alex',role:'member',joined_at:now}]};},
 leaderboard:async()=>[{user_id:'a',display_name:'Alex',games_played:2,games_won:2,total_net:4000}],
},games:{
 list:async id=>{requests++;return id==='r1'?games:[];},
 live:async()=>({players,totalIn:20000,totalOut:17000,bank:3000}),
 get:async id=>{if(failSaved&&id==='g2')throw new Error('Saved record unavailable');return {...game(id),event_name:'Room 1',players,rsvps:[{id:'yes1',display_name:'Alex',status:'yes'},{id:'no1',display_name:'Casey',status:'no'}],transfers:id==='g1'?payments:[]};},
 results:async token=>{if(failResults&&token==='token-g2')throw new Error('Temporary outage');return {
  game:games.find(g=>g.results_token===token),
  players:token==='token-g2'?
    [{...players[0],user_id:'historic-alex-id',display_name:' Alex ',buy_ins:3,buy_in_total:10000},
     {...players[1],user_id:'old-other-id',display_name:'Casey'}]:players,
  transfers:token==='token-g1'?payments:[]};},
}};
const fmt=n=>(n<0?'-':'')+'$'+(Math.abs(n)/100).toFixed(2),fmtSign=n=>(n>0?'+':'')+fmt(n);
const moduleObject={exports:{}};
vm.runInNewContext(code,{module:moduleObject,exports:moduleObject.exports,require(name){
 if(name==='@/lib/api')return {api,fmt,fmtSign,fmtDate:n=>new Date(n*1000).toISOString()};
 if(name==='@/lib/game-status')return {isCurrentGame:g=>['scheduled','lobby','active'].includes(g.status)};
 throw new Error('Unexpected import '+name);
},Date,Map,Math,Promise,DOMException,Number,String,console});
const {loadRecordDetail:load,isOutstanding,paymentLabel}=moduleObject.exports;
(async()=>{
 assert.equal(isOutstanding(payments[0]),false);assert.equal(isOutstanding(payments[4]),false);
 assert(payments.slice(1,4).every(isOutstanding));assert.equal(paymentLabel(payments[2]),'Sent - awaiting receipt');
 assert.equal((await load({kind:'games',title:'All games',roomId:'r1'})).rows.length,3);
 assert.equal((await load({kind:'games',title:'Settled',roomId:'r1',filter:'settled'})).rows.length,2);
 assert.equal((await load({kind:'games',title:'Upcoming',roomId:'r1',filter:'upcoming'})).rows.length,1);
 assert.equal((await load({kind:'games',title:'Across rooms'})).rows.length,3);
 assert.equal((await load({kind:'rooms',title:'Active rooms'})).rows.length,1);
 const outstanding=await load({kind:'transfers',title:'Outstanding',roomId:'r1',filter:'outstanding'});
 assert.equal(outstanding.rows.length,3);assert.match(outstanding.summary,/\$27\.00/);
 const paid=await load({kind:'transfers',title:'Paid',roomId:'r1',filter:'paid'});
 assert.equal(paid.rows.length,1);assert.match(paid.summary,/\$10\.00/);
 const owing=await load({kind:'transfers',title:'People owing',roomId:'r1',filter:'owing'});
 const alex=owing.rows.find(row=>row.id==='a');assert.equal(alex.value,'$23.00');
 const outgoing=await load(alex.next);assert.equal(outgoing.rows.length,2);assert.match(outgoing.summary,/\$23\.00/);
 const balance=await load({kind:'transfers',title:'Alex net',roomId:'r1',playerId:'a',filter:'outstanding'});
 assert.equal(balance.rows.length,3);assert.match(balance.summary,/net to pay \$19\.00/);
 const person=await load({kind:'player',title:'Alex',roomId:'r1',playerId:'a',playerName:'Alex'});
 assert.equal(person.rows.length,2);assert.match(person.summary,/\+\$40\.00/);
 assert.match(person.summary,/2 settled games/);
 assert.equal(JSON.stringify(person.rows.map(row=>row.href).sort()),
  JSON.stringify(['/games/results/token-g1','/games/results/token-g2']));
 // VM evaluation creates arrays from a separate JavaScript realm; compare
 // serialised string values rather than realm-specific Array prototypes.
 assert(person.rows.every(row=>row.detail.includes('Buy-ins')&&row.detail.includes('Cash-out')),
  'Each game history entry shows buy-ins and cash-outs');
 assert(person.rows.some(row=>row.detail.includes('3 buy-ins')),
  'Historical games must match the leaderboard name even if user IDs change');
 assert.equal((await load({kind:'player',title:'Alex wins',roomId:'r1',playerId:'a',playerName:'Alex',filter:'profitable'})).rows.length,2);
 assert.equal((await load({kind:'transfers',title:'Recent',roomId:'r1',filter:'paid',period:'90d'})).rows.length,1);
 assert.equal((await load({kind:'rsvps',title:'Attending',gameId:'g3',filter:'yes'})).rows.length,1);
 assert.equal((await load({kind:'seats',title:'Seats',gameId:'g3'})).rows.length,9);
 assert.equal((await load({kind:'players',title:'Cashed out',gameId:'g1',filter:'cashed-out'})).rows.length,2);
 const bank=await load({kind:'live-money',title:'Bank',publicToken:'synthetic',measure:'bank'});
 assert.equal(bank.rows.length,2);assert.match(bank.summary,/\$30\.00/);
 const live=await load(bank.rows[0].next);assert.match(live.warning,/No amounts have been estimated/);
 failResults=true;
 const recovered=await load({kind:'transfers',title:'Outstanding',roomId:'r1',filter:'outstanding'});
 assert.equal(recovered.warning,undefined,'Original settled-game record must recover a failed results link');
 assert.equal(recovered.rows.length,3);
 assert.equal(person.summaryTone,'positive');
 assert.equal(person.rows[0].moneyTone,'positive');
 assert.equal(balance.rows.find(row=>row.value.startsWith('-')).moneyTone,'negative');
 assert.equal(balance.rows.find(row=>row.value.startsWith('+')).moneyTone,'positive');
 const missingToken=games[1].results_token;games[1].results_token=null;
 const historical=await load({kind:'player',title:'Alex',roomId:'r1',playerId:'a',playerName:'Alex'});
 assert.equal(historical.warning,undefined,'Missing historical results_token must use saved game');
 assert.equal(historical.rows.length,2);
 games[1].results_token=missingToken;
 failSaved=true;const incomplete=await load({kind:'transfers',title:'Outstanding',roomId:'r1',filter:'outstanding'});
 assert.match(incomplete.warning,/incomplete/);assert.equal(incomplete.rows.length,3);
 assert.match(incomplete.warning,/1970|20\d\d|g2/,'Warning must identify the unavailable game date');
 await assert.rejects(()=>load({kind:'members',title:'No permission',roomId:'r2'}),/Permission denied/);
 const controller=new AbortController();controller.abort();const before=requests;
 await assert.rejects(()=>load({kind:'games',title:'Cancelled',roomId:'r1'},controller.signal),/cancelled/);assert.equal(requests,before);
 assert(!/\blegacy\b/i.test(outstanding.rows.map(row=>row.label+' '+row.detail).join(' ')));
 console.log('PASS: record-detail assertions; read-only scopes, paid totals, player identity, direction, partial loads and cancellation.');
})().catch(error=>{console.error(error);process.exitCode=1;});
