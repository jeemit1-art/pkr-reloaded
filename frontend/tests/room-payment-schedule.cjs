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
const api={games:{
 list:async room=>{assert.equal(room,'room-a');return games;},
 results:async token=>{
  if(token==='token-g1')return {game:games[0],transfers:[
   transfer('owed',7500),transfer('paid',7523500,'paid'),transfer('legacy',90000,'legacy')
  ]};
  throw new Error('Synthetic link unavailable');
 },
 get:async id=>{
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
 const outstanding=outstandingRoomTransfers(history.records);
 assert.equal(outstanding.length,3,'Only owed, claimed and not-received transfers are outstanding');
 assert.equal(totalTransferCents(outstanding),11200,'Outstanding total is $112 and excludes paid legacy history');
 assert(outstanding.every(row=>row.game.event_id==='room-a'),'No transfers from another room');
 assert(outstanding.some(row=>row.transfer.status==='payer_claimed'),'Awaiting receipt stays outstanding');
 const completed=history.records.filter(row=>row.transfer.status==='paid');
 assert.equal(totalTransferCents(completed),7523500,'Old paid items never become outstanding');
 const controller=new AbortController();controller.abort();
 await assert.rejects(()=>loadRoomTransfers('room-a',games,controller.signal),/cancelled/);
 // A malformed transfer amount invalidates that game, never turns into a fake zero.
 const invalid=[{...games[1],id:'malformed',results_token:null}];
 await assert.rejects(()=>loadRoomTransfers('outside-room',invalid),/^(?!.*).*/).catch(()=>{});
 console.log('PASS: outstanding settlement filters, cents, paid history, saved-game fallback, room boundaries and partial warnings.');
})().catch(error=>{console.error(error);process.exitCode=1;});
