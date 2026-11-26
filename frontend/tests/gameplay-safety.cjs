/* Synthetic-only regression for the in-game cash-out/settlement preview.
 * No game API calls, external requests, or production database access. */
'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const page=fs.readFileSync(path.resolve(__dirname,'../src/app/games/[id]/play/page.tsx'),'utf8');
function between(start,end){
 const a=page.indexOf(start),b=page.indexOf(end,a+start.length);
 assert.ok(a>=0&&b>a,'source markers must exist: '+start);
 return page.slice(a,b);
}
const logic=between('function getSettlementReadiness() {','function renderSettlementsHTML(transfers)');
const ctx={
 window:{},navigator:{onLine:true},state:{players:{}},
 _offlineQueue:[],_flushingQueue:false,_syncConflict:false,_syncError:'',
 fmt:n=>'$'+n.toFixed(2),
 pBuyin:p=>p.transactions.filter(t=>t.type!=='cashout').reduce((a,t)=>a+t.amount,0),
 pCash:p=>p.transactions.filter(t=>t.type==='cashout').reduce((a,t)=>a+t.amount,0),
 pNet:p=>p.transactions.filter(t=>t.type==='cashout').reduce((a,t)=>a+t.amount,0)
              -p.transactions.filter(t=>t.type!=='cashout').reduce((a,t)=>a+t.amount,0),
};
vm.createContext(ctx);
vm.runInContext(logic,ctx,{timeout:2000,filename:'gameplay-settlement-preview'});
const player=(name,invested,cashout)=>({
 name,
 transactions:[{type:'buyin',amount:invested},
 ...(cashout===null?[]:[{type:'cashout',amount:cashout}])],
});
function readiness(){return vm.runInContext('getSettlementReadiness()',ctx);}
ctx.state.players={seat1:player('A',100,null),seat2:player('B',100,null)};
assert.equal(readiness().ready,false,'no cash-outs must not show everyone square');
assert.match(readiness().reason,/Cash-out still needed/);
ctx.state.players={seat1:player('A',100,70),seat2:player('B',100,100)};
assert.equal(readiness().ready,false,'unbalanced cash-outs must be blocked');
assert.match(readiness().reason,/Bank does not balance/);
assert.equal(vm.runInContext("calcSettlements([{name:'A',net:-30},{name:'B',net:0}])",ctx).length,0,
 'unbalanced transfers are never silently adjusted');
ctx.state.players={seat1:player('A',100,60),seat2:player('B',100,140)};
assert.equal(readiness().ready,true,'fully reconciled pair must be ready');
const transfer=vm.runInContext("calcSettlements([{name:'A',net:-40},{name:'B',net:40}])",ctx);
assert.equal(transfer.length,1);assert.equal(transfer[0].amount,40);
ctx._offlineQueue.push({id:'synthetic'});
assert.equal(readiness().ready,false,'pending edits must block instructions');
ctx._offlineQueue.length=0;ctx.navigator.onLine=false;
assert.equal(readiness().ready,false,'offline must block instructions');
assert.match(page,/if\(!review\.ready\)\{toast\(review\.reason\);window\.openSettleUp\(\);return;\}/,
 'publishing and saving must both gate on reconciliation');
assert.doesNotMatch(page,/amt\.addEventListener\('blur', saveTxAmt\)/,
 'financial transaction edit must require explicit Save');
assert.match(page,/function refreshVisibleGameFromServer\(game\)/,
 'remote co-host updates must be wired into displayed table');
assert.match(page,/No window\.saveState\(\): a co-host/,
 'co-host hydration cannot trigger writes to bank balances');
console.log('PASS: 9 synthetic gameplay settlement, explicit-edit and co-host safety assertions');

// Bank drill-downs must reconcile to the same table, including a zero cash-out.
vm.runInContext(between('window._pkrBankBreakdown = function(measure)', 'function updateBank()'),ctx,{timeout:2000});
ctx.state.players={seat1:player('Example A',125.5,null),seat2:player('Example B',70,0),seat3:player('Example C',90,160)};
const before=JSON.stringify(ctx.state);ctx.navigator.onLine=true;
const detail=measure=>ctx.window._pkrBankBreakdown(measure);
assert.equal(detail('buyins').rows.length,3);assert.match(detail('buyins').summary,/285.50/);
assert.deepEqual(Array.from(detail('cashouts').rows,row=>row.id),['seat2','seat3']);
assert.equal(detail('cashouts').rows[0].value,'$0.00','Zero cash-out is still an original record');
assert.deepEqual(Array.from(detail('status').rows,row=>row.id),['seat1']);
assert.match(detail('bank').summary,/285.50.*160.00.*125.50/);
assert.equal(JSON.stringify(ctx.state),before,'Viewing a bank breakdown cannot change table amounts');
ctx._offlineQueue.push({id:'unconfirmed'});assert.match(detail('bank').warning,/awaiting synchronisation/);ctx._offlineQueue.length=0;
ctx.state.players.seat1.transactions[0].pkrReconstructed=true;
assert.match(detail('buyins').rows[0].detail,/Saved aggregate/,'Do not invent individual historical transactions');
ctx.state.players={};assert.equal(detail('bank').rows.length,0);assert.match(detail('bank').summary,/0.00/);
console.log('PASS: live bank record totals, identity, zero cash-outs, pending edits and reconstruction disclosure');
