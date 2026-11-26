'use client';
import {useCallback,useEffect,useState} from 'react';
import {useRouter} from 'next/navigation';
import {api,type ClubDatePoll,type ClubWaitlist,type ClubMemberRequests,
  type ClubMemberRequestKind,type ClubLeagueSeason,type ClubSeasonStandings,type Game} from '@/lib/api';
import './ClubEngagementPanel.css';

type Props={eventId:string;game?:Game|null;isHost:boolean;onScheduleDate?:(ts:number)=>void};
const fmt=(seconds:number)=>new Date(seconds*1000).toLocaleString('en-AU',{
  day:'numeric',month:'short',year:'numeric',hour:'numeric',minute:'2-digit',timeZone:'Australia/Brisbane'
});
const toTime=(text:string)=>text?Math.floor(new Date(text).getTime()/1000):NaN;
const err=(e:unknown)=>e instanceof Error?e.message:'Action could not be completed';
const kinds:{kind:ClubMemberRequestKind;label:string}[]=[
  {kind:'buyin',label:'Buy-in / more chips'},{kind:'cashout',label:'Cash-out'},
  {kind:'tournament_rebuy',label:'Tournament rebuy'},{kind:'addon',label:'Tournament add-on'}
];

export default function ClubEngagementPanel({eventId,game,isHost,onScheduleDate}:Props){
 const router=useRouter();
 const [enabled,setEnabled]=useState(false),[busy,setBusy]=useState(false);
 const [error,setError]=useState(''),[notice,setNotice]=useState('');
 const [polls,setPolls]=useState<ClubDatePoll[]>([]);
 const [seasons,setSeasons]=useState<ClubLeagueSeason[]>([]);
 const [seasonId,setSeasonId]=useState('');
 const [standings,setStandings]=useState<ClubSeasonStandings|null>(null);
 const [queue,setQueue]=useState<ClubWaitlist|null>(null);
 const [requests,setRequests]=useState<ClubMemberRequests|null>(null);
 const [pollTitle,setPollTitle]=useState(''),[dates,setDates]=useState(['','']);
 const [voteDeadline,setVoteDeadline]=useState('');
 const [leagueName,setLeagueName]=useState(''),[from,setFrom]=useState(''),[through,setThrough]=useState('');
 const [points,setPoints]=useState({first:10,second:7,third:5,other:1});
 const [memberNote,setMemberNote]=useState('');
 const refresh=useCallback(async()=>{
   try{
     const [pollResult,seasonResult]=await Promise.all([api.club.polls(eventId),api.club.seasons(eventId)]);
     setEnabled(true);setPolls(pollResult.polls);setSeasons(seasonResult.seasons);
     setSeasonId(id=>seasonResult.seasons.some(s=>s.id===id)?id:(seasonResult.seasons[0]?.id||''));
   }catch(e){
     if(!/awaits the isolated|not enabled|temporarily unavailable/i.test(err(e)))setError(err(e));
     setEnabled(false);return;
   }
   if(!game?.id){setQueue(null);setRequests(null);return;}
   const [w,r]=await Promise.allSettled([
     ['scheduled','lobby'].includes(game.status)?api.club.waitlist(game.id):Promise.resolve(null),
     game.status==='active'?api.club.memberRequests(game.id):Promise.resolve(null)
   ]);
   setQueue(w.status==='fulfilled'?w.value:null);
   setRequests(r.status==='fulfilled'?r.value:null);
 },[eventId,game?.id,game?.status]);
 useEffect(()=>{
   void refresh();
   const onFocus=()=>{if(document.visibilityState==='visible')void refresh();};
   window.addEventListener('focus',onFocus);
   return()=>window.removeEventListener('focus',onFocus);
 },[refresh]);
 useEffect(()=>{
   if(!enabled||!seasonId){setStandings(null);return;}
   let active=true;
   api.club.seasonStandings(eventId,seasonId).then(r=>{if(active)setStandings(r);})
     .catch(e=>{if(active)setError(err(e));});
   return()=>{active=false;};
 },[eventId,seasonId,enabled,seasons]);
 async function run(work:()=>Promise<unknown>,success:string){
   if(busy)return;
   setBusy(true);setError('');setNotice('');
   try{await work();setNotice(success);await refresh();}
   catch(e){setError(err(e));}
   finally{setBusy(false);}
 }
 if(!enabled)return null;
 const openPoll=polls.find(x=>x.status==='open');
 const past=polls.filter(x=>x.status==='closed'&&x.selected_index!==null);
 const waiting=queue?.my_status==='waiting',offered=queue?.my_status==='offered';
 return <section className="pkr-club" aria-label="Club planning and league">
   <header className="pkr-club-header"><div><small>PRIVATE CLUB TOOLS</small>
     <h3>Organise your poker nights</h3>
     <p>Vote on dates, manage waiting players and follow your club league.</p></div>
     <button type="button" onClick={()=>void refresh()} disabled={busy}>Refresh</button>
   </header>
   {error&&<p role="alert" className="pkr-club-error">{error}</p>}
   {notice&&<p role="status" className="pkr-club-ok">{notice}</p>}
   <div className="pkr-club-grid">
     <details className="pkr-club-card" open={!!openPoll||undefined}>
       <summary>📅 Game date voting <small>{openPoll?'Voting open':polls.length+' saved'}</small></summary>
       {openPoll?<div className="pkr-club-body">
         <strong>{openPoll.title}</strong>
         <p>Voting closes {fmt(openPoll.closes_at)}. Vote totals do not identify members.</p>
         {openPoll.options.map((ts,i)=><div className="pkr-club-item" key={i}>
           <span>{fmt(ts)} <small>· {openPoll.counts[i]||0} votes</small></span>
           <button type="button" aria-pressed={openPoll.my_vote===i} disabled={busy||openPoll.closes_at<=Date.now()/1000}
             onClick={()=>void run(()=>api.club.vote(eventId,openPoll.id,i),'Vote saved.')}>
             {openPoll.my_vote===i?'✓ My vote':'Vote'}
           </button>
           {isHost&&<button type="button" disabled={busy} onClick={()=>void run(
             ()=>api.club.closePoll(eventId,openPoll.id,i),
             'Date selected. Confirm it through the existing game scheduler.')}>Choose date</button>}
         </div>)}
         {isHost&&<button type="button" disabled={busy} onClick={()=>void run(
           ()=>api.club.closePoll(eventId,openPoll.id,null),'Poll closed.')}>Close without date</button>}
       </div>:<div className="pkr-club-body"><p>No open poll.</p>
         {isHost&&<div className="pkr-club-form">
           <label>Poll title<input value={pollTitle} maxLength={100} onChange={e=>setPollTitle(e.target.value)}
             placeholder="Which Friday should we play?"/></label>
           {dates.map((d,i)=><label key={i}>Option {i+1}
             <input type="datetime-local" value={d} onChange={e=>setDates(a=>a.map((x,j)=>i===j?e.target.value:x))}/>
           </label>)}
           <div className="pkr-club-actions">
             {dates.length<5&&<button type="button" onClick={()=>setDates(a=>[...a,''])}>+ Date</button>}
             {dates.length>2&&<button type="button" onClick={()=>setDates(a=>a.slice(0,-1))}>Remove last</button>}
           </div>
           <label>Voting deadline<input type="datetime-local" value={voteDeadline}
             onChange={e=>setVoteDeadline(e.target.value)}/></label>
           <button type="button" className="pkr-club-primary" disabled={busy}
             onClick={()=>void run(()=>api.club.createPoll(eventId,{
               title:pollTitle.trim(),options:dates.map(toTime),closes_at:toTime(voteDeadline)
             }),'Poll created. Share PKR with approved members to vote.')}>Create date poll</button>
         </div>}
       </div>}
       {past.length>0&&<div className="pkr-club-body">
         <small>Selected date: {fmt(past[0].options[past[0].selected_index!])}</small>
         {isHost&&onScheduleDate&&<button type="button" onClick={()=>onScheduleDate(past[0].options[past[0].selected_index!])}>
           Open game scheduler with selected date →</button>}
       </div>}
     </details>

     {queue&&<details className="pkr-club-card">
       <summary>🪑 Seat waitlist <small>{queue.available} places · {queue.waiting} waiting</small></summary>
       <div className="pkr-club-body">
         <p>{queue.filled} confirmed for {queue.seats} seats. An offer does not reserve a seat;
           the RSVP board confirms availability.</p>
         {waiting&&<p className="pkr-club-ok">You are on the waiting list.</p>}
         {offered&&<p className="pkr-club-ok">A place may be available. Please confirm promptly
           {queue.my_offer_expires_at?' before '+fmt(queue.my_offer_expires_at):''}.</p>}
         <div className="pkr-club-actions">
           {(waiting||offered)?<>
             {offered&&<button type="button" className="pkr-club-primary"
               onClick={()=>router.push('/games/'+encodeURIComponent(game!.id)+'/rsvp')}>Open RSVP →</button>}
             <button type="button" disabled={busy} onClick={()=>void run(
               ()=>api.club.leaveWaitlist(game!.id),'Left the waitlist.')}>Leave waitlist</button>
           </>:queue.open?queue.available>0?
             <button type="button" className="pkr-club-primary"
               onClick={()=>router.push('/games/'+encodeURIComponent(game!.id)+'/rsvp')}>RSVP for a place →</button>:
             <button type="button" className="pkr-club-primary" disabled={busy}
               onClick={()=>void run(()=>api.club.joinWaitlist(game!.id),'Joined the seat waitlist.')}>Join waitlist</button>:null}
         </div>
         {isHost&&<>
           <div className="pkr-club-actions"><strong>Waiting players</strong>
             <button type="button" disabled={busy||!queue.waiting||queue.available===0}
               onClick={()=>void run(()=>api.club.offerWaitlist(game!.id),'Checked the next waitlist offer.')}>
               Offer next available place</button></div>
           {queue.queue?.map(x=><div className="pkr-club-item" key={x.user_id}>
             {x.display_name} <small>{x.status}</small></div>)}
         </>}
       </div>
     </details>}

     {requests&&<details className="pkr-club-card" open={isHost&&requests.requests.some(
       r=>r.status==='pending')||undefined}>
       <summary>✋ Player requests <small>{requests.requests.filter(r=>r.status==='pending').length} pending</small></summary>
       <div className="pkr-club-body"><p>Approvals never change financial records. Hosts record
         actual buy-ins or cash-outs through the existing game controls.</p>
         {!isHost&&<div className="pkr-club-form"><label>Optional note to host
           <input value={memberNote} maxLength={180} onChange={e=>setMemberNote(e.target.value)}/></label>
           <div className="pkr-club-actions">{kinds.map(k=><button type="button" key={k.kind} disabled={busy}
             onClick={()=>void run(()=>api.club.createRequest(game!.id,{kind:k.kind,note:memberNote}),
               'Host request submitted.')}>{k.label}</button>)}</div>
         </div>}
         {requests.requests.length===0?<p>No requests yet.</p>:requests.requests.slice(0,15).map(r=>
           <div className="pkr-club-item" key={r.id}>
             <div><strong>{isHost?r.member_name+' · ':''}{kinds.find(k=>k.kind===r.kind)?.label||r.kind}</strong>
               <small>{r.status}{r.note?' · '+r.note:''}</small></div>
             {isHost&&r.status==='pending'&&<div className="pkr-club-actions">
               <button type="button" disabled={busy} onClick={()=>void run(
                 ()=>api.club.reviewRequest(game!.id,r.id,'approved'),'Approved. Use existing game controls to record funds.')}>Approve</button>
               <button type="button" disabled={busy} onClick={()=>void run(
                 ()=>api.club.reviewRequest(game!.id,r.id,'declined'),'Request declined.')}>Decline</button>
             </div>}
             {isHost&&r.status==='approved'&&<button type="button" disabled={busy}
               onClick={()=>void run(()=>api.club.reviewRequest(game!.id,r.id,'resolved'),'Request marked handled.')}>
               Mark handled</button>}
           </div>)}
         {isHost&&<button type="button" onClick={()=>router.push('/games/'+encodeURIComponent(game!.id))}>
           Open guarded game controls →</button>}
       </div>
     </details>}

     <details className="pkr-club-card" open={seasons.length>0||undefined}>
       <summary>🏆 Club league seasons <small>{seasons.length} seasons</small></summary>
       <div className="pkr-club-body">
         {seasons.length>0?<label>Season
           <select value={seasonId} onChange={e=>setSeasonId(e.target.value)}>
             {seasons.map(s=><option key={s.id} value={s.id}>{s.name}</option>)}
           </select></label>:<p>No league season yet.</p>}
         {standings&&<>
           <p>{standings.settled_games} settled games · points: first {standings.season.points_first},
             second {standings.season.points_second}, third {standings.season.points_third},
             others {standings.season.points_other}.</p>
           {standings.standings.length?standings.standings.slice(0,20).map((s,i)=>
             <div className="pkr-club-item" key={s.user_id}>
               <span>{i+1}. {s.display_name}{s.identity_review_required?' · identity review':''}</span>
               <strong>{s.points} pts <small>· {s.games_played} games</small></strong>
             </div>):<p>No settled results in this season.</p>}
         </>}
         {isHost&&<div className="pkr-club-form">
           <strong>Create a season</strong>
           <label>Name<input value={leagueName} maxLength={80} onChange={e=>setLeagueName(e.target.value)}
             placeholder="Summer Championship"/></label>
           <div className="pkr-club-dates">
             <label>Starts<input type="date" value={from} onChange={e=>setFrom(e.target.value)}/></label>
             <label>Ends<input type="date" value={through} onChange={e=>setThrough(e.target.value)}/></label>
           </div>
           <div className="pkr-club-scores">
             {(['first','second','third','other'] as const).map(k=><label key={k}>{k}
               <input type="number" min={0} max={100} value={points[k]}
                 onChange={e=>setPoints(a=>({...a,[k]:Number(e.target.value)}))}/></label>)}
           </div>
           <button type="button" className="pkr-club-primary" disabled={busy}
             onClick={()=>void run(()=>api.club.createSeason(eventId,{
               name:leagueName.trim(),starts_at:toTime(from+'T00:00'),
               ends_at:toTime(through+'T00:00')+86400,points
             }),'League season created.')}>Create league season</button>
         </div>}
       </div>
     </details>
   </div>
 </section>;
}
