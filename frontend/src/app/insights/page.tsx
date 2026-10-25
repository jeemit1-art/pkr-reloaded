'use client';
import {useEffect,useState} from 'react';
import {useRouter} from 'next/navigation';
import {api,Event} from '@/lib/api';

export default function InsightsPage(){
 const router=useRouter();
 const [rooms,setRooms]=useState<Event[]>([]);
 const [loading,setLoading]=useState(true);
 const [error,setError]=useState('');
 useEffect(()=>{api.events.list().then(setRooms).catch(e=>setError(e.message||'Unable to load rooms')).finally(()=>setLoading(false));},[]);
 const active=rooms.filter(r=>r.status!=='ended');
 const totalGames=rooms.reduce((n,r)=>n+(r.game_count||0),0);
 const members=rooms.reduce((n,r)=>n+(r.member_count||0),0);
 return <main className="pkr-insights-page">
  <div className="pkr-insights-top"><button onClick={()=>router.push('/dashboard')}>♠ PKR / Home</button><span>INSIGHTS & SETTLEMENT</span></div>
  <header className="pkr-insights-banner"><div className="pkr-eyebrow">▥ INSIGHTS & SETTLEMENT</div><h1>Insights & Settlement</h1><p>Your poker rooms, members and games in one place.</p></header>
  {error&&<p role="alert" className="pkr-insights-alert">{error}</p>}
  {loading?<p>Loading your poker statistics…</p>:<>
   <section className="pkr-insights-kpis" aria-label="Verified room summary">
    <div><small>♧ Total Games</small><strong>{totalGames}</strong><span>Recorded across your rooms</span></div>
    <div><small>♟ Members</small><strong>{members}</strong><span>Memberships across rooms</span></div>
    <div><small>♠ Active Rooms</small><strong>{active.length}</strong><span>Rooms currently available</span></div>
    <div><small>▦ All Rooms</small><strong>{rooms.length}</strong><span>Including archived rooms</span></div>
   </section>
   <div className="pkr-insights-columns">
    <section className="pkr-insights-card"><h2>♠ Room Overview</h2><p>Open a room to review its recorded games and player results.</p>
      {rooms.length?rooms.map(r=><button key={r.id} onClick={()=>router.push('/events/'+r.id)}><span><strong>{r.name}</strong><small>{r.game_count||0} games · {r.member_count||0} members</small></span><span>Open →</span></button>):<p>No rooms yet. Create one to start tracking games.</p>}
    </section>
    <section className="pkr-insights-card"><h2>＄ Settlement Center</h2><p>Financial amounts are only displayed from verified game ledger records. Room counts cannot determine who owes whom.</p>
      <div className="pkr-insights-note">Select a room to open its game ledger, cash-outs and settlement results.</div>
      {active.length>0&&<button onClick={()=>router.push('/events/'+active[0].id)}><span>Open {active[0].name}</span><span>→</span></button>}
    </section>
   </div>
  </>}
 </main>;
}
