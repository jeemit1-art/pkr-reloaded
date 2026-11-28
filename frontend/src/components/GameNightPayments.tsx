'use client';

import {useEffect,useMemo,useRef,useState} from 'react';
import {useRouter,useSearchParams} from 'next/navigation';
import AppDialog from '@/components/AppDialog';
import {api,fmt,type Event} from '@/lib/api';
import {historyStateForQueryUpdate} from '@/lib/page-scroll';
import FinancialIntegrityReview from '@/components/FinancialIntegrityReview';
import PkrBrandMark from '@/components/PkrBrandMark';
import {loadRoomTransfers,outstandingRoomTransfers,totalTransferCents,type RoomTransferLoad,type RoomTransferRecord} from '@/lib/room-payment-schedule';
import {canTakePaymentAction,filterPaymentOverview,paymentRowKey,paymentSummaryRecords,readPaymentOverviewQuery,
 type PaymentAction,type PaymentControlState,type PaymentFilter,type PaymentScope,type PaymentGroup} from '@/lib/payment-overview';

type SelectedAction={row:RoomTransferRecord;action:PaymentAction};
type LedgerState={roomId:string;memberId:string;phase:'loading'|'ready'|'error';data?:RoomTransferLoad;error?:string};
type IconName='outgoing'|'incoming'|'check'|'arrow'|'more'|'refresh'|'clock'|'receipt'|'search';

function PaymentIcon({name}:{name:IconName}){
 const paths={
  outgoing:<path d="M6 18 18 6M6 6h12v12"/>,
  incoming:<path d="m18 6-12 12M6 6v12h12"/>,
  check:<path d="m5 12 4 4L19 6"/>,
  arrow:<path d="m9 5 7 7-7 7"/>,
  more:<><circle cx="5" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/></>,
  refresh:<><path d="M20 7v5h-5M4 17v-5h5"/><path d="M6.1 6.1A8 8 0 0 1 19 8l1 4M4 12l1 4a8 8 0 0 0 12.9 1.9"/></>,
  clock:<><circle cx="12" cy="12" r="8.5"/><path d="M12 7v5l3 2"/></>,
  receipt:<><path d="M6 3h12v18l-3-2-3 2-3-2-3 2V3Z"/><path d="M9 8h6M9 12h6"/></>,
  search:<><circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 5 5"/></>,
 };
 return <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">{paths[name]}</svg>;
}

const dateFormatter=new Intl.DateTimeFormat('en-AU',{
 weekday:'short',day:'numeric',month:'short',year:'numeric',timeZone:'Australia/Brisbane',
});
const gameDate=(stamp:number)=>dateFormatter.format(new Date(stamp*1000));
const initials=(name:string)=>name.trim().split(/\s+/).slice(0,2).map(part=>part[0]).join('').toUpperCase();
const statusOptions=[
 ['all','Any status'],['owed','Payment due'],['payer_claimed','Sent · awaiting receipt'],
 ['not_received','Reported not received'],['paid','Recorded paid'],['legacy','Needs host review'],
] as const;

function paymentState(row:RoomTransferRecord,memberId:string|null){
 const {transfer}=row;
 if(transfer.status==='paid')return {label:'Recorded paid',tone:'paid',icon:'check' as IconName};
 if(transfer.status==='payer_claimed')return {label:'Sent · awaiting confirmation',tone:'sent',icon:'clock' as IconName};
 if(transfer.status==='not_received')return {label:'Reported not received',tone:'due',icon:'clock' as IconName};
 if(transfer.status==='legacy')return {label:'Needs host review',tone:'review',icon:'receipt' as IconName};
 return {label:transfer.from===memberId?'Payment due':'Awaiting payment',tone:'due',icon:'clock' as IconName};
}

