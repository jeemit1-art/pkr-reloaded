'use client';
import {useEffect,useState} from 'react';
import {useRouter} from 'next/navigation';
import {api,fmtDate,type Event,type Game} from '@/lib/api';
type Scheduled={room:Event;game:Game};
export default function SchedulePage(){
 const router=useRouter();const [items,setItems]=useState<Scheduled[]>([]);
 const [loading,setLoading]=useState(true);const [error,setError]=useState('');
 useEffect(()=>{let live=true;api.events.list().then(async rooms=>{
  const batches=await Promise.allSettled(rooms.map(async room=>({room,games:await api.games.list(room.id)})));
  if(!live)return;
  const all=batches.flatMap(x=>x.status==='fulfilled'?x.value.games.map(game=>({room:x.value.room,game})):[])
   .filter(x=>['scheduled','lobby','active'].includes(x.game.status))
   .sort((a,b)=>a.game.scheduled_at-b.game.scheduled_at);
  setItems(all);
  if(batches.some(x=>x.status==='rejected'))setError('Some rooms could not be loaded. The schedule may be incomplete.');
 }).catch(e=>{if(live)setError(e.message||'Unable to load schedule')}).finally(()=>{if(live)setLoading(false)});return()=>{live=false}},[]);
 return <main className="pkr-schedule-page"><header className="pkr-schedule-hero"><span className="pkr-eyebrow">▦ POKER NIGHT PLANNER</span><h1>Game Schedule</h1><p>Upcoming and live games from rooms you belong to.</p></header>
 {error&&<p className="pkr-vnext-warning" role="alert">{error}</p>}
 <div className="pkr-schedule-list">{loading?<p className="pkr-vnext-empty">Loading your games…</p>:items.length?items.map(({room,game})=><article className="pkr-schedule-entry" key={game.id}><div className="pkr-schedule-calendar"><strong>{new Date(game.scheduled_at*1000).toLocaleDateString('en-AU',{day:'2-digit'})}</strong><small>{new Date(game.scheduled_at*1000).toLocaleDateString('en-AU',{month:'short'})}</small></div><div className="pkr-schedule-info"><span className="pkr-eyebrow">{room.name}</span><h2>{fmtDate(game.scheduled_at)}</h2><p>{game.location||'Location not set'} · {game.seats} seats</p><span className="pkr-vnext-status pending">{game.status}</span></div><div className="pkr-schedule-actions"><button onClick={()=>router.push('/games/'+game.id)}>Game details →</button><button onClick={()=>router.push('/games/'+game.id+'/rsvp')}>RSVP board →</button></div></article>):<section className="pkr-vnext-card"><h2>No upcoming games</h2><p>Your hosts can schedule the next poker night from their rooms.</p><button onClick={()=>router.push('/dashboard')}>Go to poker rooms →</button></section>}</div>
 </main>;
}