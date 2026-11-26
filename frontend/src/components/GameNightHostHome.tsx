'use client';

import {useState} from 'react';
import PkrGlyph, {type PkrGlyphName} from '@/components/PkrGlyph';
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
  const [search,setSearch] = useState('');
  const game = p.featured;
  const closed = game?.status==='settled';
  const finishing = game?.status==='completed';
  const confirmed = p.attendanceState==='ready';
  const hasOpenPayments = (p.paymentState==='ready'||p.paymentState==='partial')&&p.payments.length>0;
  const guests = p.going.slice(0,6);
  const startTime = game?new Date(game.scheduled_at*1000).toLocaleTimeString('en-AU',{hour:'numeric',minute:'2-digit',timeZone:tz}):'';
  const phase = p.active?'At the table':closed||finishing?'After the game':'Before the game';
  const primary = p.active?'Open live table':closed?'View game results':finishing?'Review settlement':game?'Prepare game':p.canManageGames?'Schedule a game':'Open club';
  const tools:Array<{label:string;detail:string;icon:PkrGlyphName;run:()=>void;show?:boolean}> = [
    {label:'Game sessions',detail:'Dates, tables and game details',icon:'games',run:p.onRoom},
    {label:'Calendar',detail:'Upcoming and unfinished games',icon:'schedule',run:p.onCalendar},
    {label:'RSVPs & sharing',detail:'Attendance, seats and WhatsApp',icon:'members',run:p.onSharing},
    {label:'RSVP settings',detail:'Arrival times and custom replies',icon:'settings',run:p.onRsvpSettings,show:p.canManageGames},
    {label:'Players & invitations',detail:'Profiles, approvals and QR codes',icon:'members',run:p.onMembers},
    {label:'Results & history',detail:'Standings, graphs and past games',icon:'insights',run:p.onResults},
    {label:'Payments',detail:'Saved records, reminders and ledger',icon:'settle',run:p.onPayments},
    {label:'Account & notifications',detail:'Install, alerts, sound and account',icon:'account',run:p.onAccount},
    {label:'Scan invitation',detail:'Join a club using its QR code',icon:'qr',run:p.onScan},
    {label:'Room appearance',detail:'Command Centre and Live Poker',icon:'grid',run:p.onAppearance},
  ];
  const query = search.trim().toLocaleLowerCase('en-AU');
  const matches = tools.filter(t=>t.show!==false&&(!query||(t.label+' '+t.detail).toLocaleLowerCase('en-AU').includes(query)));

  return <section className="pkr-gn-home" data-testid="game-night-host-home">
    <header className="pkr-gn-page-head">
      <div><span className="pkr-gn-eyebrow">YOUR CLUB, YOUR NIGHT</span><h1>Game night<span>.</span></h1></div>
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

    {game&&!closed&&<section className="pkr-gn-crew" aria-label="Confirmed guests">
      <header><h2>The table so far</h2><button type="button" onClick={p.onRsvp}>View all</button></header>
      {confirmed&&guests.length>0?<div className="pkr-gn-people-strip">{guests.map((r,i)=><button type="button" onClick={p.onRsvp} key={r.id} aria-label={'View RSVP for '+r.display_name}>
        <span className={'pkr-gn-avatar tone-'+i}>{initials(r.display_name)}<i aria-hidden="true"><PkrGlyph name="check" size={12}/></i></span><strong title={r.display_name}>{r.display_name.split(' ')[0]}</strong>
      </button>)}</div>:<p className="pkr-gn-muted" role="status">{confirmed?'No confirmed RSVPs yet.':p.attendanceState==='unavailable'?'Could not check RSVPs. Open the RSVP board to retry.':'Checking the guest list…'}</p>}
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

    <section className="pkr-gn-club-links" aria-label="Club shortcuts">
      <button type="button" onClick={p.canInvite?p.onInvite:p.onMembers}><PkrGlyph name="members"/><span><strong>{p.canInvite?'Bring your people':'Your club'}</strong><small>{p.canInvite?'Invitations & player profiles':'Players & game history'}</small></span></button>
      <button type="button" onClick={p.canManageGames?p.onSchedule:p.onCalendar}><PkrGlyph name="schedule"/><span><strong>{p.canManageGames?'Plan the next one':'Your calendar'}</strong><small>{p.canManageGames?'Schedule a game':'View upcoming games'}</small></span></button>
    </section>

    <section className="pkr-gn-tools" aria-label="All club tools">
      <div className="pkr-gn-tools-heading"><div><span className="pkr-gn-eyebrow">EVERYTHING IN ONE PLACE</span><h2>Your club tools</h2></div>
        <label><span>Find a tool</span><input type="search" value={search} onChange={e=>setSearch(e.target.value)} placeholder="Search tools…"/></label></div>
      <div className="pkr-gn-tool-grid">{matches.map(t=><button type="button" key={t.label} onClick={t.run}><PkrGlyph name={t.icon}/><span><strong>{t.label}</strong><small>{t.detail}</small></span><b aria-hidden="true"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M6 18 18 6M6 6h12v12"/></svg></b></button>)}</div>
      {matches.length===0&&<p className="pkr-gn-muted" role="status">No tools match “{search}”. Try payments, RSVP, calendar or players.</p>}
    </section>
  </section>;
}
