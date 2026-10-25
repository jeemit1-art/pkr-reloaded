'use client';
import {useEffect,useMemo,useState} from 'react';
import {useRouter} from 'next/navigation';
import {api,fmt,fmtDate,fmtSign,type Event,type Game,type LeaderboardEntry,type Transfer} from '@/lib/api';
import CasinoArtwork from '@/components/CasinoArtwork';

type SettlementRow={game:Game;transfer:Transfer};
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
  setLoadingDetails(true);setError('');setGames([]);setLeaders([]);setTransfers([]);setTransfersPartial(false);
  Promise.all([api.games.list(selected),api.events.leaderboard(selected)]).then(async ([g,l])=>{
   if(!live)return;
   setGames(g);setLeaders(l);
   const settled=g.filter(x=>x.status==='settled'&&x.results_token).sort((a,b)=>b.scheduled_at-a.scheduled_at).slice(0,5);
   const result=await Promise.allSettled(settled.map(async game=>({game,results:await api.games.results(game.results_token!)})));
   if(!live)return;
   setTransfers(result.flatMap(item=>item.status==='fulfilled'?
    (item.value.results.transfers||[]).map(transfer=>({game:item.value.game,transfer})) : []));
   setTransfersPartial(result.some(item=>item.status==='rejected'));
  }).catch(e=>{if(live)setError(e.message||'Could not load room insights')})
  .finally(()=>{if(live)setLoadingDetails(false)});
  return()=>{live=false};
 },[selected]);
 const room=rooms.find(x=>x.id===selected);
 const played=games.filter(g=>g.status==='settled');
 const upcoming=games.filter(g=>g.status==='scheduled'||g.status==='lobby'||g.status==='active').sort((a,b)=>a.scheduled_at-b.scheduled_at);
 const winners=leaders.slice().sort((a,b)=>b.total_net-a.total_net);
 const maxNet=Math.max(1,...leaders.map(l=>Math.abs(l.total_net)));
 const pending=transfers.filter(t=>t.transfer.status==='owed'||t.transfer.status==='not_received'||t.transfer.status==='legacy'||!t.transfer.status);
 const totalPending=pending.reduce((sum,row)=>sum+row.transfer.amount,0);
 const filteredMonthly=useMemo(()=>{
  const today=new Date(),dates=Array.from({length:6},(_,i)=>{
   const d=new Date(today.getFullYear(),today.getMonth()-5+i,1);
   return {key:d.getFullYear()+'-'+d.getMonth(),label:d.toLocaleDateString('en-AU',{month:'short'}),count:0};
  });
  const map=new Map(dates.map((d,i)=>[d.key,i]));
  games.filter(g=>g.status==='settled').forEach(g=>{
   const d=new Date(g.scheduled_at*1000),i=map.get(d.getFullYear()+'-'+d.getMonth());
   if(i!==undefined)dates[i].count++;
  });
  return dates;
 },[games]);
 const maxMonth=Math.max(1,...filteredMonthly.map(x=>x.count));
 return <main className="pkr-vnext-insights">
  <header className="pkr-vnext-insights-top"><div><span className="pkr-eyebrow">♠ PKR / ANALYTICS</span><h1>Insights &amp; Settlement</h1><p>Real results and balances for your private poker rooms.</p></div>
    <div className="pkr-insights-selector"><label htmlFor="pkr-insights-room">Poker room</label><select id="pkr-insights-room" value={selected} onChange={e=>setSelected(e.target.value)} disabled={loadingRooms||!rooms.length}>{rooms.map(r=><option key={r.id} value={r.id}>{r.name}</option>)}</select></div>
  </header>
  {error&&<p role="alert" className="pkr-insights-alert">{error}</p>}
  {loadingRooms?<p className="pkr-insights-loader">Loading your rooms…</p>:rooms.length===0?
   <section className="pkr-vnext-card"><h2>No poker rooms yet</h2><p>Create a room to start recording games and results.</p><button onClick={()=>router.push('/dashboard')}>Go to dashboard →</button></section>:
  <>
   <section className="pkr-vnext-insights-hero"><div className="pkr-vnext-insights-hero-copy"><span className="pkr-eyebrow">PRIVATE ROOM OVERVIEW</span><h2>{room?.name||'Poker room'}</h2><p>Insights calculated from your recorded games. No estimated winnings or payments.</p></div><div className="pkr-vnext-insights-art" aria-hidden="true"><CasinoArtwork variant="lounge"/></div></section>
   <section className="pkr-vnext-insights-stats" aria-label="Verified room statistics">
    <div><span>♧ Total games</span><strong>{games.length}</strong><small>All game statuses</small></div>
    <div><span>♛ Settled games</span><strong>{played.length}</strong><small>Finalised results</small></div>
    <div><span>♟ Room members</span><strong>{room?.member_count||0}</strong><small>Memberships in this room</small></div>
    <div><span>▦ Upcoming / live</span><strong>{upcoming.length}</strong><small>Games to manage</small></div>
    <div><span>＄ Pending transfers</span><strong>{fmt(totalPending)}</strong><small>From the last five settled games</small></div>
   </section>
   {loadingDetails&&<p className="pkr-insights-loader" role="status">Updating game results and transfers…</p>}
   <div className="pkr-vnext-insights-grid">
    <section className="pkr-vnext-card"><div className="pkr-vnext-card-heading"><h2>▥ Games over time</h2><span>Past six calendar months</span></div><div className="pkr-vnext-bar-chart" role="img" aria-label="Settled games per month">{filteredMonthly.map(d=><div key={d.key} className="pkr-vnext-bar-column"><strong>{d.count}</strong><div><i style={{height:(d.count/maxMonth*100)+'%'}}/></div><span>{d.label}</span></div>)}</div></section>
    <section className="pkr-vnext-card"><div className="pkr-vnext-card-heading"><h2>♛ Top players</h2><button onClick={()=>router.push('/events/'+selected+'?tab=leaderboard')}>Leaderboard →</button></div>{winners.length?winners.slice(0,5).map((p,i)=><div className="pkr-vnext-result-row" key={p.user_id}><span className="pkr-vnext-medal">{i===0?'♛':i+1}</span><span className="pkr-vnext-person"><strong>{p.display_name}</strong><small>{p.games_played} games · {p.games_won} wins</small></span><strong className={p.total_net>=0?'pkr-vnext-positive':'pkr-vnext-negative'}>{fmtSign(p.total_net)}</strong></div>):<p className="pkr-vnext-empty">No settled results for this room yet.</p>}</section>
   </div>
   <div className="pkr-vnext-insights-grid">
    <section className="pkr-vnext-card" id="pkr-settlement"><div className="pkr-vnext-card-heading"><h2>＄ Settlement Center</h2><span>Latest five settled games</span></div><p className="pkr-vnext-muted">Payment status is displayed as recorded. Marking a transfer as paid does not itself move money.</p>
     {transfersPartial&&<p className="pkr-vnext-warning" role="status">Some settlements could not be loaded. Amounts may be incomplete.</p>}
     {transfers.length?<div className="pkr-vnext-table-scroll"><table className="pkr-vnext-data-table"><thead><tr><th>From</th><th>To</th><th>Amount</th><th>Status</th><th>Game</th></tr></thead><tbody>{transfers.slice(0,20).map((item,i)=><tr key={item.game.id+':'+(item.transfer.id||i)}><td>{item.transfer.from_name}</td><td>{item.transfer.to_name}</td><td>{fmt(item.transfer.amount)}</td><td><span className={'pkr-vnext-status '+(item.transfer.status==='paid'?'paid':'pending')}>{item.transfer.status==='paid'?'Paid':item.transfer.status==='not_received'?'Not received':'Pending'}</span></td><td><button onClick={()=>router.push('/games/'+item.game.id)}>Open →</button></td></tr>)}</tbody></table></div>:<p className="pkr-vnext-empty">No recorded transfers in the most recent settled games.</p>}</section>
    <section className="pkr-vnext-card"><div className="pkr-vnext-card-heading"><h2>♧ Recent games</h2><button onClick={()=>router.push('/events/'+selected+'?tab=history')}>History →</button></div>{games.length?games.slice().sort((a,b)=>b.scheduled_at-a.scheduled_at).slice(0,6).map(g=><button className="pkr-vnext-game-row" key={g.id} onClick={()=>router.push('/games/'+g.id)}><span><strong>{fmtDate(g.scheduled_at)}</strong><small>{g.location||room?.name||'Poker game'}</small></span><span className={'pkr-vnext-status '+(g.status==='settled'?'paid':'pending')}>{g.status}</span></button>):<p className="pkr-vnext-empty">No games recorded yet.</p>}</section>
   </div>
   <section className="pkr-vnext-card"><div className="pkr-vnext-card-heading"><h2>▥ Player net results</h2><span>Across settled games in this room</span></div>{leaders.length?<div className="pkr-vnext-performance">{winners.slice(0,12).map(p=><div className="pkr-vnext-performance-row" key={p.user_id}><span>{p.display_name}</span><div><i className={p.total_net<0?'loss':'gain'} style={{width:(Math.max(3,Math.abs(p.total_net)/maxNet*100))+'%'}}/></div><strong className={p.total_net>=0?'pkr-vnext-positive':'pkr-vnext-negative'}>{fmtSign(p.total_net)}</strong></div>)}</div>:<p className="pkr-vnext-empty">Net results appear after games have been settled.</p>}</section>
  </>}
 </main>;
}