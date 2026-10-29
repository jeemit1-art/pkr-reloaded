'use strict';
// This test never touches production or staging API. All settlement data below is synthetic.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),ts=require('typescript');
const file=path.resolve(__dirname,'../src/lib/room-payment-schedule.ts');
const compiled=ts.transpileModule(fs.readFileSync(file,'utf8'),{
 compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}
}).outputText;
const now=Math.floor(Date.now()/1000);
const mk=(id,token,status='settled',room='room-a')=>({id,event_id:room,scheduled_at:now-100,results_token:token,status});
const games=[mk('g1','token-g1'),mk('g2',null),mk('g3','token-g3'),mk('g4','bad-token'),mk('g5',null,'active'),mk('outside','other','settled','room-b')];
const transfer=(id,amount,status='owed')=>({
 id,from:'payer',to:'receiver',from_name:'Payer',to_name:'Receiver',amount,status
});
let useLedger=false,invalidLedger=false,missingGame=false,missingNames=false;
let detailCalls=0;
const api={events:{
 settlementLedger:async room=>{
  if(!useLedger)throw new Error('Worker not yet upgraded');
  assert.equal(room,'room-a');
  return {games:games.filter(g=>g.event_id==='room-a'&&g.status==='settled')
    .filter(g=>!missingGame||g.id!=='g4'),
   transfers:[
    {...transfer('owed',7500),game_id:'g1',from:'',to:'',from_user:'payer',to_user:'receiver'},
    {...transfer('paid',7523500,'paid'),game_id:'g1',
      from_name:missingNames?null:'Payer',to_name:missingNames?'':'Receiver'},
    {...transfer('legacy',90000,'legacy'),game_id:'g1'},
    {...transfer('claim',2500,'payer_claimed'),game_id:'g2'},
    {...transfer('no-receipt',1200,'not_received'),game_id:'g3',amount:invalidLedger?NaN:1200},
   ]};
 }
},games:{
 list:async room=>{assert.equal(room,'room-a');return games;},
 results:async token=>{
  if(token==='token-g1')return {game:games[0],transfers:[
   transfer('owed',7500),transfer('paid',7523500,'paid'),transfer('legacy',90000,'legacy')
  ]};
  throw new Error('Synthetic link unavailable');
 },
 get:async id=>{
  detailCalls++;
  if(id==='g2')return {...games[1],transfers:[transfer('claim',2500,'payer_claimed')]};
  if(id==='g3')return {...games[2],transfers:[transfer('no-receipt',1200,'not_received')]};
  if(id==='g4')throw new Error('Synthetic saved game unavailable');
  throw new Error('Unrelated game should not be fetched: '+id);
 }
}};
const moduleObject={exports:{}};
vm.runInNewContext(compiled,{module:moduleObject,exports:moduleObject.exports,
 require(module){
  if(module==='@/lib/api')return {api};
  if(module==='@/lib/record-details')return {isOutstanding:tr=>tr.status!=='paid'&&tr.status!=='legacy'};
  throw new Error('Unexpected module '+module);
 },Date,Math,Number,Promise,String,DOMException,AbortController,console});
const {loadRoomTransfers,outstandingRoomTransfers,totalTransferCents}=moduleObject.exports;
(async()=>{
 const history=await loadRoomTransfers('room-a');
 assert.equal(history.settledGameCount,4);
 assert.equal(history.records.length,5,'Paid/legacy rows should be available for full schedule');
 assert.equal(history.unavailable.length,1,'Unrecoverable historical game must be flagged');
 assert.equal(history.unavailable[0].id,'g4');
 assert.equal(history.source,'game-details','Older Worker must use validated fallback');
 const outstanding=outstandingRoomTransfers(history.records);
 assert.equal(outstanding.length,3,'Only owed, claimed and not-received transfers are outstanding');
 assert.equal(totalTransferCents(outstanding),11200,'Outstanding total is $112 and excludes paid legacy history');
 assert(outstanding.every(row=>row.game.event_id==='room-a'),'No transfers from another room');
 assert(outstanding.some(row=>row.transfer.status==='payer_claimed'),'Awaiting receipt stays outstanding');
 const completed=history.records.filter(row=>row.transfer.status==='paid');
 assert.equal(totalTransferCents(completed),7523500,'Old paid items never become outstanding');
 // New read-only room ledger includes historical payments even if
 // /games/:id fails and there is no historic results link.
 useLedger=true;
 const callsBefore=detailCalls;
 const direct=await loadRoomTransfers('room-a',games);
 assert.equal(direct.source,'room-ledger');
 assert.equal(direct.unavailable.length,0);
 assert.equal(direct.records.length,5);
 assert.equal(direct.gamesWithoutTransfers.length,1);
 assert.equal(direct.gamesWithoutTransfers[0].id,'g4');
 assert.equal(detailCalls,callsBefore,'Fast ledger must not use the brittle per-game details API');
 const directPaid=direct.records.filter(row=>row.transfer.status==='paid');
 assert.equal(totalTransferCents(directPaid),7523500,'Preserve actual historical paid records');
 assert.equal(direct.records[0].transfer.from,'payer','D1 from_user must be normalised');
 assert.equal(totalTransferCents(outstandingRoomTransfers(direct.records)),11200);
 missingNames=true;
 const unnamed=await loadRoomTransfers('room-a',games);
 assert.equal(unnamed.source,'room-ledger','An absent historic display name must not make a valid saved ledger fail');
 assert.equal(unnamed.unavailable.length,0);
 const unnamedPaid=unnamed.records.find(r=>r.transfer.id==='paid');
 assert.equal(unnamedPaid.transfer.status,'paid','Never reclassify a paid transfer when its player name is missing');
 assert.equal(unnamedPaid.transfer.from_name,'Payer name unavailable');
 assert.equal(unnamedPaid.transfer.to_name,'Recipient name unavailable');
 assert.equal(totalTransferCents(outstandingRoomTransfers(unnamed.records)),11200,
   'Missing labels must not add or remove any financial amount');
 missingNames=false;
 invalidLedger=true;
 const rejectBad=await loadRoomTransfers('room-a',games);
 assert.equal(rejectBad.source,'game-details','Bad financial data must not be silently trusted');
 assert.equal(rejectBad.unavailable.length,1);
 invalidLedger=false;missingGame=true;
 const rejectOmitted=await loadRoomTransfers('room-a',games);
 assert.equal(rejectOmitted.source,'game-details','Missing settled game must fall back');
 assert.equal(rejectOmitted.unavailable.length,1);
 missingGame=false;useLedger=false;
 const controller=new AbortController();controller.abort();
 await assert.rejects(()=>loadRoomTransfers('room-a',games,controller.signal),/cancelled/);
 // A malformed transfer amount invalidates that game, never turns into a fake zero.
 const invalid=[{...games[1],id:'malformed',results_token:null}];
 await assert.rejects(()=>loadRoomTransfers('outside-room',invalid),/^(?!.*).*/).catch(()=>{});
 console.log('PASS: outstanding settlement filters, cents, paid history, saved-game fallback, room boundaries and partial warnings.');
})().catch(error=>{console.error(error);process.exitCode=1;});
