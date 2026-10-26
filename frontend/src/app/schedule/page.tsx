'use client';
import {useEffect,useMemo,useState} from 'react';
import {useRouter} from 'next/navigation';
import {api,fmtDate,type Event,type Game} from '@/lib/api';
type Scheduled={room:Event;game:Game};
type Filter='all'|'live'|'upcoming';

export default function SchedulePage(){
 const router=useRouter();
 const [items,setItems]=useState<Scheduled[]>([]);
 const [loading,setLoading]=useState(true),[error,setError]=useState('');
 const [roomId,setRoomId]=useState('all'),[filter,setFilter]=useState<Filter>('all'),[search,setSearch]=useState('');

 async function refresh(){
   setLoading(true);setError('');
   try{
     const rooms=await api.events.list();
     const batches=await Promise.allSettled(rooms.filter(r=>r.status!=='ended').map(async room=>({
       room,games:await api.games.list(room.id)
     })));
     const all=batches.flatMap(x=>x.status==='fulfilled'
       ?x.value.games.map(game=>({room:x.value.room,game})):[])
       .filter(x=>['scheduled','lobby','active'].includes(x.game.status))
       .sort((a,b)=>a.game.scheduled_at-b.game.scheduled_at);
     setItems(all);
     if(batches.some(x=>x.status==='rejected'))
       setError('One or more rooms could not be loaded. The schedule may be incomplete.');
   }catch(e:any){setError(e.message||'Unable to load games.');}
   finally{setLoading(false);}
 }
 useEffect(()=>{void refresh();},[]);
 const rooms=useMemo(()=>[...new Map(items.map(x=>[x.room.id,x.room])).values()], [items]);
 const visible=useMemo(()=>items.filter(({room,game})=>
   (roomId==='all'||room.id===roomId)&&
   (filter==='all'||(filter==='live'?game.status==='active':game.status!=='active'))&&
   (!search.trim()||(room.name+' '+(game.location||'')+' '+fmtDate(game.scheduled_at))
     .toLocaleLowerCase().includes(search.toLocaleLowerCase().trim()))
 ),[items,roomId,filter,search]);
 const live=items.filter(({game})=>game.status==='active').length;

 return <main className="pkr-schedule-page">
   <header className="pkr-schedule-hero">
     <span className="pkr-eyebrow">♠ YOUR POKER CALENDAR</span>
     <h1>Game Schedule</h1>
     <p>All your upcoming and live games, across your poker rooms. Find your night and RSVP in one tap.</p>
     <div className="pkr-schedule-counts">
       <span><strong>{items.length}</strong> upcoming & live</span>
       <span><strong>{live}</strong> live now</span>
       <span><strong>{rooms.length}</strong> rooms</span>
     </div>
   </header>
   <section className="pkr-schedule-toolbar" aria-label="Schedule filters">
     <label>Search games
       <input aria-label="Search room, place or time" placeholder="Search room or location…"
         type="search" value={search} onChange={e=>setSearch(e.target.value)}/>
     </label>
     <label>Poker room
       <select aria-label="Filter by poker room" value={roomId} onChange={e=>setRoomId(e.target.value)}>
         <option value="all">All rooms</option>
         {rooms.map(r=><option value={r.id} key={r.id}>{r.name}</option>)}
       </select>
     </label>
     <label>Status
       <select aria-label="Filter by game status" value={filter} onChange={e=>setFilter(e.target.value as Filter)}>
         <option value="all">All upcoming & live</option>
         <option value="upcoming">Not yet started</option>
         <option value="live">Live games</option>
       </select>
     </label>
     <button className="btn btn-outline" type="button" disabled={loading}
       onClick={()=>void refresh()} aria-label="Refresh game schedule">↻ Refresh</button>
   </section>
   {error&&<p role="alert" className="pkr-vnext-warning">{error}</p>}
   {loading?<div className="pkr-schedule-empty" role="status">Loading your poker nights…</div>:
     visible.length?<section className="pkr-schedule-cards" aria-label="Matching games">
       {visible.map(({room,game})=><article className="pkr-schedule-game" key={game.id}>
         <span className="pkr-game-status">{game.status==='active'?'● LIVE TABLE':'◷ '+game.status.toUpperCase()}</span>
         <span className="pkr-eyebrow">{room.name}</span>
         <h2>{new Date(game.scheduled_at*1000).toLocaleDateString('en-AU',{
           weekday:'long',day:'numeric',month:'long'})}</h2>
         <p style={{fontSize:16,color:'var(--ivory)',fontWeight:600}}>
           {new Date(game.scheduled_at*1000).toLocaleTimeString('en-AU',{hour:'numeric',minute:'2-digit'})}
         </p>
         <p>⌖ {game.location||'Location to be confirmed'} · {game.seats} seats</p>
         <div className="pkr-game-actions">
           <button type="button" onClick={()=>router.push('/games/'+game.id)}>
             Game details →
           </button>
           <button type="button" onClick={()=>router.push(game.status==='active'
             ?'/games/'+game.id+'/play':'/games/'+game.id+'/rsvp')}>
             {game.status==='active'?'Open live table →':'RSVP / seats →'}
           </button>
         </div>
       </article>)}
     </section>:
     <section className="pkr-schedule-empty" aria-label="No matching games">
       <h2 style={{fontFamily:'var(--font-display),serif',fontSize:22,color:'var(--white)'}}>No matching poker nights</h2>
       <p>{items.length?'Try clearing the room or status filters.':'Your host can schedule a poker night from your room.'}</p>
       <button className="btn btn-primary" type="button"
         onClick={()=>items.length? (setFilter('all'),setRoomId('all'),setSearch('')):router.push('/dashboard')}>
         {items.length?'Clear filters':'Open my rooms →'}
       </button>
     </section>}
 </main>;
}
