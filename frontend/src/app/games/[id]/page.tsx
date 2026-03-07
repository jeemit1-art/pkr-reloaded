"use client";
import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { api, fmtDate, fmt, fmtSign } from "@/lib/api";

export default function GamePage() {
  const params = useParams();
  const router = useRouter();
  const id = (Array.isArray(params.id) ? params.id[0] : params.id) as string;

  const [game,    setGame]    = useState<any>(null);
  const [isHost,  setIsHost]  = useState(false);
  const [loading, setLoading] = useState(true);
  const [confirm, setConfirm] = useState<'cancel'|'delete'|'unsettle'|null>(null);
  const [acting,  setActing]  = useState(false);
  const appUrl = typeof window !== 'undefined' ? window.location.origin : '';

  useEffect(() => {
    Promise.all([api.games.get(id), api.auth.me()])
      .then(([g, u]: any) => {
        setGame(g);
        api.events.get(g.event_id).then((ev: any) => {
          const me = (ev.members||[]).find((m: any) => m.id === u.id);
          setIsHost(me?.role === 'host' || me?.role === 'cohost');
        }).catch(() => {});
      })
      .catch(() => router.push('/dashboard'))
      .finally(() => setLoading(false));
  }, [id]);

  async function doCancel() {
    setActing(true);
    try { await api.games.cancel(id); setGame((g:any)=>({...g,status:'cancelled'})); }
    catch(e:any) { alert(e.message); }
    finally { setActing(false); setConfirm(null); }
  }

  async function doDelete() {
    setActing(true);
    try { await api.games.delete(id); router.push(`/events/${game.event_id}`); }
    catch(e:any) { alert(e.message); setActing(false); setConfirm(null); }
  }

  async function doUnsettle() {
    setActing(true);
    try { await api.games.unsettle(id); setGame((g:any)=>({...g,status:'active'})); }
    catch(e:any) { alert(e.message); }
    finally { setActing(false); setConfirm(null); }
  }

  if (loading) return (
    <div style={{minHeight:'100vh',background:'var(--bg)',display:'flex',alignItems:'center',justifyContent:'center'}}>
      <div className="display" style={{fontSize:48,color:'var(--gold)',opacity:0.6}}>PKR</div>
    </div>
  );
  if (!game) return null;

  const lobbyUrl   = `${appUrl}/games/${game.id}/lobby`;
  const resultsUrl = game.results_token ? `${appUrl}/games/results/${game.results_token}` : '';
  const statusColor: any = {
    scheduled:'var(--amber)', lobby:'var(--gold)',
    active:'var(--green)', settled:'var(--green)', cancelled:'var(--red)'
  };
  const yesRsvps   = (game.rsvps||[]).filter((r:any)=>r.status==='yes');
  const maybeRsvps = (game.rsvps||[]).filter((r:any)=>r.status==='maybe');
  const seated     = (game.players||[]).filter((p:any)=>p.buy_ins>0);
  const cashedOut  = (game.players||[]).filter((p:any)=>p.cashout!=null);

  return (
    <div style={{minHeight:'100vh',background:'var(--bg)',paddingBottom:80}}>
      <div style={{position:'fixed',bottom:-60,right:-40,fontSize:420,opacity:0.018,
        color:'var(--gold)',lineHeight:1,userSelect:'none',pointerEvents:'none',fontFamily:'serif',zIndex:0}}>♠</div>

      {/* Header */}
      <div style={{background:'var(--bg2)',borderBottom:'1px solid var(--border-sub)',
        position:'sticky',top:0,zIndex:50,backdropFilter:'blur(16px)'}}>
        <div style={{maxWidth:640,margin:'0 auto',padding:'0 16px',height:56,
          display:'flex',alignItems:'center',gap:12}}>
          <button onClick={()=>router.push(`/events/${game.event_id}`)}
            style={{background:'none',border:'none',color:'var(--muted)',cursor:'pointer',
              fontSize:20,padding:'4px 8px',lineHeight:1}}>‹</button>
          <div style={{flex:1,minWidth:0}}>
            <div className="display" style={{fontSize:15,color:'var(--white)',fontWeight:500,
              overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>
              {game.event_name || 'Game'}
            </div>
          </div>
          <div style={{display:'flex',alignItems:'center',gap:6}}>
            <span style={{width:7,height:7,borderRadius:'50%',
              background:statusColor[game.status]||'var(--faint)',display:'inline-block'}}/>
            <span style={{fontSize:11,color:statusColor[game.status]||'var(--faint)',
              fontFamily:'var(--font-body),sans-serif',textTransform:'capitalize'}}>{game.status}</span>
          </div>
        </div>
      </div>

      <div style={{maxWidth:640,margin:'0 auto',padding:'20px 16px',position:'relative',zIndex:1}}>

        {/* Game info card */}
        <div className="card-gold" style={{padding:'20px',marginBottom:16}}>
          <div className="display" style={{fontSize:22,color:'var(--white)',fontWeight:500,marginBottom:4}}>
            {fmtDate(game.scheduled_at)}
          </div>
          {game.location && (
            <div style={{fontSize:13,color:'var(--muted)',marginBottom:8,fontFamily:'var(--font-body),sans-serif'}}>
              📍 {game.location}
            </div>
          )}
          {game.notes && (
            <div style={{fontSize:12,color:'var(--faint)',fontStyle:'italic',marginBottom:8,fontFamily:'var(--font-body),sans-serif'}}>
              {game.notes}
            </div>
          )}
          {game.format && game.format !== 'cash' && (
            <span style={{fontSize:10,color:'var(--gold)',fontFamily:'var(--font-body),sans-serif',
              letterSpacing:'0.08em',textTransform:'uppercase',padding:'2px 8px',borderRadius:2,
              background:'rgba(201,168,76,0.1)',border:'1px solid rgba(201,168,76,0.2)'}}>
              {({tournament:'🏆 Tournament',rebuy:'♻️ Rebuy',freezeout:'❄️ Freezeout'} as any)[game.format]||game.format}
            </span>
          )}
          <div style={{display:'flex',gap:20,marginTop:16,paddingTop:14,borderTop:'1px solid var(--border-sub)'}}>
            {[
              {label:'Seats',  value: game.seats||9,                            color:'var(--white)'},
              {label:'Buy-in', value: game.buy_in>0 ? fmt(game.buy_in) : '—',   color:'var(--gold)'},
              {label:'RSVPs',  value: yesRsvps.length,                          color:'var(--green)'},
              {label:'Seated', value: (game.players||[]).length,                color:'var(--ivory)'},
            ].map(s=>(
              <div key={s.label}>
                <div className="display" style={{fontSize:20,color:s.color,fontWeight:500,lineHeight:1}}>{s.value}</div>
                <div style={{fontSize:9,letterSpacing:'0.18em',textTransform:'uppercase',
                  color:'var(--muted)',marginTop:3,fontFamily:'var(--font-body),sans-serif',fontWeight:500}}>{s.label}</div>
              </div>
            ))}
          </div>
        </div>

        {/* Primary actions */}
        {game.status==='scheduled' && (
          <button className="btn btn-primary" style={{width:'100%',fontSize:14,padding:'14px',marginBottom:12}}
            onClick={()=>router.push(`/games/${id}/lobby`)}>▶ Open Lobby</button>
        )}
        {game.status==='lobby' && (
          <button className="btn btn-primary" style={{width:'100%',fontSize:14,padding:'14px',marginBottom:12}}
            onClick={()=>router.push(`/games/${id}/lobby`)}>♠ View Lobby</button>
        )}
        {game.status==='active' && isHost && (
          <button className="btn btn-primary" style={{width:'100%',fontSize:14,padding:'14px',marginBottom:12,
            background:'linear-gradient(135deg,#1a8a4a,#0f5a2e)',color:'var(--white)'}}
            onClick={()=>router.push(`/games/${id}/play`)}>🃏 Open Table</button>
        )}
        {game.status==='active' && !isHost && game.live_token && (
          <button className="btn btn-ghost" style={{width:'100%',fontSize:13,padding:'12px',marginBottom:12}}
            onClick={()=>router.push(`/games/live/${game.live_token}`)}>📡 Watch Live Scores</button>
        )}
        {game.status==='settled' && resultsUrl && (
          <button className="btn btn-primary" style={{width:'100%',fontSize:14,padding:'14px',marginBottom:12,
            background:'linear-gradient(135deg,#1a8a4a,#0f5a2e)',color:'var(--white)'}}
            onClick={()=>router.push(`/games/results/${game.results_token}`)}>✅ View Results</button>
        )}

        {/* Share row */}
        {(game.status==='scheduled'||game.status==='lobby') && (
          <div style={{display:'flex',gap:8,marginBottom:16,flexWrap:'wrap'}}>
            <button className="btn btn-ghost" style={{fontSize:11,padding:'7px 12px'}}
              onClick={()=>navigator.clipboard.writeText(lobbyUrl).then(()=>alert('RSVP link copied!'))}>
              📋 Copy RSVP Link
            </button>
            <a href={`https://wa.me/?text=${encodeURIComponent(`🃏 ${game.event_name}\n${fmtDate(game.scheduled_at)}${game.location?'\n📍 '+game.location:''}\n\nRSVP here: ${lobbyUrl}`)}`}
              target="_blank" rel="noopener noreferrer" className="btn btn-ghost"
              style={{fontSize:11,padding:'7px 12px',textDecoration:'none',display:'inline-flex',alignItems:'center'}}>
              📱 WhatsApp Invite
            </a>
          </div>
        )}
        {game.status==='active' && game.live_token && (
          <div style={{display:'flex',gap:8,marginBottom:16}}>
            <button className="btn btn-ghost" style={{fontSize:11,padding:'7px 12px',color:'var(--green)'}}
              onClick={()=>navigator.clipboard.writeText(`${appUrl}/games/live/${game.live_token}`).then(()=>alert('Live link copied!'))}>
              📡 Copy Live Link
            </button>
          </div>
        )}
        {game.status==='settled' && resultsUrl && (
          <div style={{display:'flex',gap:8,marginBottom:16,flexWrap:'wrap'}}>
            <button className="btn btn-ghost" style={{fontSize:11,padding:'7px 12px'}}
              onClick={()=>navigator.clipboard.writeText(resultsUrl).then(()=>alert('Results link copied!'))}>
              📋 Copy Results Link
            </button>
            <a href={`https://wa.me/?text=${encodeURIComponent(`♠ ${game.event_name} results: ${resultsUrl}`)}`}
              target="_blank" rel="noopener noreferrer" className="btn btn-ghost"
              style={{fontSize:11,padding:'7px 12px',textDecoration:'none',display:'inline-flex',alignItems:'center'}}>
              📱 Share Results
            </a>
          </div>
        )}

        {/* RSVPs */}
        {(game.rsvps||[]).length>0 && (
          <div className="card" style={{marginBottom:14}}>
            <div style={{padding:'12px 16px',borderBottom:'1px solid var(--border-sub)',fontSize:9,
              letterSpacing:'0.18em',textTransform:'uppercase',color:'var(--muted)',
              fontFamily:'var(--font-body),sans-serif',fontWeight:500}}>
              RSVPs — {yesRsvps.length} in · {maybeRsvps.length} maybe · {(game.rsvps||[]).filter((r:any)=>r.status==='no').length} out
            </div>
            {(game.rsvps||[]).map((r:any)=>(
              <div key={r.id} style={{display:'flex',alignItems:'center',gap:12,
                padding:'10px 16px',borderBottom:'1px solid var(--border-sub)'}}>
                <span style={{fontSize:14,width:18,textAlign:'center',
                  color:r.status==='yes'?'var(--green)':r.status==='maybe'?'var(--amber)':'var(--red)'}}>
                  {r.status==='yes'?'✓':r.status==='maybe'?'~':'✗'}
                </span>
                <span style={{flex:1,fontSize:14,color:'var(--white)',fontFamily:'var(--font-display),serif'}}>
                  {r.display_name}
                </span>
                {r.whatsapp && (
                  <a href={`https://wa.me/${r.whatsapp.replace(/\D/g,'')}?text=${encodeURIComponent(`Game on — ${fmtDate(game.scheduled_at)}`)}`}
                    target="_blank" rel="noopener noreferrer"
                    style={{fontSize:11,color:'var(--gold)',textDecoration:'none',fontFamily:'var(--font-body),sans-serif'}}>
                    WA
                  </a>
                )}
              </div>
            ))}
          </div>
        )}

        {/* Players */}
        {(game.players||[]).length>0 && (
          <div className="card" style={{marginBottom:14}}>
            <div style={{padding:'12px 16px',borderBottom:'1px solid var(--border-sub)',fontSize:9,
              letterSpacing:'0.18em',textTransform:'uppercase',color:'var(--muted)',
              fontFamily:'var(--font-body),sans-serif',fontWeight:500}}>
              Players — {seated.length} bought in · {cashedOut.length} cashed out
            </div>
            {(game.players||[]).map((p:any,i:number)=>(
              <div key={i} style={{display:'flex',alignItems:'center',gap:12,
                padding:'10px 16px',borderBottom:'1px solid var(--border-sub)'}}>
                <div style={{width:28,height:28,borderRadius:'50%',background:'var(--bg3)',
                  border:'1px solid var(--border-sub)',display:'flex',alignItems:'center',
                  justifyContent:'center',fontSize:10,color:'var(--gold)',fontWeight:600,flexShrink:0}}>
                  {p.seat_number||i+1}
                </div>
                <div style={{flex:1}}>
                  <div style={{fontSize:14,color:'var(--white)',fontFamily:'var(--font-display),serif'}}>
                    {p.display_name}
                  </div>
                  <div style={{fontSize:11,color:'var(--muted)',fontFamily:'var(--font-body),sans-serif',marginTop:1}}>
                    ×{p.buy_ins} buy-in{p.buy_ins!==1?'s':''}
                    {p.cashout!=null ? ` · cashed $${(p.cashout/100).toFixed(0)}` : ' · still in'}
                  </div>
                </div>
                {p.net!=null && (
                  <div className="display" style={{fontSize:16,fontWeight:500,
                    color:p.net>0?'var(--green)':p.net<0?'var(--red)':'var(--muted)'}}>
                    {fmtSign(p.net)}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}

        {/* Settlements */}
        {game.status==='settled' && (game.transfers||[]).length>0 && (
          <div className="card" style={{marginBottom:14}}>
            <div style={{padding:'12px 16px',borderBottom:'1px solid var(--border-sub)',fontSize:9,
              letterSpacing:'0.18em',textTransform:'uppercase',color:'var(--muted)',
              fontFamily:'var(--font-body),sans-serif',fontWeight:500}}>Settlements</div>
            {(game.transfers||[]).map((t:any,i:number)=>(
              <div key={i} style={{display:'flex',alignItems:'center',gap:8,
                padding:'12px 16px',borderBottom:'1px solid var(--border-sub)'}}>
                <span style={{fontSize:13,color:'var(--red)',fontFamily:'var(--font-display),serif',flex:1}}>
                  {t.from_name}
                </span>
                <span style={{fontSize:12,color:'var(--muted)',fontFamily:'var(--font-body),sans-serif'}}>
                  pays ${(t.amount/100).toFixed(2)}
                </span>
                <span style={{fontSize:13,color:'var(--green)',fontFamily:'var(--font-display),serif',flex:1,textAlign:'right'}}>
                  {t.to_name}
                </span>
              </div>
            ))}
          </div>
        )}

        {/* Host actions */}
        {isHost && game.status!=='cancelled' && (
          <div style={{marginTop:24}}>
            <div style={{fontSize:9,letterSpacing:'0.18em',textTransform:'uppercase',
              color:'var(--faint)',fontFamily:'var(--font-body),sans-serif',fontWeight:500,marginBottom:12}}>
              Host Actions
            </div>
            <div style={{display:'flex',gap:8,flexWrap:'wrap'}}>
              {game.status==='settled' && (
                <button className="btn btn-ghost"
                  style={{fontSize:11,padding:'7px 12px',color:'var(--amber)',borderColor:'rgba(212,137,26,0.3)'}}
                  onClick={()=>setConfirm('unsettle')}>↩ Unsettle</button>
              )}
              {game.status!=='settled' && (
                <button className="btn btn-ghost"
                  style={{fontSize:11,padding:'7px 12px',color:'var(--amber)',borderColor:'rgba(212,137,26,0.3)'}}
                  onClick={()=>setConfirm('cancel')}>Cancel Game</button>
              )}
              <button className="btn btn-danger" style={{fontSize:11,padding:'7px 12px'}}
                onClick={()=>setConfirm('delete')}>Delete Game</button>
            </div>
          </div>
        )}

      </div>

      {/* Confirm modal */}
      {confirm && (
        <div className="modal-overlay" onClick={()=>!acting&&setConfirm(null)}>
          <div className="modal animate-up" onClick={(e:any)=>e.stopPropagation()} style={{maxWidth:360}}>
            <div style={{padding:'24px 24px 0'}}>
              <div style={{fontSize:16,color:'var(--white)',fontFamily:'var(--font-display),serif',fontWeight:500,marginBottom:8}}>
                {confirm==='cancel'?'Cancel Game?':confirm==='delete'?'Delete Game?':'Unsettle Game?'}
              </div>
              <div style={{fontSize:13,color:'var(--muted)',lineHeight:1.7,fontFamily:'var(--font-body),sans-serif'}}>
                {confirm==='cancel' && "Marks the game as cancelled. It stays in history but won't appear in active games or affect the leaderboard."}
                {confirm==='delete' && 'Permanently removes the game and all player data. The leaderboard will be recalculated. This cannot be undone.'}
                {confirm==='unsettle' && 'Reopens the game as active so results can be corrected. Settle again when done.'}
              </div>
            </div>
            <div style={{padding:'20px 24px',display:'flex',gap:8,justifyContent:'flex-end'}}>
              <button className="btn btn-ghost" style={{fontSize:12}} onClick={()=>setConfirm(null)} disabled={acting}>
                Keep it
              </button>
              <button
                className={confirm==='unsettle'?'btn btn-primary':'btn btn-danger'}
                style={{fontSize:12}} disabled={acting}
                onClick={confirm==='cancel'?doCancel:confirm==='delete'?doDelete:doUnsettle}>
                {acting?'Working…':confirm==='cancel'?'Cancel game':confirm==='delete'?'Delete permanently':'Yes, Unsettle'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
