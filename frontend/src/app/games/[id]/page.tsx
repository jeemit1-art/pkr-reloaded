'use client';
import { useEffect, useState, useCallback } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { api, GameDetail, GamePlayer, EventPlayer, fmtDate, fmt, fmtSign, waLink } from '@/lib/api';
import { subscribePush, unsubscribePush, isPushSubscribedToEvent, canUsePush, isPWAInstalled, isIOS, isSafari } from '@/lib/push';

export default function GamePage() {
  const { id } = useParams<{id:string}>();
  const router  = useRouter();
  const [game, setGame]           = useState<GameDetail|null>(null);
  const [knownPlayers, setKnown]  = useState<EventPlayer[]>([]);
  const [error, setError]         = useState('');
  const [isHost, setIsHost]       = useState(false);
  const [selectedPlayer, setSelected] = useState<GamePlayer|null>(null);
  const [showSeat, setShowSeat]   = useState(false);
  const [showSettle, setShowSettle] = useState(false);
  const [showUnsettle, setShowUnsettle] = useState(false);
  const [settleResult, setResult] = useState<any>(null);
  const [lastSaved, setLastSaved] = useState<Date|null>(null);
  const [eventName, setEventName] = useState('');
  const [showShare, setShowShare] = useState(false);
  const [pushEnabled, setPushEnabled] = useState(false);
  const [pushLoading, setPushLoading] = useState(false);
  const [eventId, setEventId] = useState('');
  const appUrl = typeof window !== 'undefined' ? window.location.origin : '';

  const load = useCallback(async()=>{
    try {
      const [g,u] = await Promise.all([api.games.get(id),api.auth.me()]);
      const safeGame = { ...g, players:g.players||[], rsvps:g.rsvps||[], transfers:(g as any).transfers||[] };
      setGame(safeGame);
      setEventId(safeGame.event_id);
      try {
        const ev = await api.events.get(safeGame.event_id);
        setEventName(ev.name||'');
        const me = (ev.members||[]).find((m:any)=>m.id===u.id);
        setIsHost(me?.role==='host'||me?.role==='cohost');
      } catch { setIsHost(false); }
      try { const ep = await api.events.players(safeGame.event_id); setKnown(ep||[]); } catch { setKnown([]); }
      setLastSaved(new Date());
    } catch { setError('Unable to load game.'); }
  },[id]);

  useEffect(()=>{ load(); },[load]);

  useEffect(()=>{
    if (eventId) isPushSubscribedToEvent(eventId).then(setPushEnabled);
  },[eventId]);

  useEffect(()=>{
    let lastLoad = Date.now();
    const INTERVAL = 30000;
    function tick() { if (document.visibilityState !== 'hidden') { load(); lastLoad = Date.now(); } }
    function onVisible() { if (document.visibilityState === 'visible' && Date.now() - lastLoad > INTERVAL) { load(); lastLoad = Date.now(); } }
    const timer = setInterval(tick, INTERVAL);
    document.addEventListener('visibilitychange', onVisible);
    return ()=>{ clearInterval(timer); document.removeEventListener('visibilitychange',onVisible); };
  },[load]);

  async function togglePush() {
    if (!eventId) return;
    setPushLoading(true);
    try {
      if (pushEnabled) {
        const result = await unsubscribePush(eventId);
        setPushEnabled(result);
      } else {
        const perm = await Notification.requestPermission();
        if (perm === 'granted') {
          const result = await subscribePush(eventId);
          setPushEnabled(result);
        }
      }
    } finally { setPushLoading(false); }
  }

  if (error) return (
    <div style={{height:'100dvh',background:'var(--bg)',display:'flex',alignItems:'center',justifyContent:'center',padding:24}}>
      <div style={{textAlign:'center'}}>
        <div style={{color:'var(--red)',marginBottom:16,fontFamily:'var(--font-body),sans-serif'}}>{error}</div>
        <button className="btn btn-ghost" onClick={()=>window.location.reload()}>Retry</button>
      </div>
    </div>
  );
  if (!game) return (
    <div style={{height:'100dvh',background:'var(--bg)',display:'flex',alignItems:'center',justifyContent:'center'}}>
      <div className="display" style={{fontSize:48,color:'var(--gold)',opacity:0.5}}>PKR</div>
    </div>
  );

  const players   = game.players||[];
  const rsvps     = game.rsvps||[];
  const transfers = (game as any).transfers||[];
  const totalIn   = players.reduce((s,p)=>s+(p.buy_ins||0),0);
  const totalOut  = players.reduce((s,p)=>s+(p.cashout||0),0);
  const bank      = totalIn - totalOut;
  const isSettled = game.status==='settled';
  const isActive  = game.status==='active';
  const liveUrl   = game.live_token    ? `${appUrl}/games/live/${game.live_token}` : '';
  const resultsUrl= game.results_token ? `${appUrl}/games/results/${game.results_token}` : '';
  const lobbyUrl  = `${appUrl}/games/${id}/lobby`;
  const installLink = `${appUrl}`;

  async function handleStart() {
    let pw='';
    if (game!.game_password) { pw=prompt('Game password:')||''; }
    try { await api.games.start(id,pw); load(); }
    catch(e:any){ alert(e.message); }
  }

  const seats = game.seats||9;
  const seatMap: (GamePlayer|null)[] = Array(seats).fill(null);
  players.forEach(p=>{ if(p.seat_number&&p.seat_number<=seats) seatMap[p.seat_number-1]=p; });
  let nextEmpty = 0;
  players.filter(p=>!p.seat_number||p.seat_number>seats).forEach(p=>{
    while(nextEmpty<seats&&seatMap[nextEmpty]!==null) nextEmpty++;
    if(nextEmpty<seats) { seatMap[nextEmpty]=p; nextEmpty++; }
  });

  const isPWA = isPWAInstalled();
  const iosDevice = isIOS();
  const safariOnly = isSafari();

  return (
    <div style={{height:'100dvh',display:'flex',flexDirection:'column',background:'var(--bg)',overflow:'hidden',paddingTop:'env(safe-area-inset-top)'}}>

      {/* Header */}
      <div style={{background:'var(--bg2)',borderBottom:'1px solid var(--border-sub)',flexShrink:0,zIndex:50}}>
        <div style={{maxWidth:600,margin:'0 auto',padding:'0 16px',height:52,display:'flex',alignItems:'center',gap:10}}>
          <button onClick={()=>router.push(`/events/${game.event_id}`)} style={{
            background:'none',border:'none',color:'var(--muted)',cursor:'pointer',
            fontSize:20,padding:'4px 8px',lineHeight:1,minHeight:44,display:'flex',alignItems:'center'}}>‹</button>
          <div style={{flex:1}}>
            <div style={{fontSize:13,color:'var(--gold)',fontFamily:'var(--font-display),serif',fontWeight:700,letterSpacing:'0.02em'}}>
              {eventName||fmtDate(game.scheduled_at)}
            </div>
            <div style={{fontSize:10,color:'var(--muted)',fontFamily:'var(--font-body),sans-serif',letterSpacing:'0.12em'}}>
              {game.location ? `📍 ${game.location}` : `CODE: ${id.slice(0,6).toUpperCase()}`}
            </div>
          </div>
          <div style={{display:'flex',alignItems:'center',gap:6}}>
            {canUsePush() && (
              <button onClick={togglePush} disabled={pushLoading} title={pushEnabled?'Tap to disable notifications':'Enable push notifications'}
                style={{background:pushEnabled?'rgba(0,255,136,0.12)':'rgba(255,255,255,0.05)',
                  color:pushEnabled?'var(--green)':'var(--muted)',
                  border:`1px solid ${pushEnabled?'rgba(0,255,136,0.3)':'var(--border-sub)'}`,
                  borderRadius:2,padding:'5px 8px',cursor:'pointer',fontSize:14,minHeight:34,
                  display:'flex',alignItems:'center',WebkitTapHighlightColor:'transparent',opacity:pushLoading?0.5:1}}>
                {pushEnabled ? '🔔' : '🔕'}
              </button>
            )}
            {lastSaved&&<span style={{fontSize:10,color:'var(--faint)',fontFamily:'var(--font-body),sans-serif'}}>
              ☁ {lastSaved.toLocaleTimeString([],{hour:'numeric',minute:'2-digit'})}
            </span>}
            <button onClick={()=>setShowShare(true)}
              style={{background:'rgba(201,168,76,0.12)',color:'var(--gold)',border:'1px solid rgba(201,168,76,0.3)',borderRadius:2,
                padding:'5px 10px',cursor:'pointer',fontSize:10,fontFamily:'var(--font-body),sans-serif',letterSpacing:'0.1em',
                minHeight:34,display:'flex',alignItems:'center',gap:4,WebkitTapHighlightColor:'transparent'}}>
              ◎ SHARE
            </button>
          </div>
        </div>
      </div>

      {/* Bank Stats */}
      <div style={{background:'var(--bg2)',borderBottom:'1px solid var(--border-sub)',flexShrink:0}}>
        <div style={{maxWidth:600,margin:'0 auto',display:'grid',gridTemplateColumns:'1fr 1fr 1fr 1fr'}}>
          {[
            {l:'BUY-INS',v:fmt(totalIn),color:'var(--green)',icon:'📈'},
            {l:'CASH-OUTS',v:fmt(totalOut),color:'var(--red)',icon:'📉'},
            {l:'IN BANK',v:fmt(bank),color:'var(--white)',icon:'🏦'},
            {l:'PLAYERS',v:`${players.filter(p=>p.cashout==null).length}`,color:'var(--white)',icon:'👥'},
          ].map((s,i)=>(
            <div key={s.l} style={{padding:'8px',borderRight:i<3?'1px solid var(--border-sub)':'none',background:'var(--bg2)'}}>
              <div style={{fontSize:8,letterSpacing:'0.1em',color:'var(--muted)',fontFamily:'var(--font-body),sans-serif',fontWeight:500,marginBottom:3,whiteSpace:'nowrap',overflow:'hidden'}}>
                {s.icon} {s.l}
              </div>
              <div className="display" style={{fontSize:13,color:s.color,fontWeight:500}}>{s.v}</div>
            </div>
          ))}
        </div>
      </div>

      {/* Settled banner */}
      {isSettled&&(
        <div style={{background:'var(--bg3)',borderBottom:'1px solid var(--border)',flexShrink:0,
          display:'flex',alignItems:'center',justifyContent:'space-between',padding:'10px 16px',gap:12}}>
          <div style={{fontSize:13,color:'var(--ivory)',fontWeight:500,fontFamily:'var(--font-display),serif'}}>Game Settled ✓</div>
          <div style={{display:'flex',gap:6}}>
            {resultsUrl&&<button className="btn btn-outline" style={{fontSize:11,padding:'6px 10px'}}
              onClick={()=>navigator.clipboard.writeText(resultsUrl).then(()=>alert('Copied!'))}>RESULTS LINK</button>}
            {isHost&&<button className="btn btn-ghost" style={{fontSize:11,padding:'6px 10px',color:'var(--amber)'}}
              onClick={()=>setShowUnsettle(true)}>Unsettle</button>}
          </div>
        </div>
      )}

      {/* Transfers (settled) */}
      {isSettled&&transfers.length>0&&(
        <div style={{background:'var(--bg3)',borderBottom:'1px solid var(--border-sub)',padding:'6px 16px',flexShrink:0,overflowX:'auto',whiteSpace:'nowrap'}}>
          {transfers.map((t:any,i:number)=>(
            <span key={i} style={{fontSize:12,marginRight:16,fontFamily:'var(--font-body),sans-serif'}}>
              <span style={{color:'var(--red)'}}>{t.from_name||t.from_user}</span>
              <span style={{color:'var(--faint)',margin:'0 5px'}}>→</span>
              <span style={{color:'var(--green)'}}>{t.to_name||t.to_user}</span>
              <span style={{color:'var(--ivory)',marginLeft:6}}>{fmt(t.amount)}</span>
            </span>
          ))}
        </div>
      )}

      {/* RSVP strip */}
      {(game.status==='scheduled'||game.status==='lobby') && rsvps.length>0 && (
        <div style={{background:'var(--bg3)',borderBottom:'1px solid var(--border-sub)',padding:'6px 12px',flexShrink:0,overflowX:'auto',whiteSpace:'nowrap',display:'flex',alignItems:'center',gap:8}}>
          <span style={{fontSize:9,letterSpacing:'0.15em',color:'var(--gold-dim)',fontFamily:'var(--font-body),sans-serif',fontWeight:600,flexShrink:0}}>RSVP</span>
          {rsvps.map((r:any)=>(
            <span key={r.id} style={{fontSize:11,padding:'3px 8px',borderRadius:12,
              background:r.status==='yes'?'rgba(0,255,136,0.1)':'rgba(255,60,60,0.1)',
              color:r.status==='yes'?'var(--green)':'var(--red)',
              border:`1px solid ${r.status==='yes'?'rgba(0,255,136,0.2)':'rgba(255,60,60,0.2)'}`,
              fontFamily:'var(--font-body),sans-serif'}}>
              {r.display_name} {r.status==='no'?'✗':'✓'}
            </span>
          ))}
        </div>
      )}

      {/* TABLE */}
      <div style={{flex:1,position:'relative',overflow:'hidden',minHeight:0}}>
        <CircularTable
          seats={seatMap} totalSeats={seats} isHost={isHost} gameStatus={game.status}
          eventName={eventName} playerCount={players.length}
          activeCount={players.filter(p=>p.cashout==null).length}
          onSeatClick={(p,idx)=>{ if(p) setSelected(p); else if(isHost&&isActive) setShowSeat(true); }}
          liveUrl={liveUrl}
        />
      </div>

      {/* Host quick actions */}
      {isHost&&(
        <div style={{background:'var(--bg2)',borderTop:'1px solid var(--border-sub)',display:'flex',flexWrap:'wrap',gap:6,padding:'8px 12px',flexShrink:0,alignItems:'center'}}>
          {(game.status==='scheduled'||game.status==='lobby')&&(
            <button className="btn btn-primary" style={{fontSize:11,padding:'8px 14px'}} onClick={handleStart}>▶ Start</button>
          )}
          {isActive&&(
            <button className="btn btn-primary" style={{fontSize:11,padding:'8px 14px'}} onClick={()=>setShowSeat(true)}>+ Seat</button>
          )}
          {isActive&&players.length>0&&(
            <button className="btn btn-outline" style={{fontSize:11,padding:'8px 14px'}} onClick={()=>setShowSettle(true)}>Settle Up</button>
          )}
          <button className="btn btn-ghost" style={{fontSize:11,padding:'8px 12px'}} onClick={()=>setShowShare(true)}>
            📤 Share
          </button>
          {(game.status==='scheduled'||game.status==='lobby')&&(
            <button className="btn btn-danger" style={{fontSize:11,padding:'8px 12px',marginLeft:'auto'}}
              onClick={async()=>{ if(confirm('Delete this game?')){ try{ await api.games.delete(id); router.push(`/events/${game.event_id}`); }catch(e:any){alert(e.message);} } }}>
              Delete
            </button>
          )}
          {isActive&&(
            <button className="btn btn-danger" style={{fontSize:11,padding:'8px 12px',marginLeft:'auto'}}
              onClick={async()=>{ if(confirm('End game?')){ try{ await api.games.delete(id); router.push(`/events/${game.event_id}`); }catch(e:any){alert(e.message);} } }}>
              End
            </button>
          )}
        </div>
      )}

      {/* Bottom tab bar */}
      <div style={{background:'var(--bg2)',borderTop:'1px solid var(--border-sub)',display:'flex',flexShrink:0,zIndex:100,paddingBottom:'env(safe-area-inset-bottom)'}}>
        {[
          {label:'RESULTS',icon:'📤',action:()=>resultsUrl&&navigator.clipboard.writeText(resultsUrl).then(()=>alert('Results link copied!')),disabled:!isSettled},
          {label:'LEADERBOARD',icon:'🏆',action:()=>router.push(`/events/${game.event_id}`),disabled:false},
          {label:'SETTLE UP',icon:'🤝',action:()=>setShowSettle(true),disabled:isSettled||players.length===0||!isHost},
          {label:'LIVE LINK',icon:'📡',action:()=>liveUrl&&navigator.clipboard.writeText(liveUrl).then(()=>alert('Live link copied!')),disabled:!liveUrl||isSettled},
        ].map(b=>(
          <button key={b.label} disabled={b.disabled} onClick={b.action}
            style={{flex:1,background:'none',border:'none',padding:'10px 4px',cursor:b.disabled?'default':'pointer',
              opacity:b.disabled?0.3:1,display:'flex',flexDirection:'column',alignItems:'center',gap:3,
              WebkitTapHighlightColor:'transparent',touchAction:'manipulation',minHeight:50}}>
            <span style={{fontSize:20}}>{b.icon}</span>
            <span style={{fontSize:8,letterSpacing:'0.12em',color:'var(--muted)',fontFamily:'var(--font-body),sans-serif',fontWeight:500}}>{b.label}</span>
          </button>
        ))}
      </div>

      {/* SHARE MODAL */}
      {showShare && (
        <Overlay onClose={()=>setShowShare(false)}>
          <div className="display" style={{fontSize:18,color:'var(--white)',marginBottom:4,fontWeight:500}}>Share & Invite</div>
          <div style={{fontSize:11,color:'var(--muted)',marginBottom:20,fontFamily:'var(--font-body),sans-serif'}}>
            {eventName} · {fmtDate(game.scheduled_at)}{game.location?` · ${game.location}`:''}
          </div>

          {/* RSVP */}
          <ShareRow label="📋 RSVP Link" sub="Players confirm attendance before the game" url={lobbyUrl}
            waMsg={`🃏 *${eventName||'Poker Night'}*\n📅 ${fmtDate(game.scheduled_at)}${game.location?`\n📍 ${game.location}`:''}\n\nRSVP here: ${lobbyUrl}`}/>

          {/* Live link */}
          {liveUrl && !isSettled && (
            <ShareRow label="📡 Live Scorecard" sub="Players watch their balance update in real-time" url={liveUrl}
              waMsg={`🃏 Watch live scores for ${eventName}: ${liveUrl}`}/>
          )}

          {/* Install link */}
          <div style={{marginBottom:14,padding:'12px 14px',background:'rgba(0,255,136,0.04)',border:'1px solid rgba(0,255,136,0.15)',borderRadius:4}}>
            <div style={{fontSize:9,letterSpacing:'0.18em',color:'var(--green)',marginBottom:6,fontFamily:'var(--font-body),sans-serif',fontWeight:600,textTransform:'uppercase'}}>
              📲 Install Link — First-time players only
            </div>
            <div style={{fontSize:11,color:'var(--muted)',marginBottom:10,fontFamily:'var(--font-body),sans-serif',lineHeight:1.6}}>
              Send this to new players so they can install PKR on their phone and get push notifications for future games.
            </div>
            <ShareRow label="" sub="" url={installLink}
              waMsg={`Install PKR and join ${eventName}: ${installLink}`}/>
          </div>

          {/* Results */}
          {isSettled && resultsUrl && (
            <ShareRow label="✅ Results" sub="Share the final scoreboard" url={resultsUrl}
              waMsg={`🃏 ${eventName} results: ${resultsUrl}`}/>
          )}

          {/* Push toggle */}
          {canUsePush() && (
            <div style={{padding:'12px 14px',background:'var(--bg3)',border:'1px solid var(--border-sub)',borderRadius:4,marginBottom:14}}>
              <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',gap:12}}>
                <div>
                  <div style={{fontSize:12,color:'var(--ivory)',fontFamily:'var(--font-body),sans-serif',fontWeight:500}}>🔔 Push Notifications</div>
                  <div style={{fontSize:10,color:'var(--muted)',fontFamily:'var(--font-body),sans-serif',marginTop:2}}>
                    {pushEnabled ? 'ON — you get notified for buy-ins, cashouts & results.' : 'OFF — enable to get notified when games happen.'}
                  </div>
                </div>
                <button onClick={togglePush} disabled={pushLoading}
                  style={{padding:'7px 14px',borderRadius:2,cursor:'pointer',fontSize:12,fontWeight:600,
                    background:pushEnabled?'rgba(255,60,60,0.1)':'var(--gold)',color:pushEnabled?'var(--red)':'#000',
                    border:`1px solid ${pushEnabled?'rgba(255,60,60,0.3)':'var(--gold)'}`,
                    fontFamily:'var(--font-body),sans-serif',opacity:pushLoading?0.6:1,whiteSpace:'nowrap'}}>
                  {pushLoading ? '…' : pushEnabled ? 'Disable' : 'Enable'}
                </button>
              </div>
            </div>
          )}

          {/* iOS tip */}
          {!isPWA && iosDevice && safariOnly && (
            <div style={{padding:'10px 14px',background:'rgba(201,168,76,0.06)',border:'1px solid rgba(201,168,76,0.2)',borderRadius:4,marginBottom:14}}>
              <div style={{fontSize:11,color:'var(--gold)',fontFamily:'var(--font-body),sans-serif',fontWeight:500,marginBottom:4}}>📱 Add to Home Screen (iPhone)</div>
              <div style={{fontSize:10,color:'var(--muted)',fontFamily:'var(--font-body),sans-serif',lineHeight:1.6}}>
                Tap <strong style={{color:'var(--ivory)'}}>Share ↑</strong> → <strong style={{color:'var(--ivory)'}}>Add to Home Screen</strong> to install PKR as an app.
              </div>
            </div>
          )}

          <button className="btn btn-ghost" style={{width:'100%'}} onClick={()=>setShowShare(false)}>Done</button>
        </Overlay>
      )}

      {selectedPlayer&&(
        <PlayerDetailPanel player={selectedPlayer} gameId={id} gameStatus={game.status} isHost={isHost}
          appUrl={appUrl} liveToken={game.live_token||''} onClose={()=>setSelected(null)}
          onUpdate={()=>{ load(); setSelected(null); }} knownSeats={seatMap}/>
      )}
      {showSeat&&(
        <SeatModal gameId={id} knownPlayers={knownPlayers} onClose={()=>setShowSeat(false)} onSeated={()=>{ load(); setShowSeat(false); }}/>
      )}
      {showSettle&&(
        <SettleModal game={{...game,players}} onClose={()=>setShowSettle(false)} onDone={(r)=>{ setResult(r); setShowSettle(false); load(); }}/>
      )}
      {showUnsettle&&(
        <Overlay onClose={()=>setShowUnsettle(false)}>
          <div className="display" style={{fontSize:18,color:'var(--ivory)',marginBottom:8,fontWeight:500}}>Unsettle Game?</div>
          <p style={{fontSize:13,color:'var(--muted)',lineHeight:1.7,marginBottom:16,fontFamily:'var(--font-body),sans-serif'}}>
            This removes the settlement and unlocks the game for editing and re-settling.
          </p>
          <div style={{display:'flex',gap:8}}>
            <button className="btn btn-outline" style={{flex:1,color:'var(--amber)'}}
              onClick={async()=>{ try{ await api.games.unsettle(id); setResult(null); setShowUnsettle(false); load(); }catch(e:any){alert(e.message);} }}>
              Confirm Unsettle
            </button>
            <button className="btn btn-ghost" onClick={()=>setShowUnsettle(false)}>Cancel</button>
          </div>
        </Overlay>
      )}
    </div>
  );
}

