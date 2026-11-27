'use client';

import PkrGlyph from '@/components/PkrGlyph';
import RecordMetric from '@/components/RecordMetric';
import type {Event, Game, Rsvp} from '@/lib/api';
import type {RoomTransferRecord} from '@/lib/room-payment-schedule';

type Props = {
  room: Event; featured: Game|null; active: boolean; going: Rsvp[]; seated: number;
  payments: RoomTransferRecord[]; paymentLabel: string;
  paymentState: 'loading'|'unavailable'|'partial'|'ready';
  attendanceState: 'loading'|'unavailable'|'ready';
  canInvite: boolean; canManageGames: boolean;
  onGame: ()=>void; onSchedule: ()=>void; onInvite: ()=>void; onRsvp: ()=>void;
  onSharing: ()=>void; onPayments: ()=>void; onResults: ()=>void;
  onCalendar: ()=>void; onMembers: ()=>void; onScan: ()=>void;
  onAppearance: ()=>void; onRsvpSettings: ()=>void; onAccount: ()=>void;
  onRoom: ()=>void; onRefresh: ()=>void;
  refreshing?: boolean; refreshError?: string;
};

const tz = 'Australia/Brisbane';
const initials = (name:string)=>name.trim().split(/\s+/).slice(0,2).map(x=>x[0]).join('');
const datePart = (ts:number,options:Intl.DateTimeFormatOptions)=>new Date(ts*1000).toLocaleDateString('en-AU',{...options,timeZone:tz});

