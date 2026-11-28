'use client';

import {useState} from 'react';
import PkrGlyph from '@/components/PkrGlyph';
import type {Game} from '@/lib/api';
import {isLiveGame} from '@/lib/game-status';

type Filter='upcoming'|'live'|'completed';
type Props={
 club:string;games:Game[];upcoming:Game[];unfinished:Game[];settled:Game[];
 isHost:boolean;isOwner:boolean;
 onSchedule:()=>void;onGame:(id:string)=>void;onOpenTable:(id:string)=>void;
 onWatch:(id:string)=>void;onRsvp:(id:string,choice?:'yes'|'maybe'|'no')=>void;
 onShare:(id:string)=>void;onRsvpSettings:(id:string)=>void;
 onQuickSeat:(id:string)=>void;onCancel:(id:string)=>void;onDelete:(id:string)=>void;
 onResults:()=>void;onCalendar:()=>void;onSharing:()=>void;
};
const options:[Filter,string][]=[['upcoming','Upcoming'],['live','Live'],['completed','Completed']];
const timeInBrisbane=(seconds:number)=>new Date(seconds*1000).toLocaleTimeString('en-AU',{timeZone:'Australia/Brisbane',hour:'numeric',minute:'2-digit'});
const dateInBrisbane=(seconds:number,opts:Intl.DateTimeFormatOptions)=>new Date(seconds*1000).toLocaleDateString('en-AU',{...opts,timeZone:'Australia/Brisbane'});
export default function PrivateClubGamesLobby(p:Props){
 const [filter,setFilter]=useState<Filter>('upcoming');
 const live=p.upcoming.filter(game=>isLiveGame(game));
 const scheduled=p.upcoming.filter(game=>!isLiveGame(game));
 const visible=filter==='upcoming'?scheduled:filter==='live'?live:p.settled.slice().sort((a,b)=>b.scheduled_at-a.scheduled_at);
 const counts={upcoming:scheduled.length,live:live.length,completed:p.settled.length};
 const first=p.upcoming[0]||null;
 const featured=visible[0]||null;
 return <section className="pkr-privateclub-games" data-testid="private-club-games" aria-label="Private Casino Club game lobby">
  <header className="pkr-pc-lobby-hero">
   <img className="pkr-pc-lobby-photo" src="/images/pkr-approved-hero-desktop.webp"
      alt="" aria-hidden="true" decoding="async"/>
   <div className="pkr-pc-lobby-hero-content">
    <span className="pkr-pc-overline"><PkrGlyph name="spade" size={15}/> PKR PRIVATE CASINO CLUB</span>
    <h1>Game <em>Lobby</em></h1>
    <p>Your nights at the table.</p>
   </div>
   <div className="pkr-pc-lobby-chip-art" aria-hidden="true"><span/><span/><span/></div>
  </header>
  <nav className="pkr-pc-lobby-filter" aria-label="Game lobby filters">
   {options.map(([value,label])=><button key={value} type="button" aria-current={filter===value?'page':undefined} aria-pressed={filter===value}
      onClick={()=>setFilter(value)}><span>{label}</span>{counts[value]>0&&<small>{counts[value]}</small>}</button>)}
  </nav>
  <div className="pkr-pc-lobby-context">
   <span>{filter==='upcoming'?'NEXT AT THE TABLE':filter==='live'?'TABLES IN PLAY':'YOUR GAME ARCHIVE'}</span>
   {p.isHost&&<button type="button" onClick={p.onSchedule}><PkrGlyph name="schedule" size={17}/> Host a game</button>}
  </div>

  {featured&&filter==='upcoming'&&<div className="pkr-pc-lobby-featured" aria-hidden="true">
    <span><PkrGlyph name="spade" size={15}/> THE NEXT NIGHT BEGINS HERE</span>
    <b>{dateInBrisbane(featured.scheduled_at,{weekday:'long',day:'numeric',month:'long'})}</b>
  </div>}
  {visible.length>0?<div className="pkr-pc-lobby-tickets">
   {visible.map((game,index)=>{
    const liveNow=isLiveGame(game);
    const completed=filter==='completed';
    return <article className={'pkr-pc-lobby-ticket'+(index===0?' is-featured':'')+(liveNow?' is-live':'')} key={game.id} aria-label={'Poker session '+dateInBrisbane(game.scheduled_at,{day:'numeric',month:'long',year:'numeric'})}>
     <div className="pkr-pc-lobby-ticket-top">
       <span><PkrGlyph name={liveNow?'broadcast':completed?'trophy':'schedule'} size={17}/>
         {liveNow?'LIVE NOW':completed?'COMPLETED GAME':index===0?'NEXT SESSION':'UPCOMING GAME'}</span>
       <button type="button" className="pkr-pc-ticket-chevron" aria-label={'Open game '+dateInBrisbane(game.scheduled_at,{day:'numeric',month:'long'})} onClick={()=>p.onGame(game.id)}>
         <PkrGlyph name="chevron-right" size={20}/></button>
     </div>
     <div className="pkr-pc-lobby-ticket-main">
      <div className="pkr-pc-lobby-date"><span>{dateInBrisbane(game.scheduled_at,{weekday:'short'}).toUpperCase()}</span>
       <strong>{dateInBrisbane(game.scheduled_at,{day:'2-digit'})}</strong>
       <span>{dateInBrisbane(game.scheduled_at,{month:'short'}).toUpperCase()}</span></div>
      <div className="pkr-pc-lobby-session-copy">
       <h2>{p.club}</h2>
       <p><PkrGlyph name="clock" size={17}/> {timeInBrisbane(game.scheduled_at)}</p>
       {game.location&&<p className="pkr-pc-lobby-location"><PkrGlyph name="map-pin" size={16}/> {game.location}</p>}
       <span className="pkr-pc-lobby-seats"><PkrGlyph name="members" size={16}/>
        {typeof game.player_count==='number'?game.player_count+' players': 'Player list available'}
        {Number.isFinite(game.seats)&&game.seats>0?' · '+game.seats+' seats':''}</span>
      </div>
      <div className="pkr-pc-lobby-cards" aria-hidden="true"><span>A<PkrGlyph name="spade" size={29}/></span><span>A<PkrGlyph name="heart" size={29}/></span></div>
     </div>
     {!liveNow&&!completed&&<div className="pkr-pc-rsvp-quick" aria-label="Open RSVP response form">
       <button type="button" onClick={()=>p.onRsvp(game.id,'yes')}><PkrGlyph name="check" size={18}/> Going</button>
       <button type="button" onClick={()=>p.onRsvp(game.id,'maybe')}><PkrGlyph name="help" size={18}/> Maybe</button>
       <button type="button" onClick={()=>p.onRsvp(game.id,'no')}><PkrGlyph name="close" size={18}/> Out</button>
      </div>}
     <div className="pkr-pc-lobby-actions">
       {liveNow?<button type="button" className="pkr-pc-lobby-primary" onClick={()=>p.isHost?p.onOpenTable(game.id):game.live_token?p.onWatch(game.id):p.onGame(game.id)}>
         <PkrGlyph name="table" size={19}/> {p.isHost?'OPEN LIVE TABLE':game.live_token?'WATCH LIVE TABLE':'VIEW LIVE GAME'}</button>:
        <button type="button" className="pkr-pc-lobby-primary" onClick={()=>completed?p.onGame(game.id):p.onShare(game.id)}>
         <PkrGlyph name={completed?'trophy':'members'} size={19}/> <span>{completed?'VIEW RESULTS':p.isHost?'MANAGE RSVPs':'VIEW RSVPs'}</span></button>}
       <button type="button" onClick={()=>completed?p.onResults():p.onShare(game.id)}>
         <PkrGlyph name={completed?'history':'share'} size={19}/> {completed?'HISTORY':'SHARE & INVITE'}</button>
     </div>
     {p.isHost&&!completed&&<div className="pkr-pc-host-tools">
       {!liveNow&&<button type="button" onClick={()=>p.onRsvpSettings(game.id)}><PkrGlyph name="settings" size={16}/> RSVP settings</button>}
       {!liveNow&&<button type="button" onClick={()=>p.onQuickSeat(game.id)}><PkrGlyph name="table" size={16}/> Quick seat</button>}
       {!liveNow&&<button type="button" onClick={()=>p.onCancel(game.id)}>Cancel game</button>}
       {!liveNow&&p.isOwner&&<button type="button" onClick={()=>p.onDelete(game.id)}>Delete</button>}
      </div>}
    </article>;
   })}
  </div>:<div className="pkr-pc-lobby-empty" role="status">
   <div className="pkr-pc-lobby-empty-art" aria-hidden="true"><PkrGlyph name={filter==='live'?'table':filter==='completed'?'trophy':'cards'} size={38}/></div>
   <h2>{filter==='upcoming'?'No upcoming games yet':filter==='live'?'No live tables right now':'No completed games yet'}</h2>
   <p>{filter==='upcoming'?'Your next poker night starts with a date.':filter==='live'?'Live tables will appear here once a game begins.':'Your recorded game results will be available here.'}</p>
   <button type="button" onClick={filter==='upcoming'&&p.isHost?p.onSchedule:filter==='completed'?p.onResults:p.onCalendar}>
    {filter==='upcoming'&&p.isHost?'SCHEDULE A GAME':filter==='completed'?'VIEW RESULTS':'OPEN CALENDAR'}
    <PkrGlyph name="chevron-right" size={18}/></button>
  </div>}
  {p.unfinished.length>0&&<section className="pkr-pc-unfinished" aria-label="Historical unfinished game sessions">
    <div className="pkr-pc-unfinished-summary"><PkrGlyph name="history" size={19}/>
      <span><strong>{p.unfinished.length} historical unfinished game{p.unfinished.length===1?'':'s'}</strong>
      <small>Preserved for review — not counted as currently live.</small></span></div>
    <div className="pkr-pc-unfinished-list">
      {p.unfinished.map(game=><button type="button" key={game.id} onClick={()=>p.onGame(game.id)}>
        <span>{dateInBrisbane(game.scheduled_at,{day:'numeric',month:'short',year:'numeric'})} · {timeInBrisbane(game.scheduled_at)}</span>
        <PkrGlyph name="chevron-right" size={17}/>
       </button>)}
    </div>
   </section>}
  <div className="pkr-pc-lobby-bottom-actions">
    <button type="button" onClick={p.onCalendar}><PkrGlyph name="schedule" size={18}/> Game calendar</button>
    <button type="button" onClick={p.onResults}><PkrGlyph name="history" size={18}/> Completed nights</button>
    <button type="button" onClick={p.onSharing}><PkrGlyph name="members" size={18}/> RSVPs &amp; Sharing</button>
  </div>
 </section>;
}