// ─── Share row helper ───
function ShareRow({label,sub,url,waMsg}:{label:string;sub:string;url:string;waMsg:string}) {
  return (
    <div style={{marginBottom:12}}>
      {label && <div style={{fontSize:9,letterSpacing:'0.18em',color:'var(--gold-dim)',marginBottom:4,fontFamily:'var(--font-body),sans-serif',fontWeight:600,textTransform:'uppercase'}}>{label}</div>}
      {sub && <div style={{fontSize:10,color:'var(--muted)',marginBottom:8,fontFamily:'var(--font-body),sans-serif'}}>{sub}</div>}
      <div style={{background:'var(--bg3)',border:'1px solid var(--border-sub)',borderRadius:2,padding:'8px 10px',fontSize:10,color:'var(--ivory)',wordBreak:'break-all',marginBottom:8,fontFamily:'monospace',lineHeight:1.4}}>{url}</div>
      <div style={{display:'flex',gap:6}}>
        <button className="btn btn-outline" style={{flex:1,fontSize:11}} onClick={()=>navigator.clipboard.writeText(url).then(()=>alert('Copied!'))}>Copy Link</button>
        <a href={`https://wa.me/?text=${encodeURIComponent(waMsg)}`} target="_blank" rel="noopener noreferrer"
          className="btn btn-ghost" style={{flex:1,textDecoration:'none',display:'flex',alignItems:'center',justifyContent:'center',fontSize:11}}>
          📱 WhatsApp
        </a>
      </div>
    </div>
  );
}

