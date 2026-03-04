'use client';
import { useEffect, useState, useCallback } from 'react';
import { useParams } from 'next/navigation';
import { api, LobbyData, fmtDate, waLink } from '@/lib/api';
import {
  isPWAInstalled, isIOS, isSafari, canUsePush,
  getNotificationPermission, isPushSubscribedToEvent, subscribePush,
} from '@/lib/push';

type InstallState = 'checking' | 'not_installed' | 'installed_no_push' | 'push_denied' | 'subscribed';

export default function LobbyPage() {
  const { id } = useParams<{id:string}>();
  const [data, setData]         = useState<LobbyData|null>(null);
  const [error, setError]       = useState('');
  const [name, setName]         = useState('');
  const [wa, setWa]             = useState('');
  const [sending, setSending]   = useState(false);
  const [done, setDone]         = useState(false);
  const [installState, setInstallState] = useState<InstallState>('checking');
  const [subscribing, setSubscribing]   = useState(false);
  const [showInstallHelp, setShowInstallHelp] = useState(false);
  const appUrl = typeof window !== 'undefined' ? window.location.origin : '';

  // Load game data
  useEffect(() => {
    api.games.lobby(id).then(setData).catch(() => setError('Game not found'));
    const t = setInterval(() => api.games.lobby(id).then(setData).catch(() => {}), 10000);
    return () => clearInterval(t);
  }, [id]);

  // Determine install + push state
  const checkState = useCallback(async () => {
    if (typeof window === 'undefined') return;
    const installed = isPWAInstalled();
    if (!installed) { setInstallState('not_installed'); return; }
    if (!canUsePush()) { setInstallState('installed_no_push'); return; }
    const perm = getNotificationPermission();
    if (perm === 'denied') { setInstallState('push_denied'); return; }
    const subscribed = await isPushSubscribedToEvent(id);
    setInstallState(subscribed ? 'subscribed' : 'installed_no_push');
  }, [id]);

  useEffect(() => { checkState(); }, [checkState]);

  // Handle push subscribe (called after RSVP when we have a name)
  async function handleSubscribe(playerName: string) {
    if (!canUsePush()) return;
    setSubscribing(true);
    try {
      const perm = await Notification.requestPermission();
      if (perm !== 'granted') { setInstallState('push_denied'); return; }
      // Pass displayName so targeted notifications (buyin/cashout) can reach this device
      const ok = await subscribePush(data!.event.id, undefined, playerName);
      if (ok) setInstallState('subscribed');
    } catch(e) { console.error(e); }
    finally { setSubscribing(false); }
  }

  async function handleRsvp(status: string) {
    if (!name.trim()) return;
    setSending(true);
    try {
      const res = await api.games.rsvp(id, { display_name: name.trim(), whatsapp: wa || undefined, status });
      setData(d => d ? { ...d, rsvps: res.rsvps } : d);
      setDone(true);
      // After RSVP, try to subscribe for push if PWA is installed
      if (isPWAInstalled() && canUsePush() && installState !== 'subscribed') {
        await handleSubscribe(name.trim());
      }
    } catch(e: any) { alert(e.message); }
    finally { setSending(false); }
  }

  if (error) return (
    <div style={{minHeight:'100vh',background:'var(--bg)',display:'flex',alignItems:'center',justifyContent:'center'}}>
      <div className="card" style={{padding:32,textAlign:'center'}}><p style={{color:'var(--red)',fontSize:14}}>{error}</p></div>
    </div>
  );
  if (!data) return <Loader />;

  const { game, event, rsvps, players } = data;
  const gameWithToken = game as typeof game & { live_token?: string; lobby_views?: number; format?: string };
  const yesCount = rsvps.filter(r => r.status === 'yes').length;
  const maybeCount = rsvps.filter(r => r.status === 'maybe').length;
  const isLive = game.status === 'active' || game.status === 'settled';
  const ios = isIOS();
  const safari = isSafari();

  return (
    <div style={{minHeight:'100vh',background:'var(--bg)',paddingBottom:80}}>
      <div style={{position:'fixed',bottom:-60,right:-40,fontSize:420,opacity:0.018,
        color:'var(--gold)',lineHeight:1,userSelect:'none',pointerEvents:'none',fontFamily:'serif',zIndex:0}}>♠</div>

      {/* Header */}
      <div style={{background:'var(--bg2)',borderBottom:'1px solid var(--border-sub)',position:'relative',overflow:'hidden'}}>
        <div style={{position:'absolute',top:0,left:0,right:0,height:1,background:'linear-gradient(90deg,transparent,rgba(201,168,76,0.4),transparent)'}}/>
        <div style={{maxWidth:480,margin:'0 auto',padding:'16px 20px'}}>
          <div style={{display:'flex',alignItems:'flex-start',justifyContent:'space-between',gap:12}}>
            <div>
              <div style={{fontSize:9,letterSpacing:'0.22em',textTransform:'uppercase',color:'var(--gold)',fontFamily:'var(--font-body),sans-serif',fontWeight:500,marginBottom:6}}>
                ♠ PKR — Pre-Game Lobby
              </div>
              <div className="display" style={{fontSize:22,color:'var(--white)',fontWeight:500,lineHeight:1.1}}>{event.name}</div>
            </div>
            <div style={{textAlign:'right',flexShrink:0}}>
              <div style={{fontSize:13,color:'var(--ivory)',fontFamily:'var(--font-display),serif'}}>
                {fmtDate(game.scheduled_at)}
              </div>
              {game.location && <div style={{fontSize:11,color:'var(--muted)',marginTop:2}}>{game.location}</div>}
            </div>
          </div>
          {/* Stats */}
          <div style={{display:'flex',gap:20,marginTop:14,paddingTop:12,borderTop:'1px solid var(--border-sub)'}}>
            {[
              {label:'Seats', value:game.seats, color:'var(--white)'},
              {label:'Attending', value:yesCount, color:'var(--green)'},
              {label:'Maybe', value:maybeCount, color:'var(--amber)'},
              ...(gameWithToken.lobby_views ? [{label:'Link Opens', value:gameWithToken.lobby_views, color:'var(--faint)'}] : []),
            ].map((s:any)=>(
              <div key={s.label}>
                <div className="display" style={{fontSize:20,color:s.color,fontWeight:500,lineHeight:1}}>{s.value}</div>
                <div style={{fontSize:9,letterSpacing:'0.18em',textTransform:'uppercase',color:'var(--muted)',marginTop:3,fontFamily:'var(--font-body),sans-serif',fontWeight:500}}>{s.label}</div>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div style={{maxWidth:480,margin:'0 auto',padding:'18px 16px',position:'relative',zIndex:1}}>

        {/* ── INSTALL + PUSH BANNER ── */}
        {installState === 'not_installed' && (
          <div style={{background:'var(--bg2)',border:'1px solid rgba(201,168,76,0.3)',borderRadius:3,
            marginBottom:16,position:'relative',overflow:'hidden'}}>
            <div style={{position:'absolute',top:0,left:0,right:0,height:1,background:'linear-gradient(90deg,transparent,rgba(201,168,76,0.5),transparent)'}}/>
            <div style={{padding:'16px 16px 0'}}>
              <div style={{display:'flex',alignItems:'center',gap:10,marginBottom:10}}>
                <div style={{width:36,height:36,borderRadius:8,background:'var(--bg3)',border:'1px solid var(--border)',
                  display:'flex',alignItems:'center',justifyContent:'center',fontSize:18,flexShrink:0}}>♠</div>
                <div>
                  <div style={{fontSize:14,color:'var(--white)',fontFamily:'var(--font-display),serif',fontWeight:500}}>
                    Install PKR on your phone
                  </div>
                  <div style={{fontSize:11,color:'var(--muted)',marginTop:1,fontFamily:'var(--font-body),sans-serif'}}>
                    Get notified when games start & when your chips move
                  </div>
                </div>
              </div>
              {/* Feature list */}
              <div style={{display:'grid',gap:8,marginBottom:14}}>
                {[
                  {icon:'🃏', title:'New games', desc:'Instant alert when the host schedules a game'},
                  {icon:'💰', title:'Your buy-ins', desc:'Notified when the host records your buy-in'},
                  {icon:'💸', title:'Your cashout', desc:'Notified when your chips are cashed out'},
                  {icon:'✅', title:'Results', desc:'Push when the game is settled — see your P&L'},
                ].map(f=>(
                  <div key={f.title} style={{display:'flex',alignItems:'flex-start',gap:10,padding:'8px 10px',
                    background:'var(--bg3)',borderRadius:2,border:'1px solid var(--border-sub)'}}>
                    <span style={{fontSize:16,flexShrink:0,lineHeight:1.3}}>{f.icon}</span>
                    <div>
                      <div style={{fontSize:12,color:'var(--ivory)',fontWeight:500,fontFamily:'var(--font-body),sans-serif'}}>{f.title}</div>
                      <div style={{fontSize:11,color:'var(--muted)',lineHeight:1.4,fontFamily:'var(--font-body),sans-serif'}}>{f.desc}</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
            {/* Install instructions */}
            <div style={{borderTop:'1px solid var(--border-sub)',padding:'14px 16px'}}>
              <div style={{fontSize:10,letterSpacing:'0.18em',textTransform:'uppercase',color:'var(--gold)',marginBottom:10,fontFamily:'var(--font-body),sans-serif',fontWeight:500}}>
                How to install
              </div>
              {ios ? (
                <div style={{display:'grid',gap:6}}>
                  {[
                    {step:'1', text: safari ? 'Tap the Share button at the bottom of Safari (the box with an arrow)' : 'Open this page in Safari (not Chrome) for the best experience'},
                    {step:'2', text:'Scroll down and tap "Add to Home Screen"'},
                    {step:'3', text:'Tap "Add" in the top-right corner'},
                    {step:'4', text:'Open PKR from your home screen and allow notifications'},
                  ].map(s=>(
                    <div key={s.step} style={{display:'flex',alignItems:'flex-start',gap:8}}>
                      <div style={{width:18,height:18,borderRadius:'50%',background:'rgba(201,168,76,0.15)',
                        border:'1px solid rgba(201,168,76,0.3)',display:'flex',alignItems:'center',
                        justifyContent:'center',fontSize:9,color:'var(--gold)',fontWeight:600,flexShrink:0,marginTop:1}}>{s.step}</div>
                      <div style={{fontSize:12,color:'var(--ivory)',lineHeight:1.5,fontFamily:'var(--font-body),sans-serif'}}>{s.text}</div>
                    </div>
                  ))}
                </div>
              ) : (
                <div style={{display:'grid',gap:6}}>
                  {[
                    {step:'1', text:'Tap the ⋮ menu in the top-right of Chrome'},
                    {step:'2', text:'Tap "Add to Home screen" or "Install app"'},
                    {step:'3', text:'Open PKR from your home screen and allow notifications'},
                  ].map(s=>(
                    <div key={s.step} style={{display:'flex',alignItems:'flex-start',gap:8}}>
                      <div style={{width:18,height:18,borderRadius:'50%',background:'rgba(201,168,76,0.15)',
                        border:'1px solid rgba(201,168,76,0.3)',display:'flex',alignItems:'center',
                        justifyContent:'center',fontSize:9,color:'var(--gold)',fontWeight:600,flexShrink:0,marginTop:1}}>{s.step}</div>
                      <div style={{fontSize:12,color:'var(--ivory)',lineHeight:1.5,fontFamily:'var(--font-body),sans-serif'}}>{s.text}</div>
                    </div>
                  ))}
                </div>
              )}
              <div style={{marginTop:12,display:'flex',gap:8}}>
                <button className="btn btn-ghost" style={{flex:1,fontSize:11,padding:'8px'}}
                  onClick={() => {
                    if (navigator.share) navigator.share({title:'PKR — Install', url:appUrl, text:`Install PKR to get notified about ${event.name} games`});
                    else navigator.clipboard.writeText(appUrl).then(() => alert('Link copied!'));
                  }}>
                  Share install link
                </button>
                <button className="btn btn-ghost" style={{fontSize:11,padding:'8px 12px',color:'var(--faint)'}}
                  onClick={() => setShowInstallHelp(v => !v)}>
                  {showInstallHelp ? 'Less' : 'Help'}
                </button>
              </div>
              {showInstallHelp && (
                <div style={{marginTop:10,padding:'10px 12px',background:'rgba(201,168,76,0.04)',
                  border:'1px solid rgba(201,168,76,0.12)',borderRadius:2}}>
                  <div style={{fontSize:11,color:'var(--muted)',lineHeight:1.7,fontFamily:'var(--font-body),sans-serif'}}>
                    PKR is a PWA (Progressive Web App) — it installs like a native app directly from your browser, no App Store needed.
                    Once installed and notifications are allowed, you'll receive alerts on your lock screen whenever there's
                    activity on this table: new games, your buy-ins, cashouts, and final results.
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Installed but push not yet enabled */}
        {(installState === 'installed_no_push') && (
          <div style={{background:'var(--bg2)',border:'1px solid rgba(76,175,125,0.25)',borderRadius:3,
            padding:'14px 16px',marginBottom:16,display:'flex',alignItems:'center',gap:12,position:'relative',overflow:'hidden'}}>
            <div style={{position:'absolute',top:0,left:0,right:0,height:1,background:'linear-gradient(90deg,transparent,rgba(76,175,125,0.4),transparent)'}}/>
            <div style={{fontSize:22,flexShrink:0}}>🔔</div>
            <div style={{flex:1}}>
              <div style={{fontSize:13,color:'var(--white)',fontFamily:'var(--font-display),serif',fontWeight:500}}>Enable notifications</div>
              <div style={{fontSize:11,color:'var(--muted)',marginTop:2,fontFamily:'var(--font-body),sans-serif',lineHeight:1.4}}>
                Get alerted for new games, buy-ins, cashouts & results.
                {!name.trim() && ' Enter your name first.'}
              </div>
            </div>
            <button
              className="btn btn-primary"
              style={{fontSize:11,padding:'8px 12px',flexShrink:0}}
              disabled={!name.trim() || subscribing}
              onClick={() => handleSubscribe(name.trim())}>
              {subscribing ? '…' : 'Allow'}
            </button>
          </div>
        )}

        {installState === 'push_denied' && (
          <div style={{background:'var(--bg2)',border:'1px solid rgba(212,137,26,0.25)',borderRadius:3,
            padding:'12px 16px',marginBottom:16}}>
            <div style={{fontSize:12,color:'var(--amber)',fontFamily:'var(--font-body),sans-serif',lineHeight:1.6}}>
              <strong>Notifications blocked.</strong> To re-enable: open your browser settings → find PKR → allow notifications.
            </div>
          </div>
        )}

        {installState === 'subscribed' && (
          <div style={{background:'rgba(76,175,125,0.06)',border:'1px solid rgba(76,175,125,0.2)',borderRadius:3,
            padding:'10px 14px',marginBottom:16,display:'flex',alignItems:'center',gap:8}}>
            <span style={{fontSize:14,color:'var(--green)'}}>✓</span>
            <div style={{fontSize:12,color:'var(--green)',fontFamily:'var(--font-body),sans-serif'}}>
              Notifications enabled — you'll be alerted for all activity on this table.
            </div>
          </div>
        )}

        {/* Fix #3: Live game — show scorecard inline for late arrivals */}
        {game.status === 'active' && (
          <LiveScoreboard gameId={id} liveToken={gameWithToken.live_token} />
        )}
        {game.status === 'settled' && (
          <div style={{background:'var(--bg3)',border:'1px solid var(--border)',borderRadius:3,
            padding:'12px 16px',marginBottom:16,textAlign:'center'}}>
            <span style={{fontSize:13,color:'var(--green)',fontFamily:'var(--font-display),serif',fontWeight:500}}>
              ✅ Game Settled
            </span>
          </div>
        )}

        {/* RSVP form */}
        {!done && !isLive && (
          <div className="card-gold" style={{padding:'20px',marginBottom:14}}>
            <div style={{fontSize:10,letterSpacing:'0.18em',textTransform:'uppercase',color:'var(--gold)',
              fontFamily:'var(--font-body),sans-serif',fontWeight:500,marginBottom:14}}>Your RSVP</div>
            <div style={{display:'grid',gap:10,marginBottom:14}}>
              <div>
                <div style={{fontSize:9,letterSpacing:'0.16em',textTransform:'uppercase',color:'var(--muted)',
                  fontFamily:'var(--font-body),sans-serif',fontWeight:500,marginBottom:5}}>Name *</div>
                <input className="inp" placeholder="Your name" value={name} onChange={e => setName(e.target.value)}
                  onBlur={e => {
                    // When name is filled and push is ready but not subscribed — nudge
                    if (e.target.value.trim() && installState === 'installed_no_push') {
                      // State already shows the "Allow" button — no extra action needed
                    }
                  }}/>
              </div>
              <div>
                <div style={{fontSize:9,letterSpacing:'0.16em',textTransform:'uppercase',color:'var(--muted)',
                  fontFamily:'var(--font-body),sans-serif',fontWeight:500,marginBottom:5}}>WhatsApp (optional)</div>
                <input className="inp" placeholder="+61 4xx xxx xxx" value={wa} onChange={e => setWa(e.target.value)}/>
              </div>
            </div>
            <div style={{display:'grid',gridTemplateColumns:'2fr 1fr 1fr',gap:8}}>
              <button className="btn btn-primary" style={{fontSize:12}} disabled={!name.trim() || sending}
                onClick={() => handleRsvp('yes')}>✓ I'm In</button>
              <button className="btn btn-ghost" style={{fontSize:11}} disabled={!name.trim() || sending}
                onClick={() => handleRsvp('maybe')}>? Maybe</button>
              <button className="btn btn-ghost" style={{fontSize:11,color:'var(--red)'}} disabled={!name.trim() || sending}
                onClick={() => handleRsvp('no')}>✗ Can't</button>
            </div>
          </div>
        )}

        {done && (
          <div style={{background:'var(--bg3)',border:'1px solid var(--border)',borderRadius:2,
            padding:'14px 16px',marginBottom:14,textAlign:'center'}}>
            <div style={{fontSize:13,color:'var(--ivory)',fontFamily:'var(--font-display),serif'}}>
              RSVP saved — see you at the table. 🃏
            </div>
            {installState === 'installed_no_push' && (
              <div style={{marginTop:10}}>
                <button className="btn btn-outline" style={{fontSize:11,padding:'7px 14px'}}
                  disabled={subscribing} onClick={() => handleSubscribe(name.trim())}>
                  {subscribing ? 'Enabling…' : '🔔 Enable notifications for this table'}
                </button>
              </div>
            )}
          </div>
        )}

        {/* RSVPs */}
        {rsvps.length > 0 && (
          <div className="card" style={{marginBottom:14}}>
            <div className="section-header">RSVPs</div>
            {rsvps.map(r => (
              <div key={r.id} style={{display:'flex',alignItems:'center',gap:12,padding:'10px 16px',
                borderBottom:'1px solid var(--border-sub)'}}>
                <span style={{fontSize:13,
                  color:r.status==='yes'?'var(--green)':r.status==='maybe'?'var(--amber)':'var(--red)',width:16}}>
                  {r.status==='yes'?'✓':r.status==='maybe'?'~':'✗'}
                </span>
                <span style={{flex:1,fontSize:14,color:'var(--white)',fontFamily:'var(--font-display),serif'}}>
                  {r.display_name}
                </span>
                {r.whatsapp && (
                  <a href={waLink(r.whatsapp, `Game on — ${fmtDate(game.scheduled_at)}`)}
                    target="_blank" rel="noopener noreferrer"
                    style={{fontSize:11,color:'var(--gold)',textDecoration:'none',
                      fontFamily:'var(--font-body),sans-serif',letterSpacing:'0.06em'}}>WA</a>
                )}
              </div>
            ))}
          </div>
        )}

        {/* Seated players */}
        {players.length > 0 && (
          <div className="card">
            <div className="section-header">At the Table</div>
            {players.map((p, i) => (
              <div key={i} style={{display:'flex',alignItems:'center',gap:12,padding:'10px 16px',
                borderBottom:'1px solid var(--border-sub)'}}>
                <span style={{fontSize:11,color:'var(--faint)',width:20,textAlign:'center'}}>
                  {p.seat_number || i+1}
                </span>
                <span style={{flex:1,fontSize:14,color:'var(--ivory)',fontFamily:'var(--font-display),serif'}}>
                  {p.display_name}
                </span>
                <span style={{fontSize:11,color:'var(--muted)',fontFamily:'var(--font-body),sans-serif'}}>
                  ×{p.buy_ins}
                </span>
              </div>
            ))}
          </div>
        )}

      </div>
    </div>
  );
}

function Loader() {
  return (
    <div style={{minHeight:'100vh',background:'var(--bg)',display:'flex',alignItems:'center',justifyContent:'center'}}>
      <div className="display" style={{fontSize:48,color:'var(--gold)',opacity:0.5}}>PKR</div>
    </div>
  );
}

// ── Fix #3: Inline live scoreboard shown to late arrivals on lobby page ──────
function LiveScoreboard({ gameId, liveToken }: { gameId:string; liveToken?:string }) {
  const [live, setLive] = useState<any>(null);
  const appUrl = typeof window !== 'undefined' ? window.location.origin : '';

  useEffect(()=>{
    if (!liveToken) return;
    api.games.live(liveToken).then(setLive).catch(()=>{});
    const t = setInterval(()=>{ api.games.live(liveToken).then(setLive).catch(()=>{}); }, 8000);
    return ()=>clearInterval(t);
  },[liveToken]);

  if (!liveToken) return null;

  return (
    <div style={{marginBottom:16}}>
      <div style={{background:'rgba(201,168,76,0.06)',border:'1px solid rgba(201,168,76,0.2)',borderRadius:3,
        padding:'10px 14px',marginBottom:8,display:'flex',alignItems:'center',justifyContent:'space-between'}}>
        <div style={{display:'flex',alignItems:'center',gap:8}}>
          <span style={{width:7,height:7,borderRadius:'50%',background:'var(--green)',display:'inline-block',
            boxShadow:'0 0 6px rgba(76,175,125,0.7)'}}/>
          <span style={{fontSize:12,color:'var(--gold)',fontFamily:'var(--font-body),sans-serif',fontWeight:500}}>
            Game is Live — Scores updating
          </span>
        </div>
        <a href={`${appUrl}/games/live/${liveToken}`} style={{fontSize:10,color:'var(--muted)',textDecoration:'none',
          fontFamily:'var(--font-body),sans-serif',letterSpacing:'0.08em'}}>
          Full view →
        </a>
      </div>

      {live && (
        <div style={{background:'var(--bg2)',border:'1px solid var(--border-sub)',borderRadius:3,overflow:'hidden'}}>
          <div style={{display:'grid',gridTemplateColumns:'1fr 1fr 1fr',gap:0,
            borderBottom:'1px solid var(--border-sub)'}}>
            {[
              {l:'Buy-ins', v:`$${(live.totalIn/100).toFixed(0)}`},
              {l:'Cashouts', v:`$${(live.totalOut/100).toFixed(0)}`},
              {l:'In Bank', v:`$${(live.bank/100).toFixed(0)}`},
            ].map((s,i)=>(
              <div key={s.l} style={{padding:'10px 8px',textAlign:'center',
                borderRight:i<2?'1px solid var(--border-sub)':'none'}}>
                <div style={{fontSize:15,color:'var(--white)',fontWeight:500,fontFamily:'var(--font-display),serif'}}>{s.v}</div>
                <div style={{fontSize:9,color:'var(--faint)',textTransform:'uppercase',letterSpacing:'0.14em',
                  fontFamily:'var(--font-body),sans-serif',marginTop:2}}>{s.l}</div>
              </div>
            ))}
          </div>
          {[...live.players].sort((a:any,b:any)=>(b.buy_ins||0)-(a.buy_ins||0)).map((p:any,i:number)=>{
            const net = p.cashout != null ? p.cashout - p.buy_ins : null;
            return (
              <div key={i} style={{display:'flex',alignItems:'center',gap:10,padding:'9px 14px',
                borderBottom:'1px solid var(--border-sub)'}}>
                <span style={{fontSize:10,color:'var(--faint)',width:16,textAlign:'center'}}>{p.seat_number||i+1}</span>
                <span style={{flex:1,fontSize:13,color:'var(--white)',fontFamily:'var(--font-display),serif'}}>{p.display_name}</span>
                <span style={{fontSize:11,color:'var(--muted)',fontFamily:'var(--font-body),sans-serif'}}>×{p.buy_ins}</span>
                {net!=null && (
                  <span style={{fontSize:13,fontWeight:600,color:net>0?'var(--green)':net<0?'var(--red)':'var(--muted)',
                    fontFamily:'var(--font-display),serif'}}>
                    {net>0?'+':''}{(net/100).toFixed(0)}
                  </span>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}