/** Focused home view using the same games, RSVP records and saved ledger as the full dashboard. */
export default function GameNightHostHome(p:Props){
  const game = p.featured;
  const closed = game?.status==='settled';
  const finishing = game?.status==='completed';
  const confirmed = p.attendanceState==='ready';
  const hasOpenPayments = (p.paymentState==='ready'||p.paymentState==='partial')&&p.payments.length>0;
  const guests = p.going.slice(0,6);
  const startTime = game?new Date(game.scheduled_at*1000).toLocaleTimeString('en-AU',{hour:'numeric',minute:'2-digit',timeZone:tz}):'';
  const phase = p.active?'At the table':closed||finishing?'After the game':'Before the game';
  const primary = p.active?'Open live table':closed?'View game results':finishing?'Review settlement':game?'Prepare game':p.canManageGames?'Schedule a game':'Open club';

  return <section className="pkr-gn-home" data-testid="game-night-host-home">
    <header className="pkr-gn-page-head">
      <div><span className="pkr-gn-eyebrow">YOUR CLUB AT A GLANCE</span><h1>Club overview<span>.</span></h1></div>
      <button className="pkr-gn-refresh" type="button" disabled={p.refreshing} onClick={p.onRefresh} aria-label="Refresh game night"><PkrGlyph name="refresh"/> <span>{p.refreshing?'Refreshing…':'Refresh'}</span></button>
    </header>
    {p.refreshError&&<p className="pkr-gn-refresh-error" role="alert">{p.refreshError}</p>}

    <section className="pkr-gn-game-ticket" aria-label="Current game night">
      <div className="pkr-gn-ticket-top"><span>{phase}</span><span className="pkr-gn-host-tag">{p.room.role==='cohost'?'CO-HOST':p.canManageGames?'HOST':'PLAYER'}</span></div>
      {game?<>
        <div className="pkr-gn-ticket-main">
          <div className="pkr-gn-date"><strong>{datePart(game.scheduled_at,{day:'numeric'})}</strong><span>{datePart(game.scheduled_at,{month:'short',year:'numeric'})}</span></div>
          <div className="pkr-gn-when"><h2>{datePart(game.scheduled_at,{weekday:'long'})}</h2><p>{startTime}</p><span>{game.location||p.room.name}</span></div>
        </div>
        <div className="pkr-gn-ticket-rule"/>
        <div className="pkr-gn-ticket-footer">
          <div className="pkr-gn-seats-summary">
            {!p.active&&!closed&&!finishing&&confirmed?<RecordMetric bare className="pkr-gn-ticket-record"
              request={{kind:'rsvps',title:'Confirmed RSVPs',gameId:game.id,filter:'yes'}}><strong>{p.going.length} confirmed</strong></RecordMetric>:
              <button type="button" className="pkr-record-action pkr-gn-ticket-record" onClick={p.active||closed||finishing?p.onGame:p.onRsvp}>
                <strong>{p.active?'Game in progress':closed?'Results saved':finishing?'Ready to settle':p.attendanceState==='unavailable'?'RSVPs unavailable':'Checking RSVPs'}</strong></button>}
            <RecordMetric bare className="pkr-gn-ticket-record" request={{kind:'seats',title:'Table seats',gameId:game.id}}><span>{game.seats}-seat table</span></RecordMetric>
            {!p.active&&!closed&&!finishing&&confirmed&&<div className="pkr-gn-seat-meter" aria-hidden="true">{Array.from({length:Math.min(game.seats,24)},(_,i)=><span className={i<p.going.length?'filled':''} key={i}/>)}</div>}
          </div>
          <button type="button" className="pkr-gn-primary" onClick={p.onGame}>{primary}</button>
        </div>
      </>:p.refreshing?<div className="pkr-gn-no-game" role="status"><h2>Checking your next game…</h2><p>Loading the club’s saved schedule.</p></div>:p.refreshError?<div className="pkr-gn-no-game"><h2>Your schedule is unavailable.</h2><p>We could not check the saved games. Refresh to try again.</p><button type="button" className="pkr-gn-primary" onClick={p.onRefresh}>Retry loading games</button></div>:<div className="pkr-gn-no-game"><h2>Your next great night starts here.</h2><p>Choose a date and bring the club together.</p><button type="button" className="pkr-gn-primary" onClick={p.canManageGames?p.onSchedule:p.onRoom}>{primary}<PkrGlyph name="schedule"/></button></div>}
    </section>

    {game&&!closed&&<div className="pkr-gn-context-actions">
      <button type="button" onClick={p.onRsvp}><PkrGlyph name="members"/><span>RSVPs &amp; seats</span></button>
      <button type="button" onClick={p.onSharing}><svg aria-hidden="true" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M12 16V3m-4 4 4-4 4 4M5 12v8h14v-8"/></svg><span>Sharing options</span></button>
    </div>}

    {game&&!closed&&<section className="pkr-gn-crew pkr-attendance-card" aria-label="Confirmed guests">
      <header><h2><PkrGlyph name="members"/> The table so far</h2><button type="button" onClick={p.onRsvp}>View all <span aria-hidden="true">›</span></button></header>
      {confirmed&&guests.length>0?<div className="pkr-gn-people-strip">{guests.map((r,i)=><button type="button" onClick={p.onRsvp} key={r.id} aria-label={'View RSVP for '+r.display_name}>
        <span className={'pkr-gn-avatar tone-'+i}>{initials(r.display_name)}<i aria-hidden="true"><PkrGlyph name="check" size={12}/></i></span><strong title={r.display_name}>{r.display_name.split(' ')[0]}</strong>
      </button>)}</div>:<p className="pkr-gn-muted" role="status">{confirmed?'No confirmed RSVPs yet.':p.attendanceState==='unavailable'?'Could not check RSVPs. Open the RSVP board to retry.':'Checking the guest list…'}</p>}
      {confirmed&&<div className="pkr-seat-preview" aria-hidden="true">{Array.from({length:Math.min(36,Math.max(0,game.seats))},(_,i)=><span key={i} className={i<p.seated?'is-assigned':''}/>)}</div>}
      {confirmed&&<p className="pkr-gn-seat-note"><RecordMetric bare request={{kind:'players',title:'Seated players',gameId:game.id,filter:'seated'}}>{p.seated} seat{p.seated===1?'':'s'} assigned</RecordMetric>
        {' · '}<RecordMetric bare request={{kind:'rsvps',title:'Confirmed RSVPs',gameId:game.id,filter:'yes'}}>{p.going.length} confirmed RSVP{p.going.length===1?'':'s'}</RecordMetric></p>}
    </section>}

    <section className="pkr-gn-attention" aria-label="Payments to review">
      <div className="pkr-gn-attention-icon"><PkrGlyph name="settle"/></div>
      <button type="button" className="pkr-record-action pkr-gn-attention-record" onClick={p.onPayments}
        aria-label="View underlying records: Outstanding payments"><h2>{hasOpenPayments?(p.paymentState==='partial'?'At least ':'')+p.payments.length+' payment'+(p.payments.length===1?'':'s')+' outstanding':p.paymentState==='loading'?'Checking payments':p.paymentState==='ready'?'Payments are up to date':'Payment records need a check'}</h2>
        <p>{hasOpenPayments?p.paymentLabel+' across saved games'+(p.paymentState==='partial'?' · partial history':''):p.paymentState==='loading'?'Looking up the club’s saved records.':p.paymentState==='ready'?'View paid history and the full ledger.':'Open Payments to review the available records.'}</p></button>
      <button type="button" onClick={p.onPayments}>Review</button>
    </section>


    {/* Home is for decisions, not a duplicate directory of every tab. */}
    <section className="pkr-gn-quick" aria-labelledby="pkr-home-quick-heading">
      <div className="pkr-gn-quick-heading">
        <div><span className="pkr-gn-eyebrow">ONE TAP AWAY</span><h2 id="pkr-home-quick-heading">Quick actions</h2></div>
        <span className="pkr-gn-quick-note">Your everyday club tools</span>
      </div>
      <div className="pkr-gn-quick-grid">
        <button type="button" onClick={p.canManageGames?p.onSchedule:p.onCalendar}>
          <span className="pkr-gn-quick-icon"><PkrGlyph name="schedule"/></span>
          <span><strong>{p.canManageGames?'Schedule game':'View calendar'}</strong><small>{p.canManageGames?'Set up the next session':'Upcoming sessions'}</small></span>
          <span className="pkr-gn-quick-arrow" aria-hidden="true">›</span>
        </button>
        <button type="button" onClick={p.onSharing}>
          <span className="pkr-gn-quick-icon"><PkrGlyph name="members"/></span>
          <span><strong>RSVPs &amp; sharing</strong><small>Attendance and WhatsApp</small></span>
          <span className="pkr-gn-quick-arrow" aria-hidden="true">›</span>
        </button>
        <button type="button" onClick={p.canInvite?p.onInvite:p.onMembers}>
          <span className="pkr-gn-quick-icon"><PkrGlyph name="members"/></span>
          <span><strong>{p.canInvite?'Invite players':'Player profiles'}</strong><small>{p.canInvite?'Add someone to the club':'Your club members'}</small></span>
          <span className="pkr-gn-quick-arrow" aria-hidden="true">›</span>
        </button>
        <button type="button" onClick={p.onCalendar}>
          <span className="pkr-gn-quick-icon"><PkrGlyph name="games"/></span>
          <span><strong>Game calendar</strong><small>Dates and game history</small></span>
          <span className="pkr-gn-quick-arrow" aria-hidden="true">›</span>
        </button>
      </div>
      <div className="pkr-gn-quick-utilities" aria-label="Additional club tools">
        {p.canManageGames&&<button type="button" onClick={p.onRsvpSettings}><PkrGlyph name="settings"/> RSVP settings</button>}
        <button type="button" onClick={p.onScan}><PkrGlyph name="qr"/> Scan invitation</button>
        <button type="button" onClick={p.onAppearance}><PkrGlyph name="grid"/> Full dashboard</button>
      </div>
    </section>
  </section>;
}