// ─── Circular Table ───
function CircularTable({seats,totalSeats,isHost,gameStatus,eventName,playerCount,activeCount,onSeatClick,liveUrl}:{
  seats:(GamePlayer|null)[];totalSeats:number;isHost:boolean;gameStatus:string;
  eventName:string;playerCount:number;activeCount:number;
  onSeatClick:(p:GamePlayer|null,idx:number)=>void;liveUrl:string;
}) {
  const isActive = gameStatus==='active';
  const isSettled= gameStatus==='settled';
  return (
    <div style={{width:'100%',height:'100%',position:'relative',display:'flex',alignItems:'center',justifyContent:'center'}}>
      <svg viewBox="0 0 340 340" style={{width:'min(340px,calc(100vw - 16px))',height:'min(340px,calc(100dvh - 380px))',overflow:'visible'}}>
        <defs>
          <radialGradient id="feltG" cx="50%" cy="45%"><stop offset="0%" stopColor="#1e6b2a"/><stop offset="60%" stopColor="#155220"/><stop offset="100%" stopColor="#0e3a18"/></radialGradient>
          <radialGradient id="railG" cx="50%" cy="45%"><stop offset="0%" stopColor="#5a3010"/><stop offset="100%" stopColor="#3d1f08"/></radialGradient>
          <filter id="shadow"><feDropShadow dx="0" dy="4" stdDeviation="8" floodOpacity="0.5"/></filter>
        </defs>
        <ellipse cx="170" cy="170" rx="162" ry="156" fill="url(#railG)" filter="url(#shadow)"/>
        <ellipse cx="170" cy="170" rx="148" ry="143" fill="url(#feltG)"/>
        <ellipse cx="170" cy="170" rx="148" ry="143" fill="none" stroke="rgba(201,168,76,0.18)" strokeWidth="1.5"/>
        <ellipse cx="170" cy="170" rx="120" ry="116" fill="none" stroke="rgba(201,168,76,0.08)" strokeWidth="1"/>
        <text x="170" y="152" textAnchor="middle" fontFamily="serif" fontWeight="700" fontSize="28" fill="rgba(201,168,76,0.7)">♠</text>
        <text x="170" y="174" textAnchor="middle" fontFamily="serif" fontWeight="600" fontSize="11" fill="rgba(240,230,200,0.5)" letterSpacing="2">
          {eventName.slice(0,14).toUpperCase()||'THE TABLE'}
        </text>
        <text x="170" y="191" textAnchor="middle" fontFamily="sans-serif" fontSize="9" fill="rgba(107,140,110,0.8)">
          {isSettled ? '✓ SETTLED' : isActive ? `${activeCount} ACTIVE` : `${playerCount} RSVP`}
        </text>
        {seats.map((p,i)=>{
          const angle=(i/totalSeats)*2*Math.PI - Math.PI/2;
          const x=170+155*Math.cos(angle);
          const y=170+152*Math.sin(angle)*0.75;
          const net=p&&p.cashout!=null ? p.cashout-(p.buy_ins||0) : null;
          const netColor=net!=null?(net>0?'#2ecc71':net<0?'#e74c3c':'#6b8c6e'):'#6b8c6e';
          const ringColor=p?(net!=null?netColor:'rgba(201,168,76,0.5)'):'rgba(255,255,255,0.07)';
          const bgColor=p?(p.cashout!=null?'#1a2a1c':'#132a14'):'#0d1f10';
          return (
            <g key={i} onClick={()=>onSeatClick(p,i)} style={{cursor:p||(isHost&&isActive)?'pointer':'default'}}>
              <circle cx={x} cy={y} r="22" fill={bgColor} stroke={ringColor} strokeWidth={p?2:1}/>
              {p ? (
                <>
                  <text x={x} y={y-5} textAnchor="middle" fontFamily="sans-serif" fontWeight="600"
                    fontSize={p.display_name.length>7?7:8.5} fill={p.cashout!=null?"rgba(240,230,200,0.5)":"rgba(240,230,200,0.9)"}>
                    {p.display_name.slice(0,8)}
                  </text>
                  {net!=null ? (
                    <text x={x} y={y+8} textAnchor="middle" fontFamily="monospace" fontWeight="700" fontSize="8" fill={netColor}>
                      {net>0?'+':''}{(net/100).toFixed(0)}
                    </text>
                  ) : (
                    <text x={x} y={y+8} textAnchor="middle" fontFamily="monospace" fontSize="7" fill="rgba(201,168,76,0.6)">×{p.buy_ins||1}</text>
                  )}
                </>
              ) : (
                <text x={x} y={y+4} textAnchor="middle" fontFamily="sans-serif" fontSize="16"
                  fill={isHost&&isActive?"rgba(201,168,76,0.3)":"rgba(255,255,255,0.04)"}>
                  {isHost&&isActive?'+':''}
                </text>
              )}
            </g>
          );
        })}
      </svg>
    </div>
  );
}

