// Synthetic records only: identity, date boundaries and payment-action permissions.
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const ts=require('typescript');
const source=fs.readFileSync(path.resolve(__dirname,'../src/lib/payment-overview.ts'),'utf8');
const output=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020}}).outputText;
const exposed={};new Function('exports',output)(exposed);
const {readPaymentOverviewQuery,filterPaymentOverview,paymentSummaryRecords,paymentGameDay,canTakePaymentAction}=exposed;
const query=(value='')=>readPaymentOverviewQuery(new URLSearchParams(value));
const row=(id,from,to,status,at='2026-11-26T14:00:00Z')=>({
  game:{id:'game-'+id,status:'settled',scheduled_at:Date.parse(at)/1000},
  transfer:{id,from,to,from_name:from==='member'?'Sam':from==='alex'?'Alex':'Other payer',to_name:to==='member'?'Sam':'Alex',amount:2500,status},
});
const owed=row('owed','member','alex','owed');
const incoming=row('incoming','alex','member','payer_claimed');
const paid=row('paid','member','alex','paid');
const legacy=row('legacy','member','alex','legacy');
const sameName=row('unrelated','another-sam','alex','owed');sameName.transfer.from_name='Sam';
const records=[owed,incoming,paid,legacy,sameName];
assert.equal(query('payments=paid').filter,'paid');
assert.equal(query('payments=all').filter,'all');
assert.equal(query('payments=invalid').filter,'outstanding');
assert.equal(query('paymentGroup=pay').group,'pay');
assert.equal(query('paymentGroup=receive').group,'receive');
assert.equal(query('paymentGroup=invalid').group,'all');
assert.equal(query('paymentStatus=payer_claimed').status,'payer_claimed');
assert.equal(query('paymentStatus=unknown').status,'all');
assert.equal(query('paymentFrom=2026-02-30').from,'');
assert.equal(query('paymentFrom=2026-02-28').from,'2026-02-28');
assert.deepEqual(filterPaymentOverview(records,'mine','member',query()).map(r=>r.transfer.id).sort(),['incoming','legacy','owed','paid']);
assert.equal(filterPaymentOverview(records,'mine','missing-member',query()).length,0);
assert.equal(filterPaymentOverview(records,'club','member',query()).length,5);
assert.equal(filterPaymentOverview(records,'mine','member',query('paymentSearch=Alex')).length,4);
assert.equal(filterPaymentOverview(records,'mine','member',query('paymentStatus=paid')).length,1);
// A total opens exactly its contributing records, never a same-name account or a paid/legacy row.
assert.deepEqual(paymentSummaryRecords(records,'mine','member','pay').map(r=>r.transfer.id),['owed']);
assert.deepEqual(paymentSummaryRecords(records,'mine','member','receive').map(r=>r.transfer.id),['incoming']);
assert.equal(paymentSummaryRecords(records,'mine','missing-member','pay').length,0);
assert.equal(paymentSummaryRecords(records,'mine','','receive').length,0);
assert.deepEqual(paymentSummaryRecords(records,'club','member','pay').map(r=>r.transfer.id),['owed','unrelated']);
assert.deepEqual(paymentSummaryRecords(records,'club','member','receive').map(r=>r.transfer.id),['incoming']);
for(const scope of ['mine','club'])for(const group of ['pay','receive']){
 const summary=paymentSummaryRecords(records,scope,'member',group);
 const detail=filterPaymentOverview(records,scope,'member',query('payments=outstanding&paymentGroup='+group));
 assert.deepEqual(detail.map(r=>r.transfer.id).sort(),summary.map(r=>r.transfer.id).sort());
 assert.equal(detail.reduce((sum,row)=>sum+row.transfer.amount,0),summary.reduce((sum,row)=>sum+row.transfer.amount,0));
}
assert.equal(filterPaymentOverview([paid,legacy],'mine','member',query('paymentGroup=pay')).length,0,
 'A verified zero total has an empty underlying record set');
assert.equal(filterPaymentOverview(records,'mine','member',query('paymentGroup=pay&paymentStatus=payer_claimed')).length,0);
assert.equal(filterPaymentOverview(records,'mine','member',query('paymentGroup=receive&paymentSearch=Other')).length,0);
assert.equal(paymentGameDay(Date.parse('2026-11-26T13:59:59Z')/1000),'2026-11-26');
assert.equal(paymentGameDay(Date.parse('2026-11-26T14:00:00Z')/1000),'2026-11-27');
assert.equal(filterPaymentOverview(records,'mine','member',query('paymentFrom=2026-11-27&paymentTo=2026-11-27')).length,4);
assert.equal(filterPaymentOverview(records,'mine','member',query('paymentFrom=2026-11-28&paymentTo=2026-11-27')).length,0);
const member={memberId:'member',canManage:false,control:'enabled'};
assert.equal(canTakePaymentAction(owed,'sent',member),true);
assert.equal(canTakePaymentAction(owed,'sent',{...member,control:'not_started'}),false);
assert.equal(canTakePaymentAction(owed,'sent',{...member,control:'unavailable'}),false);
assert.equal(canTakePaymentAction(owed,'sent',{...member,memberId:'another-member'}),false);
assert.equal(canTakePaymentAction(incoming,'received',member),true);
assert.equal(canTakePaymentAction(incoming,'not_received',member),true);
assert.equal(canTakePaymentAction(owed,'received',member),false);
assert.equal(canTakePaymentAction(paid,'sent',member),false);
assert.equal(canTakePaymentAction(legacy,'record_paid',{...member,canManage:true}),false);
assert.equal(canTakePaymentAction(owed,'record_paid',member),false);
assert.equal(canTakePaymentAction(owed,'record_paid',{...member,canManage:true}),true);
assert.equal(canTakePaymentAction({...owed,game:{...owed.game,status:'active'}},'sent',member),false);
assert.equal(canTakePaymentAction(owed,'record_paid',{...member,memberId:null,canManage:true}),false);
console.log('PASS: payment overview exact total-to-record groups, identity isolation, queries, Brisbane dates, search and payer/recipient/manager gates.');
