'use client';
import {useEffect,useMemo,useState} from 'react';
import {useRouter} from 'next/navigation';
import {api,fmt,fmtDate,fmtSign,type Event,type Game,type LeaderboardEntry,type Transfer} from '@/lib/api';

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

 useEffect(()=>{
  let live=true;
  api.events.list().then(r=>{if(!live)return;setRooms(r);setSelected(r.find(x=>x.status!=='ended')?.id||r[0]?.id||'');})
   .catch(e=>{if(live)setError(e.message||'Could not load rooms')})
   .finally(()=>{if(live)setLoadingRooms(false)});
  return()=>{live=false};
 },[]);

 useEffect(()=>{
  if(!selected)return;
  let live=true;
  setLoadingDetails(true);setError('');setGames([]);setLeaders([]);setTransfers([]);setTransfersPartial(false);setSettlementView('transfers');
  Promise.all([api.games.list(selected),api.events.leaderboard(selected)]).then(async ([g,l])=>{
   if(!live)return;
   setGames(g);setLeaders(l);
   const settled=g.filter(x=>x.status==='settled'&&x.results_token).sort((a,b)=>b.scheduled_at-a.scheduled_at).slice(0,5);
   const result=await Promise.allSettled(settled.map(async game=>({game,results:await api.games.results(game.results_token!)})));
   if(!live)return;
   setTransfers(result.flatMap(item=>item.status==='fulfilled'?
    (item.value.results.transfers||[]).map(transfer=>({game:item.value.game,transfer})):[]));
   setTransfersPartial(result.some(item=>item.status==='rejected'));
  }).catch(e=>{if(live)setError(e.message||'Could not load room insights')})
   .finally(()=>{if(live)setLoadingDetails(false)});
  return()=>{live=false};
 },[selected]);

 const room=rooms.find(x=>x.id===selected);
 const played=games.filter(g=>g.status==='settled');
 const upcoming=games.filter(g=>['scheduled','lobby','active'].includes(g.status));
 const recent=played.slice().sort((a,b)=>b.scheduled_at-a.scheduled_at);
 const leadersByNet=leaders.slice().sort((a,b)=>b.total_net-a.total_net);
 const best=leadersByNet.find(p=>p.total_net>0);
 const maxNet=Math.max(1,...leaders.map(p=>Math.abs(p.total_net)));
 const outstanding=transfers.filter(t=>t.transfer.status!=='paid');
 const paid=transfers.filter(t=>t.transfer.status==='paid');
 const totalPending=outstanding.reduce((sum,row)=>sum+row.transfer.amount,0);
 const peopleOwing=new Set(outstanding.map(t=>t.transfer.from)).size;
 const peopleReceiving=new Set(outstanding.map(t=>t.transfer.to)).size;
 const balances=useMemo(()=>{
  const map=new Map<string,{name:string;net:number}>();
  for(const {transfer} of transfers){
   if(transfer.status==='paid')continue;
   const from=map.get(transfer.from)||{name:transfer.from_name,net:0};
   from.net-=transfer.amount;map.set(transfer.from,from);
   const to=map.get(transfer.to)||{name:transfer.to_name,net:0};
   to.net+=transfer.amount;map.set(transfer.to,to);
  }
  return [...map.entries()].map(([id,value])=>({id,...value})).filter(x=>x.net!==0).sort((a,b)=>b.net-a.net);
 },[transfers]);
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
    <div className="pkr-insights-kpi"><span className="pkr-insights-kpi-icon">＄</span><span className="pkr-insights-kpi-copy"><small>Outstanding</small><strong>{fmt(totalPending)}</strong><em>Latest five settled games</em></span></div>
   </section>
   {loadingDetails&&<p className="pkr-insights-loader" role="status">Updating the recorded results and settlement information…</p>}
   <div className="pkr-insights-overview-grid">
    <section className="pkr-vnext-card pkr-insights-balance-summary">
     <div className="pkr-vnext-card-heading"><div><h2>＄ Balance Summary</h2><p>Recorded outstanding transfers from the latest five settled games.</p></div>
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
     <div className="pkr-vnext-card-heading"><div><h2>＄ Settlement Centre</h2><p>See who pays whom and track recorded payment status.</p></div></div>
     <div className="pkr-insights-settle-tabs" role="tablist" aria-label="Settlement views">
      {([['transfers','Who Pays Who'],['balances','Player Balances'],['status','Payment Status']] as const).map(([key,label])=>
       <button type="button" key={key} role="tab" aria-selected={settlementView===key} className={settlementView===key?'active':''} onClick={()=>setSettlementView(key)}>{label}</button>)}
     </div>
     {transfersPartial&&<p className="pkr-vnext-warning" role="status">Some settlement records could not be loaded. Balances may be incomplete.</p>}
     {settlementView==='transfers'&&
      (transfers.length?<div className="pkr-vnext-table-scroll"><table className="pkr-vnext-data-table"><thead><tr><th>From</th><th>To</th><th>Amount</th><th>Status</th><th>Action</th></tr></thead><tbody>
       {transfers.slice(0,20).map((item,i)=><tr key={item.game.id+':'+(item.transfer.id||i)}>
        <td>{item.transfer.from_name}</td><td>{item.transfer.to_name}</td><td>{fmt(item.transfer.amount)}</td>
        <td><span className={'pkr-vnext-status '+(item.transfer.status==='paid'?'paid':'pending')}>{item.transfer.status==='paid'?'Paid':item.transfer.status==='not_received'?'Not received':'Pending'}</span></td>
        <td><button onClick={()=>router.push('/games/'+item.game.id)}>View game →</button></td>
       </tr>)}
      </tbody></table></div>:<p className="pkr-vnext-empty">No transfers recorded for the latest five settled games.</p>)}
     {settlementView==='balances'&&
      (balances.length?<div className="pkr-insights-balance-list">{balances.map(p=><div className="pkr-insights-balance-row" key={p.id}>
       <span className="pkr-insights-avatar">{p.name.slice(0,1).toUpperCase()}</span><strong>{p.name}</strong><small>{p.net<0?'To pay':'To receive'}</small>
       <b className={p.net<0?'pkr-vnext-negative':'pkr-vnext-positive'}>{fmt(Math.abs(p.net))}</b>
      </div>)}</div>:<p className="pkr-vnext-empty">No outstanding player balances in the recorded transfers.</p>)}
     {settlementView==='status'&&<div className="pkr-insights-payment-summary">
      <div><strong>{paid.length}</strong><span>Recorded as paid</span></div>
      <div><strong>{outstanding.length}</strong><span>Still outstanding</span></div>
      <div><strong>{fmt(totalPending)}</strong><span>Total unpaid amount</span></div>
      <p>Payment labels reflect PKR records only. No money is transferred by this screen. Open the relevant game to review a payment.</p>
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
     <div className="pkr-vnext-card-heading"><div><h2>▥ Player Performance</h2><p>Recorded results for the selected room.</p></div><button type="button" onClick={()=>router.push(roomUrl('leaderboard'))}>All players →</button></div>
     {leaders.length?<div className="pkr-vnext-table-scroll"><table className="pkr-vnext-data-table"><thead><tr><th>Player</th><th>Games</th><th>Wins</th><th>Win rate</th><th>Net result</th></tr></thead>
      <tbody>{leadersByNet.slice(0,8).map((p,i)=><tr key={p.user_id}><td><span className="pkr-insights-player-name"><span className="pkr-insights-rank">{i+1}</span>{p.display_name}</span></td>
       <td>{p.games_played}</td><td>{p.games_won}</td><td>{p.games_played?Math.round(p.games_won/p.games_played*100)+'%':'—'}</td>
       <td className={p.total_net>=0?'pkr-vnext-positive':'pkr-vnext-negative'}>{fmtSign(p.total_net)}</td></tr>)}</tbody>
     </table></div>:<p className="pkr-vnext-empty">Player results appear after a game is settled.</p>}
    </section>
    <section className="pkr-vnext-card pkr-insights-results">
     <div className="pkr-vnext-card-heading"><h2>♛ Player Net Results</h2><span>Lifetime in this room</span></div>
     {leaders.length?<div className="pkr-vnext-performance">{leadersByNet.slice(0,10).map(p=><div className="pkr-vnext-performance-row" key={p.user_id}>
      <span>{p.display_name}</span><div><i className={p.total_net<0?'loss':'gain'} style={{width:(Math.max(3,Math.abs(p.total_net)/maxNet*100))+'%'}}/></div>
      <strong className={p.total_net>=0?'pkr-vnext-positive':'pkr-vnext-negative'}>{fmtSign(p.total_net)}</strong>
     </div>)}</div>:<p className="pkr-vnext-empty">No settled player results recorded yet.</p>}
    </section>
   </div>
   {upcoming.length>0&&<p className="pkr-insights-upcoming-note">{upcoming.length} upcoming or live game{upcoming.length===1?'':'s'} are excluded from settled results.</p>}
  </>}
 </main>;
}