// ─── Player Detail Panel ───
function PlayerDetailPanel({player,gameId,gameStatus,isHost,appUrl,liveToken,onClose,onUpdate,knownSeats}:{
  player:GamePlayer;gameId:string;gameStatus:string;isHost:boolean;
  appUrl:string;liveToken:string;onClose:()=>void;onUpdate:()=>void;knownSeats:(GamePlayer|null)[];
}) {
  const [cashoutAmt, setCashoutAmt] = useState(player.cashout!=null?(player.cashout/100).toFixed(0):'');
  const [saving,setSaving] = useState(false);
  const net = player.cashout!=null ? player.cashout-(player.buy_ins||0) : null;
  const netColor = net!=null?(net>0?'var(--green)':net<0?'var(--red)':'var(--muted)'):'var(--muted)';
  const isActive = gameStatus==='active';
  const playerLiveUrl = liveToken ? `${appUrl}/games/live/${liveToken}?player=${encodeURIComponent(player.display_name)}` : '';
  const qrUrl = playerLiveUrl ? `https://api.qrserver.com/v1/create-qr-code/?size=160x160&data=${encodeURIComponent(playerLiveUrl)}&bgcolor=0d1f10&color=c9a84c&margin=6` : '';

  async function addBuyin() {
    setSaving(true);
    try { await api.games.buyin(gameId,player.user_id); onUpdate(); }
    catch(e:any){ alert(e.message); } finally { setSaving(false); }
  }
  async function saveCashout() {
    const val=parseFloat(cashoutAmt);
    if(isNaN(val)||val<0){alert('Enter a valid amount');return;}
    setSaving(true);
    try { await api.games.cashout(gameId,player.user_id,Math.round(val*100)); onUpdate(); }
    catch(e:any){ alert(e.message); } finally { setSaving(false); }
  }
  async function removePlayer() {
    if(!confirm(`Remove ${player.display_name}?`))return;
    setSaving(true);
    try { await api.games.removeSeat(gameId,player.user_id); onUpdate(); }
    catch(e:any){ alert(e.message); } finally { setSaving(false); }
  }

  return (
    <div style={{position:'fixed',inset:0,background:'rgba(0,0,0,0.75)',zIndex:200,display:'flex',flexDirection:'column',justifyContent:'flex-end'}}
      onClick={e=>{if(e.target===e.currentTarget)onClose();}}>
      <div style={{background:'var(--bg2)',borderTop:'1px solid var(--border-sub)',borderRadius:'12px 12px 0 0',
        padding:'20px',maxHeight:'82dvh',overflowY:'auto',paddingBottom:'calc(20px + env(safe-area-inset-bottom))'}}>

        <div style={{display:'flex',alignItems:'center',gap:12,marginBottom:16}}>
          <div style={{width:44,height:44,borderRadius:'50%',background:'linear-gradient(135deg,var(--gold-dim),var(--bg3))',
            display:'flex',alignItems:'center',justifyContent:'center',fontSize:16,fontWeight:700,color:'var(--gold)',fontFamily:'var(--font-display),serif',flexShrink:0}}>
            {player.display_name.slice(0,2).toUpperCase()}
          </div>
          <div style={{flex:1}}>
            <div style={{fontSize:16,color:'var(--white)',fontFamily:'var(--font-display),serif',fontWeight:600}}>{player.display_name}</div>
            <div style={{fontSize:11,color:'var(--muted)',fontFamily:'var(--font-body),sans-serif',marginTop:2}}>
              Seat {player.seat_number||'?'} · {player.buy_ins||1} buy-in{(player.buy_ins||1)>1?'s':''}
              {net!=null && <span style={{color:netColor,marginLeft:6}}>{net>0?'+':''}{(net/100).toFixed(0)}</span>}
            </div>
          </div>
          <button onClick={onClose} style={{background:'none',border:'none',color:'var(--muted)',fontSize:24,cursor:'pointer',padding:4}}>×</button>
        </div>

        <div style={{display:'grid',gridTemplateColumns:'1fr 1fr 1fr',gap:6,marginBottom:16}}>
          {[
            {l:'BUY-INS',v:`×${player.buy_ins||1}`,c:'var(--white)'},
            {l:'CASHOUT',v:player.cashout!=null?`$${(player.cashout/100).toFixed(0)}`:'—',c:'var(--ivory)'},
            {l:'NET',v:net!=null?(net>0?'+':'')+(net/100).toFixed(0)+'':'—',c:netColor},
          ].map(s=>(
            <div key={s.l} style={{background:'var(--bg3)',border:'1px solid var(--border-sub)',borderRadius:4,padding:'8px',textAlign:'center'}}>
              <div style={{fontSize:15,color:s.c,fontFamily:'var(--font-display),serif',fontWeight:600}}>{s.v}</div>
              <div style={{fontSize:8,color:'var(--faint)',letterSpacing:'0.1em',fontFamily:'var(--font-body),sans-serif',marginTop:2}}>{s.l}</div>
            </div>
          ))}
        </div>

        {isHost && isActive && (
          <>
            <button className="btn btn-outline" style={{width:'100%',fontSize:12,marginBottom:10}} disabled={saving} onClick={addBuyin}>
              + Add Buy-in (now at ×{player.buy_ins||1} → ×{(player.buy_ins||1)+1})
            </button>
            <div style={{marginBottom:14}}>
              <div style={{fontSize:9,letterSpacing:'0.15em',color:'var(--muted)',marginBottom:8,fontFamily:'var(--font-body),sans-serif',fontWeight:600,textTransform:'uppercase'}}>Cashout Amount ($)</div>
              <div style={{display:'flex',gap:8}}>
                <input type="number" inputMode="decimal" placeholder="0.00" value={cashoutAmt}
                  onChange={e=>setCashoutAmt(e.target.value)} className="inp" style={{flex:1,fontSize:16}}/>
                <button className="btn btn-primary" style={{fontSize:12,padding:'8px 14px'}} disabled={saving||!cashoutAmt} onClick={saveCashout}>
                  {saving?'…':'Save'}
                </button>
              </div>
            </div>
          </>
        )}

        {playerLiveUrl && gameStatus==='active' && (
          <div style={{marginBottom:14,padding:'12px',background:'var(--bg3)',border:'1px solid var(--border-sub)',borderRadius:4}}>
            <div style={{fontSize:9,letterSpacing:'0.15em',color:'var(--gold-dim)',marginBottom:10,fontFamily:'var(--font-body),sans-serif',fontWeight:600,textTransform:'uppercase'}}>
              📡 {player.display_name}'s Live Balance
            </div>
            <div style={{display:'flex',gap:10,alignItems:'flex-start'}}>
              {qrUrl&&<img src={qrUrl} alt="QR" style={{width:72,height:72,borderRadius:4,flexShrink:0,background:'#fff',padding:2}}/>}
              <div style={{flex:1}}>
                <div style={{fontSize:10,color:'var(--ivory)',wordBreak:'break-all',fontFamily:'monospace',marginBottom:8,lineHeight:1.4}}>{playerLiveUrl}</div>
                <div style={{display:'flex',gap:6}}>
                  <button className="btn btn-ghost" style={{fontSize:10,flex:1}} onClick={()=>navigator.clipboard.writeText(playerLiveUrl).then(()=>alert('Copied!'))}>Copy</button>
                  {player.whatsapp&&(
                    <a href={waLink(player.whatsapp,`Hi ${player.display_name}! Your PKR live balance: ${playerLiveUrl}`)}
                      target="_blank" rel="noopener noreferrer" className="btn btn-ghost"
                      style={{fontSize:10,flex:1,textDecoration:'none',display:'flex',alignItems:'center',justifyContent:'center'}}>📱 WA</a>
                  )}
                </div>
              </div>
            </div>
          </div>
        )}

        {player.whatsapp&&(
          <a href={`https://wa.me/${player.whatsapp.replace(/\D/g,'')}`} target="_blank" rel="noopener noreferrer"
            className="btn btn-ghost" style={{width:'100%',fontSize:11,display:'flex',alignItems:'center',justifyContent:'center',gap:6,textDecoration:'none',marginBottom:8}}>
            📞 WhatsApp {player.display_name}
          </a>
        )}

        {isHost && isActive && (
          <button className="btn btn-ghost" style={{width:'100%',fontSize:11,color:'var(--red)'}} onClick={removePlayer} disabled={saving}>
            Remove from game
          </button>
        )}
      </div>
    </div>
  );
}

