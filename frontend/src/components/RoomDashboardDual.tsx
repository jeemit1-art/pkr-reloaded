'use client';

import {useEffect,useMemo,useState} from 'react';
import {useRouter} from 'next/navigation';
import {api,fmt,fmtDate,fmtSign,type Event,type EventMember,type Game,type GameDetail,
  type LeaderboardEntry,type RoomDashboardLayout,type RoomPlayerProfile} from '@/lib/api';
import RoomOutstandingCard from '@/components/RoomOutstandingCard';
import {loadRoomTransfers,outstandingRoomTransfers,totalTransferCents,type RoomTransferLoad} from '@/lib/room-payment-schedule';
import {isCurrentGame,isLiveGame} from '@/lib/game-status';
import './RoomDashboardDual.css';

type Props={
  room:Event;
  games:Game[];
  history?:Game[];
  leaders?:LeaderboardEntry[];
  members?:EventMember[];
  rooms?:Event[];
  viewerIsHost:boolean;
  onRoomSelect?:(id:string)=>void;
  onCreateGame?:()=>void;
  onInvite?:()=>void;
  onScan?:()=>void;
  onMembers?:()=>void;
  onHistory?:()=>void;
};
const money=(cents:number|null|undefined)=>Number.isSafeInteger(cents)?fmt(cents as number):'—';
const shortName=(name:string)=>name.split(/\s+/).filter(Boolean).map(s=>s[0]).slice(0,2).join('').toUpperCase();
function niceDate(ts:number){return new Date(ts*1000).toLocaleString('en-AU',{weekday:'long',month:'short',day:'numeric',hour:'numeric',minute:'2-digit',timeZone:'Australia/Brisbane'});}
function isCurrent(ts:number){return ts>Math.floor(Date.now()/1000)-86400;}
function PlayerAvatar({name,image,size='normal'}:{name:string;image?:string|null;size?:'normal'|'small'}){
  return <span className={'pkr-dual-avatar'+(size==='small'?' small':'')}>
    {image?<img src={image} alt="" loading="lazy"/>:shortName(name)}</span>;
}

