'use client';
import { useEffect, useState, useCallback } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { api, GameDetail, GamePlayer, EventPlayer, fmtDate, fmt, fmtSign, waLink } from '@/lib/api';

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
  const appUrl = typeof window !== 'undefined' ? window.location.origin : '';

  const load = useCallback(async()=>{
    try {
      const [g,u] = await Promise.all([api.games.get(id),api.auth.me()]);
      const safeGame = { ...g, players:g.players||[], rsvps:g.rsvps||[], transfers:(g as any).transfers||[] };
      setGame(safeGame);
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
    let lastLoad = Date.now();
    const INTERVAL = 30000;
    function tick() {
      if (document.visibilityState !== 'hidden') { load(); lastLoad = Date.now(); }
    }
    function onVisible() {
      if (document.visibilityState === 'visible' && Date.now() - lastLoad > INTERVAL) {
        load(); lastLoad = Date.now();
      }
    }
    const timer = setInterval(tick, INTERVAL);
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('online', tick);
    return ()=>{ clearInterval(timer); document.removeEventListener('visibilitychange',onVisible); window.removeEventListener('online',tick); };
  },[load]);

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
  const transfers = (game as any).transfers||[];
  const totalIn   = players.reduce((s,p)=>s+(p.buy_ins||0),0);
  const totalOut  = players.reduce((s,p)=>s+(p.cashout||0),0);
  const bank      = totalIn - totalOut;
  const isSettled = game.status==='settled';
  const isActive  = game.status==='active';
  const liveUrl   = game.live_token    ? `${appUrl}/games/live/${game.live_token}` : '';
  const resultsUrl= game.results_token ? `${appUrl}/games/results/${game.results_token}` : '';
  const lobbyUrl  = `${appUrl}/games/${id}/lobby`;

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

  // ── The entire page is a fixed-height flex column, NO scrolling ──
  return (
    <div style={{
      height:'100dvh',
      display:'flex', flexDirection:'column',
      background:'var(--bg)',
      overflow:'hidden',
      // iOS safe areas
      paddingTop:'env(safe-area-inset-top)',
    }}>

      {/* Header */}
      <div style={{background:'var(--bg2)',borderBottom:'1px solid var(--border-sub)',
        flexShrink:0,zIndex:50}}>
        <div style={{maxWidth:600,margin:'0 auto',padding:'0 16px',height:52,
          display:'flex',alignItems:'center',gap:10}}>
          <button onClick={()=>router.push(`/events/${game.event_id}`)} style={{
            background:'none',border:'none',color:'var(--muted)',cursor:'pointer',
            fontSize:20,padding:'4px 8px',lineHeight:1,minHeight:44,display:'flex',alignItems:'center'}}>‹</button>
          <div style={{flex:1}}>
            <div style={{fontSize:13,color:'var(--gold)',fontFamily:'var(--font-display),serif',fontWeight:700,letterSpacing:'0.02em'}}>
              {eventName||fmtDate(game.scheduled_at)}
            </div>
            <div style={{fontSize:10,color:'var(--muted)',fontFamily:'var(--font-body),sans-serif',letterSpacing:'0.12em'}}>
              CODE: {id.slice(0,6).toUpperCase()}
            </div>
          </div>
          <div style={{display:'flex',alignItems:'center',gap:8}}>
            {lastSaved&&<span style={{fontSize:10,color:'var(--faint)',fontFamily:'var(--font-body),sans-serif'}}>
              ☁ {lastSaved.toLocaleTimeString([],{hour:'numeric',minute:'2-digit'})}
            </span>}
            <button onClick={()=>{
              const url = lobbyUrl;
              if(navigator.share) navigator.share({url,title:'Join the game'});
              else navigator.clipboard.writeText(url).then(()=>alert('Link copied!'));
            }} style={{background:'rgba(201,168,76,0.12)',color:'var(--gold)',
              border:'1px solid rgba(201,168,76,0.3)',borderRadius:2,
              padding:'5px 10px',cursor:'pointer',fontSize:10,fontFamily:'var(--font-body),sans-serif',
              letterSpacing:'0.1em',minHeight:34,display:'flex',alignItems:'center',gap:4,
              WebkitTapHighlightColor:'transparent'}}>
              ◎ SHARE
            </button>
          </div>
        </div>
      </div>

      {/* Bank Summary bar */}
      <div style={{background:'var(--bg2)',borderBottom:'1px solid var(--border-sub)',flexShrink:0}}>
        <div style={{maxWidth:600,margin:'0 auto',padding:'7px 16px',
          display:'flex',alignItems:'center',gap:8}}>
          <span style={{fontSize:15}}>💳</span>
          <span style={{fontSize:13,color:'var(--ivory)',fontFamily:'var(--font-display),serif',fontWeight:500,flex:1}}>Bank Summary</span>
          <span style={{fontSize:13,color:'var(--green)',fontFamily:'var(--font-body),sans-serif',fontWeight:500}}>{fmt(totalIn)} in</span>
          <span style={{fontSize:12,color:'var(--faint)'}}>·</span>
          <span style={{fontSize:13,color:bank>0?'var(--amber)':'var(--muted)',fontFamily:'var(--font-body),sans-serif',fontWeight:500}}>{fmt(bank)} bank</span>
          {bank>0?<span style={{color:'var(--amber)',fontSize:11}}>▲</span>:<span style={{color:'var(--muted)',fontSize:11}}>▼</span>}
        </div>
        {/* Stats row */}
        <div style={{maxWidth:600,margin:'0 auto',display:'grid',gridTemplateColumns:'1fr 1fr 1fr 1fr',
          borderTop:'1px solid var(--border-sub)'}}>
          {[
            {l:'TOTAL BUY-INS',v:fmt(totalIn),color:'var(--green)',icon:'📈'},
            {l:'CASH-OUTS',v:fmt(totalOut),color:'var(--red)',icon:'📉'},
            {l:'IN BANK',v:fmt(bank),sub:'on table',color:'var(--white)',icon:'🏦'},
            {l:'STATUS',v:`${players.filter(p=>p.cashout==null).length} Active`,color:'var(--white)',icon:'⚡'},
          ].map((s,i)=>(
            <div key={s.l} style={{padding:'7px 8px',borderRight:i<3?'1px solid var(--border-sub)':'none',background:'var(--bg2)'}}>
              <div style={{fontSize:8,letterSpacing:'0.1em',color:'var(--muted)',
                fontFamily:'var(--font-body),sans-serif',fontWeight:500,marginBottom:3,
                whiteSpace:'nowrap',overflow:'hidden'}}>
                {s.icon} {s.l}
              </div>
              <div className="display" style={{fontSize:13,color:s.color,fontWeight:500}}>{s.v}</div>
              {s.sub&&<div style={{fontSize:8,color:'var(--faint)',fontFamily:'var(--font-body),sans-serif'}}>{s.sub}</div>}
            </div>
          ))}
        </div>
      </div>

      {/* Settled banner (only when settled) */}
      {isSettled&&(
        <div style={{background:'var(--bg3)',borderBottom:'1px solid var(--border)',flexShrink:0,
          display:'flex',alignItems:'center',justifyContent:'space-between',padding:'10px 16px',gap:12}}>
          <div style={{fontSize:13,color:'var(--ivory)',fontWeight:500,fontFamily:'var(--font-display),serif'}}>Game Settled ✓</div>
          <div style={{display:'flex',gap:6}}>
            {resultsUrl&&<button className="btn btn-outline" style={{fontSize:11,padding:'6px 10px'}}
              onClick={()=>navigator.clipboard.writeText(resultsUrl).then(()=>alert('Copied!'))}>COPY RESULTS</button>}
            {isHost&&<button className="btn btn-ghost" style={{fontSize:11,padding:'6px 10px',color:'var(--amber)'}}
              onClick={()=>setShowUnsettle(true)}>Unsettle</button>}
          </div>
        </div>
      )}

      {/* Transfers row (settled only, compact) */}
      {isSettled&&transfers.length>0&&(
        <div style={{background:'var(--bg3)',borderBottom:'1px solid var(--border-sub)',
          padding:'6px 16px',flexShrink:0,overflowX:'auto',whiteSpace:'nowrap'}}>
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

      {/* TABLE — flex:1 means it fills ALL remaining space */}
      <div style={{flex:1,position:'relative',overflow:'hidden',minHeight:0}}>
        <CircularTable
          seats={seatMap}
          totalSeats={seats}
          isHost={isHost}
          gameStatus={game.status}
          eventName={eventName}
          playerCount={players.length}
          activeCount={players.filter(p=>p.cashout==null).length}
          onSeatClick={(p,idx)=>{ if(p) setSelected(p); else if(isHost&&isActive) setShowSeat(true); }}
          liveUrl={liveUrl}
        />
      </div>

      {/* Watch Live — shown to non-host players when game is active */}
      {!isHost&&isActive&&liveUrl&&(
        <div style={{background:'var(--bg2)',borderTop:'1px solid var(--border-sub)',
          padding:'10px 12px',display:'flex',alignItems:'center',gap:10}}>
          <a href={liveUrl} target="_blank" rel="noopener noreferrer"
            className="btn btn-primary" style={{flex:1,textAlign:'center',textDecoration:'none',
              fontSize:13,padding:'10px 14px',display:'block'}}>
            🎰 Watch Live Table
          </a>
        </div>
      )}

      {/* Host quick actions (compact, above tab bar) */}
      {isHost&&(
        <div style={{background:'var(--bg2)',borderTop:'1px solid var(--border-sub)',
          display:'flex',flexWrap:'wrap',gap:6,padding:'8px 12px',flexShrink:0,
          alignItems:'center'}}>
          {(game.status==='scheduled'||game.status==='lobby')&&(
            <button className="btn btn-primary" style={{fontSize:11,padding:'8px 14px'}} onClick={handleStart}>▶ Start</button>
          )}
          {isActive&&(
            <button className="btn btn-primary" style={{fontSize:11,padding:'8px 14px'}} onClick={()=>setShowSeat(true)}>+ Seat Player</button>
          )}
          {isActive&&players.length>0&&(
            <button className="btn btn-outline" style={{fontSize:11,padding:'8px 14px'}} onClick={()=>setShowSettle(true)}>Settle Up</button>
          )}
          <button className="btn btn-ghost" style={{fontSize:11,padding:'8px 12px'}}
            onClick={()=>navigator.clipboard.writeText(lobbyUrl).then(()=>alert('RSVP link copied!'))}>
            RSVP
          </button>
          {(game.status==='scheduled'||game.status==='lobby')&&(
            <button className="btn btn-danger" style={{fontSize:11,padding:'8px 12px',marginLeft:'auto'}}
              onClick={async()=>{ if(confirm('Delete this scheduled game? This cannot be undone.')){ try{ await api.games.delete(id); router.push(`/events/${game.event_id}`); }catch(e:any){alert(e.message);} } }}>
              Delete
            </button>
          )}
          {isActive&&(
            <button className="btn btn-danger" style={{fontSize:11,padding:'8px 12px',marginLeft:'auto'}}
              onClick={async()=>{ if(confirm('End game? Make sure you have settled up first.')){ try{ await api.games.delete(id); router.push(`/events/${game.event_id}`); }catch(e:any){alert(e.message);} } }}>
              End
            </button>
          )}
        </div>
      )}

      {/* Bottom tab bar — with safe area inset */}
      <div style={{background:'var(--bg2)',borderTop:'1px solid var(--border-sub)',
        display:'flex',flexShrink:0,zIndex:100,
        paddingBottom:'env(safe-area-inset-bottom)'}}>
        {[
          {label:'PUBLISH',icon:'📤',action:()=>resultsUrl&&navigator.clipboard.writeText(resultsUrl).then(()=>alert('Copied!')),disabled:!isSettled},
          {label:'LEADERBOARD',icon:'🏆',action:()=>router.push(`/events/${game.event_id}?tab=leaderboard`),disabled:false},
          {label:'SETTLE UP',icon:'🤝',action:()=>setShowSettle(true),disabled:isSettled||players.length===0||!isHost},
          {label:'END GAME',icon:'🏁',action:()=>setShowUnsettle(true),disabled:!isSettled},
        ].map(b=>(
          <button key={b.label} disabled={b.disabled} onClick={b.action}
            style={{flex:1,background:'none',border:'none',padding:'10px 4px',cursor:b.disabled?'default':'pointer',
              opacity:b.disabled?0.3:1,display:'flex',flexDirection:'column',alignItems:'center',gap:3,
              WebkitTapHighlightColor:'transparent',touchAction:'manipulation',minHeight:50}}>
            <span style={{fontSize:20}}>{b.icon}</span>
            <span style={{fontSize:8,letterSpacing:'0.12em',color:'var(--muted)',
              fontFamily:'var(--font-body),sans-serif',fontWeight:500}}>{b.label}</span>
          </button>
        ))}
      </div>

      {/* Player Detail Panel */}
      {selectedPlayer&&(
        <PlayerDetailPanel
          player={selectedPlayer}
          gameId={id}
          gameStatus={game.status}
          isHost={isHost}
          appUrl={appUrl}
          liveToken={game.live_token||''}
          onClose={()=>setSelected(null)}
          onUpdate={()=>{ load(); setSelected(null); }}
          knownSeats={seatMap}
        />
      )}

      {/* Seat modal */}
      {showSeat&&(
        <SeatModal gameId={id} knownPlayers={knownPlayers}
          onClose={()=>setShowSeat(false)}
          onSeated={()=>{ load(); setShowSeat(false); }}/>
      )}

      {/* Settle modal */}
      {showSettle&&(
        <SettleModal game={{...game,players}} onClose={()=>setShowSettle(false)}
          onDone={(r)=>{ setResult(r); setShowSettle(false); load(); }}/>
      )}

      {/* Unsettle confirm */}
      {showUnsettle&&(
        <Overlay onClose={()=>setShowUnsettle(false)}>
          <div className="display" style={{fontSize:18,color:'var(--ivory)',marginBottom:8,fontWeight:500}}>Unsettle Game?</div>
          <p style={{fontSize:13,color:'var(--muted)',lineHeight:1.7,marginBottom:16,fontFamily:'var(--font-body),sans-serif'}}>
            This removes the settlement and unlocks the game for re-settling.
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

// ── Circular Table (SVG, fills its container) ──────────────────────
function CircularTable({seats,totalSeats,isHost,gameStatus,eventName,playerCount,activeCount,onSeatClick,liveUrl}:{
  seats:(GamePlayer|null)[];totalSeats:number;isHost:boolean;gameStatus:string;
  eventName:string;playerCount:number;activeCount:number;
  onSeatClick:(p:GamePlayer|null,idx:number)=>void;liveUrl:string;
}) {
  const canAdd = isHost && gameStatus==='active';
  // SVG viewport: seats go 0–360 wide, 0–340 tall
  // Table ellipse centred at (180,170)
  const cx=180, cy=165;

  return (
    <div style={{width:'100%',height:'100%',display:'flex',flexDirection:'column',
      alignItems:'center',justifyContent:'center',gap:4}}>
      <svg viewBox="0 0 360 330"
        style={{width:'100%',height:'100%',maxWidth:420,maxHeight:'100%',display:'block'}}>

        {/* Felt table */}
        <ellipse cx={cx} cy={cy} rx={138} ry={108} fill="#0d1f14" stroke="#1a3a22" strokeWidth={3}/>
        <ellipse cx={cx} cy={cy} rx={123} ry={94} fill="#0f2416" stroke="rgba(201,168,76,0.12)" strokeWidth={1}/>
        {/* Table label */}
        <text x={cx} y={cy-6} textAnchor="middle" fill="rgba(201,168,76,0.22)"
          style={{fontSize:26,fontWeight:700,fontFamily:'serif',letterSpacing:4}}>
          {eventName ? eventName.slice(0,8).toUpperCase() : 'PKR'}
        </text>
        <text x={cx} y={cy+12} textAnchor="middle" fill="rgba(201,168,76,0.12)"
          style={{fontSize:8,fontFamily:'sans-serif',letterSpacing:5}}>
          {activeCount} active · {playerCount} seated
        </text>

        {/* Seats around the ellipse */}
        {seats.map((p,i)=>{
          const angle = (i/totalSeats)*2*Math.PI - Math.PI/2;
          const x = cx + 155*Math.cos(angle);
          const y = cy + 152*Math.sin(angle)*0.75;
          const net = p&&p.cashout!=null ? p.cashout-(p.buy_ins||0) : null;
          const netColor = net==null?'none':net>0?'#22c55e':net<0?'#ef4444':'#888';
          const ringColor = p ? (net!=null?netColor:'rgba(201,168,76,0.5)') : 'rgba(255,255,255,0.07)';

          return (
            <g key={i} style={{cursor:'pointer'}} onClick={()=>onSeatClick(p,i)}>
              {/* Tap target (larger invisible area) */}
              <circle cx={x} cy={y} r={32} fill="transparent"/>
              {/* Visible seat */}
              <circle cx={x} cy={y} r={22} fill={p?'#1c3022':'#111a14'} stroke={ringColor} strokeWidth={p?2:1}/>
              {p ? (
                <>
                  <text x={x} y={y-2} textAnchor="middle" dominantBaseline="middle"
                    fill={net!=null?netColor:'rgba(201,168,76,0.85)'}
                    style={{fontSize:11,fontWeight:700,fontFamily:'serif'}}>
                    {p.display_name.slice(0,2).toUpperCase()}
                  </text>
                  <text x={x} y={y+10} textAnchor="middle"
                    fill="rgba(255,255,255,0.3)" style={{fontSize:7,fontFamily:'sans-serif'}}>
                    ×{p.buy_ins}
                  </text>
                  {net!=null&&(
                    <text x={x} y={y+29} textAnchor="middle"
                      fill={netColor} style={{fontSize:9,fontWeight:600,fontFamily:'sans-serif'}}>
                      {net>=0?'+':''}{(net/100).toFixed(0)}
                    </text>
                  )}
                  <text x={x} y={y+(net!=null?41:34)} textAnchor="middle"
                    fill="rgba(255,255,255,0.4)" style={{fontSize:8,fontFamily:'sans-serif'}}>
                    {p.display_name.split(' ')[0].slice(0,7)}
                  </text>
                </>
              ) : (
                <>
                  {canAdd&&<text x={x} y={y} textAnchor="middle" dominantBaseline="middle"
                    fill="rgba(255,255,255,0.18)" style={{fontSize:20}}>+</text>}
                  <text x={x} y={y+32} textAnchor="middle"
                    fill="rgba(255,255,255,0.1)" style={{fontSize:8,fontFamily:'sans-serif'}}>
                    Seat {i+1}
                  </text>
                </>
              )}
            </g>
          );
        })}
      </svg>
    </div>
  );
}

// ── Player Detail Panel ─────────────────────────────────────────────
function PlayerDetailPanel({player,gameId,gameStatus,isHost,appUrl,liveToken,onClose,onUpdate,knownSeats}:{
  player:GamePlayer;gameId:string;gameStatus:string;isHost:boolean;
  appUrl:string;liveToken:string;onClose:()=>void;onUpdate:()=>void;
  knownSeats:(GamePlayer|null)[];
}) {
  const [buyinAmt, setBuyinAmt] = useState('');
  const [cashoutAmt, setCashoutAmt] = useState(
    player.cashout!=null ? (player.cashout/100).toFixed(2) : ''
  );
  const [saving, setSaving] = useState(false);
  const isActive = gameStatus==='active';
  const net = player.cashout!=null ? player.cashout-(player.buy_ins||0) : null;
  const playerLiveUrl = liveToken
    ? `${appUrl}/games/live/${liveToken}?player=${encodeURIComponent(player.display_name)}`
    : '';
  const qrUrl = playerLiveUrl
    ? `https://api.qrserver.com/v1/create-qr-code/?size=180x180&data=${encodeURIComponent(playerLiveUrl)}&bgcolor=ffffff&color=000000&margin=4`
    : '';

  async function addBuyin() {
    setSaving(true);
    try { await api.games.buyin(gameId,player.user_id); onUpdate(); }
    catch(e:any){ alert(e.message); setSaving(false); }
  }
  async function saveCashout() {
    const cents = Math.round(parseFloat(cashoutAmt)*100);
    if(isNaN(cents)||cents<0){ alert('Enter a valid amount'); return; }
    setSaving(true);
    try { await api.games.cashout(gameId,player.user_id,cents); onUpdate(); }
    catch(e:any){ alert(e.message); setSaving(false); }
  }
  async function removePlayer() {
    if(!confirm(`Remove ${player.display_name} from the game?`)) return;
    try { await api.games.removeSeat(gameId,player.user_id); onUpdate(); }
    catch(e:any){ alert(e.message); }
  }

  return (
    <div className="modal-overlay" onClick={e=>{if(e.target===e.currentTarget)onClose();}}>
      <div className="modal-sheet" style={{
        maxHeight:'88dvh',overflowY:'auto',
        paddingBottom:'calc(32px + env(safe-area-inset-bottom))'}}>

        {/* Header */}
        <div style={{display:'flex',alignItems:'center',gap:12,marginBottom:20}}>
          <div style={{width:44,height:44,borderRadius:'50%',background:'var(--bg3)',
            border:`2px solid ${net!=null?(net>0?'var(--green)':net<0?'var(--red)':'var(--border)'):'var(--gold)'}`,
            display:'flex',alignItems:'center',justifyContent:'center',
            color:'var(--gold)',fontFamily:'var(--font-display),serif',fontSize:18,fontWeight:500,flexShrink:0}}>
            {player.display_name.slice(0,1).toUpperCase()}
          </div>
          <div style={{flex:1}}>
            <div className="display" style={{fontSize:20,color:'var(--white)',fontWeight:500}}>{player.display_name}</div>
            <div style={{fontSize:11,color:'var(--muted)',fontFamily:'var(--font-body),sans-serif',marginTop:2}}>
              Seat {player.seat_number||'—'} · In: {fmt(player.buy_ins||0)} · Out: {player.cashout!=null?fmt(player.cashout):'$0.00'}
            </div>
          </div>
          {net!=null&&(
            <div className="display" style={{fontSize:22,fontWeight:600,
              color:net>0?'var(--green)':net<0?'var(--red)':'var(--muted)'}}>
              {fmtSign(net)}
            </div>
          )}
          <button onClick={onClose} style={{background:'none',border:'none',color:'var(--faint)',
            cursor:'pointer',fontSize:22,padding:'0 4px',lineHeight:1,minWidth:36,minHeight:36,
            display:'flex',alignItems:'center',justifyContent:'center'}}>×</button>
        </div>

        {/* Transactions */}
        <div className="lbl" style={{marginBottom:8}}>TRANSACTIONS</div>
        <div style={{background:'var(--bg3)',borderRadius:2,border:'1px solid var(--border-sub)',marginBottom:16}}>
          {player.buy_ins > 0 ? (
            Array.from({length: player.buy_ins}).map((_,i) => (
              <div key={i} style={{display:'flex',justifyContent:'space-between',alignItems:'center',
                padding:'9px 12px',borderBottom:'1px solid var(--border-sub)',fontSize:13}}>
                <span style={{color:'var(--muted)',fontFamily:'var(--font-body),sans-serif'}}>Buy-in #{i+1}</span>
                <span style={{color:'var(--green)',fontFamily:'var(--font-display),serif'}}>+{fmt(player.buy_ins||0)}</span>
              </div>
            ))
          ) : (
            <div style={{padding:'14px 12px',fontSize:13,color:'var(--muted)',fontFamily:'var(--font-body),sans-serif',textAlign:'center'}}>
              No transactions yet
            </div>
          )}
          {player.cashout != null && (
            <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',
              padding:'9px 12px',fontSize:13,background:'rgba(76,175,125,0.05)'}}>
              <span style={{color:'var(--muted)',fontFamily:'var(--font-body),sans-serif'}}>Cash Out</span>
              <span style={{color:'var(--green)',fontFamily:'var(--font-display),serif'}}>{fmt(player.cashout)}</span>
            </div>
          )}
        </div>

        {/* Buy-in */}
        {isHost&&isActive&&(
          <>
            <div className="lbl" style={{marginBottom:8}}>BUY-IN</div>
            <div style={{display:'flex',gap:8,marginBottom:16}}>
              <input className="inp" type="number" placeholder="Amount" step="0.01"
                value={buyinAmt} onChange={e=>setBuyinAmt(e.target.value)} style={{flex:1}}/>
              <button className="btn btn-primary" style={{fontSize:13,padding:'0 18px',whiteSpace:'nowrap'}}
                disabled={saving} onClick={addBuyin}>+ Buy In</button>
            </div>
          </>
        )}

        {/* Cash out */}
        {isHost&&isActive&&(
          <>
            <div className="lbl" style={{marginBottom:8}}>CASH OUT</div>
            <div style={{display:'flex',gap:8,marginBottom:20}}>
              <input className="inp" type="number" placeholder="Amount" step="0.01"
                value={cashoutAmt} onChange={e=>setCashoutAmt(e.target.value)} style={{flex:1}}/>
              <button style={{fontSize:13,padding:'0 18px',whiteSpace:'nowrap',cursor:saving||!cashoutAmt?'default':'pointer',
                background:saving||!cashoutAmt?'var(--bg3)':'rgba(34,197,94,0.15)',
                color:saving||!cashoutAmt?'var(--muted)':'var(--green)',
                border:'1px solid',borderColor:saving||!cashoutAmt?'var(--border-sub)':'rgba(34,197,94,0.4)',
                borderRadius:2,fontFamily:'var(--font-body),sans-serif',letterSpacing:'0.08em',fontWeight:500,
                minHeight:44,display:'flex',alignItems:'center'}}
                disabled={saving||!cashoutAmt} onClick={saveCashout}>Cash Out</button>
            </div>
          </>
        )}

        {/* WhatsApp */}
        <div className="lbl" style={{marginBottom:6}}>WHATSAPP</div>
        <div style={{fontSize:13,color:player.whatsapp?'var(--ivory)':'var(--muted)',
          fontFamily:'var(--font-body),sans-serif',marginBottom:player.whatsapp?8:16,lineHeight:1.5}}>
          {player.whatsapp||'No number saved — add one in Contacts tab.'}
        </div>
        {player.whatsapp&&playerLiveUrl&&(
          <a href={waLink(player.whatsapp,`Hi ${player.display_name}! Check your PKR balance: ${playerLiveUrl}`)}
            target="_blank" rel="noopener noreferrer"
            className="btn btn-ghost" style={{display:'block',textAlign:'center',
              textDecoration:'none',marginBottom:16,fontSize:12}}>
            📱 Send via WhatsApp
          </a>
        )}

        {/* QR Code */}
        {playerLiveUrl&&(
          <>
            <div className="lbl" style={{marginBottom:8}}>PLAYER QR CODE</div>
            <div style={{fontSize:12,color:'var(--muted)',fontFamily:'var(--font-body),sans-serif',marginBottom:12,lineHeight:1.6}}>
              {player.display_name} can scan this to watch their live balance.
            </div>
            <div style={{background:'white',borderRadius:6,padding:12,
              display:'flex',flexDirection:'column',alignItems:'center',gap:8,marginBottom:12}}>
              <img src={qrUrl} width={180} height={180} alt="QR Code" style={{display:'block',borderRadius:2}}/>
              <div style={{fontSize:9,color:'#999',textAlign:'center',wordBreak:'break-all',
                fontFamily:'monospace',maxWidth:200,lineHeight:1.4}}>{playerLiveUrl}</div>
            </div>
            <button className="btn btn-ghost" style={{width:'100%',fontSize:12,marginBottom:20}}
              onClick={()=>navigator.clipboard.writeText(playerLiveUrl).then(()=>alert('Copied!'))}>
              Copy Live Link
            </button>
          </>
        )}

        {/* Change Seat */}
        {isHost&&isActive&&knownSeats.length>0&&(
          <>
            <div className="lbl" style={{marginBottom:6}}>CHANGE SEAT</div>
            <div style={{fontSize:12,color:'var(--muted)',fontFamily:'var(--font-body),sans-serif',marginBottom:10}}>
              Tap a seat to move or swap.
            </div>
            <div style={{display:'flex',flexWrap:'wrap',gap:6,marginBottom:20}}>
              {knownSeats.map((s,i)=>(
                <button key={i} style={{padding:'6px 12px',borderRadius:2,cursor:'pointer',fontSize:12,
                  background:s?.user_id===player.user_id?'rgba(201,168,76,0.15)':'var(--bg3)',
                  color:s?.user_id===player.user_id?'var(--gold)':'var(--muted)',
                  border:`1px solid ${s?.user_id===player.user_id?'var(--gold)':'var(--border-sub)'}`,
                  fontFamily:'var(--font-body),sans-serif',minHeight:36}}>
                  {s?s.display_name.split(' ')[0]:`Seat ${i+1} empty`}
                </button>
              ))}
            </div>
          </>
        )}

        {/* Remove */}
        {isHost&&isActive&&(
          <>
            <div className="lbl" style={{marginBottom:8}}>REMOVE PLAYER</div>
            <button onClick={removePlayer}
              style={{width:'100%',padding:'13px',borderRadius:2,cursor:'pointer',fontSize:13,
                background:'rgba(220,38,38,0.08)',color:'var(--red)',
                border:'1px solid rgba(220,38,38,0.25)',fontFamily:'var(--font-body),sans-serif',
                letterSpacing:'0.06em',fontWeight:500,minHeight:44}}>
              Remove from Seat
            </button>
          </>
        )}
      </div>
    </div>
  );
}

// ── Seat Modal ──────────────────────────────────────────────────────
function SeatModal({gameId,knownPlayers,onClose,onSeated}:{
  gameId:string;knownPlayers:EventPlayer[];onClose:()=>void;onSeated:()=>void;
}) {
  const [name,setName]=useState('');
  const [wa,setWa]=useState('');
  const [saving,setSaving]=useState(false);

  async function submit(){
    if(!name.trim())return;
    setSaving(true);
    try{
      await api.games.seat(gameId,{display_name:name.trim(),whatsapp:wa||undefined});
      onSeated();
    }catch(e:any){alert(e.message);}
    finally{setSaving(false);}
  }

  return(
    <Overlay onClose={onClose}>
      <div className="display" style={{fontSize:18,color:'var(--white)',marginBottom:20,fontWeight:500}}>Seat Player</div>
      {knownPlayers.length>0&&(
        <div style={{marginBottom:16}}>
          <div className="lbl" style={{marginBottom:8}}>QUICK SELECT</div>
          <div style={{display:'flex',flexWrap:'wrap',gap:6}}>
            {knownPlayers.slice(0,12).map(kp=>(
              <button key={kp.id} onClick={()=>{setName(kp.display_name);setWa(kp.whatsapp||'');}}
                style={{padding:'6px 14px',borderRadius:20,cursor:'pointer',fontSize:13,
                  background:name===kp.display_name?'rgba(201,168,76,0.15)':'var(--bg3)',
                  color:name===kp.display_name?'var(--gold)':'var(--ivory)',
                  border:`1px solid ${name===kp.display_name?'var(--gold)':'var(--border-sub)'}`,
                  fontFamily:'var(--font-body),sans-serif',minHeight:36}}>
                {kp.display_name}
              </button>
            ))}
          </div>
        </div>
      )}
      <div style={{display:'grid',gap:10,marginBottom:20}}>
        <div>
          <div className="lbl" style={{marginBottom:5}}>NAME *</div>
          <input className="inp" placeholder="Enter name..." value={name}
            onChange={e=>setName(e.target.value)} autoFocus/>
        </div>
        <div>
          <div className="lbl" style={{marginBottom:5}}>WHATSAPP (OPTIONAL)</div>
          <div style={{display:'flex',alignItems:'center',gap:8}}>
            <span style={{fontSize:18}}>🇦🇺</span>
            <input className="inp" placeholder="04xx xxx xxx" value={wa}
              onChange={e=>setWa(e.target.value)} style={{flex:1}}/>
          </div>
        </div>
      </div>
      <div style={{display:'flex',gap:8}}>
        <button className="btn btn-primary" style={{flex:1}} disabled={!name.trim()||saving} onClick={submit}>
          {saving?'Seating...':'Seat Player'}
        </button>
        <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
      </div>
    </Overlay>
  );
}

// ── Settle Modal ────────────────────────────────────────────────────
function SettleModal({game,onClose,onDone}:{game:any;onClose:()=>void;onDone:(r:any)=>void}) {
  const players = game.players||[];
  const [cashouts,setCashouts]=useState<Record<string,string>>(
    Object.fromEntries(players.map((p:any)=>[p.user_id,p.cashout!=null?(p.cashout/100).toFixed(2):'']))
  );
  const [saving,setSaving]=useState(false);
  const pot    = players.reduce((s:number,p:any)=>s+(p.buy_ins||0),0);
  const totOut = players.reduce((s:number,p:any)=>s+Math.round(parseFloat(cashouts[p.user_id]||'0')*100),0);
  const mismatch = Math.abs(totOut-pot)>1;

  async function submit(){
    setSaving(true);
    try{
      const results=players.map((p:any)=>({
        user_id:p.user_id,display_name:p.display_name,buy_ins:p.buy_ins,
        cashout:Math.round(parseFloat(cashouts[p.user_id]||'0')*100),
      }));
      const r=await api.games.settle(game.id,{idempotency_key:crypto.randomUUID(),results});
      onDone(r);
    }catch(e:any){alert(e.message);}
    finally{setSaving(false);}
  }

  return(
    <Overlay onClose={onClose}>
      <div className="display" style={{fontSize:18,color:'var(--white)',marginBottom:4,fontWeight:500}}>Settle Up</div>
      <div style={{fontSize:12,color:'var(--muted)',marginBottom:16,fontFamily:'var(--font-body),sans-serif'}}>Enter each player's cashout amount</div>
      <div style={{maxHeight:'40vh',overflowY:'auto',marginBottom:12}}>
        {players.map((p:any)=>(
          <div key={p.user_id} style={{display:'flex',alignItems:'center',gap:10,marginBottom:10}}>
            <div style={{flex:1}}>
              <div style={{fontSize:14,color:'var(--white)',fontFamily:'var(--font-display),serif'}}>{p.display_name}</div>
              <div style={{fontSize:10,color:'var(--muted)',fontFamily:'var(--font-body),sans-serif'}}>×{p.buy_ins} buy-in{p.buy_ins!==1?'s':''} · {fmt(p.buy_ins||0)}</div>
            </div>
            <span style={{color:'var(--muted)',fontSize:14}}>$</span>
            <input className="inp" type="number" placeholder="0.00" step="0.01"
              value={cashouts[p.user_id]||''}
              onChange={e=>setCashouts(v=>({...v,[p.user_id]:e.target.value}))}
              style={{maxWidth:90}}/>
          </div>
        ))}
      </div>
      <div style={{display:'flex',justifyContent:'space-between',fontSize:11,
        marginBottom:14,fontFamily:'var(--font-body),sans-serif',padding:'8px 0',
        borderTop:'1px solid var(--border-sub)'}}>
        <span style={{color:'var(--muted)'}}>Pot: {fmt(pot)}</span>
        <span style={{color:mismatch?'var(--red)':'var(--green)'}}>
          Out: {fmt(totOut)} {mismatch?'⚠ mismatch':'✓ balanced'}
        </span>
      </div>
      <div style={{display:'flex',gap:8}}>
        <button className="btn btn-primary" style={{flex:1}} disabled={saving} onClick={submit}>
          {saving?'Settling...':'Confirm Settle'}
        </button>
        <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
      </div>
    </Overlay>
  );
}

// ── Overlay ─────────────────────────────────────────────────────────
function Overlay({children,onClose}:{children:React.ReactNode;onClose:()=>void}) {
  return(
    <div className="modal-overlay" onClick={e=>{if(e.target===e.currentTarget)onClose();}}>
      <div className="modal-sheet" style={{paddingBottom:'calc(24px + env(safe-area-inset-bottom))'}}>
        {children}
      </div>
    </div>
  );
}
