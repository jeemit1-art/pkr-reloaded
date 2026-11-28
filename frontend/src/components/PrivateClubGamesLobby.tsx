'use client';

import {useState} from 'react';
import PkrGlyph from '@/components/PkrGlyph';
import PkrBrandMark from '@/components/PkrBrandMark';
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
const filters:[Filter,string][]=[['upcoming','Upcoming'],['live','Live'],['completed','Completed']];
const zone='Australia/Brisbane';
const gameDate=(seconds:number,opts:Intl.DateTimeFormatOptions)=>
 new Date(seconds*1000).toLocaleDateString('en-AU',{...opts,timeZone:zone});
const gameTime=(seconds:number)=>new Date(seconds*1000).toLocaleTimeString('en-AU',{timeZone:zone,hour:'numeric',minute:'2-digit'});

/**
 * The Private Casino Club has its own genuinely distinct casino-floor composition.
 * This screen uses authoritative game records and existing callbacks. No gameplay,
 * RSVP confirmation or settlement logic lives here.
 */
export default function PrivateClubGamesLobby(p:Props){
 const [filter,setFilter]=useState<Filter>('upcoming');
 const live=p.upcoming.filter(isLiveGame);
 const scheduled=p.upcoming.filter(game=>!isLiveGame(game));
 const completed=p.settled.slice().sort((a,b)=>b.scheduled_at-a.scheduled_at);
 const counts={upcoming:scheduled.length,live:live.length,completed:completed.length};
 const visible=filter==='upcoming'?scheduled:filter==='live'?live:completed;
 const lastNight=completed[0]||null;
 const heroLabel=live.length?'LIVE TABLE IN PLAY':scheduled.length?'YOUR NEXT POKER NIGHT':'THE FLOOR IS YOURS';
 const emptyCopy=filter==='upcoming'
   ?(p.isHost?'Pick a date, invite the crew and get the cards moving.':'Your host has not scheduled the next session yet.')
   :filter==='live'?'Your next live game will appear right here.':'Your completed game nights will appear here when a host settles the results.';
 const openGame=(game:Game)=>p.onGame(game.id);
 return <section className="pkr-privateclub-games pkr-casino-floor" data-testid="private-club-games" aria-label="Private Casino Club game lobby">
  <header className="pkr-cf-hero">
    <img src="/images/casino/real-casino-props.webp" className="pkr-cf-hero-photo" alt="" aria-hidden="true" decoding="async"/>
    <PkrBrandMark className="pkr-brand-mark--hero pkr-brand-mark--games"/>
    <div className="pkr-cf-hero-pattern" aria-hidden="true"><span className="pkr-cf-holo-card">A<PkrGlyph name="spade" size={33}/></span><span className="pkr-cf-holo-chip">PKR</span></div>
    <div className="pkr-cf-marquee"><span className="pkr-cf-marquee-dot" aria-hidden="true"/><span>PRIVATE CASINO · GAME NIGHT</span></div>
    <div className="pkr-cf-hero-copy">
      <span className="pkr-cf-hero-kicker">{heroLabel}</span>
      <h1>THE <em>POKER</em><span>FLOOR.</span></h1>
      <p>{p.club}</p>
    </div>
    <div className="pkr-cf-hero-metrics" aria-label="Current club game counts">
      <button type="button" onClick={()=>setFilter('upcoming')} aria-label={counts.upcoming+' upcoming games; show upcoming games'}>
        <strong>{counts.upcoming}</strong><span>UPCOMING</span>
      </button>
      <button type="button" onClick={()=>setFilter('live')} aria-label={counts.live+' live games; show live games'}>
        <strong>{counts.live}</strong><span><i className="pkr-cf-live-dot" aria-hidden="true"/> LIVE</span>
      </button>
      <button type="button" onClick={()=>setFilter('completed')} aria-label={counts.completed+' completed games; show completed games'}>
        <strong>{counts.completed}</strong><span>PLAYED</span>
      </button>
    </div>
  </header>

  <nav className="pkr-pc-lobby-filter pkr-cf-filters" aria-label="Game lobby filters">
    {filters.map(([value,label])=><button type="button" key={value} aria-current={filter===value?'page':undefined}
      aria-pressed={filter===value} onClick={()=>setFilter(value)}>
      <span>{label}</span><small>{counts[value]}</small>
    </button>)}
  </nav>

  <div className="pkr-cf-section-line">
    <div><span className="pkr-cf-suit" aria-hidden="true">♠</span>
      <div><span className="pkr-cf-kicker">{filter==='upcoming'?'THE NEXT DEAL':filter==='live'?'TABLES IN ACTION':'THE GAME ARCHIVE'}</span>
       <h2>{filter==='upcoming'?'Upcoming nights':filter==='live'?'Live on the floor':'Completed sessions'}</h2></div>
    </div>
    {p.isHost&&<button type="button" className="pkr-cf-host-quick" onClick={p.onSchedule}><PkrGlyph name="schedule" size={18}/> <span>Host a game</span></button>}
  </div>

  {visible.length>0?<div className="pkr-pc-lobby-tickets pkr-cf-session-list">
   {visible.map((game,index)=>{
    const liveNow=isLiveGame(game);
    const done=filter==='completed';
    const label=liveNow?'LIVE NOW':done?'RECORDED SESSION':index===0?'NEXT DEAL':'ON THE CALENDAR';
    return <article className={'pkr-pc-lobby-ticket pkr-cf-game-ticket'+(index===0?' is-featured':'')+(liveNow?' is-live':'')} key={game.id}>
     <div className="pkr-pc-lobby-ticket-top">
       <span><span className="pkr-cf-ticket-status-dot" aria-hidden="true"/>{label}</span>
       <button type="button" className="pkr-pc-ticket-chevron" aria-label={'Open '+gameDate(game.scheduled_at,{day:'numeric',month:'long'})+' game'} onClick={()=>openGame(game)}><PkrGlyph name="chevron-right" size={20}/></button>
     </div>
     <div className="pkr-pc-lobby-ticket-main">
      <div className="pkr-pc-lobby-date"><span>{gameDate(game.scheduled_at,{weekday:'short'}).toUpperCase()}</span>
       <strong>{gameDate(game.scheduled_at,{day:'2-digit'})}</strong>
       <span>{gameDate(game.scheduled_at,{month:'short'}).toUpperCase()}</span>
      </div>
      <div className="pkr-pc-lobby-session-copy">
       <h2>{p.club}</h2>
       <p><PkrGlyph name="clock" size={17}/> {gameTime(game.scheduled_at)}</p>
       {game.location&&<p><PkrGlyph name="map-pin" size={16}/>{game.location}</p>}
       <span className="pkr-pc-lobby-seats"><PkrGlyph name="members" size={16}/> {typeof game.player_count==='number'?game.player_count+' players':'Player list available'}
        {Number.isFinite(game.seats)&&game.seats>0?' · '+game.seats+' seats':''}</span>
      </div>
      <div className="pkr-cf-ticket-art" aria-hidden="true"><span>♠</span><span>♥</span></div>
     </div>
     {!liveNow&&!done&&<div className="pkr-pc-rsvp-quick" aria-label="Open RSVP response form">
      <button type="button" onClick={()=>p.onRsvp(game.id,'yes')}><PkrGlyph name="check" size={18}/><span>Going</span></button>
      <button type="button" onClick={()=>p.onRsvp(game.id,'maybe')}><PkrGlyph name="help" size={18}/><span>Maybe</span></button>
      <button type="button" onClick={()=>p.onRsvp(game.id,'no')}><PkrGlyph name="close" size={18}/><span>Out</span></button>
     </div>}
     <div className="pkr-pc-lobby-actions">
      {liveNow?<button type="button" className="pkr-pc-lobby-primary" onClick={()=>p.isHost?p.onOpenTable(game.id):game.live_token?p.onWatch(game.id):p.onGame(game.id)}>
       <PkrGlyph name="table" size={19}/><span>{p.isHost?'OPEN LIVE TABLE':game.live_token?'WATCH LIVE':'VIEW LIVE GAME'}</span></button>:
       <button type="button" className="pkr-pc-lobby-primary" onClick={()=>done?openGame(game):p.onShare(game.id)}>
        <PkrGlyph name={done?'trophy':'members'} size={19}/><span>{done?'VIEW RESULTS':p.isHost?'MANAGE RSVPs':'VIEW RSVPs'}</span>
       </button>}
      <button type="button" onClick={()=>done?p.onResults():p.onShare(game.id)}>
        <PkrGlyph name={done?'history':'share'} size={18}/><span>{done?'GAME HISTORY':'SHARE & INVITE'}</span></button>
     </div>
     {p.isHost&&!done&&<div className="pkr-pc-host-tools" aria-label="Host session controls">
       {!liveNow&&<button type="button" onClick={()=>p.onRsvpSettings(game.id)}><PkrGlyph name="settings" size={16}/> RSVP settings</button>}
       {!liveNow&&<button type="button" onClick={()=>p.onQuickSeat(game.id)}><PkrGlyph name="table" size={16}/> Quick seat</button>}
       {!liveNow&&<button type="button" onClick={()=>p.onCancel(game.id)}>Cancel game</button>}
       {!liveNow&&p.isOwner&&<button type="button" onClick={()=>p.onDelete(game.id)}>Delete</button>}
     </div>}
    </article>;
   })}
  </div>:
  <section className="pkr-cf-empty" role="status" aria-label={filter==='upcoming'?'No upcoming games':filter==='live'?'No live games':'No completed games'}>
   <div className="pkr-cf-tabletop" aria-hidden="true">
    <div className="pkr-cf-table-rim"><div className="pkr-cf-felt">
      <span className="pkr-cf-felt-brand">PKR</span>
      <span className="pkr-cf-table-card one">A<br/>♠</span><span className="pkr-cf-table-card two">K<br/>♥</span>
      <span className="pkr-cf-table-chip chip-one"/><span className="pkr-cf-table-chip chip-two"/>
     </div></div>
   </div>
   <div className="pkr-cf-empty-content">
    <h2>{filter==='upcoming'?'Ready for the next deal?':filter==='live'?'No live table right now':'No completed nights yet'}</h2>
    <button type="button" className="pkr-cf-schedule" onClick={filter==='upcoming'&&p.isHost?p.onSchedule:filter==='completed'?p.onResults:p.onCalendar}>
     <PkrGlyph name={filter==='upcoming'&&p.isHost?'schedule':filter==='completed'?'trophy':'clock'} size={21}/>
     <span>{filter==='upcoming'&&p.isHost?'HOST YOUR NEXT GAME':filter==='completed'?'VIEW LEADERBOARD':'OPEN GAME CALENDAR'}</span>
     <PkrGlyph name="chevron-right" size={19}/>
    </button>
    <p>{emptyCopy}</p>
   </div>
  </section>}

  {filter==='upcoming'&&lastNight&&<section className="pkr-cf-last-night" aria-label="Most recent completed poker game">
    <div className="pkr-cf-last-night-crest" aria-hidden="true"><PkrGlyph name="trophy" size={24}/></div>
    <div><span className="pkr-cf-kicker">FROM THE ARCHIVES · {completed.length} GAMES PLAYED</span>
     <h3>The last game night</h3><p>{gameDate(lastNight.scheduled_at,{weekday:'short',day:'numeric',month:'short',year:'numeric'})}</p></div>
    <button type="button" onClick={()=>openGame(lastNight)} aria-label="Open most recent completed game"><PkrGlyph name="chevron-right" size={23}/></button>
  </section>}

  {p.unfinished.length>0&&<section className="pkr-pc-unfinished pkr-cf-unfinished" aria-label="Historical unfinished game sessions">
    <div className="pkr-pc-unfinished-summary"><PkrGlyph name="history" size={20}/>
     <span><strong>{p.unfinished.length} unfinished historical game{p.unfinished.length===1?'':'s'}</strong>
     <small>Preserved for review; not counted as live.</small></span></div>
    <div className="pkr-pc-unfinished-list">{p.unfinished.map(game=><button type="button" key={game.id} onClick={()=>openGame(game)}>
     <span>{gameDate(game.scheduled_at,{day:'numeric',month:'short',year:'numeric'})} · {gameTime(game.scheduled_at)}</span><PkrGlyph name="chevron-right" size={18}/></button>)}</div>
  </section>}

  <section className="pkr-cf-explore" aria-label="More ways to play">
    <div className="pkr-cf-explore-title"><span className="pkr-cf-kicker">BEYOND THE TABLE</span><h2>YOUR CLUB. YOUR NIGHT.</h2></div>
    <div className="pkr-pc-lobby-bottom-actions">
      <button type="button" onClick={p.onCalendar}><span className="pkr-cf-tool-icon calendar"><PkrGlyph name="schedule" size={25}/></span>
       <span><strong>Game calendar</strong><small>All your sessions</small></span><PkrGlyph name="chevron-right" size={18}/></button>
      <button type="button" onClick={p.onResults}><span className="pkr-cf-tool-icon results"><PkrGlyph name="trophy" size={25}/></span>
       <span><strong>Hall of fame</strong><small>{completed.length} nights played</small></span><PkrGlyph name="chevron-right" size={18}/></button>
      <button type="button" onClick={p.onSharing}><span className="pkr-cf-tool-icon invite"><PkrGlyph name="members" size={25}/></span>
       <span><strong>RSVPs &amp; sharing</strong><small>Bring the crew</small></span><PkrGlyph name="chevron-right" size={18}/></button>
    </div>
  </section>
 </section>;
}