// ─── Seat Modal ───
function SeatModal({gameId,knownPlayers,onClose,onSeated}:{gameId:string;knownPlayers:EventPlayer[];onClose:()=>void;onSeated:()=>void;}) {
  const [name,setName]=useState('');
  const [wa,setWa]=useState('');
  const [saving,setSaving]=useState(false);
  async function seat() {
    if(!name.trim())return;
    setSaving(true);
    try { await api.games.seat(gameId,{display_name:name.trim(),whatsapp:wa||undefined}); onSeated(); }
    catch(e:any){alert(e.message);} finally{setSaving(false);}
  }
  return (
    <Overlay onClose={onClose}>
      <div className="display" style={{fontSize:18,color:'var(--white)',marginBottom:16,fontWeight:500}}>Seat Player</div>
      {knownPlayers.length>0&&(
        <div style={{marginBottom:12}}>
          <div style={{fontSize:9,letterSpacing:'0.15em',color:'var(--muted)',marginBottom:8,fontFamily:'var(--font-body),sans-serif',fontWeight:600,textTransform:'uppercase'}}>Quick Select</div>
          <div style={{display:'flex',flexWrap:'wrap',gap:6,maxHeight:90,overflowY:'auto'}}>
            {knownPlayers.map(kp=>(
              <button key={kp.id} onClick={()=>{setName(kp.display_name);setWa(kp.whatsapp||'');}}
                style={{padding:'5px 10px',borderRadius:2,cursor:'pointer',fontSize:11,
                  background:name===kp.display_name?'var(--gold)':'var(--bg3)',color:name===kp.display_name?'#0e0e0f':'var(--muted)',
                  border:`1px solid ${name===kp.display_name?'var(--gold)':'var(--border-sub)'}`,fontFamily:'var(--font-body),sans-serif'}}>
                {kp.display_name}
              </button>
            ))}
          </div>
        </div>
      )}
      <div style={{display:'grid',gap:10,marginBottom:14}}>
        <div>
          <div style={{fontSize:9,letterSpacing:'0.15em',color:'var(--muted)',marginBottom:6,fontFamily:'var(--font-body),sans-serif',fontWeight:600,textTransform:'uppercase'}}>Name *</div>
          <input className="inp" placeholder="Player name" value={name} onChange={e=>setName(e.target.value)} onKeyDown={e=>e.key==='Enter'&&seat()} autoFocus/>
        </div>
        <div>
          <div style={{fontSize:9,letterSpacing:'0.15em',color:'var(--muted)',marginBottom:6,fontFamily:'var(--font-body),sans-serif',fontWeight:600,textTransform:'uppercase'}}>WhatsApp (optional)</div>
          <input className="inp" placeholder="+61 400 000 000" type="tel" value={wa} onChange={e=>setWa(e.target.value)}/>
        </div>
      </div>
      <div style={{display:'flex',gap:8}}>
        <button className="btn btn-primary" style={{flex:1}} disabled={!name.trim()||saving} onClick={seat}>{saving?'Seating…':'Seat Player'}</button>
        <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
      </div>
    </Overlay>
  );
}

