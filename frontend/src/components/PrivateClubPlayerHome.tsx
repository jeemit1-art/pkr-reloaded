'use client';
import PkrGlyph from '@/components/PkrGlyph';
import PkrBrandMark from '@/components/PkrBrandMark';
import type {Event,Game} from '@/lib/api';
import {isLiveGame} from '@/lib/game-status';
type Props={room:Event;next:Game|null;loading:boolean;error:string;onGame:()=>void;onRsvp:()=>void;onCalendar:()=>void;onResults:()=>void;onPayments:()=>void;onMembers:()=>void};
const datePart=(t:number,options:Intl.DateTimeFormatOptions)=>new Date(t*1000).toLocaleDateString('en-AU',{...options,timeZone:'Australia/Brisbane'});
const hour=(t:number)=>new Date(t*1000).toLocaleTimeString('en-AU',{hour:'numeric',minute:'2-digit',timeZone:'Australia/Brisbane'});
/** The approved club pass and upcoming-game design, driven by real records. */
export default function PrivateClubPlayerHome(p:Props){
 const game=p.next;const live=!!game&&isLiveGame(game);
 return <section className="pkr-privateclub-player pkr-no-player" data-testid="private-club-player-home" aria-label="PKR player home">
  <header className="pkr-no-player-pass">
   <span className="pkr-no-pass-cut" aria-hidden="true"/>
   <div className="pkr-no-player-pass-top"><span>YOUR CLUB PASS</span><PkrBrandMark className="pkr-no-pass-mark"/></div>
   <h1>{p.room.name}</h1><span className="pkr-no-pass-level">PKR / CLUB MEMBER</span>
  </header>
  <div className="pkr-no-section-heading pkr-no-section-heading-player"><span>THE NIGHT IS ON.</span><h2>Your next game</h2></div>
  <section className="pkr-no-player-next" aria-label="Your next scheduled poker game">
   <div className="pkr-no-player-next-top"><span>GAME NIGHT</span>{live&&<strong>LIVE NOW</strong>}</div>
   <h3>{game?datePart(game.scheduled_at,{weekday:'long',day:'numeric',month:'long'}):p.loading?'Checking the schedule…':p.error?'Schedule unavailable':'Nothing on the calendar yet'}</h3>
   {game&&<p><PkrGlyph name="clock" size={17}/>{hour(game.scheduled_at)}{game.location?' · '+game.location:''}</p>}
   {!game&&<p>{p.error||'Your host will schedule the next session.'}</p>}
   <div className="pkr-no-player-next-actions">
    <button type="button" className="pkr-no-player-primary" onClick={game?p.onRsvp:p.onCalendar}>{game?'MY RSVP':'VIEW CALENDAR'}<PkrGlyph name="chevron-right" size={18}/></button>
    <button type="button" className="pkr-no-player-secondary" onClick={game?p.onGame:p.onCalendar}>{live?'VIEW LIVE GAME':game?'GAME DETAILS':'ALL GAMES'}</button>
   </div>
  </section>
  <div className="pkr-no-player-links" aria-label="Player shortcuts">
   <button type="button" onClick={p.onResults}><PkrGlyph name="trophy" size={22}/><span>My club results</span><PkrGlyph name="chevron-right" size={18}/></button>
   <button type="button" onClick={p.onPayments}><PkrGlyph name="settle" size={22}/><span>My payment records</span><PkrGlyph name="chevron-right" size={18}/></button>
   <button type="button" onClick={p.onMembers}><PkrGlyph name="members" size={22}/><span>Club players</span><PkrGlyph name="chevron-right" size={18}/></button>
  </div>
 </section>;
}
