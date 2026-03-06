'use client';
import { useEffect, useState, useMemo } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { api, EventDetail, Game, LeaderboardEntry, fmtDate, fmt, fmtSign } from '@/lib/api';
import { subscribePush, unsubscribePush, isPushSubscribedToEvent, canUsePush, isPWAInstalled, isIOS, isSafari } from '@/lib/push';

type Tab = 'games' | 'leaderboard' | 'history' | 'members';
type InviteRole = 'cohost' | 'member';

export default function EventPage() {
  const _p = useParams(); const id = (Array.isArray(_p.id) ? _p.id[0] : _p.id) as string;
  const router  = useRouter();
  const [event, setEvent]     = useState(null as any);
  const [games, setGames]     = useState([] as any[]);
  const [history, setHistory] = useState([] as any[]);
  const [leaders, setLeaders] = useState([] as any[]);
  const [tab, setTab]         = useState('games');
  const [isHost, setIsHost]   = useState(false);
  const [user, setUser]       = useState(null as any);
  const [showCreate, setShowCreate] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(null as any);
  const [selectedPlayer, setSelectedPlayer] = useState(null as any); // display_name for drill-down // gameId or gameId+':delete'
  const [showInvite, setShowInvite] = useState(false);
  const [showInstall, setShowInstall] = useState(false);
  const [showQuickSeat, setShowQuickSeat] = useState(false);
  const [quickSeatGameId, setQuickSeatGameId] = useState('');
  const [inviteUrl, setInviteUrl]   = useState('');
  const [inviteRole, setInviteRole] = useState('cohost');
  const [form, setForm] = useState({scheduled_at:'',location:'',notes:'',seats:'9',game_password:'',repeat:'none',format:'cash'});
  const [saving, setSaving] = useState(false);
  const [pushEnabled, setPushEnabled] = useState(false);
  const [pushLoading, setPushLoading] = useState(false);
  const appUrl = typeof window !== 'undefined' ? window.location.origin : '';

  useEffect(()=>{
    Promise.all([api.events.get(id), api.auth.me()]).then(([e,u])=>{
      setEvent(e as any); setUser(u as any);
      const me = e.members.find((m:any)=>m.id===u.id);
      setIsHost(me?.role==='host'||me?.role==='cohost');
    }).catch(()=>router.push('/dashboard'));
    api.games.list(id).then(setGames);
    api.events.leaderboard(id).then(setLeaders);
    api.events.history(id).then(setHistory);
  },[id]);

  useEffect(()=>{
    isPushSubscribedToEvent(id).then(setPushEnabled);
  },[id]);

  async function createGame() {
    if (!form.scheduled_at) return;
    setSaving(true);
    try {
      const ts = Math.floor(new Date(form.scheduled_at).getTime()/1000);
      const g = await api.games.create(id,{
        scheduled_at:ts, location:form.location||undefined,
        notes:form.notes||undefined, seats:parseInt(form.seats)||9,
        game_password:form.game_password||undefined,
        repeat: form.repeat !== 'none' ? form.repeat : undefined,
        format: form.format,
      });
      setGames(gs=>[g,...gs]);
      setShowCreate(false);
      setForm({scheduled_at:'',location:'',notes:'',seats:'9',game_password:'',repeat:'none',format:'cash'});
    } catch(e:any){ alert(e.message); }
    finally { setSaving(false); }
  }

  async function generateInvite(role='cohost') {
    try {
      const r = await api.events.invite(id, role);
      setInviteUrl(r.url); setInviteRole(role); setShowInvite(true);
    } catch(e:any){ alert(e.message); }
  }

  async function togglePush() {
    setPushLoading(true);
    try {
      if (pushEnabled) {
        const result = await unsubscribePush(id);
        setPushEnabled(result);
      } else {
        const perm = await Notification.requestPermission();
        if (perm === 'granted') {
          const result = await subscribePush(id, user?.id, user?.name);
          setPushEnabled(result);
        }
      }
    } finally { setPushLoading(false); }
  }

  const isPWA      = useMemo(()=>isPWAInstalled(),[]);
  const iosDevice  = useMemo(()=>isIOS(),[]);
  const safariOnly = useMemo(()=>isSafari(),[]);

  if (!event) return null;

  const upcoming = games.filter(g=>g.status==='scheduled'||g.status==='lobby'||g.status==='active');
  const settled  = games.filter(g=>g.status==='settled');
  const installLink = appUrl;

  const statusColor:any = {
    scheduled:'var(--amber)', lobby:'var(--gold)', active:'var(--green)',
    settled:'var(--muted)', cancelled:'var(--red)',
  };

  const TABS: Tab[] = ['games', 'leaderboard', 'history', 'members'];

  const TABS_NAV = ['games','leaderboard','history'];
  return (
    <div style={{minHeight:'100vh',background:'var(--bg)',paddingBottom:80}}>
      <div style={{position:'fixed',bottom:-60,right:-40,fontSize:420,opacity:0.018,color:'var(--gold)',lineHeight:1,userSelect:'none',pointerEvents:'none',fontFamily:'serif',zIndex:0}}>♠</div>

      {/* Header */}
      <div style={{background:'var(--bg2)',borderBottom:'1px solid var(--border-sub)',position:'sticky',top:0,zIndex:50,backdropFilter:'blur(16px)'}}>
        <div style={{maxWidth:640,margin:'0 auto',padding:'0 16px',height:56,display:'flex',alignItems:'center',gap:12}}>
          <button onClick={()=>router.push('/dashboard')} style={{background:'none',border:'none',color:'var(--muted)',cursor:'pointer',fontSize:20,padding:'4px 8px',lineHeight:1,display:'flex',alignItems:'center'}}>‹</button>
          <div style={{flex:1,minWidth:0}}>
            <div className="display" style={{fontSize:16,color:'var(--white)',fontWeight:500,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{event.name}</div>
          </div>
          {/* Push bell */}
          {canUsePush() && (
            <button onClick={togglePush} disabled={pushLoading} title={pushEnabled?'Notifications ON — tap to disable':'Enable push notifications'}
              style={{background:pushEnabled?'rgba(0,255,136,0.12)':'rgba(255,255,255,0.05)',
                color:pushEnabled?'var(--green)':'var(--muted)',
                border:`1px solid ${pushEnabled?'rgba(0,255,136,0.3)':'var(--border-sub)'}`,
                borderRadius:2,padding:'5px 8px',cursor:'pointer',fontSize:16,minHeight:36,
                display:'flex',alignItems:'center',WebkitTapHighlightColor:'transparent',opacity:pushLoading?0.5:1}}>
              {pushEnabled ? '🔔' : '🔕'}
            </button>
          )}
          {isHost && (
            <div style={{display:'flex',gap:6}}>
              <button className="btn btn-primary" style={{fontSize:11,padding:'7px 14px'}} onClick={()=>setShowCreate(true)}>+ Game</button>
              <button className="btn btn-ghost" style={{fontSize:11,padding:'7px 12px'}} onClick={()=>setShowInstall(true)}>Share</button>
            </div>
          )}
        </div>
      </div>

      {/* Stats strip */}
      <div style={{background:'var(--bg2)',borderBottom:'1px solid var(--border-sub)',padding:'0 16px'}}>
        <div style={{maxWidth:640,margin:'0 auto',display:'flex',gap:0}}>
          {[
            {l:'Buy-in', v:event.buy_in>0?fmt(event.buy_in):'—'},
            {l:'Games',  v:`${event.game_count||0}`},
            {l:'Members',v:`${event.member_count||1}`},
          ].map((s,i)=>(
            <div key={s.l} style={{padding:'14px 20px',borderRight:i<2?'1px solid var(--border-sub)':'none'}}>
              <div className="display" style={{fontSize:18,color:'var(--white)',fontWeight:500}}>{s.v}</div>
              <div style={{fontSize:9,letterSpacing:'0.18em',textTransform:'uppercase',color:'var(--muted)',marginTop:2,fontFamily:'var(--font-body),sans-serif',fontWeight:500}}>{s.l}</div>
            </div>
          ))}
          {/* Push status chip */}
          <div style={{marginLeft:'auto',display:'flex',alignItems:'center',padding:'0 16px'}}>
            {pushEnabled
              ? <span style={{fontSize:10,color:'var(--green)',fontFamily:'var(--font-body),sans-serif'}}>🔔 Notified</span>
              : canUsePush() ? <span style={{fontSize:10,color:'var(--faint)',fontFamily:'var(--font-body),sans-serif'}}>🔕 No alerts</span> : null
            }
          </div>
        </div>
      </div>

      {/* Tab nav */}
      <div style={{background:'var(--bg2)',borderBottom:'1px solid var(--border-sub)',padding:'0 16px'}}>
        <div style={{maxWidth:640,margin:'0 auto',display:'flex'}}>
          {TABS.map((t)=>(
            <button key={t} onClick={()=>setTab(t)} className={`tab ${tab===t?'active':''}`}>
              {t.charAt(0).toUpperCase()+t.slice(1)}
            </button>
          ))}
        </div>
      </div>

      <div style={{maxWidth:640,margin:'0 auto',padding:'20px 16px',position:'relative',zIndex:1}}>

        {/* ── Games tab ── */}
        {tab==='games' && (
          <div>
            {isHost && (
              <div style={{display:'flex',gap:6,marginBottom:16,flexWrap:'wrap'}}>
                <button className="btn btn-ghost" style={{fontSize:11,padding:'7px 12px'}} onClick={()=>generateInvite('cohost')}>+ Co-host</button>
                <button className="btn btn-ghost" style={{fontSize:11,padding:'7px 12px'}} onClick={()=>generateInvite('member')}>+ Member</button>
              </div>
            )}
            {upcoming.length===0 && settled.length===0 && (
              <div className="empty-state">
                <div className="empty-state-icon">♠</div>
                <div className="empty-state-text">No games scheduled yet.</div>
                {isHost && <div style={{fontSize:12,color:'var(--faint)',marginTop:6}}>Click + Game to schedule one.</div>}
              </div>
            )}
            {upcoming.map(g=>(
              <GameCard key={g.id} game={g} appUrl={appUrl} eventName={event.name} isHost={isHost} onClick={()=>router.push(`/games/${g.id}`)} onQuickSeat={()=>{setQuickSeatGameId(g.id);setShowQuickSeat(true);}} onCancel={()=>setConfirmDelete(g.id)} onDelete={()=>setConfirmDelete(g.id+':delete')}/>
            ))}
            {settled.length>0 && (
              <>
                <div style={{fontSize:9,letterSpacing:'0.2em',textTransform:'uppercase',color:'var(--faint)',margin:'20px 0 10px',fontFamily:'var(--font-body),sans-serif',fontWeight:500}}>
                  Recent Results
                </div>
                {settled.slice(0,3).map(g=>(
                  <div key={g.id} className="card" style={{marginBottom:8,cursor:'pointer',opacity:0.7}} onClick={()=>router.push(`/games/${g.id}`)}>
                    <div style={{padding:'14px 18px',display:'flex',alignItems:'center',gap:14}}>
                      <div style={{flex:1}}>
                        <div style={{fontSize:14,color:'var(--ivory)'}}>{fmtDate(g.scheduled_at)}</div>
                        {g.location && <div style={{fontSize:11,color:'var(--muted)'}}>{g.location}</div>}
                        {(g as any).format && (g as any).format !== 'cash' && (
                          <span style={{fontSize:10,color:'var(--gold)',fontFamily:'var(--font-body),sans-serif',
                            letterSpacing:'0.08em',textTransform:'uppercase'}}>
                            {String(({tournament:'🏆 Tournament',rebuy:'♻️ Rebuy',freezeout:'❄️ Freezeout'} as {[k:string]:string})[(g as any).format] || (g as any).format)}
                          </span>
                        )}
                      </div>
                      <span className="badge badge-settled">Settled</span>
                      <span style={{color:'var(--faint)',fontSize:16}}>›</span>
                    </div>
                  </div>
                ))}
              </>
            )}
          </div>
        )}

        {/* ── Leaderboard tab ── */}
        {tab==='leaderboard' && (
          <div>
            {leaders.length===0 && (
              <div className="empty-state">
                <div className="empty-state-icon">🏆</div>
                <div className="empty-state-text">No results yet. Settle a game to see the leaderboard.</div>
              </div>
            )}
            {leaders.length>0 && (
              <div className="card">
                {leaders.map((l,i)=>(
                  <div key={l.user_id} onClick={()=>setSelectedPlayer(l.display_name)}
                    style={{display:'flex',alignItems:'center',gap:12,padding:'14px 16px',borderBottom:i<leaders.length-1?'1px solid var(--border-sub)':'none',
                    cursor:'pointer',transition:'background 0.12s'}}
                    onMouseEnter={e=>(e.currentTarget.style.background='rgba(201,168,76,0.04)')}
                    onMouseLeave={e=>(e.currentTarget.style.background='')}>
                    <div style={{width:28,textAlign:'center',fontSize:i<3?18:13,color:i===0?'var(--gold)':i===1?'var(--ivory)':i===2?'var(--amber)':'var(--faint)'}}>
                      {i===0?'♛':i===1?'♝':i===2?'♞':`${i+1}`}
                    </div>
                    <div style={{flex:1}}>
                      <div style={{fontSize:14,color:'var(--white)',fontFamily:'var(--font-display),serif',fontWeight:i===0?600:400}}>{l.display_name}</div>
                      <div style={{fontSize:11,color:'var(--muted)',marginTop:2}}>{l.games_played} game{l.games_played!==1?'s':''} · best {fmtSign(l.biggest_win)}</div>
                    </div>
                    <div className="display" style={{fontSize:20,color:l.total_net>0?'var(--green)':l.total_net<0?'var(--red)':'var(--muted)',fontWeight:500}}>
                      {fmtSign(l.total_net)}
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* Fix 8: Player drill-down — show their individual game history */}
            {selectedPlayer && (
              <PlayerHistoryCard
                player={selectedPlayer}
                history={history}
                leader={leaders.find(l=>l.display_name===selectedPlayer)||null}
                onClose={()=>setSelectedPlayer(null)}
              />
            )}
          </div>
        )}

        {/* ── Members tab ── */}
        {tab==='members' && (
          <div>
            {(!event.members || event.members.length === 0) && (
              <div className="empty-state">
                <div className="empty-state-icon">👥</div>
                <div className="empty-state-text">No members yet. Invite people using + Co-host or + Member.</div>
              </div>
            )}
            {event.members && event.members.length > 0 && (
              <div className="card">
                {event.members.map((m: any, i: number) => (
                  <div key={m.id} style={{display:'flex',alignItems:'center',gap:12,padding:'14px 16px',
                    borderBottom:i<event.members.length-1?'1px solid var(--border-sub)':'none'}}>
                    <div style={{width:36,height:36,borderRadius:'50%',background:'var(--bg3)',
                      border:'1px solid var(--border-sub)',display:'flex',alignItems:'center',
                      justifyContent:'center',fontSize:16,flexShrink:0,overflow:'hidden'}}>
                      {m.avatar_url
                        ? <img src={m.avatar_url} alt={m.name} style={{width:'100%',height:'100%',objectFit:'cover'}}/>
                        : <span style={{color:'var(--gold)',fontFamily:'serif'}}>{(m.name||'?')[0].toUpperCase()}</span>}
                    </div>
                    <div style={{flex:1,minWidth:0}}>
                      <div style={{fontSize:14,color:'var(--white)',fontFamily:'var(--font-display),serif',
                        fontWeight:m.role==='host'?600:400,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>
                        {m.name}
                      </div>
                      <div style={{fontSize:11,color:'var(--muted)',marginTop:2,fontFamily:'var(--font-body),sans-serif'}}>
                        {m.email}
                      </div>
                    </div>
                    <div style={{display:'flex',flexDirection:'column',alignItems:'flex-end',gap:4,flexShrink:0}}>
                      <span style={{fontSize:9,letterSpacing:'0.14em',textTransform:'uppercase',fontWeight:600,
                        padding:'2px 7px',borderRadius:2,fontFamily:'var(--font-body),sans-serif',
                        background: m.role==='host'?'rgba(201,168,76,0.15)':m.role==='cohost'?'rgba(76,175,125,0.1)':'rgba(255,255,255,0.05)',
                        color: m.role==='host'?'var(--gold)':m.role==='cohost'?'var(--green)':'var(--muted)',
                        border: `1px solid ${m.role==='host'?'rgba(201,168,76,0.3)':m.role==='cohost'?'rgba(76,175,125,0.2)':'var(--border-sub)'}`}}>
                        {m.role}
                      </span>
                      <span style={{fontSize:9,color:'var(--faint)',fontFamily:'var(--font-body),sans-serif'}}>
                        {new Date(m.joined_at*1000).toLocaleDateString('en-AU',{month:'short',day:'numeric',year:'numeric'})}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* ── History tab ── */}
        {tab==='history' && (
          <div>
            {history.length===0 && <div className="empty-state"><div className="empty-state-icon">📋</div><div className="empty-state-text">No settled games yet.</div></div>}
            <div style={{display:'grid',gap:8}}>
              {history.map(g=>(
                <div key={g.id} className="card">
                  <div style={{padding:'14px 16px',cursor:'pointer'}} onClick={()=>router.push(`/games/${g.id}`)}>
                    <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',gap:12,marginBottom:4}}>
                      <div style={{fontSize:14,color:'var(--white)',fontFamily:'var(--font-display),serif',fontWeight:400}}>{fmtDate(g.scheduled_at)}</div>
                      <span className="badge badge-settled">{(g as any).player_count||0} players</span>
                    </div>
                    {g.location && <div style={{fontSize:11,color:'var(--muted)',marginBottom:8}}>📍 {g.location}</div>}
                    {((g as any).top_players||[]).length>0 && (
                      <div style={{display:'flex',gap:6,flexWrap:'wrap'}}>
                        {((g as any).top_players||[]).map((p:any,i:number)=>(
                          <div key={i} style={{display:'flex',alignItems:'center',gap:5,padding:'3px 8px',
                            background:i===0?'rgba(201,168,76,0.08)':'rgba(255,255,255,0.03)',
                            border:`1px solid ${i===0?'rgba(201,168,76,0.25)':'var(--border-sub)'}`,borderRadius:2}}>
                            <span style={{fontSize:10,color:i===0?'var(--gold)':'var(--faint)'}}>{i===0?'♛':i===1?'♝':'♞'}</span>
                            <span style={{fontSize:11,color:'var(--ivory)',fontFamily:'var(--font-display),serif'}}>{p.display_name}</span>
                            <span style={{fontSize:11,fontWeight:600,color:p.net>0?'var(--green)':p.net<0?'var(--red)':'var(--muted)'}}>{fmtSign(p.net)}</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                  {isHost && (
                    <div style={{borderTop:'1px solid var(--border-sub)',padding:'8px 14px',display:'flex',justifyContent:'flex-end'}}>
                      <button className="btn btn-danger" style={{fontSize:11,padding:'5px 10px'}}
                        onClick={()=>setConfirmDelete(g.id+':delete')}>Delete</button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Fix 6+10: Confirm delete/cancel modal */}
      {confirmDelete && (
        <div className="modal-overlay" onClick={()=>setConfirmDelete(null)}>
          <div className="modal animate-up" onClick={e=>e.stopPropagation()} style={{maxWidth:360}}>
            <div style={{padding:'24px 24px 0'}}>
              <div style={{fontSize:16,color:'var(--white)',fontFamily:'var(--font-display),serif',fontWeight:500,marginBottom:8}}>
                {confirmDelete.endsWith(':delete') ? 'Delete Game?' : 'Cancel Game?'}
              </div>
              <div style={{fontSize:13,color:'var(--muted)',lineHeight:1.7,fontFamily:'var(--font-body),sans-serif'}}>
                {confirmDelete.endsWith(':delete')
                  ? 'This permanently removes the game record and all player data. The leaderboard will be recalculated. This cannot be undone.'
                  : "This marks the game as cancelled. It will stay in history but won't affect the leaderboard."}
              </div>
            </div>
            <div style={{padding:'20px 24px',display:'flex',gap:8,justifyContent:'flex-end'}}>
              <button className="btn btn-ghost" style={{fontSize:12}} onClick={()=>setConfirmDelete(null)}>Keep it</button>
              <button className="btn btn-danger" style={{fontSize:12}} onClick={async()=>{
                const gameId = confirmDelete.replace(':delete','');
                const isDelete = confirmDelete.endsWith(':delete');
                try {
                  if (isDelete) {
                    await api.games.delete(gameId);
                    setHistory(h=>h.filter(x=>x.id!==gameId));
                    setGames(gs=>gs.filter(g=>g.id!==gameId));
                    api.events.leaderboard(id).then(setLeaders);
                  } else {
                    await api.games.cancel(gameId);
                    setGames(gs=>gs.map(g=>g.id===gameId?{...g,status:'cancelled'}:g));
                  }
                } catch(e:any){ alert(e.message); }
                setConfirmDelete(null);
              }}>
                {confirmDelete.endsWith(':delete') ? 'Delete permanently' : 'Cancel game'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Create game modal */}
      {showCreate && (
        <div className="modal-overlay" onClick={e=>{if(e.target===e.currentTarget)setShowCreate(false);}}>
          <div className="modal-sheet">
            <div className="display" style={{fontSize:18,color:'var(--white)',marginBottom:20,fontWeight:500}}>Schedule Game</div>
            <div style={{display:'grid',gap:14}}>
              <div>
                <div className="lbl" style={{marginBottom:6}}>Date & Time *</div>
                <input className="inp" type="datetime-local" value={form.scheduled_at} onChange={e=>setForm(f=>({...f,scheduled_at:e.target.value}))}/>
              </div>
              <div>
                <div className="lbl" style={{marginBottom:6}}>Location</div>
                <input className="inp" placeholder="e.g. Mike's place" value={form.location} onChange={e=>setForm(f=>({...f,location:e.target.value}))}/>
              </div>
              <div>
                <div className="lbl" style={{marginBottom:8}}>Seats</div>
                <div style={{display:'flex',gap:6,flexWrap:'wrap'}}>
                  {['6','7','8','9','10','11','12'].map(n=>(
                    <button key={n} onClick={()=>setForm(f=>({...f,seats:n}))}
                      style={{padding:'7px 14px',borderRadius:2,cursor:'pointer',fontSize:13,fontWeight:500,
                        background:form.seats===n?'var(--gold)':'var(--bg3)',color:form.seats===n?'#0e0e0f':'var(--muted)',
                        border:form.seats===n?'1px solid var(--gold)':'1px solid var(--border-sub)',fontFamily:'var(--font-body),sans-serif'}}>{n}</button>
                  ))}
                </div>
              </div>
              <div>
                <div className="lbl" style={{marginBottom:6}}>Game Password</div>
                <input className="inp" placeholder="Optional" value={form.game_password} onChange={e=>setForm(f=>({...f,game_password:e.target.value}))}/>
              </div>
              <div>
                <div className="lbl" style={{marginBottom:6}}>Notes</div>
                <input className="inp" placeholder="Optional" value={form.notes} onChange={e=>setForm(f=>({...f,notes:e.target.value}))}/>
              </div>
              <div>
                <div className="lbl" style={{marginBottom:8}}>Repeat</div>
                <div style={{display:'flex',gap:6}}>
                  {(['none','weekly','fortnightly']).map(r=>(
                    <button key={r} onClick={()=>setForm(f=>({...f,repeat:r}))}
                      style={{padding:'7px 14px',borderRadius:2,cursor:'pointer',fontSize:12,fontWeight:500,
                        background:form.repeat===r?'var(--gold)':'var(--bg3)',color:form.repeat===r?'#0e0e0f':'var(--muted)',
                        border:form.repeat===r?'1px solid var(--gold)':'1px solid var(--border-sub)',fontFamily:'var(--font-body),sans-serif'}}>
                      {r==='none'?'Once':r==='weekly'?'Weekly':'Fortnightly'}
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <div className="lbl" style={{marginBottom:8}}>Format</div>
                <div style={{display:'flex',gap:6,flexWrap:'wrap'}}>
                  {([
                    {v:'cash',       l:'💰 Cash'},
                    {v:'tournament', l:'🏆 Tournament'},
                    {v:'rebuy',      l:'♻️ Rebuy'},
                    {v:'freezeout',  l:'❄️ Freezeout'},
                  ]).map(f=>(
                    <button key={f.v} onClick={()=>setForm(fm=>({...fm,format:f.v}))}
                      style={{padding:'7px 14px',borderRadius:2,cursor:'pointer',fontSize:12,fontWeight:500,
                        background:form.format===f.v?'var(--gold)':'var(--bg3)',
                        color:form.format===f.v?'#0e0e0f':'var(--muted)',
                        border:form.format===f.v?'1px solid var(--gold)':'1px solid var(--border-sub)',
                        fontFamily:'var(--font-body),sans-serif'}}>
                      {f.l}
                    </button>
                  ))}
                </div>
              </div>
            </div>
            <div style={{display:'flex',gap:8,marginTop:20}}>
              <button className="btn btn-primary" style={{flex:1}} disabled={!form.scheduled_at||saving} onClick={createGame}>
                {saving?'Scheduling…':'Schedule & Notify'}
              </button>
              <button className="btn btn-ghost" onClick={()=>setShowCreate(false)}>Cancel</button>
            </div>
          </div>
        </div>
      )}

      {/* Invite modal */}
      {showInvite && (
        <div className="modal-overlay" onClick={e=>{if(e.target===e.currentTarget)setShowInvite(false);}}>
          <div className="modal-sheet">
            <div className="display" style={{fontSize:18,color:'var(--white)',marginBottom:6,fontWeight:500}}>{inviteRole==='member'?'Member Invite':'Co-host Invite'}</div>
            <div style={{fontSize:12,color:'var(--muted)',marginBottom:18,fontFamily:'var(--font-body),sans-serif'}}>Single-use · expires in 48 hours</div>
            <div style={{background:'var(--bg3)',border:'1px solid var(--border-sub)',borderRadius:2,padding:'12px 14px',fontSize:11,color:'var(--ivory)',wordBreak:'break-all',marginBottom:16,fontFamily:'monospace'}}>
              {inviteUrl}
            </div>
            <div style={{display:'flex',gap:8}}>
              <button className="btn btn-primary" style={{flex:1}} onClick={()=>navigator.clipboard.writeText(inviteUrl).then(()=>alert('Copied!'))}>Copy Link</button>
              <a href={`https://wa.me/?text=${encodeURIComponent(`Join me as co-host on PKR: ${inviteUrl}`)}`}
                target="_blank" rel="noopener noreferrer" className="btn btn-outline"
                style={{flex:1,textDecoration:'none',display:'flex',alignItems:'center',justifyContent:'center'}}>WhatsApp</a>
              <button className="btn btn-ghost" onClick={()=>setShowInvite(false)}>Close</button>
            </div>
          </div>
        </div>
      )}

      {/* Install / Share modal */}
      {showInstall && (
        <div className="modal-overlay" onClick={e=>{if(e.target===e.currentTarget)setShowInstall(false);}}>
          <div className="modal-sheet">
            <div className="display" style={{fontSize:18,color:'var(--white)',marginBottom:4,fontWeight:500}}>Share PKR</div>
            <div style={{fontSize:12,color:'var(--muted)',marginBottom:20,fontFamily:'var(--font-body),sans-serif'}}>{event.name}</div>

            {/* Install link */}
            <div style={{marginBottom:16,padding:'14px',background:'rgba(0,255,136,0.04)',border:'1px solid rgba(0,255,136,0.15)',borderRadius:4}}>
              <div style={{fontSize:9,letterSpacing:'0.18em',color:'var(--green)',marginBottom:6,fontFamily:'var(--font-body),sans-serif',fontWeight:600,textTransform:'uppercase'}}>📲 Player Install Link</div>
              <div style={{fontSize:11,color:'var(--muted)',marginBottom:10,fontFamily:'var(--font-body),sans-serif',lineHeight:1.6}}>
                Send to new players so they can install PKR and get push notifications for every game.
              </div>
              <div style={{background:'var(--bg3)',border:'1px solid var(--border-sub)',borderRadius:2,padding:'10px 12px',fontSize:10,color:'var(--ivory)',wordBreak:'break-all',marginBottom:8,fontFamily:'monospace'}}>{installLink}</div>
              <div style={{display:'flex',gap:6}}>
                <button className="btn btn-outline" style={{flex:1,fontSize:11,borderColor:'rgba(0,255,136,0.3)',color:'var(--green)'}}
                  onClick={()=>navigator.clipboard.writeText(installLink).then(()=>alert('Install link copied!'))}>Copy</button>
                <a href={`https://wa.me/?text=${encodeURIComponent(`Install PKR and join ${event.name}: ${installLink}`)}`}
                  target="_blank" rel="noopener noreferrer" className="btn btn-ghost"
                  style={{flex:1,textDecoration:'none',display:'flex',alignItems:'center',justifyContent:'center',fontSize:11}}>📱 WhatsApp</a>
              </div>
            </div>

            {/* Push toggle */}
            {canUsePush() && (
              <div style={{padding:'12px 14px',background:'var(--bg3)',border:'1px solid var(--border-sub)',borderRadius:4,marginBottom:14}}>
                <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',gap:12}}>
                  <div>
                    <div style={{fontSize:12,color:'var(--ivory)',fontFamily:'var(--font-body),sans-serif',fontWeight:500}}>🔔 Your Notifications</div>
                    <div style={{fontSize:10,color:'var(--muted)',fontFamily:'var(--font-body),sans-serif',marginTop:2}}>
                      {pushEnabled ? 'ON — get alerts for games, results & buy-ins.' : 'OFF — enable to stay in the loop.'}
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

            {!isPWA && iosDevice && safariOnly && (
              <div style={{padding:'10px 14px',background:'rgba(201,168,76,0.06)',border:'1px solid rgba(201,168,76,0.2)',borderRadius:4,marginBottom:14}}>
                <div style={{fontSize:11,color:'var(--gold)',fontFamily:'var(--font-body),sans-serif',fontWeight:500,marginBottom:4}}>📱 iPhone: Add to Home Screen</div>
                <div style={{fontSize:10,color:'var(--muted)',fontFamily:'var(--font-body),sans-serif',lineHeight:1.6}}>
                  Tap <strong style={{color:'var(--ivory)'}}>Share ↑</strong> → <strong style={{color:'var(--ivory)'}}>Add to Home Screen</strong> to install PKR as a native app.
                </div>
              </div>
            )}

            <button className="btn btn-ghost" style={{width:'100%'}} onClick={()=>setShowInstall(false)}>Close</button>
          </div>
        </div>
      )}

      {/* ── Quick Seat Modal (#13) ── */}
      {showQuickSeat && quickSeatGameId && (
        <QuickSeatModal
          gameId={quickSeatGameId}
          onClose={()=>setShowQuickSeat(false)}
          onSeated={()=>{ setShowQuickSeat(false); api.games.list(id).then(setGames); }}
        />
      )}
    </div>
  );
}

// ─── Quick Seat Modal ────────────────────────────────────────────────────────
function QuickSeatModal({ gameId, onClose, onSeated }: { gameId:string; onClose:()=>void; onSeated:()=>void }) {
  const [name, setName] = useState('');
  const [wa, setWa]     = useState('');
  const [saving, setSaving] = useState(false);
  const [seated, setSeated] = useState([] as any[]);

  async function seat() {
    if (!name.trim()) return;
    setSaving(true);
    try {
      await api.games.seat(gameId, { display_name: name.trim(), whatsapp: wa || undefined });
      setSeated(s => [...s, name.trim()]);
      setName(''); setWa('');
    } catch(e:any) { alert(e.message); }
    finally { setSaving(false); }
  }

  return (
    <div className="modal-overlay" onClick={e=>{if(e.target===e.currentTarget)onClose();}}>
      <div className="modal-sheet">
        <div className="display" style={{fontSize:18,color:'var(--white)',marginBottom:4,fontWeight:500}}>⚡ Quick Seat Players</div>
        <div style={{fontSize:12,color:'var(--muted)',marginBottom:18,fontFamily:'var(--font-body),sans-serif'}}>Add players before launching the table</div>

        {seated.length > 0 && (
          <div style={{marginBottom:14,display:'flex',flexWrap:'wrap',gap:6}}>
            {seated.map((n,i) => (
              <span key={i} style={{padding:'4px 10px',background:'rgba(76,175,125,0.1)',border:'1px solid rgba(76,175,125,0.25)',borderRadius:2,fontSize:11,color:'var(--green)',fontFamily:'var(--font-body),sans-serif'}}>
                ✓ {n}
              </span>
            ))}
          </div>
        )}

        <div style={{display:'grid',gap:10,marginBottom:14}}>
          <div>
            <div className="lbl" style={{marginBottom:5}}>Name *</div>
            <input className="inp" placeholder="Player name" value={name} onChange={e=>setName(e.target.value)}
              onKeyDown={e=>e.key==='Enter'&&seat()} autoFocus/>
          </div>
          <div>
            <div className="lbl" style={{marginBottom:5}}>WhatsApp (optional)</div>
            <input className="inp" placeholder="+61 400 000 000" type="tel" value={wa} onChange={e=>setWa(e.target.value)}/>
          </div>
        </div>

        <div style={{display:'flex',gap:8}}>
          <button className="btn btn-primary" style={{flex:1}} disabled={!name.trim()||saving} onClick={seat}>
            {saving ? 'Seating…' : '+ Seat Player'}
          </button>
          <button className="btn btn-ghost" onClick={()=>{ onSeated(); }}>
            {seated.length > 0 ? 'Done' : 'Cancel'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Game Card with RSVP count + push + links ───
function GameCard({game,appUrl,eventName,isHost,onClick,onQuickSeat,onCancel,onDelete}:any) {
  const lobbyUrl = `${appUrl}/games/${game.id}/lobby`;
  const liveUrl  = game.live_token ? `${appUrl}/games/live/${game.live_token}` : '';
  const statusBg:Record<string,string> = {
    scheduled:'rgba(201,168,76,0.08)', active:'rgba(0,255,136,0.08)',
    lobby:'rgba(201,168,76,0.12)', settled:'transparent',
  };
  const statusDot:Record<string,string> = {
    scheduled:'var(--amber)', active:'var(--green)', lobby:'var(--gold)', settled:'var(--muted)',
  };
  return (
    <div className="card" style={{marginBottom:8,background:statusBg[game.status]||'transparent'}}>
      <div style={{padding:'16px 18px',display:'flex',alignItems:'flex-start',gap:14,cursor:'pointer'}} onClick={onClick}>
        <div style={{flex:1}}>
          <div style={{display:'flex',alignItems:'center',gap:8,marginBottom:4}}>
            <div style={{width:7,height:7,borderRadius:'50%',background:statusDot[game.status]||'var(--faint)',flexShrink:0}}/>
            <div style={{fontSize:15,color:'var(--white)',fontFamily:'var(--font-display),serif',fontWeight:500}}>{fmtDate(game.scheduled_at)}</div>
          </div>
          {game.location && <div style={{fontSize:12,color:'var(--muted)',marginBottom:4}}>📍 {game.location}</div>}
          {game.notes && <div style={{fontSize:11,color:'var(--faint)',fontStyle:'italic'}}>{game.notes}</div>}
          {(game as any).format && (game as any).format !== 'cash' && (
            <span style={{display:'inline-block',marginTop:4,padding:'2px 8px',borderRadius:2,fontSize:10,fontWeight:500,
              letterSpacing:'0.1em',textTransform:'uppercase',fontFamily:'var(--font-body),sans-serif',
              background:'rgba(201,168,76,0.08)',border:'1px solid rgba(201,168,76,0.2)',color:'var(--gold)'}}>
              {String(({tournament:'🏆 Tournament',rebuy:'♻️ Rebuy',freezeout:'❄️ Freezeout'} as {[k:string]:string})[(game as any).format] || (game as any).format)}
            </span>
          )}
          <div style={{display:'flex',gap:8,marginTop:6,alignItems:'center'}}>
            <span className={`badge badge-${game.status}`}>{game.status}</span>
            <span style={{fontSize:10,color:'var(--faint)',fontFamily:'var(--font-body),sans-serif'}}>{game.seats||9} seats</span>
          </div>
        </div>
        <span style={{color:'var(--faint)',fontSize:16,marginTop:2}}>›</span>
      </div>
      {/* Quick share row */}
      {(game.status==='scheduled'||game.status==='lobby'||game.status==='active') && (
        <div style={{borderTop:'1px solid var(--border-sub)',padding:'8px 14px',display:'flex',gap:6,flexWrap:'wrap'}}>
          {isHost && (game.status==='scheduled'||game.status==='lobby') && (
            <button onClick={(e)=>{e.stopPropagation();onQuickSeat();}}
              className="btn btn-ghost" style={{fontSize:10,padding:'5px 10px',color:'var(--gold)',borderColor:'rgba(201,168,76,0.3)'}}>
              ⚡ Quick Seat
            </button>
          )}
          {isHost && game.status==='scheduled' && (<>
            <button onClick={(e)=>{e.stopPropagation();onCancel();}}
              className="btn btn-ghost" style={{fontSize:10,padding:'5px 10px',color:'var(--amber)',borderColor:'rgba(212,137,26,0.3)'}}>
              Cancel
            </button>
            <button onClick={(e)=>{e.stopPropagation();onDelete();}}
              className="btn btn-danger" style={{fontSize:10,padding:'5px 10px'}}>
              Delete
            </button>
          </>)}
          <button onClick={(e)=>{e.stopPropagation();navigator.clipboard.writeText(lobbyUrl).then(()=>alert('RSVP link copied!'));}}
            className="btn btn-ghost" style={{fontSize:10,padding:'5px 10px'}}>
            📋 RSVP Link
          </button>
          <a onClick={e=>e.stopPropagation()} href={`https://wa.me/?text=${encodeURIComponent(`🃏 *${eventName}*\n${fmtDate(game.scheduled_at)}${game.location?'\n📍 '+game.location:''}\n\nRSVP: ${lobbyUrl}`)}`}
            target="_blank" rel="noopener noreferrer" className="btn btn-ghost"
            style={{fontSize:10,padding:'5px 10px',textDecoration:'none',display:'flex',alignItems:'center'}}>
            📱 WhatsApp
          </a>
          {liveUrl && game.status==='active' && (
            <button onClick={(e)=>{e.stopPropagation();navigator.clipboard.writeText(liveUrl).then(()=>alert('Live link copied!'));}}
              className="btn btn-ghost" style={{fontSize:10,padding:'5px 10px',color:'var(--green)'}}>
              📡 Live Link
            </button>
          )}
        </div>
      )}
    </div>
  );
}


function PlayerHistoryCard({ player, history, leader, onClose }: {
  player: string;
  history: any[];
  leader: any;
  onClose: () => void;
}) {
  const playerGames = history.filter((g:any)=>
    (g.top_players||[]).some((p:any)=>p.display_name===player) ||
    (g.all_players||[]).some((p:any)=>p.display_name===player)
  );
  return (
    <div style={{marginTop:12,background:'var(--bg2)',border:'1px solid var(--border-hi)',borderRadius:3,overflow:'hidden'}}>
      <div style={{padding:'12px 16px',borderBottom:'1px solid var(--border-sub)',display:'flex',alignItems:'center',justifyContent:'space-between'}}>
        <div>
          <div style={{fontSize:14,color:'var(--white)',fontFamily:'var(--font-display),serif',fontWeight:500}}>{player}</div>
          {leader && (
            <div style={{fontSize:11,color:'var(--muted)',marginTop:2,fontFamily:'var(--font-body),sans-serif'}}>
              {leader.games_played} games · {leader.games_won} wins · best {leader.biggest_win>0?'+':''}{(leader.biggest_win/100).toFixed(0)} · worst -{(leader.biggest_loss/100).toFixed(0)}
            </div>
          )}
        </div>
        <button onClick={onClose}
          style={{background:'none',border:'none',color:'var(--faint)',fontSize:18,cursor:'pointer',padding:'2px 6px'}}>✕</button>
      </div>
      {playerGames.length===0 && (
        <div style={{padding:'16px',fontSize:12,color:'var(--muted)',fontFamily:'var(--font-body),sans-serif'}}>No settled game history for this player yet.</div>
      )}
      {playerGames.map((g:any)=>{
        const pp = (g.top_players||[]).find((p:any)=>p.display_name===player)
                || (g.all_players||[]).find((p:any)=>p.display_name===player);
        const net = pp?.net ?? null;
        return (
          <div key={g.id} style={{display:'flex',alignItems:'center',gap:12,padding:'10px 16px',
            borderBottom:'1px solid var(--border-sub)'}}>
            <div style={{flex:1}}>
              <div style={{fontSize:12,color:'var(--ivory)',fontFamily:'var(--font-body),sans-serif'}}>{new Date(g.scheduled_at*1000).toLocaleDateString('en-AU',{weekday:'short',month:'short',day:'numeric'})}</div>
              {g.location && <div style={{fontSize:10,color:'var(--faint)',marginTop:1}}>{g.location}</div>}
            </div>
            {net!==null && (
              <div style={{fontSize:15,fontWeight:600,fontFamily:'serif',
                color:net>0?'var(--green)':net<0?'var(--red)':'var(--muted)'}}>
                {net>0?'+':''}{(net/100).toFixed(0)}
              </div>
            )}
          </div>
        );
      })}
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
