// Read-only unit tests for the table's embedded buy-in recovery functions.
// The legacy client uses a template string; execute only the two pure helpers
// in a VM, never the app and never any production API.
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');

const page=fs.readFileSync(path.resolve(__dirname,'../src/app/games/[id]/play/page.tsx'),'utf8');
const first=page.indexOf('function pkrBuildBankTransactions(');
const end=page.indexOf('// ── State ──',first);
assert.ok(first>=0 && end>first,'Embedded recovery helpers must be present');
const sandbox={Date,Number,Math,Object};
vm.createContext(sandbox);
vm.runInContext(page.slice(first,end),sandbox,{timeout:1000});
const build=(p,unit)=>JSON.parse(JSON.stringify(sandbox.pkrBuildBankTransactions(p,unit)));
const recover=(p,remote,unit)=>sandbox.pkrRepairLegacyAveragedBanks(p,remote,unit);
const amounts=tx=>tx.map(x=>x.amount);

test('12 x $25 bank remains exactly $25 per bank, no fractional cents',()=>{
 const tx=build({buy_ins:12,buy_in_total:30000},25);
 assert.equal(tx.length,12);
 assert.deepEqual(amounts(tx),Array(12).fill(25));
 assert.equal(tx.reduce((n,x)=>n+Math.round(x.amount*100),0),30000);
 assert.ok(tx.every(x=>x.pkrReconstructed&&!x.pkrEstimated));
});

test('$325 / 12 is NOT divided into $27.08 banks; preserves full $325',()=>{
 const tx=build({buy_ins:12,buy_in_total:32500},25);
 assert.deepEqual(amounts(tx),[...Array(11).fill(25),50]);
 assert.equal(tx.reduce((n,x)=>n+Math.round(x.amount*100),0),32500);
 assert.ok(tx.every(x=>x.pkrEstimated));
});

test('unusual totals still preserve integer cents and count, with visible estimate marker',()=>{
 const tx=build({buy_ins:12,buy_in_total:25000},25);
 assert.equal(tx.length,12);
 assert.equal(tx.reduce((n,x)=>n+Math.round(x.amount*100),0),25000);
 assert.ok(tx.every(x=>Number.isInteger(x.amount*100)||Math.abs(x.amount*100-Math.round(x.amount*100))<0.000001));
 assert.ok(tx.every(x=>x.pkrEstimated));
});

test('missing legacy total uses the configured standard buy-in',()=>{
 assert.deepEqual(amounts(build({buy_ins:3,buy_in_total:0},25)),[25,25,25]);
});

test('old fractional-mean local rows can be repaired from confirmed saved $25 banks',()=>{
 const old={transactions:[...Array.from({length:12},(_,i)=>({type:'buyin',amount:325/12,ts:i})),
   {type:'cashout',amount:555,ts:120}]};
 assert.equal(recover(old,{buy_ins:12,buy_in_total:30000},25),true);
 assert.deepEqual(old.transactions.filter(t=>t.type==='buyin').map(t=>t.amount),Array(12).fill(25));
 assert.equal(old.transactions.find(t=>t.type==='cashout').amount,555);
 assert.equal(old.transactions.reduce((n,t)=>n+(t.type==='cashout'?0:Math.round(t.amount*100)),0),30000);
});

test('do not overwrite legitimately recorded cent-accurate bank amounts',()=>{
 const old={transactions:[{type:'buyin',amount:25},{type:'buyin',amount:50}]};
 assert.equal(recover(old,{buy_ins:2,buy_in_total:7500},25),false);
 assert.deepEqual(amounts(old.transactions),[25,50]);
});

test('do not auto-correct apparently valid cent amounts without original transaction evidence',()=>{
 const old={transactions:Array.from({length:12},()=>({type:'buyin',amount:27.08}))};
 assert.equal(recover(old,{buy_ins:12,buy_in_total:30000},25),false);
});
