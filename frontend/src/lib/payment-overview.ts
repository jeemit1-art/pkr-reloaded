import type {Transfer} from '@/lib/api';
import type {RoomTransferRecord} from '@/lib/room-payment-schedule';

export type PaymentScope='mine'|'club';
export type PaymentFilter='all'|'outstanding'|'paid';
export type PaymentGroup='all'|'pay'|'receive';
export type PaymentStatusFilter='all'|NonNullable<Transfer['status']>;
export type PaymentAction='sent'|'received'|'not_received'|'record_paid';
export type PaymentControlState='enabled'|'not_started'|'unavailable';
export type PaymentOverviewQuery={
 filter:PaymentFilter;
 group:PaymentGroup;
 status:PaymentStatusFilter;
 search:string;
 from:string;
 to:string;
};

const statuses=new Set(['owed','paid','payer_claimed','not_received','legacy']);
const gameDayFormatter=new Intl.DateTimeFormat('en-CA',{
 year:'numeric',month:'2-digit',day:'2-digit',timeZone:'Australia/Brisbane',
});

function dateValue(value:string|null){
 if(!value||!/^\d{4}-\d{2}-\d{2}$/.test(value))return '';
 const date=new Date(value+'T00:00:00.000Z');
 return Number.isFinite(date.getTime())&&date.toISOString().slice(0,10)===value?value:'';
}

export function readPaymentOverviewQuery(params:{get:(name:string)=>string|null}):PaymentOverviewQuery{
 const requested=params.get('payments');
 const status=params.get('paymentStatus')||'';
 const group=params.get('paymentGroup');
 return {
  filter:requested==='all'||requested==='paid'?requested:'outstanding',
  group:group==='pay'||group==='receive'?group:'all',
  status:statuses.has(status)?status as PaymentStatusFilter:'all',
  search:params.get('paymentSearch')||'',
  from:dateValue(params.get('paymentFrom')),
  to:dateValue(params.get('paymentTo')),
 };
}

export const paymentRowKey=(row:RoomTransferRecord)=>row.game.id+':'+row.transfer.id;

export function paymentGameDay(stamp:number){
 const parts=gameDayFormatter.formatToParts(new Date(stamp*1000));
 return ['year','month','day'].map(type=>parts.find(part=>part.type===type)?.value||'').join('-');
}

/** The exact open records behind a total, with the same immutable-ID scope. */
export function paymentSummaryRecords(
 records:RoomTransferRecord[],scope:PaymentScope,memberId:string,group:Exclude<PaymentGroup,'all'>,
){
 return records.filter(({transfer})=>{
  if(transfer.status==='paid'||transfer.status==='legacy')return false;
  if(scope==='mine')return !!memberId&&(group==='pay'?transfer.from===memberId:transfer.to===memberId);
  return group==='pay'?transfer.status!=='payer_claimed':transfer.status==='payer_claimed';
 });
}

/** Presentation-only filters. The shared loader remains the financial source. */
export function filterPaymentOverview(
 records:RoomTransferRecord[],scope:PaymentScope,memberId:string,query:PaymentOverviewQuery,
){
 const needle=query.search.trim().toLocaleLowerCase('en-AU');
 if(query.from&&query.to&&query.from>query.to)return [];
 const matchingGroup=query.group==='all'?records:paymentSummaryRecords(records,scope,memberId,query.group);
 return matchingGroup.filter(row=>{
  const {transfer}=row;
  const personal=transfer.from===memberId||transfer.to===memberId;
  if(scope==='mine'&&!personal)return false;
  if(query.status!=='all'&&transfer.status!==query.status)return false;
  const names=scope==='club'?transfer.from_name+' '+transfer.to_name:
   transfer.from===memberId?transfer.to_name:transfer.from_name;
  if(needle&&!names.toLocaleLowerCase('en-AU').includes(needle))return false;
  if(query.from||query.to){
   const day=paymentGameDay(row.game.scheduled_at);
   if(query.from&&day<query.from||query.to&&day>query.to)return false;
  }
  return true;
 }).sort((a,b)=>b.game.scheduled_at-a.game.scheduled_at||paymentRowKey(a).localeCompare(paymentRowKey(b)));
}

/** Mirrors the existing UI gates; the API still authorises every write. */
export function canTakePaymentAction(row:RoomTransferRecord,action:PaymentAction,context:{
 memberId:string|null;canManage:boolean;control?:PaymentControlState;
}){
 if(!context.memberId||!row.transfer.id||row.game.status!=='settled'||row.transfer.status==='legacy')return false;
 if(action==='record_paid')return context.canManage&&row.transfer.status!=='paid';
 if(context.control!=='enabled')return false;
 if(action==='sent')return context.memberId===row.transfer.from&&
  (row.transfer.status==='owed'||row.transfer.status==='not_received');
 return context.memberId===row.transfer.to&&row.transfer.status==='payer_claimed';
}