export default function RoomDashboardDual({
  room,games,history=[],leaders=[],members=[],rooms=[],viewerIsHost,
  onRoomSelect,onCreateGame,onInvite,onScan,onMembers,onHistory,
}:Props){
  const router=useRouter();
  const [layout,setLayout]=useState<RoomDashboardLayout>('command');
  const [layoutReady,setLayoutReady]=useState(false);
  const [layoutError,setLayoutError]=useState('');
  const [saving,setSaving]=useState(false);
  const [gameDetail,setGameDetail]=useState<GameDetail|null>(null);
  const [gameError,setGameError]=useState(false);
  const [ledger,setLedger]=useState<RoomTransferLoad|null>(null);
  const [ledgerError,setLedgerError]=useState(false);
  const [profiles,setProfiles]=useState<RoomPlayerProfile[]>([]);
  const [roomMenu,setRoomMenu]=useState(false);
  const current=useMemo(()=>games.filter(isCurrentGame).sort((a,b)=>{
    if(isLiveGame(a)!==isLiveGame(b))return isLiveGame(a)?-1:1;
    return a.scheduled_at-b.scheduled_at;
  }),[games]);
  const featured=current[0]||null;
  const active=featured&&isLiveGame(featured)?featured:null;
  const settlements=useMemo(()=>history.filter(g=>g.status==='settled')
    .sort((a,b)=>b.scheduled_at-a.scheduled_at),[history]);

  // The Worker is authoritative; localStorage is deliberately NOT a room setting.
  // Refresh on focus as well as room changes so other devices see host choices.
  useEffect(()=>{
    let mounted=true;
    setLayoutReady(false);setLayoutError('');setLayout('command');
    const refresh=async()=>{
      try{
        const record=await api.events.dashboardLayout(room.id);
        if(!mounted||record.event_id!==room.id)return;
        setLayout(record.layout==='live'?'live':'command');setLayoutError('');setLayoutReady(true);
      }catch{
        if(mounted){setLayout('command');setLayoutReady(true);
          setLayoutError('Saved room view temporarily unavailable. Showing Command Centre.');}
      }
    };
    void refresh();
    const onFocus=()=>{if(document.visibilityState==='visible')void refresh();};
    const onVisibility=()=>{if(document.visibilityState==='visible')void refresh();};
    window.addEventListener('focus',onFocus);
    document.addEventListener('visibilitychange',onVisibility);
    const timer=window.setInterval(()=>{if(document.visibilityState==='visible')void refresh();},45000);
    return()=>{mounted=false;clearInterval(timer);
      window.removeEventListener('focus',onFocus);
      document.removeEventListener('visibilitychange',onVisibility);};
  },[room.id]);

  useEffect(()=>{
    let mounted=true;
    setGameDetail(null);setGameError(false);
    if(!featured)return;
    const refresh=async()=>{
      try{const result=await api.games.get(featured.id);
        if(mounted){setGameDetail(result);setGameError(false);}}
      catch{if(mounted){setGameDetail(null);setGameError(true);}}
    };
    void refresh();
    const timer=window.setInterval(()=>{if(document.visibilityState==='visible')void refresh();},30000);
    return()=>{mounted=false;clearInterval(timer)};
  },[featured?.id]);

  useEffect(()=>{
    let mounted=true;setLedger(null);setLedgerError(false);
    const refresh=()=>loadRoomTransfers(room.id).then(x=>{if(mounted){setLedger(x);setLedgerError(false);}})
      .catch(()=>{if(mounted){setLedger(null);setLedgerError(true);}});
    void refresh();
    const timer=window.setInterval(()=>{if(document.visibilityState==='visible')void refresh();},45000);
    return()=>{mounted=false;clearInterval(timer)};
  },[room.id]);

  useEffect(()=>{
    let mounted=true;setProfiles([]);
    api.events.profiles(room.id).then(r=>{if(mounted)setProfiles(r.profiles);}).catch(()=>{});
    return()=>{mounted=false};
  },[room.id]);

  async function choose(next:RoomDashboardLayout){
    if(!viewerIsHost||saving||!layoutReady||next===layout)return;
    setSaving(true);setLayoutError('');
    try{
      const saved=await api.events.saveDashboardLayout(room.id,next);
      if(saved.event_id!==room.id||saved.layout!==next)throw Error('The saved layout did not match.');
      setLayout(saved.layout);
    }catch(e){
      setLayoutError(e instanceof Error?e.message:'Unable to save room layout. Nothing changed.');
      // No optimistic changes; current dashboard is unchanged on a failed write.
    }finally{setSaving(false);}
  }
  const openRoom=()=>router.push('/events/'+encodeURIComponent(room.id));
  const openGame=()=>featured&&router.push('/games/'+encodeURIComponent(featured.id));
  const openTable=()=>{
    if(!active)return;
    router.push('/games/'+encodeURIComponent(active.id)+'/play');
  };
  const goMembers=()=>onMembers?onMembers():router.push('/events/'+encodeURIComponent(room.id)+'?tab=members');
  const goHistory=()=>onHistory?onHistory():router.push('/events/'+encodeURIComponent(room.id)+'?tab=history');
  const goInvite=()=>onInvite?onInvite():goMembers();
  const goCreate=()=>viewerIsHost?(onCreateGame?onCreateGame():openRoom()):openRoom();
  const goSchedule=()=>router.push('/schedule');
  const goPayments=()=>router.push('/insights?room='+encodeURIComponent(room.id)+'&payments=outstanding#pkr-settlement');
  const goLeaders=()=>router.push('/events/'+encodeURIComponent(room.id)+'?tab=leaderboard');
  const goRsvp=()=>featured&&router.push('/games/'+encodeURIComponent(featured.id)+'/rsvp');
  const payments=useMemo(()=>outstandingRoomTransfers(ledger?.records||[]),[ledger]);
  const pendingCents=totalTransferCents(payments);
  const incomplete=!!ledgerError||!!ledger?.unavailable.length;
  const paymentLabel=ledgerError||!ledger?'—':incomplete?(payments.length?'≥ '+fmt(pendingCents):'—'):fmt(pendingCents);
  const paymentHint=ledgerError?'Payments unavailable':incomplete?'Total unverified':payments.length+' pending transfer'+(payments.length===1?'':'s');
  const livePlayers=gameDetail&&featured&&gameDetail.id===featured.id?gameDetail.players:[];
  const seated=livePlayers.filter(p=>Number.isInteger(p.seat_number)&&Number(p.seat_number)>0)
    .sort((a,b)=>Number(a.seat_number)-Number(b.seat_number));
  const rsvps=gameDetail&&featured&&gameDetail.id===featured.id?gameDetail.rsvps:[];
  const going=rsvps.filter(r=>r.status==='yes');
  const maybe=rsvps.filter(r=>r.status==='maybe');
  const otherRooms=rooms.filter(r=>r.id!==room.id&&r.status!=='ended');
  const roomMembers=members.length?members.length:room.member_count||0;
  const countAvailable=featured&&gameDetail?Math.max(0,featured.seats-seated.length):null;
  const leaderboard=leaders.slice().sort((a,b)=>b.total_net-a.total_net).slice(0,4);
  const nameFor=(userId:string,name:string)=>{
    const profile=profiles.find(p=>p.profile_key==='member:'+userId||
      p.profile_key==='history:'+name.trim().toLowerCase());
    return profile?.screen_name||name;
  };
  const avatarFor=(userId:string,name:string)=>{
    const match=profiles.find(p=>p.profile_key==='member:'+userId||
      p.profile_key==='history:'+name.trim().toLowerCase());
    return match?.avatar_data||members.find(m=>m.id===userId)?.avatar_url||null;
  };
  const paidHistory=(ledger?.records||[]).filter(x=>x.transfer.status==='paid')
    .sort((a,b)=>(b.transfer.paid_at||b.game.scheduled_at)-(a.transfer.paid_at||a.game.scheduled_at)).slice(0,3);
  const totalBuyins=livePlayers.length>0&&livePlayers.every(p=>Number.isSafeInteger((p as any).buy_in_total))
    ?livePlayers.reduce((sum,p)=>sum+Number((p as any).buy_in_total),0):null;
  const liveLabel=active?'LIVE NOW':featured?'UP NEXT':'NO GAME SCHEDULED';
  const seatText=featured?(gameDetail?seated.length+' / '+featured.seats+' seated':'Seats loading'): 'No scheduled game';

  return <section className={'pkr-dual-root pkr-dual-'+layout} data-testid="dual-dashboard"
    data-layout={layout} data-room-id={room.id} aria-label="Poker room dashboard">
    <div className="pkr-dual-shell">
      <header className="pkr-dual-toolbar">
        <div className="pkr-dual-toolbar-lead">
          <span className="pkr-dual-suit" aria-hidden="true">♠</span>
          <div><span className="pkr-dual-kicker">PKR · PRIVATE POKER CLUB</span>
            <strong>Your poker room</strong></div>
        </div>
        {rooms.length>1&&onRoomSelect?
          <div className="pkr-dual-room-selector">
            <button type="button" aria-expanded={roomMenu} aria-haspopup="listbox"
              onClick={()=>setRoomMenu(v=>!v)}>{room.name} <span aria-hidden="true">⌄</span></button>
            {roomMenu&&<div className="pkr-dual-room-menu" role="listbox">
              {[room,...otherRooms].map(r=><button key={r.id} type="button" role="option"
                aria-selected={r.id===room.id} onClick={()=>{setRoomMenu(false);onRoomSelect(r.id);}}>
                {r.name}{r.id===room.id?' ✓':''}</button>)}
            </div>}
          </div>:
          <button className="pkr-dual-room-label" type="button" onClick={openRoom}>
            {room.name} <span>↗</span></button>}
      </header>

      <div className="pkr-dual-switcher" aria-label="Dashboard presentation">
        <div className="pkr-dual-switcher-heading">
          <span className="pkr-dual-diamond">◆</span>
          <div><strong>Dashboard experience</strong>
            <small>{viewerIsHost?'Host-controlled · saved for all room members':
              'Selected by your room host'}</small></div>
        </div>
        <div className="pkr-dual-switch-actions" role="group" aria-label="Host dashboard layout">
          <button type="button" aria-pressed={layoutReady&&layout==='command'}
            disabled={!viewerIsHost||!layoutReady||saving}
            onClick={()=>void choose('command')} className={layout==='command'?'active':''}>
            ▦ <span>Command Centre</span></button>
          <button type="button" aria-pressed={layoutReady&&layout==='live'}
            disabled={!viewerIsHost||!layoutReady||saving}
            onClick={()=>void choose('live')} className={layout==='live'?'active':''}>
            ♠ <span>Live Poker</span></button>
        </div>
      </div>
      {layoutError&&<p role="alert" className="pkr-dual-error">{layoutError}</p>}
      {!layoutReady?<div role="status" className="pkr-dual-wait">Loading the room's saved layout…</div>:layout==='command'?<>
        <div className="pkr-dual-heading">
          <span className="pkr-dual-kicker">YOUR ROOM DASHBOARD</span>
          <h2>Everything for <em>game night.</em></h2>
        </div>
        <section className="pkr-dual-hero pkr-dual-hero-command">
          <div className="pkr-dual-hero-text">
            <div className="pkr-dual-eyebrow"><span>◆ CURRENT ROOM</span><span className="pkr-dual-status">{liveLabel}</span></div>
            <h3>{room.name}</h3>
            <p>♠ Private room · {roomMembers} members · {seatText}</p>
            <div className="pkr-dual-hero-buttons">
              <button type="button" className="pkr-dual-gold-button" onClick={active?openTable:featured?openGame:goCreate}>
                {active?'Resume Game':featured?'View Next Game':viewerIsHost?'Create a Game':'Open Room'} <span>→</span></button>
              <button type="button" className="pkr-dual-outline-button" onClick={openRoom}>Room details ↗</button>
            </div>
          </div>
          <div className="pkr-dual-hero-image" aria-hidden="true"><span>♠</span></div>
        </section>
        <RoomOutstandingCard roomId={room.id}/>
        <section className="pkr-dual-block">
          <div className="pkr-dual-section-title"><h3>Quick Actions</h3><small>Get the game going</small></div>
          <div className="pkr-dual-quick-grid">
            <button type="button" onClick={featured?openGame:goCreate}><b>♠</b><span>↗</span><strong>{featured?'Open Game':'Create Game'}</strong><small>Manage a session</small></button>
            <button type="button" onClick={goInvite}><b>♟</b><span>↗</span><strong>{viewerIsHost?'Invite Players':'Members'}</strong><small>{viewerIsHost?'Share your room':'View the room'}</small></button>
            <button type="button" onClick={goSchedule}><b>▦</b><span>↗</span><strong>Schedule</strong><small>Next game night</small></button>
            <button type="button" onClick={onScan||goMembers}><b>⊞</b><span>↗</span><strong>{onScan?'Scan Invite':'View Players'}</strong><small>{onScan?'Join a room':'Private roster'}</small></button>
          </div>
        </section>
        <section className="pkr-dual-nextgame">
          <div><span className="pkr-dual-kicker">▦ NEXT GAME NIGHT</span>
            <h3>{featured?niceDate(featured.scheduled_at):'No session scheduled'}</h3>
            <p>{featured?.location||'Choose a date for the next game'}</p>
            <span className="pkr-dual-tag">{active?'Game in progress':featured?'Game scheduled':'Ready when you are'}</span>
          </div>
          <div className="pkr-dual-rsvp-summary">
            <strong>{featured?going.length+' going':'No RSVPs yet'}</strong>
            {featured&&<span>{rsvps.length} responses · {maybe.length} maybe</span>}
            {featured&&<div className="pkr-dual-progress"><span style={{width:(rsvps.length?100*going.length/rsvps.length:0)+'%'}}/></div>}
            <button type="button" onClick={featured?goRsvp:goCreate}>{featured?'RSVP & game details':'Schedule a game'} →</button>
          </div>
        </section>
        <div className="pkr-dual-metrics">
          <button type="button" onClick={active?openTable:openRoom}><span>▥ Recorded buy-ins</span><strong>{money(totalBuyins)}</strong><small>{active?'Current live table':'Open a live game to view'}</small></button>
          <button type="button" onClick={goMembers}><span>♟ Room members</span><strong>{roomMembers}</strong><small>Private club</small></button>
          <button type="button" onClick={goPayments}><span>⇄ Pending transfers</span><strong>{paymentLabel}</strong><small>{paymentHint}</small></button>
          <button type="button" onClick={goHistory}><span>◉ Settled games</span><strong>{settlements.length}</strong><small>Recorded results</small></button>
        </div>
        <div className="pkr-dual-data-grid">
          <section className="pkr-dual-data-card">
            <div className="pkr-dual-section-title"><h3>🏆 Leaderboard</h3><button onClick={goLeaders}>View all ↗</button></div>
            {leaderboard.length?leaderboard.map((p,i)=><button className="pkr-dual-leader" type="button" onClick={goLeaders} key={p.user_id||p.display_name}>
              <span className="pkr-dual-rank">{i+1}</span>
              <PlayerAvatar name={p.display_name} image={avatarFor(p.user_id,p.display_name)} size="small"/>
              <strong>{nameFor(p.user_id,p.display_name)}</strong>
              <b className={p.total_net>=0?'pkr-dual-positive':'pkr-dual-negative'}>{fmtSign(p.total_net)}</b>
            </button>):<p className="pkr-dual-empty">No settled-game leaderboard yet.</p>}
          </section>
          <section className="pkr-dual-data-card">
            <div className="pkr-dual-section-title"><h3>◷ Recent activity</h3><button onClick={goHistory}>View history ↗</button></div>
            {paidHistory.length?paidHistory.map(({game,transfer})=>
              <button className="pkr-dual-activity" type="button"
                key={game.id+':'+transfer.id} onClick={goPayments}>
                <span className="pkr-dual-activity-mark">✓</span>
                <span><strong>{transfer.from_name} · marked paid</strong>
                  <small>{transfer.paid_at?niceDate(transfer.paid_at):'Paid date not recorded'} · {money(transfer.amount)}</small></span>
              </button>):settlements.length?settlements.slice(0,3).map(g=>
              <button className="pkr-dual-activity" key={g.id} type="button" onClick={()=>router.push('/games/'+g.id)}>
                <span className="pkr-dual-activity-mark">♠</span>
                <span><strong>Poker game settled</strong><small>{niceDate(g.scheduled_at)}</small></span>
              </button>):<p className="pkr-dual-empty">Game and payment history will appear here.</p>}
          </section>
        </div>
      </>:<>
        <div className="pkr-dual-heading"><span className="pkr-dual-kicker">YOUR LIVE POKER HUB</span>
          <h2>The table is <em>calling.</em></h2></div>
        <section className="pkr-dual-hero pkr-dual-hero-live">
          <div className="pkr-dual-hero-text">
            <div className="pkr-dual-eyebrow"><span>TONIGHT'S GAME</span><span className="pkr-dual-status">{liveLabel}</span></div>
            <h3>{room.name}</h3>
            <p>{featured?niceDate(featured.scheduled_at):'No game has been scheduled'}</p>
            <p className="pkr-dual-seatline">♟ {seatText}
              {countAvailable!==null&&<small> · {countAvailable} available</small>}</p>
            <div className="pkr-dual-hero-buttons">
              <button type="button" className="pkr-dual-gold-button" onClick={active?openTable:featured?openGame:goCreate}>
                {active?'Join the Table':featured?'View Game':viewerIsHost?'Schedule Game':'Open Room'} <span>→</span></button>
              <button type="button" className="pkr-dual-outline-button" onClick={openRoom}>Game room ↗</button>
            </div>
          </div><div className="pkr-dual-hero-image pkr-dual-hero-cards" aria-hidden="true"><span>♠</span></div>
        </section>
        <div className="pkr-dual-highlights">
          <button type="button" onClick={goPayments}><span>▣</span><strong>{paymentLabel}</strong><small>Outstanding payments</small></button>
          <button type="button" onClick={goRsvp} disabled={!featured}><span>▦</span><strong>{featured?rsvps.length-going.length:'—'}</strong><small>Not confirmed going</small></button>
          <button type="button" onClick={openGame} disabled={!featured}><span>▱</span><strong>{countAvailable===null?'—':countAvailable}</strong><small>Seats available</small></button>
          <button type="button" onClick={goPayments}><span>⇄</span><strong>{ledger?ledger.unavailable.length:'—'}</strong><small>Games to verify</small></button>
        </div>
        <section className="pkr-dual-table-panel">
          <div className="pkr-dual-section-title"><h3><i className="pkr-dual-live-dot"/> Live Table Snapshot</h3>
            <button type="button" onClick={active?openTable:openGame} disabled={!featured}>View table ↗</button></div>
          <div className="pkr-dual-felt-stage">
            <div className="pkr-dual-felt">
              <span>♠ ♥ ♣ ♦</span>
              <small>{active?'ACTIVE GAME':'TABLE PREVIEW'}</small>
              <strong>{featured?seatText:'No game yet'}</strong>
              <b>♠ PKR ♠</b>
            </div>
          </div>
          {gameError&&<p className="pkr-dual-empty">Seat information is temporarily unavailable. Open the game for the latest details.</p>}
          {seated.length?<div className="pkr-dual-seat-grid">{seated.map(p=>
            <button type="button" key={p.user_id||p.seat_number} onClick={active?openTable:openGame}
              title={'Seat '+p.seat_number+' · '+p.display_name}>
              <PlayerAvatar name={nameFor(p.user_id,p.display_name)}
                image={avatarFor(p.user_id,p.display_name)} size="small"/>
              <span><strong>{nameFor(p.user_id,p.display_name)}</strong><small>Seat {p.seat_number}</small></span>
            </button>)}</div>:<p className="pkr-dual-empty">
            {featured?(gameError?'Unable to load seated players':'No players seated yet.'):'Your next live table will appear here.'}</p>}
        </section>
        <section className="pkr-dual-coming">
          <div className="pkr-dual-section-title"><h3>Who's Coming?</h3><button type="button" onClick={goRsvp} disabled={!featured}>See all RSVPs ↗</button></div>
          <p>{going.length} confirmed · {maybe.length} maybe · {rsvps.length} recorded responses</p>
          <div className="pkr-dual-coming-grid">
            {rsvps.length?rsvps.slice(0,16).map(r=>
              <button type="button" key={r.id} onClick={goRsvp}>
                <PlayerAvatar name={r.display_name} size="small"/>
                <strong>{r.display_name}</strong>
                <small className={'pkr-dual-rsvp-'+r.status}>{r.status==='yes'?'Going':r.status==='maybe'?'Maybe':'Not coming'}</small>
              </button>):<p className="pkr-dual-empty">RSVPs appear when players respond.</p>}
          </div>
        </section>
        <div className="pkr-dual-data-grid pkr-dual-live-tools">
          <section className="pkr-dual-data-card">
            <div className="pkr-dual-section-title"><h3>◉ Quick Buy-in</h3><small>Host · player seat required</small></div>
            <div className="pkr-dual-banks">
              {[25,50,100].map(amount=><button type="button" key={amount} disabled={!viewerIsHost||!active}
                onClick={openTable} title={'Open the table and select a player for a $'+amount+' buy-in'}>
                  {fmt(amount*100)}</button>)}
            </div>
            <p className="pkr-dual-help">Opens the existing table. Select a player to record the bank; this dashboard never charges a player.</p>
          </section>
          <section className="pkr-dual-data-card">
            <div className="pkr-dual-section-title"><h3>♟ Invite via WhatsApp</h3><small>Private room</small></div>
            <p className="pkr-dual-help">Invite approved members through your room's secure invitation tools.</p>
            <button type="button" className="pkr-dual-wide-link" onClick={goInvite}>{viewerIsHost?'Invite players':'View room members'} →</button>
          </section>
        </div>
        <section className="pkr-dual-data-card pkr-dual-settlements">
          <div className="pkr-dual-section-title"><h3>⇄ Recent Settlements</h3><button onClick={goPayments}>View all ↗</button></div>
          {paidHistory.length?<div className="pkr-dual-settlement-grid">{paidHistory.map(({game,transfer})=>
            <button type="button" key={game.id+':'+transfer.id} onClick={goPayments}>
              <PlayerAvatar name={transfer.from_name} size="small"/>
              <span><strong>{transfer.from_name}</strong><b className="pkr-dual-positive">{money(transfer.amount)} paid</b>
              <small>{transfer.paid_at?niceDate(transfer.paid_at):'Paid date not recorded'}</small></span>
            </button>)}</div>:<p className="pkr-dual-empty">No confirmed payments recorded in this room.</p>}
        </section>
        <RoomOutstandingCard roomId={room.id}/>
      </>}
    </div>
  </section>;
}
