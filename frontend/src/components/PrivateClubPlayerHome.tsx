'use client';
import PkrGlyph from '@/components/PkrGlyph';
import type {Event,Game} from '@/lib/api';
import {isLiveGame} from '@/lib/game-status';

type Props={room:Event;next:Game|null;loading:boolean;error:string;onGame:()=>void;onRsvp:()=>void;onCalendar:()=>void;onResults:()=>void;onPayments:()=>void;onMembers:()=>void};
const datePart=(t:number,options:Intl.DateTimeFormatOptions)=>new Date(t*1000).toLocaleDateString('en-AU',{...options,timeZone:'Australia/Brisbane'});
export default function PrivateClubPlayerHome(p:Props){
 const game=p.next;const live=game&&isLiveGame(game);
 return <section className="pkr-privateclub-player" data-testid="private-club-player-home" aria-label="Private Club player home">
  <div className="pkr-pc-player-scene">
   <span className="pkr-pc-overline">WELCOME TO YOUR PRIVATE CLUB</span>
   <h1>{p.room.name}</h1>
   <span className="pkr-pc-honor"><PkrGlyph name="spade" size={17}/>{live?'A GAME IS LIVE':game?'YOUR NEXT POKER NIGHT':'THE TABLE IS READY WHEN YOU ARE'}</span>
  </div>
  <article className="pkr-pc-player-ticket">
   {game?<><div className="pkr-pc-datebox"><span>{datePart(game.scheduled_at,{weekday:'short'}).toUpperCase()}</span><strong>{datePart(game.scheduled_at,{day:'2-digit'})}</strong><span>{datePart(game.scheduled_at,{month:'short'}).toUpperCase()}</span></div>
    <div className="pkr-pc-ticket-info"><span className="pkr-pc-ticket-kicker">{live?'LIVE NOW':'NEXT SESSION'}</span><h2>Game Night</h2>
     <p><PkrGlyph name="clock" size={16}/> {new Date(game.scheduled_at*1000).toLocaleTimeString('en-AU',{hour:'numeric',minute:'2-digit',timeZone:'Australia/Brisbane'})}</p>
     <p>{game.location||p.room.name}</p></div></>:
    <div className="pkr-pc-ticket-info"><span className="pkr-pc-ticket-kicker">YOUR NEXT SESSION</span><h2>{p.loading?'Checking your schedule…':p.error?'Unable to check the schedule':'No game scheduled yet'}</h2><p>{p.error||'Your host will schedule the next night.'}</p></div>}
  </article>
  <button type="button" className="pkr-pc-main-action" onClick={game?p.onGame:p.onCalendar}>
   <span>{live?'VIEW LIVE GAME':game?'VIEW NEXT GAME':'OPEN GAME CALENDAR'}</span><PkrGlyph name="chevron-right" size={22}/>
  </button>
  <div className="pkr-pc-shortcuts">
   <button type="button" onClick={game?p.onRsvp:p.onCalendar}><PkrGlyph name="check" size={25}/><strong>{game?'My RSVP':'Calendar'}</strong></button>
   <button type="button" onClick={p.onMembers}><PkrGlyph name="members" size={25}/><strong>Players</strong></button>
   <button type="button" onClick={p.onResults}><PkrGlyph name="trophy" size={25}/><strong>Leaderboard</strong></button>
  </div>
  <button type="button" className="pkr-pc-player-payments-link" onClick={p.onPayments}>
   <PkrGlyph name="settle" size={22}/> <span>View my cashier & settlements</span><PkrGlyph name="chevron-right" size={20}/>
  </button>
 </section>;
}
