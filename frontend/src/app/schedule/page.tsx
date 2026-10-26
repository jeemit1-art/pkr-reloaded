'use client';
import {useEffect,useMemo,useState} from 'react';
import {useRouter} from 'next/navigation';
import {api,fmtDate,type Event,type Game} from '@/lib/api';
import {isCurrentGame,isLiveGame,isUnfinishedGame,gameStatusLabel} from '@/lib/game-status';

type Scheduled={room:Event;game:Game};
type Filter='all'|'live'|'upcoming'|'unfinished';

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
       .filter(x=>['scheduled','lobby','active'].includes(x.game.status));
     setItems(all);
     if(batches.some(x=>x.status==='rejected'))
       setError('One or more rooms could not be loaded. The schedule may be incomplete.');
   }catch(e:any){setError(e.message||'Unable to load games.');}
   finally{setLoading(false);}
 }
 useEffect(()=>{void refresh();},[]);
 const rooms=useMemo(()=>[...new Map(items.map(x=>[x.room.id,x.room])).values()], [items]);
 const current=items.filter(({game})=>isCurrentGame(game));
 const unfinished=items.filter(({game})=>isUnfinishedGame(game));
 const live=current.filter(({game})=>isLiveGame(game)).length;
 const visible=useMemo(()=>items.filter(({room,game})=>
   (roomId==='all'||room.id===roomId)&&
   (filter==='unfinished'?isUnfinishedGame(game)
     :isCurrentGame(game)&&(filter==='all'||(filter==='live'?isLiveGame(game):!isLiveGame(game))))&&
   (!search.trim()||(room.name+' '+(game.location||'')+' '+fmtDate(game.scheduled_at))
     .toLocaleLowerCase().includes(search.toLocaleLowerCase().trim()))
 ).sort((a,b)=>(isLiveGame(b.game)?1:0)-(isLiveGame(a.game)?1:0)||a.game.scheduled_at-b.game.scheduled_at),[items,roomId,filter,search]);

 return <main className="pkr-schedule-page">
   <header className="pkr-schedule-hero">
     <span className="pkr-eyebrow">♠ YOUR POKER CALENDAR</span>
     <h1>Game Schedule</h1>
     <p>Find upcoming poker nights, live tables and historical unfinished games without losing any records.</p>
     <div className="pkr-schedule-counts">
       <span><strong>{current.length}</strong> upcoming &amp; live</span>
       <span><strong>{live}</strong> live now</span>
       <span><strong>{unfinished.length}</strong> unfinished</span>
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
         <option value="all">Upcoming &amp; live</option>
         <option value="upcoming">Not yet started</option>
         <option value="live">Live games</option>
         <option value="unfinished">Unfinished / past due</option>
       </select>
     </label>
     <button className="btn btn-outline" type="button" disabled={loading}
       onClick={()=>void refresh()} aria-label="Refresh game schedule">↻ Refresh</button>
   </section>
   {unfinished.length>0&&filter!=='unfinished'&&<div className="pkr-unfinished-note" role="status" style={{marginBottom:12}}>
     {unfinished.length} older session{unfinished.length===1?' is':'s are'} unfinished and excluded from the live count.
     <button type="button" onClick={()=>setFilter('unfinished')} style={{border:0,background:'transparent',color:'#ffe3a4',fontWeight:750,padding:'0 7px',textDecoration:'underline'}}>Review older games</button>
   </div>}
   {error&&<p role="alert" className="pkr-vnext-warning">{error}</p>}
   {loading?<div className="pkr-schedule-empty" role="status">Loading your poker nights…</div>:
     visible.length?<section className="pkr-schedule-cards" aria-label="Matching games">
       {visible.map(({room,game})=><article className="pkr-schedule-game" key={game.id}>
         <span className={isUnfinishedGame(game)?'pkr-unfinished-label':'pkr-game-status'}>
           {isLiveGame(game)?'● LIVE TABLE':gameStatusLabel(game)}
         </span>
         <span className="pkr-eyebrow">{room.name}</span>
         <h2>{new Date(game.scheduled_at*1000).toLocaleDateString('en-AU',{
           weekday:'long',day:'numeric',month:'long',timeZone:'Australia/Brisbane'})}</h2>
         <p style={{fontSize:16,color:'var(--ivory)',fontWeight:600}}>
           {new Date(game.scheduled_at*1000).toLocaleTimeString('en-AU',{hour:'numeric',minute:'2-digit',timeZone:'Australia/Brisbane'})}
         </p>
         <p>⌖ {game.location||'Location to be confirmed'} · {game.seats} seats</p>
         <div className="pkr-game-actions">
           <button type="button" onClick={()=>router.push('/games/'+game.id)}>
             Game details →
           </button>
           <button type="button" onClick={()=>router.push(
             isUnfinishedGame(game)?'/games/'+game.id
             :isLiveGame(game)?'/games/'+game.id+'/play':'/games/'+game.id+'/rsvp')}>
             {isUnfinishedGame(game)?'Review unfinished game →':isLiveGame(game)?'Open live table →':'RSVP / seats →'}
           </button>
         </div>
       </article>)}
     </section>:
     <section className="pkr-schedule-empty" aria-label="No matching games">
       <h2 style={{fontFamily:'var(--font-display),serif',fontSize:22,color:'var(--white)'}}>No matching poker nights</h2>
       <p>{items.length?'Try clearing the room, search or status filters.':'Your host can schedule a poker night from your room.'}</p>
       <button className="btn btn-primary" type="button"
         onClick={()=>items.length?(setFilter('all'),setRoomId('all'),setSearch('')):router.push('/dashboard')}>
         {items.length?'Clear filters':'Open my rooms →'}
       </button>
     </section>}
 </main>;
}