// ─── Settle Modal ───
function SettleModal({game,onClose,onDone}:{game:any;onClose:()=>void;onDone:(r:any)=>void}) {
  const [cashouts,setCashouts]=useState<Record<string,string>>(()=>{
    const m:Record<string,string>={};
    (game.players||[]).forEach((p:any)=>{ if(p.cashout!=null) m[p.user_id]=(p.cashout/100).toFixed(0); });
    return m;
  });
  const [saving,setSaving]=useState(false);
  async function settle() {
    const results=(game.players||[]).map((p:any)=>({
      user_id:p.user_id,display_name:p.display_name,
      buy_ins:(p.buy_ins||1)*(game.buy_in||0),
      cashout:Math.round(parseFloat(cashouts[p.user_id]||'0')*100),
    }));
    setSaving(true);
    try { const r=await api.games.settle(game.id,{idempotency_key:`${game.id}_${Date.now()}`,results}); onDone(r); }
    catch(e:any){alert(e.message);} finally{setSaving(false);}
  }
  return (
    <Overlay onClose={onClose}>
      <div className="display" style={{fontSize:18,color:'var(--white)',marginBottom:4,fontWeight:500}}>Settle Up</div>
      <div style={{fontSize:11,color:'var(--muted)',marginBottom:16,fontFamily:'var(--font-body),sans-serif'}}>Enter each player's cashout amount in dollars</div>
      <div style={{display:'grid',gap:10,marginBottom:16,maxHeight:'50dvh',overflowY:'auto'}}>
        {(game.players||[]).map((p:any)=>(
          <div key={p.user_id} style={{display:'flex',alignItems:'center',gap:10}}>
            <div style={{flex:1}}>
              <div style={{fontSize:13,color:'var(--ivory)',fontFamily:'var(--font-display),serif',fontWeight:500}}>{p.display_name}</div>
              <div style={{fontSize:10,color:'var(--muted)',fontFamily:'var(--font-body),sans-serif'}}>×{p.buy_ins||1} buy-in{(p.buy_ins||1)>1?'s':''}</div>
            </div>
            <div style={{display:'flex',alignItems:'center',gap:4}}>
              <span style={{fontSize:12,color:'var(--muted)'}}>$</span>
              <input type="number" inputMode="decimal" placeholder="0" className="inp" style={{width:80,textAlign:'right',fontSize:14}}
                value={cashouts[p.user_id]||''} onChange={e=>setCashouts(c=>({...c,[p.user_id]:e.target.value}))}/>
            </div>
          </div>
        ))}
      </div>
      <div style={{display:'flex',gap:8}}>
        <button className="btn btn-primary" style={{flex:1}} disabled={saving} onClick={settle}>{saving?'Settling…':'Confirm & Settle'}</button>
        <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
      </div>
    </Overlay>
  );
}

// ─── Overlay ───
function Overlay({children,onClose}:{children:React.ReactNode;onClose:()=>void}) {
  return (
    <div style={{position:'fixed',inset:0,background:'rgba(0,0,0,0.75)',zIndex:200,display:'flex',flexDirection:'column',justifyContent:'flex-end'}}
      onClick={e=>{if(e.target===e.currentTarget)onClose();}}>
      <div style={{background:'var(--bg2)',borderTop:'1px solid var(--border-sub)',borderRadius:'12px 12px 0 0',
        padding:'24px 20px',maxHeight:'85dvh',overflowY:'auto',paddingBottom:'calc(24px + env(safe-area-inset-bottom))'}}>
        {children}
      </div>
    </div>
  );
}
