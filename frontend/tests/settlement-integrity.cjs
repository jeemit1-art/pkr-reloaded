'use strict';
// PKR production release gate: fictional game records only, no live player data.
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const ts=require('typescript');

const root=path.resolve(__dirname,'../');
const implementation=fs.readFileSync(path.join(root,'src/lib/settlement-integrity.ts'),'utf8');
const output=ts.transpileModule(implementation,{
 compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020}
}).outputText;
const mod={};
new Function('exports',output)(mod);
const {reviewSettledGame,summariseGameIntegrity}=mod;
const fixture=(players,variance=0)=>({
 id:'fictional-game-1',event_id:'fictional-room',scheduled_at:1795770000,
 status:'settled',buy_in:5000,variance,players,
});
const player=(id,buy_ins,buy_in_total,cashout,net)=>({
 user_id:id,game_id:'fictional-game-1',seat_number:1,
 display_name:'Fictional',buy_ins,buy_in_total,cashout,net,settled_at:1795770000
});
const balanced=reviewSettledGame(fixture([
 player('fictional-A',2,0,14000,4000),
 player('fictional-B',1,5000,1000,-4000),
]));
assert.equal(balanced.mismatchPlayers,0,'Legacy fallback must respect counted buy-ins');
assert.equal(balanced.missingPlayers,0);
assert.equal(balanced.nonZeroSavedNet,false);
assert.equal(balanced.inconsistentGameVariance,false);
assert.equal(balanced.needsReview,false);
assert.equal(balanced.calculatedVarianceCents,0);
const mismatch=reviewSettledGame(fixture([
 player('fictional-A',1,5000,8000,2500),
 player('fictional-B',1,5000,2000,-3000),
]));
assert.equal(mismatch.mismatchPlayers,1);
assert.equal(mismatch.nonZeroSavedNet,true);
assert.equal(mismatch.needsReview,true);
assert.equal(mismatch.calculatedVarianceCents,0);
assert.equal(mismatch.savedNetCents,-500);
const empty=reviewSettledGame(fixture([]));
assert.equal(empty.emptyPlayerRoster,true);
assert.equal(empty.calculatedVarianceCents,null);
assert.equal(empty.needsReview,true);
const incomplete=reviewSettledGame(fixture([
 player('fictional-A',1,5000,null,null),
 player('fictional-B',1,5000,10000,5000),
]));
assert.equal(incomplete.missingPlayers,1);
assert.equal(incomplete.mismatchPlayers,0);
assert.equal(incomplete.calculatedVarianceCents,null);
assert.equal(incomplete.needsReview,true);
const missingDefault=reviewSettledGame({...fixture([player('A',1,0,5000,0)]),buy_in:undefined});
assert.equal(missingDefault.missingPlayers,1,'Missing pricing must not be interpreted as a zero buy-in');
const unusual=reviewSettledGame(fixture([
 player('A',1,5000,7000,2000),
 player('B',1,5000,3000,-2000),
],300));
assert.equal(unusual.inconsistentGameVariance,true,'Compare saved variance to complete saved player arithmetic');
assert.throws(()=>reviewSettledGame({...fixture([]),status:'active'}),/unsettled game/);
assert.throws(()=>reviewSettledGame({...fixture([]),players:null}),/invalid or unsettled/);
assert.deepEqual(summariseGameIntegrity([balanced,mismatch,incomplete,empty]),{
 checked:4,flagged:3,incomplete:1,differences:1,nonZero:2,
});
const page=fs.readFileSync(path.join(root,'src/components/GameNightPayments.tsx'),'utf8');
const view=fs.readFileSync(path.join(root,'src/components/FinancialIntegrityReview.tsx'),'utf8');
const api=fs.readFileSync(path.join(root,'src/lib/api.ts'),'utf8');
assert(page.includes("room?.role==='host'&&integrityOpen&&"),'Host-only review must fail closed');
assert(page.includes("aria-expanded={integrityOpen}"),'Host review must be disclosed on demand');
assert(page.includes("<FinancialIntegrityReview key={selectedRoom} roomId={selectedRoom}/>"),
 'Review must stay room-scoped and unmounted until opened');
assert(view.includes("api.games.list(roomId,'settled')"),'Use authenticated room-scoped saved game list');
assert(view.includes("api.games.get(game.id)"),'Use existing authenticated saved game API');
assert(view.includes("start+=4"),'Bound batch size to prevent full-room request fan-out');
assert(!/api\.games\.(settle|buyin|cashout|setTransferStatus|respondToTransfer|setRsvp)/.test(view),
 'The audit cannot use mutation methods');
assert(!/fetch\(/.test(view),'The audit cannot access unprotected public APIs');
assert(api.includes('buy_in_total?:number|null'),'Ensure saved amount is present in declared player type');
const css=fs.readFileSync(path.join(root,'src/app/pkr-experience-consolidation.css'),'utf8');
assert(css.includes('.pkr-finance-integrity-row'),'Financial cards must be styled at all breakpoints');
assert(css.includes('@media(max-width:430px)'),'Financial review must remain readable on phones');
console.log('PASS PKR host-only saved game integrity: legacy buy-ins, incomplete data, balanced totals, variance, readonly gating, responsive UI');
