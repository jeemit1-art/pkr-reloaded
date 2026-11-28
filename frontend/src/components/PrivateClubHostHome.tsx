'use client';

import PkrGlyph from '@/components/PkrGlyph';
import type GameNightHostHome from '@/components/GameNightHostHome';

type Props=React.ComponentProps<typeof GameNightHostHome>;
const zone='Australia/Brisbane';
const datePart=(value:number,options:Intl.DateTimeFormatOptions)=>new Date(value*1000).toLocaleDateString('en-AU',{...options,timeZone:zone});
const initials=(name:string)=>name.trim().split(/\s+/).slice(0,2).map(word=>word.charAt(0)).join('').toUpperCase();

/** A real, data-bound club entrance. This UI never fabricates games, RSVPs or settlements. */
export default function PrivateClubHostHome(p:Props){
 const game=p.featured;
 const isFinished=game?.status==='settled'||game?.status==='completed';
 const showRsvps=p.attendanceState==='ready'&&!isFinished&&!p.active;
 const when=game?datePart(game.scheduled_at,{weekday:'short'}).toUpperCase():'';
 const day=game?datePart(game.scheduled_at,{day:'2-digit'}):'';
 const month=game?datePart(game.scheduled_at,{month:'short'}).toUpperCase():'';
 const start=game?new Date(game.scheduled_at*1000).toLocaleTimeString('en-AU',{hour:'numeric',minute:'2-digit',timeZone:zone}):'';
 const fullDate=game?datePart(game.scheduled_at,{weekday:'long',day:'numeric',month:'long'}):'';
 const guests=p.going.slice(0,4);
 const primary=p.active?'RESUME LIVE TABLE':game?'VIEW NEXT GAME':p.canManageGames?'SCHEDULE A GAME':'VIEW GAME CALENDAR';
 const openPrimary=game?p.onGame:p.canManageGames?p.onSchedule:p.onCalendar;
 return <section className="pkr-privateclub-home" data-testid="private-club-host-home" aria-label="Private Casino Club home">
  <div className="pkr-pc-entrance">
   <div className="pkr-pc-scene" aria-hidden="true">
    <span className="pkr-pc-scene-beam"/><span className="pkr-pc-scene-felt"/>
    <span className="pkr-pc-scene-chip pkr-pc-chip-one"/><span className="pkr-pc-scene-chip pkr-pc-chip-two"/>
    <span className="pkr-pc-scene-card pkr-pc-card-one">A<PkrGlyph name="spade" size={23}/></span>
    <span className="pkr-pc-scene-card pkr-pc-card-two">A<PkrGlyph name="heart" size={23}/></span>
   </div>
   <div className="pkr-pc-identity">
    <span className="pkr-pc-overline"><span aria-hidden="true">✦</span> YOUR PRIVATE CLUB <span aria-hidden="true">✦</span></span>
    <h1>{p.room.name}</h1>
    <div className="pkr-pc-honor"><span aria-hidden="true">♠</span>
      <span>{p.active?'TABLE LIVE NOW':game?'NEXT GAME NIGHT':'WELCOME TO THE CLUB'}</span>
      <span aria-hidden="true">♠</span></div>
   </div>
  </div>

  <section className="pkr-pc-ticket" aria-label={game?'Next poker session':'Plan your next poker night'}>
   {game?<div className="pkr-pc-ticket-body">
    <div className="pkr-pc-datebox"><span>{when}</span><strong>{day}</strong><span>{month}</span></div>
    <div className="pkr-pc-ticket-info">
     <span className="pkr-pc-ticket-kicker"><PkrGlyph name="schedule" size={16}/> {p.active?'LIVE GAME':'NEXT SESSION'}</span>
     <h2>{p.active?'The table is live':'Game Night'}</h2>
     <p><PkrGlyph name="clock" size={16}/> {start} <span aria-hidden="true">·</span> {fullDate}</p>
     {game.location&&<p className="pkr-pc-ticket-location"><PkrGlyph name="map-pin" size={16}/> {game.location}</p>}
     <div className="pkr-pc-attendance">
      {showRsvps?<><div className="pkr-pc-avatars" aria-hidden="true">{guests.map((r,i)=>
       <span key={r.id||r.display_name} className={'pkr-pc-avatar pkr-pc-avatar-'+i}>{initials(r.display_name)}</span>)}</div>
       <span><strong>{p.going.length}</strong>{Number.isFinite(game.seats)&&game.seats>0?' / '+game.seats:''} confirmed</span></>:
       <span>{p.active?'Game in progress':p.attendanceState==='loading'?'Checking RSVPs…':p.attendanceState==='unavailable'?'RSVPs unavailable':'Game details ready'}</span>}
     </div>
    </div>
    <div className="pkr-pc-ticket-cards" aria-hidden="true"><span>A <PkrGlyph name="spade" size={34}/></span><span>A <PkrGlyph name="heart" size={34}/></span></div>
   </div>:<div className="pkr-pc-ticket-body pkr-pc-ticket-empty">
    <span className="pkr-pc-ticket-no-date"><PkrGlyph name="schedule" size={33}/></span>
    <div className="pkr-pc-ticket-info">
     <span className="pkr-pc-ticket-kicker">THE NEXT CHAPTER</span>
     <h2>Your next great game starts here.</h2>
     <p>{p.canManageGames?'Choose a date and bring everyone back to the table.':'Your host has not scheduled the next game yet.'}</p>
    </div>
   </div>}
  </section>

  <button className="pkr-pc-main-action" type="button" onClick={openPrimary}>
   <span>{primary}</span><PkrGlyph name="chevron-right" size={22}/>
  </button>

  <div className="pkr-pc-shortcuts" aria-label="Club quick actions">
   <button type="button" onClick={p.canManageGames?p.onSchedule:p.onCalendar}>
    <PkrGlyph name="schedule" size={25}/><strong>{p.canManageGames?'Host Game':'Calendar'}</strong>
   </button>
   <button type="button" onClick={p.canInvite?p.onInvite:p.onSharing}>
    <PkrGlyph name={p.canInvite?'user-add':'share'} size={25}/><strong>{p.canInvite?'Invite':'Share'}</strong>
   </button>
   <button type="button" onClick={p.onResults}>
    <PkrGlyph name="trophy" size={25}/><strong>Leaderboard</strong>
   </button>
  </div>

  <div className="pkr-pc-next-actions">
   <button type="button" onClick={game?p.onRsvp:p.onCalendar}>
    <span className="pkr-pc-tool-icon"><PkrGlyph name="members" size={21}/></span>
    <span><strong>{game?'RSVPs & seats':'Upcoming games'}</strong><small>{game?'Attendance and seat assignments':'View your club calendar'}</small></span><PkrGlyph name="chevron-right" size={19}/>
   </button>
   <button type="button" onClick={p.onPayments}>
    <span className="pkr-pc-tool-icon"><PkrGlyph name="settle" size={21}/></span>
    <span><strong>Cashier & settlements</strong><small>{p.paymentState==='loading'?'Checking outstanding payments':p.paymentState==='ready'?p.payments.length+' transfers pending':'Review saved payment records'}</small></span><PkrGlyph name="chevron-right" size={19}/>
   </button>
   <button type="button" onClick={p.onAppearance}>
    <span className="pkr-pc-tool-icon"><PkrGlyph name="grid" size={21}/></span>
    <span><strong>Club control centre</strong><small>All management tools and reporting</small></span><PkrGlyph name="chevron-right" size={19}/>
   </button>
  </div>
 </section>;
}