/** Uses the existing saved ledger, immutable identities and authorised actions. */
export default function GameNightPayments(){
 const router=useRouter();
 const params=useSearchParams();
 const queryString=params.toString();
 const query=readPaymentOverviewQuery(params);
 const [rooms,setRooms]=useState<Event[]>([]);
 const [memberId,setMemberId]=useState<string|null>(null);
 const [preferredRoom,setPreferredRoom]=useState('');
 const [loadingAccount,setLoadingAccount]=useState(true);
 const [accountError,setAccountError]=useState('');
 const [accountRefresh,setAccountRefresh]=useState(0);
 const [ledgerState,setLedgerState]=useState<LedgerState|null>(null);
 const [ledgerRefresh,setLedgerRefresh]=useState(0);
 const [controls,setControls]=useState<Record<string,PaymentControlState>>({});
 const [notice,setNotice]=useState('');
 const [selectedAction,setSelectedAction]=useState<SelectedAction|null>(null);
 const [actionError,setActionError]=useState('');
 const [busy,setBusy]=useState(false);
 const [visibleLimit,setVisibleLimit]=useState(20);
 const [integrityOpen,setIntegrityOpen]=useState(false);
 const recordsHeading=useRef<HTMLHeadingElement>(null);
 const [focusRecordGroup,setFocusRecordGroup]=useState<PaymentGroup|null>(null);

 useEffect(()=>{
  let live=true;
  setLoadingAccount(true);setAccountError('');
  Promise.all([api.auth.me(),api.events.list()]).then(([user,available])=>{
   if(!live)return;
   if(!user?.id)throw new Error('Your account could not be verified.');
   let preferred='';try{preferred=localStorage.getItem('pkr_preferred_room')||'';}catch{}
   setMemberId(user.id);setRooms(available);setPreferredRoom(preferred);
  }).catch(error=>{
   if(live){setMemberId(null);setRooms([]);setAccountError(error instanceof Error?error.message:'Your account could not be loaded.');}
  }).finally(()=>{if(live)setLoadingAccount(false);});
  return()=>{live=false;};
 },[accountRefresh]);

 const room=rooms.find(item=>item.id===params.get('room'))||rooms.find(item=>item.id===preferredRoom)
  ||rooms.find(item=>item.status!=='ended')||rooms[0];
 const selectedRoom=room?.id||'';
 const canManage=room?.role==='host'||room?.role==='cohost';
 useEffect(()=>{setIntegrityOpen(false);},[selectedRoom]);
 const scope:PaymentScope=canManage&&params.get('paymentsScope')==='club'?'club':'mine';

 useEffect(()=>{
  if(!selectedRoom||!memberId||loadingAccount||accountError)return;
  const controller=new AbortController();
  const identity={roomId:selectedRoom,memberId};
  setLedgerState({...identity,phase:'loading'});setControls({});setSelectedAction(null);
  loadRoomTransfers(selectedRoom,undefined,controller.signal).then(async data=>{
   if(controller.signal.aborted)return;
   setLedgerState({...identity,phase:'ready',data});
   // Collection gates are needed only for this user's payer/recipient actions.
   const gameIds=[...new Set(outstandingRoomTransfers(data.records)
    .filter(row=>row.transfer.from===memberId||row.transfer.to===memberId).map(row=>row.game.id))];
   for(let offset=0;offset<gameIds.length;offset+=4){
    if(controller.signal.aborted)return;
    const batch=gameIds.slice(offset,offset+4);
    const results=await Promise.allSettled(batch.map(id=>api.games.settlementControl(id)));
    if(controller.signal.aborted)return;
    setControls(previous=>{
     const next={...previous};
     results.forEach((item,index)=>{
      next[batch[index]]=item.status==='fulfilled'&&item.value.game_id===batch[index]
       ?item.value.enabled?'enabled':'not_started':'unavailable';
     });
     return next;
    });
   }
  }).catch(error=>{
   if(!controller.signal.aborted)setLedgerState({...identity,phase:'error',error:error instanceof Error?error.message:'Payment records could not be loaded.'});
  });
  return()=>controller.abort();
 },[selectedRoom,memberId,ledgerRefresh,loadingAccount,accountError]);

 useEffect(()=>{setVisibleLimit(20);setNotice('');},[queryString]);

 const currentLedger=ledgerState?.roomId===selectedRoom&&ledgerState.memberId===memberId?ledgerState:null;
 const ledger=currentLedger?.phase==='ready'?currentLedger.data:null;
 const ledgerError=currentLedger?.phase==='error'?currentLedger.error||'Payment records could not be loaded.':'';
 const loading=loadingAccount||!!selectedRoom&&!!memberId&&!ledger&&!ledgerError&&!accountError;
 const ready=!!ledger&&!loadingAccount&&!accountError&&!!memberId;
 const records=useMemo(()=>(ledger?.records||[]).filter(row=>scope==='club'||
  row.transfer.from===memberId||row.transfer.to===memberId),[ledger,scope,memberId]);
 const needsReview=records.filter(row=>row.transfer.status==='legacy').length;
 const partial=!!ledger&&(ledger.unavailable.length>0||needsReview>0);
 const filtered=useMemo(()=>filterPaymentOverview(records,scope,memberId||'',readPaymentOverviewQuery(new URLSearchParams(queryString))),
  [records,scope,memberId,queryString]);
 const tabRecords=useMemo(()=>filterPaymentOverview(records,scope,memberId||'',{
  ...readPaymentOverviewQuery(new URLSearchParams(queryString)),group:'all'}),[records,scope,memberId,queryString]);
 const filteredOpen=outstandingRoomTransfers(filtered);
 const filteredPaid=filtered.filter(row=>row.transfer.status==='paid');
 const visible=query.filter==='all'?filtered:query.filter==='paid'?filteredPaid:filteredOpen;
 const hasSearchFilters=!!query.search.trim()||!!query.from||!!query.to||query.status!=='all';
 const hasFilters=hasSearchFilters||query.group!=='all';
 const invalidRange=!!query.from&&!!query.to&&query.from>query.to;
 const groups=[
  {label:scope==='mine'?'To pay':'Awaiting payment',rows:paymentSummaryRecords(records,scope,memberId||'','pay'),icon:'outgoing' as IconName,tone:'pay' as const},
  {label:scope==='mine'?'To receive':'Awaiting receipt',rows:paymentSummaryRecords(records,scope,memberId||'','receive'),icon:'incoming' as IconName,tone:'receive' as const},
 ];
 const selectedGroup=groups.find(group=>group.tone===query.group);
 const amount=(rows:RoomTransferRecord[])=>!ready?'—':partial?(rows.length?'≥ '+fmt(totalTransferCents(rows)):'—'):fmt(totalTransferCents(rows));

 useEffect(()=>{
  if(!ready||!focusRecordGroup||query.group!==focusRecordGroup)return;
  recordsHeading.current?.focus({preventScroll:true});
  recordsHeading.current?.scrollIntoView({behavior:'smooth',block:'start'});
  setFocusRecordGroup(null);
 },[ready,focusRecordGroup,query.group]);

 function updateQuery(values:Record<string,string|null>){
  const url=new URL(window.location.href);
  for(const [key,value] of Object.entries(values)){
   if(value===null||value==='')url.searchParams.delete(key);else url.searchParams.set(key,value);
  }
  window.history.replaceState(historyStateForQueryUpdate(window.history.state),'',url.pathname+url.search+url.hash);
 }
 function refresh(){
  setNotice('');
  if(accountError){setAccountRefresh(value=>value+1);return;}
  if(selectedRoom&&memberId)setLedgerState({roomId:selectedRoom,memberId,phase:'loading'});
  setLedgerRefresh(value=>value+1);
 }
 function showSummary(group:Exclude<PaymentGroup,'all'>){
  setFocusRecordGroup(group);
  updateQuery({payments:'outstanding',paymentGroup:group,paymentSearch:null,paymentFrom:null,paymentTo:null,paymentStatus:null});
 }
 function paymentTools(){
  const next=new URLSearchParams(window.location.search);
  next.set('room',selectedRoom);next.set('paymentsView','ledger');
  router.push('/payments?'+next.toString());
 }
 function openGame(row:RoomTransferRecord){
  router.push(row.game.results_token?'/games/results/'+encodeURIComponent(row.game.results_token):'/games/'+encodeURIComponent(row.game.id));
 }
 function chooseRoom(id:string){
  setNotice('');setSelectedAction(null);setPreferredRoom(id);
  try{localStorage.setItem('pkr_preferred_room',id);}catch{}
  window.dispatchEvent(new CustomEvent('pkr:room-changed',{detail:id}));
  updateQuery({room:id,paymentsScope:'mine',paymentGroup:null});
 }
 function allowed(row:RoomTransferRecord,action:PaymentAction){
  return ready&&canTakePaymentAction(row,action,{memberId,canManage,control:controls[row.game.id]});
 }
 function chooseAction(row:RoomTransferRecord,action:PaymentAction){
  if(!allowed(row,action))return;
  setActionError('');setSelectedAction({row,action});
 }
 async function confirmAction(){
  if(!selectedAction||busy)return;
  const {row,action}=selectedAction;
  const current=ledger?.records.find(item=>paymentRowKey(item)===paymentRowKey(row));
  if(!current||current.transfer.amount!==row.transfer.amount||current.transfer.status!==row.transfer.status||!allowed(current,action)){
   setActionError('This record has changed. Close this window and refresh your payments.');return;
  }
  setBusy(true);setActionError('');setNotice('');
  try{
   if(action==='record_paid'){
    const result=await api.games.setTransferStatus(current.game.id,current.transfer.id!,'paid');
    if(!result.ok)throw new Error('The payment update could not be verified. Refresh your records before trying again.');
   }else{
    const result=await api.games.respondToTransfer(current.game.id,current.transfer.id!,action);
    const expected=action==='sent'?'payer_claimed':action==='received'?'paid':'not_received';
    if(!result.ok||result.status!==expected)throw new Error('The payment update could not be verified. Refresh your records before trying again.');
   }
   // Reload the saved ledger; never manufacture a paid status or receipt time.
   setSelectedAction(null);setLedgerState({roomId:selectedRoom,memberId:memberId!,phase:'loading'});
   setLedgerRefresh(value=>value+1);
   setNotice(action==='sent'?'Marked as sent. The recipient still needs to confirm receipt.':
    action==='received'?'Receipt confirmed. The payment record has been updated.':
    action==='not_received'?'Recorded as not received. The payer can review this payment.':'Recorded as paid.');
  }catch(error){setActionError(error instanceof Error?error.message:'The payment record could not be updated.');}
  finally{setBusy(false);}
 }

 const modalTitle=selectedAction?.action==='sent'?'Mark this as sent?':selectedAction?.action==='received'?'Confirm receipt?':
  selectedAction?.action==='not_received'?'Payment not received?':'Record this as paid?';
 const modalAction=selectedAction?.action==='sent'?'Yes, mark as sent':selectedAction?.action==='received'?'Confirm received':
  selectedAction?.action==='not_received'?'Confirm not received':'Record paid';
 const emptyTitle=hasSearchFilters?'No matching payments':selectedGroup?
  partial?'No matching open payments in the loaded records':scope==='mine'?(query.group==='pay'?'Nothing to pay':'Nothing to receive'):
   query.group==='pay'?'No payments awaiting payment':'No payments awaiting receipt':query.filter==='outstanding'?
  partial?'No open payments in the loaded records':'All square':query.filter==='paid'?'No recorded payments yet':'No payment records yet';

 return <main className="pkr-gn-payments" aria-label="Payments overview">
  <header className="pkr-gn-payments-heading">
   <div><p className="pkr-gn-payments-club">{room?.name||'Your poker club'}</p><h1>Payments</h1></div>
   <button type="button" className="pkr-gn-payment-refresh" disabled={loading||busy||(!selectedRoom&&!accountError)} onClick={refresh} aria-label="Refresh payment records"><PaymentIcon name="refresh"/></button>
  </header>
  <section className="pkr-pc-cashier-hero pkr-no-payments-hero" data-testid="private-club-cashier" aria-label="Your private club cashier">
    <PkrBrandMark className="pkr-brand-mark--hero pkr-brand-mark--payments"/>
    <span className="pkr-no-payments-cut" aria-hidden="true"/>
    <div className="pkr-pc-cashier-copy">
      <span className="pkr-pc-overline">PKR / PAYMENT RECORDS</span>
      <h1>Cashier <em>&amp; Settlements</em></h1>
      <p>{room?.name||'Your poker club'}</p>
      <div className="pkr-pc-cashier-status">
        <span>{loading?'CHECKING RECORDS':partial?'PARTIAL RECORDS':ready?'SAVED RECORDS READY':'PRIVATE CLUB ACCOUNTS'}</span>
        <strong>{scope==='club'?'CLUB VIEW':'MY PAYMENTS'}</strong>
      </div>
    </div>
    <button type="button" className="pkr-pc-cashier-refresh" disabled={loading||busy||(!selectedRoom&&!accountError)}
      onClick={refresh}><PaymentIcon name="refresh"/> Refresh records</button>
  </section>

  {rooms.length>1&&<label className="pkr-gn-payment-room-label">Poker club<select value={selectedRoom} disabled={busy} onChange={event=>chooseRoom(event.target.value)}>{rooms.map(item=><option key={item.id} value={item.id}>{item.name}</option>)}</select></label>}
  {canManage?<div className="pkr-gn-payment-scope" role="group" aria-label="Payment view">
   {(['mine','club'] as PaymentScope[]).map(value=><button type="button" key={value} aria-pressed={scope===value} onClick={()=>updateQuery({paymentsScope:value,paymentGroup:null})}>{value==='mine'?'Mine':'Club'}</button>)}
  </div>:<p className="pkr-gn-payment-view-label">Your payment records</p>}

  <section className="pkr-gn-payment-totals" aria-label={scope==='mine'?'Your open payments':'Club open payments'} aria-busy={loading}>
   {groups.map(group=><button type="button" className={'pkr-gn-payment-total is-'+group.tone} key={group.label}
     disabled={!ready} onClick={()=>showSummary(group.tone)} aria-pressed={query.group===group.tone}
     aria-controls="pkr-gn-payment-records-heading" aria-label={'View underlying records: '+group.label}>
    <span className="pkr-gn-payment-total-label"><span className="pkr-gn-payment-direction"><PaymentIcon name={group.icon}/></span>{group.label}</span>
    <strong>{amount(group.rows)}</strong>
    <small>{ready?partial?'Recorded so far':group.rows.length===0?'Nothing outstanding':group.rows.length+' open '+(group.rows.length===1?'payment':'payments'):
     accountError||ledgerError?'Unavailable':!loadingAccount&&!rooms.length?'No club selected':'Checking records'}</small>
   </button>)}
  </section>
  {ready&&<p className="pkr-gn-payment-totals-note">Select a total to view its open payment records. Totals cover all open payments in this view.</p>}

  {notice&&<p className="pkr-gn-payment-notice" role="status"><PaymentIcon name="check"/>{notice}</p>}
  {partial&&<div className="pkr-gn-payment-warning" role="status"><p>{ledger!.unavailable.length>0?'Some game records could not be loaded. ':''}{needsReview>0?needsReview+' historical '+(needsReview===1?'record needs':'records need')+' host review. ':''}The amounts shown may be incomplete.</p>
   <div className="pkr-gn-payment-warning-actions">
    {ledger!.unavailable.length>0&&<button type="button" onClick={refresh}>Retry unavailable records</button>}
    {needsReview>0&&<button type="button" onClick={()=>updateQuery({payments:'all',paymentStatus:'legacy',paymentGroup:null,paymentSearch:null,paymentFrom:null,paymentTo:null})}>View records needing review</button>}
   </div>
  </div>}

  <div className="pkr-gn-payment-filters" role="group" aria-label="Payment records">
   {([['outstanding','Open',outstandingRoomTransfers(tabRecords).length],['paid','History',tabRecords.filter(row=>row.transfer.status==='paid').length],['all','All',tabRecords.length]] as const).map(([value,label,count])=>
    <button type="button" key={value} aria-pressed={query.filter===value} onClick={()=>updateQuery({payments:value as PaymentFilter,paymentGroup:null})}>{label} {ready&&<span>{count}</span>}</button>)}
  </div>

  {ready&&<section className="pkr-gn-payment-search-tools" aria-label="Find payments">
   <label className="pkr-gn-payment-search-label">{scope==='mine'?'Counterparty':'Player name'}<span><PaymentIcon name="search"/><input type="search" value={query.search} placeholder="Search a player" onChange={event=>updateQuery({paymentSearch:event.target.value})}/></span></label>
   <details className="pkr-gn-payment-advanced-filters">
    <summary>Date &amp; status{(query.from||query.to||query.status!=='all')&&<span>Filters applied</span>}</summary>
    <div className="pkr-gn-payment-filter-fields">
     <label>Game date from<input type="date" value={query.from} max={query.to||undefined} onChange={event=>updateQuery({paymentFrom:event.target.value})}/></label>
     <label>Game date to<input type="date" value={query.to} min={query.from||undefined} onChange={event=>updateQuery({paymentTo:event.target.value})}/></label>
     <label className="pkr-gn-payment-status-filter">Payment status<select value={query.status} onChange={event=>updateQuery({paymentStatus:event.target.value==='all'?null:event.target.value})}>{statusOptions.map(([value,label])=><option value={value} key={value}>{label}</option>)}</select></label>
    </div>
   </details>
   {selectedGroup&&<p className="pkr-gn-payment-group-filter" role="status">Showing {selectedGroup.label.toLocaleLowerCase('en-AU')} records</p>}
   {hasFilters&&<button type="button" className="pkr-gn-payment-clear-filters" onClick={()=>updateQuery({paymentSearch:null,paymentFrom:null,paymentTo:null,paymentStatus:null,paymentGroup:null})}>Clear search and filters</button>}
   {invalidRange&&<p className="pkr-gn-payment-action-error" role="alert">The start date must be on or before the end date.</p>}
  </section>}

  {loading?<div className="pkr-gn-payment-empty" role="status"><span className="pkr-gn-payment-empty-icon"><PaymentIcon name="receipt"/></span><h2>Loading your payments</h2><p>Checking the saved game records.</p></div>:
   accountError||ledgerError?<div className="pkr-gn-payment-empty" role="alert"><h2>Payments could not be loaded</h2><p>{accountError||ledgerError}</p><button type="button" className="pkr-gn-payment-primary" onClick={refresh}>Try again</button></div>:
   !rooms.length?<div className="pkr-gn-payment-empty"><h2>No poker club yet</h2><p>Your payment records will appear after a game is settled.</p><button type="button" className="pkr-gn-payment-primary" onClick={()=>router.push('/dashboard')}>Go to Home</button></div>:
   ready&&<>
    <div className="pkr-gn-payment-list-heading"><h2 id="pkr-gn-payment-records-heading" ref={recordsHeading} tabIndex={-1}>{selectedGroup?selectedGroup.label+' — underlying records':query.filter==='outstanding'?'Still to settle':query.filter==='paid'?'Payment history':'All payment records'}</h2><span aria-live="polite">{visible.length+' '+(visible.length===1?'record':'records')}{hasFilters?' found':''}</span></div>
    {visible.length?<div className="pkr-gn-payment-list">
     {visible.slice(0,visibleLimit).map(row=>{
      const {transfer}=row;
      const payer=transfer.from===memberId;
      const personal=scope==='mine';
      const name=personal?(payer?transfer.to_name:transfer.from_name):transfer.from_name;
      const state=paymentState(row,memberId);
      const canSend=allowed(row,'sent'),canReceive=allowed(row,'received');
      const outstanding=transfer.status!=='paid'&&transfer.status!=='legacy';
      const involved=transfer.from===memberId||transfer.to===memberId;
      return <article className="pkr-gn-payment-card" key={paymentRowKey(row)}>
       <div className="pkr-gn-payment-card-top">
        <span className="pkr-gn-payment-avatar" aria-hidden="true">{initials(name)}</span>
        <div className="pkr-gn-payment-person"><h3>{personal?(payer?'To ':'From '):''}{name}</h3><p>{personal?gameDate(row.game.scheduled_at):'To '+transfer.to_name}</p></div>
        <button type="button" className="pkr-record-action pkr-gn-payment-amount" onClick={()=>openGame(row)}
          aria-label={'View payment record: '+fmt(transfer.amount)+' on '+gameDate(row.game.scheduled_at)}>{fmt(transfer.amount)}</button>
       </div>
       {!personal&&<p className="pkr-gn-payment-game-date">{gameDate(row.game.scheduled_at)}</p>}
       <div className="pkr-gn-payment-card-status"><span className={'pkr-gn-payment-status is-'+state.tone}><PaymentIcon name={state.icon}/>{state.label}</span>
        <button type="button" className="pkr-gn-payment-record-link" onClick={()=>openGame(row)} aria-label={'View game record for '+gameDate(row.game.scheduled_at)}>View game<PaymentIcon name="arrow"/></button>
       </div>
       {canSend&&<button type="button" className="pkr-gn-payment-primary pkr-gn-payment-card-action" disabled={busy} onClick={()=>chooseAction(row,'sent')}>Mark as sent<PaymentIcon name="outgoing"/></button>}
       {canReceive&&<div className="pkr-gn-payment-receipt-actions"><button type="button" className="pkr-gn-payment-primary" disabled={busy} onClick={()=>chooseAction(row,'received')}>Confirm received</button><button type="button" className="pkr-gn-payment-secondary" disabled={busy} onClick={()=>chooseAction(row,'not_received')}>Not received</button></div>}
       {!canSend&&!canReceive&&canManage&&allowed(row,'record_paid')&&<button type="button" className="pkr-gn-payment-secondary pkr-gn-payment-card-action" disabled={busy} onClick={()=>chooseAction(row,'record_paid')}>Record paid</button>}
       {involved&&transfer.status==='payer_claimed'&&payer&&<p className="pkr-gn-payment-card-note">{transfer.to_name} needs to confirm receipt.</p>}
       {involved&&transfer.status==='owed'&&!payer&&<p className="pkr-gn-payment-card-note">Waiting for {transfer.from_name} to mark this as sent.</p>}
       {involved&&outstanding&&controls[row.game.id]==='not_started'&&<p className="pkr-gn-payment-card-note">The host has not opened payment confirmations for this game yet.</p>}
       {involved&&outstanding&&controls[row.game.id]==='unavailable'&&<p className="pkr-gn-payment-card-note">Payment confirmation controls could not be checked. Refresh or open the game to try again.</p>}
       {involved&&outstanding&&!controls[row.game.id]&&<p className="pkr-gn-payment-card-note" role="status">Checking payment confirmation controls…</p>}
       {transfer.status==='paid'&&transfer.paid_at&&<p className="pkr-gn-payment-card-note">Recorded {gameDate(transfer.paid_at)}</p>}
       {transfer.status==='legacy'&&<p className="pkr-gn-payment-card-note">Ask your host to review this historical record before taking action.</p>}
       {canManage&&outstanding&&<button type="button" className="pkr-gn-payment-notification-link" onClick={()=>router.push('/games/'+encodeURIComponent(row.game.id))}>Notifications &amp; reminders<PaymentIcon name="arrow"/></button>}
      </article>;
     })}
    </div>:<div className="pkr-gn-payment-empty"><span className="pkr-gn-payment-empty-icon"><PaymentIcon name={query.filter==='outstanding'&&!partial&&!hasSearchFilters?'check':'receipt'}/></span><h2>{emptyTitle}</h2><p>{hasSearchFilters?'Try another player, date range or payment status.':query.filter==='outstanding'?(partial?'Review the unavailable or historical records before treating these payments as settled.':selectedGroup?'There are no open payment records contributing to this total.':'There are no outstanding payments in these records.'):'Saved payment records will appear here after games are settled.'}</p></div>}
    {visible.length>visibleLimit&&<button type="button" className="pkr-gn-payment-secondary pkr-gn-payment-show-more" onClick={()=>setVisibleLimit(value=>value+20)}>Show more payments · {visible.length-visibleLimit} remaining</button>}
    <p className="pkr-gn-payment-footnote">Pay outside PKR, then mark it sent. Your recipient confirms receipt. These actions update the payment record only.</p>
    <div className="pkr-gn-payment-tools">
     <button type="button" className="pkr-gn-payment-tools-link" onClick={paymentTools}><span><PaymentIcon name="receipt"/>Ledger &amp; tools</span><PaymentIcon name="arrow"/></button>
     <button type="button" className="pkr-gn-payment-tools-link" onClick={()=>router.push('/results?room='+encodeURIComponent(selectedRoom))}><span>Results &amp; history</span><PaymentIcon name="arrow"/></button>
     {room?.role==='host'&&<button type="button" className="pkr-gn-payment-tools-link" onClick={()=>router.push('/events/'+encodeURIComponent(selectedRoom)+'?tab=night')}><span>Club tools &amp; export</span><PaymentIcon name="arrow"/></button>}
     {room?.role==='host'&&<button type="button" className="pkr-gn-payment-tools-link"
      aria-expanded={integrityOpen} aria-controls="pkr-host-integrity-panel"
      onClick={()=>setIntegrityOpen(value=>!value)}>
      <span><PaymentIcon name="receipt"/>Saved game integrity review</span>
      <PaymentIcon name="arrow"/>
     </button>}
    </div>
    {room?.role==='host'&&integrityOpen&&<div id="pkr-host-integrity-panel">
      <FinancialIntegrityReview key={selectedRoom} roomId={selectedRoom}/>
    </div>}
   </>}

  {selectedAction&&<AppDialog className="pkr-gn-payment-dialog" aria-labelledby="pkr-gn-payment-dialog-title" onDismiss={()=>{if(!busy)setSelectedAction(null);}}
   onClick={event=>{if(event.target===event.currentTarget&&!busy)setSelectedAction(null);}}>
   <div className="pkr-gn-payment-dialog-inner">
    <span className="pkr-gn-payment-dialog-handle" aria-hidden="true"/>
    <h2 id="pkr-gn-payment-dialog-title">{modalTitle}</h2>
    <strong className="pkr-gn-payment-dialog-amount">{fmt(selectedAction.row.transfer.amount)}</strong>
    <p>{selectedAction.row.transfer.from_name} <span aria-hidden="true">→</span> {selectedAction.row.transfer.to_name}<br/><span>{gameDate(selectedAction.row.game.scheduled_at)}</span></p>
    <p className="pkr-gn-payment-dialog-explanation">{selectedAction.action==='sent'?'Only mark sent after you have paid. The recipient will confirm receipt.':
      selectedAction.action==='received'?'Check that you have received this amount before confirming.':
      selectedAction.action==='not_received'?'This tells the payer to check the payment. It reopens the payment record.':'Check the actual receipt before recording this payment as paid.'} This updates the PKR record only.</p>
    {actionError&&<p className="pkr-gn-payment-action-error" role="alert">{actionError}</p>}
    <button type="button" className="pkr-gn-payment-primary" disabled={busy} onClick={()=>void confirmAction()}>{busy?'Updating record…':modalAction}</button>
    <button type="button" className="pkr-gn-payment-secondary" disabled={busy} onClick={()=>setSelectedAction(null)}>Cancel</button>
   </div>
  </AppDialog>}
 </main>;
}
