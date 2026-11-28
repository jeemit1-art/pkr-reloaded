'use client';
import type {ComponentProps} from 'react';
import PkrGlyph from '@/components/PkrGlyph';
import PkrBrandMark from '@/components/PkrBrandMark';
import type GameNightHostHome from '@/components/GameNightHostHome';

type Props=ComponentProps<typeof GameNightHostHome>;
const zone='Australia/Brisbane';
const datePart=(value:number,options:Intl.DateTimeFormatOptions)=>new Date(value*1000).toLocaleDateString('en-AU',{...options,timeZone:zone});
const hour=(value:number)=>new Date(value*1000).toLocaleTimeString('en-AU',{hour:'numeric',minute:'2-digit',timeZone:zone});

/** PKR / The Night Is On. All game, RSVP and payment information comes from the live record. */
export default function PrivateClubHostHome(p:Props){
 const game=p.featured;
 const done=game?.status==='settled'||game?.status==='completed';
 const live=!!p.active;
 const date=game?datePart(game.scheduled_at,{weekday:'short',day:'numeric',month:'short',year:'numeric'}):'Not scheduled';
 const confirmed=p.attendanceState==='ready'&&!done;
 const primary=live?'OPEN LIVE TABLE':game?'VIEW GAME NIGHT':p.canManageGames?'SCHEDULE YOUR GAME':'GAME CALENDAR';
 const goPrimary=game?p.onGame:p.canManageGames?p.onSchedule:p.onCalendar;
 return <section className="pkr-privateclub-home pkr-no-host" data-testid="private-club-host-home" aria-label="PKR game night host home">
  <header className="pkr-no-hero pkr-no-host-hero">
   <span className="pkr-no-hero-cut" aria-hidden="true"/>
   <div className="pkr-no-hero-meta"><span>PKR / YOUR PRIVATE GAME CLUB</span><span className="pkr-no-role">HOST</span></div>
   <span className="pkr-no-hero-kicker">{live?'LIVE TABLE':game?'UPCOMING GAME':'YOUR NEXT GAME NIGHT'}</span>
   <h1>THE NIGHT <em>IS ON.</em></h1>
   <p>{game?date+' · '+hour(game.scheduled_at):'Your crew. Your table. Your night.'}</p>
   <div className="pkr-no-hero-actions">
    <button type="button" className="pkr-no-hero-cta" onClick={goPrimary}>{primary}<PkrGlyph name="chevron-right" size={21}/></button>
    {game&&<span className="pkr-no-hero-foot">{confirmed?p.going.length+' confirmed RSVPs':live?'Game in progress':'Session details ready'}</span>}
   </div>
  </header>
  <div className="pkr-no-section-heading"><span>YOUR CLUB</span><h2>{p.room.name}</h2><p>Everything for the next game, in one place.</p></div>
  <section className="pkr-no-next-ticket" aria-label={game?'Next game details':'Next game'}>
   <div className="pkr-no-ticket-intro"><span>01 / GAME NIGHT PASS</span><PkrBrandMark className="pkr-no-ticket-mark"/></div>
   <div className="pkr-no-ticket-info">
    <div className="pkr-no-ticket-date"><strong>{game?datePart(game.scheduled_at,{day:'2-digit'}):'--'}</strong><span>{game?datePart(game.scheduled_at,{month:'short'}).toUpperCase():'TBA'}</span></div>
    <div className="pkr-no-ticket-copy"><h3>{live?'Game in progress':game?'Next game night':'No game scheduled'}</h3>
     <p><PkrGlyph name="clock" size={16}/>{game?hour(game.scheduled_at)+' · '+date:'Schedule a game to bring your crew together'}</p>
     {game?.location&&<p><PkrGlyph name="map-pin" size={16}/>{game.location}</p>}
     {confirmed&&<span className="pkr-no-confirmed">{p.going.length} confirmed{Number.isFinite(game?.seats)&&game!.seats>0?' / '+game!.seats+' seats':''}</span>}
    </div>
   </div>
   <div className="pkr-no-ticket-footer">
    <button type="button" onClick={game?p.onRsvp:p.onCalendar}><PkrGlyph name="members" size={18}/>{game?'RSVPs & seats':'Calendar'}</button>
    <button type="button" onClick={game?p.onSharing:p.onInvite}><PkrGlyph name="share" size={18}/>Share</button>
   </div>
  </section>
  <div className="pkr-no-stats" aria-label="Club at a glance">
   <button type="button" onClick={p.onRsvp} className="pkr-no-stat"><span>RSVPs</span><strong>{confirmed?p.going.length:'—'}</strong><small>{confirmed?'Going to next game':'View attendance'}</small></button>
   <button type="button" onClick={p.onPayments} className="pkr-no-stat"><span>PAYMENTS</span><strong>{p.paymentState==='ready'?p.payments.length:'—'}</strong><small>Review records</small></button>
   <button type="button" onClick={p.onResults} className="pkr-no-stat"><span>RESULTS</span><strong><PkrGlyph name="trophy" size={28}/></strong><small>Club leaderboard</small></button>
  </div>
  <section className="pkr-no-tools" aria-label="Host shortcuts">
   <div className="pkr-no-section-heading pkr-no-section-heading-small"><span>HOST CONTROLS</span><h2>Keep the night moving.</h2></div>
   <div className="pkr-no-tools-grid">
    <button type="button" onClick={p.canManageGames?p.onSchedule:p.onCalendar}><PkrGlyph name="schedule" size={22}/><span>{p.canManageGames?'Host a game':'Calendar'}</span><PkrGlyph name="chevron-right" size={17}/></button>
    <button type="button" onClick={p.canInvite?p.onInvite:p.onSharing}><PkrGlyph name={p.canInvite?'user-add':'share'} size={22}/><span>{p.canInvite?'Invite players':'Share club'}</span><PkrGlyph name="chevron-right" size={17}/></button>
    <button type="button" onClick={p.onPayments}><PkrGlyph name="settle" size={22}/><span>Settlement records</span><PkrGlyph name="chevron-right" size={17}/></button>
    <button type="button" onClick={p.onAppearance}><PkrGlyph name="grid" size={22}/><span>Full dashboard</span><PkrGlyph name="chevron-right" size={17}/></button>
   </div>
   {p.refreshError&&<p className="pkr-no-error" role="alert">{p.refreshError}</p>}
   <button type="button" className="pkr-no-refresh" onClick={p.onRefresh} disabled={p.refreshing}>{p.refreshing?'Refreshing club…':'Refresh club information'}</button>
  </section>
 </section>;
}
