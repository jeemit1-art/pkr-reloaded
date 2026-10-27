'use client';
import {useEffect,useMemo,useState} from 'react';
import {useRouter} from 'next/navigation';
import {api,fmt,fmtDate,fmtSign,type Event,type Game,type LeaderboardEntry,type Transfer} from '@/lib/api';
import {isCurrentGame,isUnfinishedGame} from '@/lib/game-status';

type SettlementRow={game:Game;transfer:Transfer};
type SettlementView='transfers'|'balances'|'status';

export default function InsightsPage(){
 const router=useRouter();
 const [rooms,setRooms]=useState<Event[]>([]);
 const [selected,setSelected]=useState('');
 const [loadingRooms,setLoadingRooms]=useState(true);
 const [loadingDetails,setLoadingDetails]=useState(false);
 const [error,setError]=useState('');
 const [games,setGames]=useState<Game[]>([]);
 const [leaders,setLeaders]=useState<LeaderboardEntry[]>([]);
 const [transfers,setTransfers]=useState<SettlementRow[]>([]);
 const [transfersPartial,setTransfersPartial]=useState(false);
 const [settlementView,setSettlementView]=useState<SettlementView>('transfers');
 const [paymentBusy,setPaymentBusy]=useState<string|null>(null);
 const [selectedTransfers,setSelectedTransfers]=useState<string[]>([]);
 const [paymentNotice,setPaymentNotice]=useState('');
 const [transferPage,setTransferPage]=useState(0);
 const [period,setPeriod]=useState<'all'|'90d'>('all');

 useEffect(()=>{
  let live=true;
  api.events.list().then(r=>{if(!live)return;setRooms(r);
    let last='';try{last=localStorage.getItem('pkr_preferred_room')||''}catch{}
    setSelected(r.find(x=>x.id===last)?.id||r.find(x=>x.status!=='ended')?.id||r[0]?.id||'');
  })
   .catch(e=>{if(live)setError(e.message||'Could not load rooms')})
   .finally(()=>{if(live)setLoadingRooms(false)});
  return()=>{live=false};
 },[]);

 useEffect(()=>{
  if(!selected)return;
  let live=true;
  setPaymentNotice('');setPaymentBusy(null);setTransferPage(0);setPeriod('all');setSelectedTransfers([]);
  setLoadingDetails(true);setError('');setGames([]);setLeaders([]);setTransfers([]);setTransfersPartial(false);setSettlementView('transfers');
  Promise.all([api.games.list(selected),api.events.leaderboard(selected)]).then(async ([g,l])=>{
   if(!live)return;
   setGames(g);setLeaders(l);
   const settled=g.filter(x=>x.status==='settled'&&x.results_token).sort((a,b)=>b.scheduled_at-a.scheduled_at);
   // Read every settled game, in small batches to protect the Worker and D1.
   // Never mutate settlement records when preparing insights.
   const rows:SettlementRow[]=[];
   let partial=false;
   for(let offset=0;offset<settled.length;offset+=6){
     const results=await Promise.allSettled(settled.slice(offset,offset+6).map(
       async game=>({game,results:await api.games.results(game.results_token!)})));
     if(!live)return;
     for(const item of results){
       if(item.status==='rejected'){partial=true;continue;}
       for(const transfer of item.value.results.transfers||[]){
         rows.push({game:item.value.game,transfer});
       }
     }
   }
   if(!live)return;
   setTransfers(rows);
   setTransfersPartial(partial);
  }).catch(e=>{if(live)setError(e.message||'Could not load room insights')})
   .finally(()=>{if(live)setLoadingDetails(false)});
  return()=>{live=false};
 },[selected]);

 const room=rooms.find(x=>x.id===selected);
 const canManagePayments=room?.role==='host'||room?.role==='cohost';
 const played=games.filter(g=>g.status==='settled');
 const upcoming=games.filter(g=>isCurrentGame(g));
 const unfinished=games.filter(g=>isUnfinishedGame(g));
 const recent=played.slice().sort((a,b)=>b.scheduled_at-a.scheduled_at);
 const leadersByNet=leaders.slice().sort((a,b)=>b.total_net-a.total_net);
 const best=leadersByNet.find(p=>p.total_net>0);
 const maxNet=Math.max(1,...leaders.map(p=>Math.abs(p.total_net)));
 const filteredTransfers=period==='all'?transfers:transfers.filter(x=>x.game.scheduled_at>=Math.floor(Date.now()/1000)-90*86400);
 // Current outstanding counts exclude statuses not recorded as owed or paid.
 // Unreviewed statuses are still blocked from financial edits by the API.
 const outstanding=filteredTransfers.filter(t=>t.transfer.status!=='paid'&&t.transfer.status!=='legacy');
 const paid=filteredTransfers.filter(t=>t.transfer.status==='paid');
 const perPage=20;
 const pageCount=Math.max(1,Math.ceil(filteredTransfers.length/perPage));
 const page=Math.min(transferPage,pageCount-1);
 const pageTransfers=filteredTransfers.slice(page*perPage,(page+1)*perPage);
 const totalPending=outstanding.reduce((sum,row)=>sum+row.transfer.amount,0);
 const peopleOwing=new Set(outstanding.map(t=>t.transfer.from)).size;
 const peopleReceiving=new Set(outstanding.map(t=>t.transfer.to)).size;
 const selectionKey=(row:SettlementRow)=>row.game.id+':'+row.transfer.id;
 const selectable=pageTransfers.filter(row=>row.transfer.id&&row.transfer.status!=='legacy');
 const selectedHere=selectable.filter(row=>selectedTransfers.includes(selectionKey(row)));
 async function bulkPaymentStatus(status:'paid'|'owed'){
   if(!canManagePayments||paymentBusy||!selectedTransfers.length)return;
   const selected=transfers.filter(row=>row.transfer.id&&selectedTransfers.includes(selectionKey(row))
     &&row.transfer.status!=='legacy');
   if(selected.length!==selectedTransfers.length){
     setPaymentNotice('Selection changed. Refresh the settlement list and try again.');return;
   }
   const label=status==='paid'?'paid':'unpaid';
   if(!window.confirm('Mark '+selected.length+' selected transfers '+label+
     '? This updates the PKR payment record only. Verify actual receipts first.'))return;
   const groups=new Map<string,string[]>();
   for(const row of selected){
     const ids=groups.get(row.game.id)||[];
     ids.push(row.transfer.id!);groups.set(row.game.id,ids);
   }
   setPaymentBusy('bulk');setPaymentNotice('');
   let count=0;
   try{
     for(const [gameId,ids] of groups){
       const updated=await api.games.bulkTransferStatus(gameId,ids,status);
       count+=updated.updated;
       setTransfers(previous=>previous.map(item=>
         item.game.id===gameId&&item.transfer.id&&ids.includes(item.transfer.id)
           ?{...item,transfer:{...item.transfer,status,paid_at:status==='paid'?Math.floor(Date.now()/1000):null}}:item));
     }
     setPaymentNotice(count+' transfer(s) marked '+label+'.');
     setSelectedTransfers([]);
   }catch(e:any){
     setPaymentNotice(count+' updated before an error: '+(e?.message||'Please refresh and review.'));
   }finally{setPaymentBusy(null)}
 }

 const balances=useMemo(()=>{
  const map=new Map<string,{name:string;net:number}>();
  for(const {transfer} of filteredTransfers){
   if(transfer.status==='paid'||transfer.status==='legacy')continue;
   const from=map.get(transfer.from)||{name:transfer.from_name,net:0};
   from.net-=transfer.amount;map.set(transfer.from,from);
   const to=map.get(transfer.to)||{name:transfer.to_name,net:0};
   to.net+=transfer.amount;map.set(transfer.to,to);
  }
  return [...map.entries()].map(([id,value])=>({id,...value})).filter(x=>x.net!==0).sort((a,b)=>b.net-a.net);
 },[filteredTransfers]);
 const months=useMemo(()=>{
  const today=new Date(),dates=Array.from({length:6},(_,i)=>{
   const d=new Date(today.getFullYear(),today.getMonth()-5+i,1);
   return {key:d.getFullYear()+'-'+d.getMonth(),label:d.toLocaleDateString('en-AU',{month:'short'}),count:0};
  });
  const index=new Map(dates.map((d,i)=>[d.key,i]));
  games.filter(g=>g.status==='settled').forEach(g=>{
   const d=new Date(g.scheduled_at*1000),i=index.get(d.getFullYear()+'-'+d.getMonth());
   if(i!==undefined)dates[i].count++;
  });
  return dates;
 },[games]);
 const maxMonth=Math.max(1,...months.map(x=>x.count));
 const roomUrl=(tab:string)=>'/events/'+encodeURIComponent(selected)+'?tab='+tab;
 useEffect(()=>{
   if(loadingRooms||!rooms.length)return;
   if(window.location.hash==='#pkr-settlement'){
     const id=window.setTimeout(()=>document.getElementById('pkr-settlement')?.scrollIntoView({block:'start'}),80);
     return()=>window.clearTimeout(id);
   }
 },[loadingRooms,rooms.length]);
 async function setPaymentStatus(row:SettlementRow,status:'owed'|'paid'|'not_received'){
   if(!canManagePayments||!row.transfer.id||row.game.status!=='settled'||row.transfer.status==='legacy')return;
   const current=row.transfer.status==='paid'?'paid':row.transfer.status==='not_received'?'not_received':'owed';
   if(status===current)return;
   const verb=status==='paid'?'Paid':status==='not_received'?'Not received':'Pending';
   const confirmed=window.confirm(
     'Change the payment from '+row.transfer.from_name+' to '+row.transfer.to_name+
     ' ('+fmt(row.transfer.amount)+') to '+verb+'?\\n\\nThis updates the PKR record only. It does not transfer money.'
   );
   if(!confirmed)return;
   const key=row.game.id+':'+row.transfer.id;
   setPaymentBusy(key);setPaymentNotice('');
   try{
     await api.games.setTransferStatus(row.game.id,row.transfer.id,status);
     setTransfers(previous=>previous.map(item=>
       item.game.id===row.game.id&&item.transfer.id===row.transfer.id
       ?{...item,transfer:{...item.transfer,status,paid_at:status==='paid'?Math.floor(Date.now()/1000):null}}:item
     ));
     setPaymentNotice('Payment status updated to '+verb+'.');
   }catch(e){
     setPaymentNotice('Could not change payment status: '+(e instanceof Error?e.message:'Please try again.'));
   }finally{setPaymentBusy(null);}
 }
 return <main className="pkr-vnext-insights pkr-casino pkr-insights-refresh">
  <header className="pkr-vnext-insights-top">
   <div className="pkr-insights-intro"><span className="pkr-eyebrow">▥ INSIGHTS &amp; SETTLEMENT</span>
    <h1>Insights &amp; Settlement</h1>
    <p>Track your room's results, review balances and settle up after game night.</p>
   </div>
   <div className="pkr-insights-selector"><label htmlFor="pkr-insights-room">Poker room</label>
    <select id="pkr-insights-room" value={selected} onChange={e=>setSelected(e.target.value)} disabled={loadingRooms||!rooms.length}>
     {rooms.map(r=><option key={r.id} value={r.id}>{r.name}</option>)}
    </select>
   </div>
  </header>
  {error&&<p role="alert" className="pkr-insights-alert">{error}</p>}
  {loadingRooms?<p className="pkr-insights-loader" role="status">Loading your poker rooms…</p>:rooms.length===0?
   <section className="pkr-vnext-card"><h2>No poker rooms yet</h2><p>Create a room to start recording games and results.</p><button onClick={()=>router.push('/dashboard')}>Go to dashboard →</button></section>:
  <>
   <section className="pkr-vnext-insights-stats pkr-insights-kpis" aria-label="Recorded poker room statistics">
    <div className="pkr-insights-kpi"><span className="pkr-insights-kpi-icon">♧</span><span className="pkr-insights-kpi-copy"><small>Games recorded</small><strong>{games.length}</strong><em>All game statuses</em></span></div>
    <div className="pkr-insights-kpi"><span className="pkr-insights-kpi-icon gold">♛</span><span className="pkr-insights-kpi-copy"><small>Settled games</small><strong>{played.length}</strong><em>Finalised results</em></span></div>
    <div className="pkr-insights-kpi"><span className="pkr-insights-kpi-icon">♟</span><span className="pkr-insights-kpi-copy"><small>Room members</small><strong>{room?.member_count||0}</strong><em>In selected poker room</em></span></div>
    <div className="pkr-insights-kpi"><span className="pkr-insights-kpi-icon gold">♕</span><span className="pkr-insights-kpi-copy"><small>Top net winner</small><strong className="pkr-insights-kpi-winner">{best?best.display_name:'—'}</strong><em>{best?fmtSign(best.total_net):'No positive net result yet'}</em></span></div>
    <div className="pkr-insights-kpi"><span className="pkr-insights-kpi-icon">＄</span><span className="pkr-insights-kpi-copy"><small>Confirmed outstanding</small><strong data-testid="current-outstanding">{fmt(totalPending)}</strong><em>{period==='all'?'All loaded settled games':'Last 90 days'}</em></span></div>
   </section>
   {loadingDetails&&<p className="pkr-insights-loader" role="status">Updating the recorded results and settlement information…</p>}
   <div className="pkr-insights-overview-grid">
    <section className="pkr-vnext-card pkr-insights-balance-summary">
     <div className="pkr-vnext-card-heading"><div><h2>＄ Balance Summary</h2><p>Recorded outstanding transfers across {period==='all'?'all settled games':'the last 90 days'}.</p></div>
      <button type="button" onClick={()=>document.getElementById('pkr-settlement')?.scrollIntoView({behavior:'smooth'})}>View details →</button>
     </div>
     <div className="pkr-insights-balance-tiles">
      <div><strong>{peopleOwing}</strong><span>Players owe</span><small>{fmt(totalPending)} outstanding</small></div>
      <div><strong>{peopleReceiving}</strong><span>To receive</span><small>{fmt(totalPending)} due</small></div>
      <div><strong>{paid.length}</strong><span>Transfers paid</span><small>Recorded as paid</small></div>
      <div><strong>{outstanding.length}</strong><span>Transfers pending</span><small>{outstanding.length?'To be followed up':'No pending transfers'}</small></div>
     </div>
    </section>
    <section className="pkr-vnext-card pkr-insights-trend">
     <div className="pkr-vnext-card-heading"><div><h2>▥ Games Trend</h2><p>Settled games in the last six calendar months.</p></div><span>Last 6 months</span></div>
     <div className="pkr-vnext-bar-chart" role="img" aria-label="Settled games by month for the last six months">
      {months.map(month=><div key={month.key} className="pkr-vnext-bar-column"><strong>{month.count}</strong><div><i style={{height:(month.count/maxMonth*100)+'%'}}/></div><span>{month.label}</span></div>)}
     </div>
    </section>
   </div>
   <div className="pkr-insights-activity-grid">
    <section className="pkr-vnext-card pkr-insights-settlement" id="pkr-settlement">
     <div className="pkr-vnext-card-heading"><div><h2>＄ Settlement Centre</h2><p>See who pays whom and track recorded payment status across your room.</p></div>
       <label style={{display:'grid',gap:5,color:'var(--ivory)',fontSize:12}}>Period
        <select aria-label="Settlement reporting period" value={period} onChange={e=>{setPeriod(e.target.value as 'all'|'90d');setTransferPage(0)}}
          style={{background:'#112b20',border:'1px solid #658260',color:'#ffe8b3',borderRadius:8,padding:'8px 11px'}}>
          <option value="all">All time</option><option value="90d">Last 90 days</option>
        </select></label>
      </div>
     <div className="pkr-insights-settle-tabs" role="tablist" aria-label="Settlement views">
      {([['transfers','Who Pays Who'],['balances','Player Balances'],['status','Payment Status']] as const).map(([key,label])=>
       <button type="button" key={key} role="tab" aria-selected={settlementView===key} className={settlementView===key?'active':''} onClick={()=>setSettlementView(key)}>{label}</button>)}
     </div>
     
     {transfersPartial&&<p className="pkr-vnext-warning" role="status">Some settlement records could not be loaded. Balances may be incomplete.</p>}
     {paymentNotice&&<p className="pkr-insights-payment-notice" role="status">{paymentNotice}</p>}
     <p className="pkr-insights-payment-help">{canManagePayments?'Host / co-host: select a payment status below after checking the transfer.':'Payment status is read-only for members; ask the host or co-host to confirm receipt.'} PKR does not send or receive money.</p>
     {settlementView==='transfers'&&canManagePayments&&filteredTransfers.length>0&&
       <div className="pkr-insights-bulk-actions" style={{display:'flex',gap:8,alignItems:'center',flexWrap:'wrap',margin:'12px 0'}}>
         <span style={{fontSize:12}}>{selectedTransfers.length} selected</span>
         <button type="button" className="btn btn-primary" disabled={paymentBusy!==null||!selectedTransfers.length}
           onClick={()=>void bulkPaymentStatus('paid')}>Mark selected paid</button>
         <button type="button" className="btn btn-outline" disabled={paymentBusy!==null||!selectedTransfers.length}
           onClick={()=>void bulkPaymentStatus('owed')}>Mark selected unpaid</button>
         <button type="button" disabled={paymentBusy!==null||!selectedTransfers.length}
           onClick={()=>setSelectedTransfers([])}>Clear selection</button>
       </div>}
     {settlementView==='transfers'&&
      (filteredTransfers.length?<div className="pkr-vnext-table-scroll"><table className="pkr-vnext-data-table"><thead><tr>
       {canManagePayments&&<th><input type="checkbox" aria-label="Select all visible settlement transfers"
          disabled={paymentBusy!==null||!selectable.length} checked={!!selectable.length&&selectedHere.length===selectable.length}
          onChange={e=>{
            const keys=selectable.map(selectionKey);
            setSelectedTransfers(prev=>e.target.checked?[...new Set([...prev,...keys])]:prev.filter(k=>!keys.includes(k)));
          }}/></th>}
       <th>From</th><th>To</th><th>Amount</th><th>Status</th><th>Action</th>
      </tr></thead><tbody>
       {pageTransfers.map((item,i)=><tr key={item.game.id+':'+(item.transfer.id||i)}>
        {canManagePayments&&<td>{item.transfer.id&&item.transfer.status!=='legacy'&&
          <input type="checkbox" aria-label={'Select settlement '+item.transfer.from_name+' to '+item.transfer.to_name}
            disabled={paymentBusy!==null}
            checked={selectedTransfers.includes(selectionKey(item))}
            onChange={e=>setSelectedTransfers(prev=>e.target.checked
              ?[...new Set([...prev,selectionKey(item)])]:prev.filter(k=>k!==selectionKey(item)))}/>}</td>}
        <td>{item.transfer.from_name}</td><td>{item.transfer.to_name}</td><td>{fmt(item.transfer.amount)}</td>
        <td>
          {canManagePayments&&item.transfer.id&&item.transfer.status!=='legacy'?
           <select className={'pkr-payment-status-select '+(item.transfer.status==='paid'?'paid':item.transfer.status==='not_received'?'not-received':'pending')}
             aria-label={'Payment status for '+item.transfer.from_name+' to '+item.transfer.to_name}
             value={item.transfer.status==='paid'?'paid':item.transfer.status==='not_received'?'not_received':item.transfer.status==='payer_claimed'?'payer_claimed':'owed'}
             disabled={paymentBusy!==null||loadingDetails}
             onChange={e=>void setPaymentStatus(item,e.target.value as 'owed'|'paid'|'not_received')}>
             <option value="owed">Pending</option><option value="paid">Paid</option><option value="not_received">Not received</option>
             <option value="payer_claimed" disabled>Sent · awaiting receipt</option>
           </select>
           :<span className={'pkr-vnext-status '+(item.transfer.status==='paid'?'paid':'pending')}>
             {item.transfer.status==='paid'?'Paid':item.transfer.status==='not_received'?'Not received':item.transfer.status==='payer_claimed'?'Sent · awaiting receipt':item.transfer.status==='legacy'?'Needs review':'Pending'}
           </span>}
         </td>
        <td><button type="button" onClick={()=>router.push(item.game.results_token?'/games/results/'+encodeURIComponent(item.game.results_token):'/games/'+item.game.id)}>View results →</button></td>
       </tr>)}
      </tbody></table>
       {pageCount>1&&<div className="pkr-insights-pagination">
         <button type="button" disabled={page===0} onClick={()=>setTransferPage(n=>Math.max(0,n-1))}>Previous</button>
         <span>Page {page+1} of {pageCount} · {filteredTransfers.length} transfers</span>
         <button type="button" disabled={page===pageCount-1} onClick={()=>setTransferPage(n=>Math.min(pageCount-1,n+1))}>Next</button>
       </div>}
       </div>:<p className="pkr-vnext-empty">No transfers recorded for this period.</p>)}
     {settlementView==='balances'&&
      (balances.length?<div className="pkr-insights-balance-list">{balances.map(p=><div className="pkr-insights-balance-row" key={p.id}>
       <span className="pkr-insights-avatar">{p.name.slice(0,1).toUpperCase()}</span><strong>{p.name}</strong><small>{p.net<0?'To pay':'To receive'}</small>
       <b className={p.net<0?'pkr-vnext-negative':'pkr-vnext-positive'}>{fmt(Math.abs(p.net))}</b>
      </div>)}</div>:<p className="pkr-vnext-empty">No outstanding player balances in the recorded transfers.</p>)}
     {settlementView==='status'&&<div className="pkr-insights-payment-summary">
      <div><strong>{paid.length}</strong><span>Recorded as paid</span></div>
      <div><strong>{outstanding.length}</strong><span>Still outstanding</span></div>
      <div><strong>{fmt(totalPending)}</strong><span>Current outstanding</span></div>
      
      <p>Payment statuses reflect the room's records. PKR does not send or receive money.</p>
     </div>}
    </section>
    <section className="pkr-vnext-card pkr-insights-recent">
     <div className="pkr-vnext-card-heading"><h2>♛ Recent Settled Games</h2><button type="button" onClick={()=>router.push(roomUrl('history'))}>View all →</button></div>
     {recent.length?recent.slice(0,6).map(g=><button className="pkr-vnext-game-row" key={g.id} onClick={()=>router.push('/games/'+g.id)}>
      <span><strong>{fmtDate(g.scheduled_at)}</strong><small>{g.location||room?.name||'Poker game'} · {g.player_count||0} players</small></span>
      <span className="pkr-vnext-status paid">✓ Settled</span>
     </button>):<p className="pkr-vnext-empty">No completed settlements yet.</p>}
    </section>
   </div>
   <div className="pkr-insights-players-grid">
    <section className="pkr-vnext-card pkr-insights-players">
     <div className="pkr-vnext-card-heading"><div><h2>▥ Player Performance</h2><p>All {leaders.length} players with settled results in this room. Members without a settled game are not ranked.</p></div><button type="button" onClick={()=>router.push(roomUrl('leaderboard'))}>All players →</button></div>
     {leaders.length?<><div className="pkr-vnext-table-scroll"><table className="pkr-vnext-data-table"><thead><tr><th>Player</th><th>Games</th><th>Profitable</th><th>Profitable %</th><th>Net result</th></tr></thead>
      <tbody>{leadersByNet.map((p,i)=><tr key={p.user_id}><td><span className="pkr-insights-player-name"><span className="pkr-insights-rank">{i+1}</span>{p.display_name}</span></td>
       <td>{p.games_played}</td><td>{p.games_won}</td><td>{p.games_played?Math.round(p.games_won/p.games_played*100)+'%':'—'}</td>
       <td className={p.total_net>=0?'pkr-vnext-positive':'pkr-vnext-negative'}>{fmtSign(p.total_net)}</td></tr>)}</tbody>
     </table></div>
       <div className="pkr-insights-player-mobile-list" role="list" aria-label="All recorded player performance">
        {leadersByNet.map((p,i)=><div role="listitem" className="pkr-insights-player-mobile-row" key={p.user_id||p.display_name}>
         <span className="pkr-insights-rank" aria-label={'Rank '+(i+1)}>{i+1}</span>
         <span className="pkr-insights-player-mobile-info"><strong>{p.display_name}</strong><small>{p.games_played} games · {p.games_won} profitable · {p.games_played?Math.round(p.games_won/p.games_played*100):0}%</small></span>
         <strong className={p.total_net>=0?'pkr-vnext-positive':'pkr-vnext-negative'}>{fmtSign(p.total_net)}</strong>
        </div>)}
       </div></>:<p className="pkr-vnext-empty">Player results appear after a game is settled.</p>}
    </section>
    <section className="pkr-vnext-card pkr-insights-results">
     <div className="pkr-vnext-card-heading"><h2>♛ Player Net Results</h2><span>All {leaders.length} recorded players · lifetime in this room</span></div>
     {leaders.length?<div className="pkr-vnext-performance">{leadersByNet.map(p=><div className="pkr-vnext-performance-row" key={p.user_id}>
      <span>{p.display_name}</span><div><i className={p.total_net<0?'loss':'gain'} style={{width:(Math.max(3,Math.abs(p.total_net)/maxNet*100))+'%'}}/></div>
      <strong className={p.total_net>=0?'pkr-vnext-positive':'pkr-vnext-negative'}>{fmtSign(p.total_net)}</strong>
     </div>)}</div>:<p className="pkr-vnext-empty">No settled player results recorded yet.</p>}
    </section>
   </div>
   {(upcoming.length>0||unfinished.length>0)&&<p className="pkr-insights-upcoming-note">
     {upcoming.length} upcoming/live and {unfinished.length} unfinished game{unfinished.length===1?'':'s'} are excluded from settled results.
    </p>}
  </>}
 </main>;
}
