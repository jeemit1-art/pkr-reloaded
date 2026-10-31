"use client";
import RecordMetric from '@/components/RecordMetric';
import AppDialog from '@/components/AppDialog';

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { api, fmtDate, fmt, fmtSign } from "@/lib/api";
import {isUnfinishedGame,isLiveGame,gameStatusLabel} from '@/lib/game-status';

export default function GamePage() {
  const params = useParams();
  const router = useRouter();
  const id = (Array.isArray(params.id) ? params.id[0] : params.id) as string;

  const [game,    setGame]    = useState<any>(null);
  const [isHost,  setIsHost]  = useState(false);
  const [loading, setLoading] = useState(true);
  const [starting, setStarting] = useState(false);
  const [confirm, setConfirm] = useState<'cancel'|'delete'|'unsettle'|null>(null);
  const [acting,  setActing]  = useState(false);
  const [settlementControl,setSettlementControl]=useState<{enabled:boolean;reminders_enabled:boolean;last_broadcast_at:number|null}|null>(null);
  const [reminderChoice,setReminderChoice]=useState(false);
  const [settlementNotice,setSettlementNotice]=useState('');
  const [sendingSettlement,setSendingSettlement]=useState(false);

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

  useEffect(()=>{
    if(!isHost||game?.status!=='settled')return;
    let active=true;
    api.games.settlementControl(id).then(value=>{
      if(active){setSettlementControl(value);setReminderChoice(value.reminders_enabled)}
    }).catch(e=>{
      if(active)setSettlementNotice(e?.message?.includes('503')
        ?'Settlement notification upgrades are not activated for this room yet.'
        :'Payment notification controls are currently unavailable.');
    });
    return()=>{active=false};
  },[isHost,game?.status,id]);

  async function sendSettlementNotifications(){
    if(sendingSettlement)return;
    if(!window.confirm('Send individual payment and receipt instructions to verified players who have enabled PKR push notifications?'))return;
    setSendingSettlement(true);setSettlementNotice('');
    try{
      const result=await api.games.broadcastSettlement(id,reminderChoice);
      setSettlementControl({enabled:true,reminders_enabled:reminderChoice,last_broadcast_at:Math.floor(Date.now()/1000)});
      setSettlementNotice('Settlement notifications initiated for '+result.transfers+
        ' transfers. '+result.push_accepted+' device notification(s) accepted; '+
        result.recipients_without_accepted_push+
        ' recipient notification(s) had no confirmed push acceptance. Share their private results link directly.');
    }catch(e:any){setSettlementNotice(e?.message||'Notification request failed')}
    finally{setSendingSettlement(false)}
  }
  async function updateSettlementReminders(enabled:boolean){
    if(!settlementControl?.enabled){setReminderChoice(enabled);return}
    setSendingSettlement(true);
    try{
      await api.games.settlementReminders(id,enabled);
      setReminderChoice(enabled);
      setSettlementControl(x=>x?{...x,reminders_enabled:enabled}:x);
      setSettlementNotice(enabled?'24-hour reminders enabled for outstanding transfers.':'24-hour reminders paused.');
    }catch(e:any){setSettlementNotice(e?.message||'Could not change reminders')}
    finally{setSendingSettlement(false)}
  }

  async function doStartGame() {
    setStarting(true);
    try {
      await api.games.start(id);
    } catch(e: any) {
      if (!e.message?.toLowerCase().includes('already')) {
        alert(e.message);
        setStarting(false);
        return;
      }
    }
    router.push(`/games/${id}/play`);
  }

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

  const unfinished=isUnfinishedGame(game);
  const live=isLiveGame(game);
  const lobbyUrl   = `${appUrl}/games/${game.id}/rsvp`;
  const resultsUrl = game.results_token ? `${appUrl}/games/results/${game.results_token}` : '';
  const statusColor: any = {
    scheduled:'var(--amber)', lobby:'var(--gold)',
    active:'var(--green)', settled:'var(--green)', cancelled:'var(--red)'
  };
  const yesRsvps   = (game.rsvps||[]).filter((r:any)=>r.status==='yes');
  const seated     = (game.players||[]).filter((p:any)=>p.buy_ins>0);
  const cashedOut  = (game.players||[]).filter((p:any)=>p.cashout!=null);

  return (
    <div className="pkr-app pkr-game-detail pkr-casino" style={{minHeight:'100vh',paddingBottom:80}}>
      <div style={{position:'fixed',bottom:-60,right:-40,fontSize:420,opacity:0.018,
        color:'var(--gold)',lineHeight:1,userSelect:'none',pointerEvents:'none',fontFamily:'serif',zIndex:0}}>♠</div>

      {/* Header */}
      <div className="pkr-topbar" style={{background:'var(--bg2)',borderBottom:'1px solid var(--border-sub)',
        position:'sticky',top:0,zIndex:50,backdropFilter:'blur(16px)'}}>
        <div style={{maxWidth:960,margin:'0 auto',padding:'0 16px',height:60,
          display:'flex',alignItems:'center',gap:12}}>
          <button aria-label="Back to poker room" onClick={()=>router.push(`/events/${game.event_id}`)}
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
            <span className={live ? 'pkr-live-chip' : ''}
              style={{fontSize:11,color:statusColor[game.status]||'var(--faint)',
              fontFamily:'var(--font-body),sans-serif',textTransform:live?'uppercase':'capitalize'}}>
              {gameStatusLabel(game)}
            </span>
          </div>
        </div>
      </div>

      <div className="pkr-content pkr-game-detail-shell" style={{maxWidth:960,margin:'0 auto',padding:'24px 16px',position:'relative',zIndex:1}}>
        {unfinished&&<div className="pkr-unfinished-note" role="status" style={{marginBottom:16}}>
          <strong>Historical unfinished game</strong>
          <p>This game is still saved as {game.status}, but its scheduled date has passed. It is not being advertised as live. All player and financial records remain unchanged.</p>
        </div>}

        {/* Game info card */}
        <div className="card-gold pkr-game-summary pkr-casino-game-summary" style={{padding:'20px',marginBottom:16}}>
          <div className="pkr-eyebrow" style={{marginBottom:8}}>Game night</div>
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
          <div className="pkr-game-metrics" style={{display:'grid',gridTemplateColumns:'repeat(4,minmax(0,1fr))',gap:12,marginTop:16,paddingTop:14,borderTop:'1px solid var(--border-sub)'}}>
            {[
              {label:'Seats',  value:game.seats,                               color:'var(--white)'},
              {label:'Buy-in', value:game.buy_in>0 ? fmt(game.buy_in) : '—',   color:'var(--gold)'},
              {label:'RSVPs',  value:yesRsvps.length,                          color:'var(--green)'},
              {label:'Seated', value:(game.players||[]).length,                color:'var(--ivory)'},
            ].map(s=>(
              <div key={s.label}><RecordMetric request={{kind:s.label==='Seats'?'seats':s.label==='Buy-in'?'game':s.label==='RSVPs'?'rsvps':'players',title:s.label,gameId:id,filter:s.label==='RSVPs'?'yes':'all'}}>
                <div className="display" style={{fontSize:20,color:s.color,fontWeight:500,lineHeight:1}}>{s.value}</div>
                <div style={{fontSize:9,letterSpacing:'0.18em',textTransform:'uppercase',
                  color:'var(--muted)',marginTop:3,fontFamily:'var(--font-body),sans-serif',fontWeight:500}}>{s.label}</div>
              </RecordMetric></div>
            ))}
          </div>
        </div>

        {/* Live financial totals are calculated in the table from recorded transactions.
            Here we show confirmed activity counts, not inferred money balances. */}
        {(game.players||[]).length>0 && (
          <div className="pkr-player-activity" aria-label="Player activity">
            <div><RecordMetric request={{kind:'players',title:"Players bought in",gameId:id,filter:'bought-in'}}><strong>{seated.length}</strong><span>Players bought in</span></RecordMetric></div>
            <div><RecordMetric request={{kind:'players',title:"Players cashed out",gameId:id,filter:'cashed-out'}}><strong>{cashedOut.length}</strong><span>Players cashed out</span></RecordMetric></div>
            <div><RecordMetric request={{kind:'players',title:"All game players",gameId:id,filter:'all'}}><strong>{(game.players||[]).length}</strong><span>Total players</span></RecordMetric></div>
          </div>
        )}

        {/* ── Primary actions ── */}

        {/* Host: scheduled or lobby — Start Game + RSVP lobby */}
        {(game.status==='scheduled'||game.status==='lobby') && isHost && (<>
          <button className="btn btn-primary"
            style={{width:'100%',fontSize:14,padding:'14px',marginBottom:8,
              background:'var(--gold)',color:'#06271d',
              opacity:starting?0.7:1}}
            disabled={starting}
            onClick={doStartGame}>
            {starting ? 'Starting…' : '🃏 Start Game'}
          </button>
          <button className="btn btn-ghost"
            style={{width:'100%',fontSize:12,padding:'10px',marginBottom:12}}
            onClick={()=>router.push(`/games/${id}/rsvp`)}>
            👥 Live RSVP & Arrival Times
          </button>
        </>)}

        {/* Player: scheduled or lobby — RSVP */}
        {(game.status==='scheduled'||game.status==='lobby') && !isHost && (
          <button className="btn btn-primary"
            style={{width:'100%',fontSize:14,padding:'14px',marginBottom:12}}
            onClick={()=>router.push(`/games/${id}/rsvp`)}>
            ✋ RSVP & Choose Your Seat
          </button>
        )}

        {/* Host: active — return to table */}
        {game.status==='active' && isHost && (
          <button className="btn btn-primary"
            style={{width:'100%',fontSize:14,padding:'14px',marginBottom:12,
              background:'var(--gold)',color:'#06271d'}}
            onClick={()=>router.push(`/games/${id}/play`)}>
            🃏 {unfinished?'Resume / Review Table':'Open Table'}
          </button>
        )}

        {/* Player: active — watch live */}
        {game.status==='active' && !isHost && game.live_token && (
          <button className="btn btn-ghost"
            style={{width:'100%',fontSize:13,padding:'12px',marginBottom:12}}
            onClick={()=>router.push(`/games/live/${game.live_token}`)}>
            📡 {unfinished?'View Saved Table':'Watch Live Scores'}
          </button>
        )}

        {/* Settled */}
        {game.status==='settled' && resultsUrl && (
          <button className="btn btn-primary"
            style={{width:'100%',fontSize:14,padding:'14px',marginBottom:12,
              background:'var(--gold)',color:'#06271d'}}
            onClick={()=>router.push(`/games/results/${game.results_token}`)}>
            ✅ View Results
          </button>
        )}

        {/* Payment collection is a separate step after final results and end game. */}
        {isHost&&game.status==='settled'&&(
          <section className="card" aria-label="Settlement notification centre"
            style={{padding:'16px',marginBottom:16,border:'1px solid var(--gold-dim)'}}>
            <h3 style={{fontSize:16,margin:'0 0 8px'}}>Settlement notifications</h3>
            <p style={{fontSize:12,color:'var(--muted)',lineHeight:1.6,marginBottom:12}}>
              Saved results are final. Notify each verified payer and recipient of their respective transfer amounts.
              PKR does not handle the money. Players who have not enabled notifications must be contacted separately.
            </p>
            <label style={{display:'flex',alignItems:'center',gap:9,fontSize:12,marginBottom:12}}>
              <input type="checkbox" checked={reminderChoice} disabled={sendingSettlement}
                onChange={e=>void updateSettlementReminders(e.target.checked)}/>
              Repeat outstanding-payment reminders every 24 hours
            </label>
            <button className="btn btn-primary" style={{width:'100%',fontSize:13,padding:12}}
              type="button" disabled={sendingSettlement||(!settlementControl&&!!settlementNotice)}
              onClick={()=>void sendSettlementNotifications()}>
              {sendingSettlement?'Sending…':settlementControl?.enabled?'Send settlement notices again':'Send settlement notifications'}
            </button>
            {settlementNotice&&<p role="status" style={{marginTop:10,fontSize:12,lineHeight:1.5,color:'var(--muted)'}}>{settlementNotice}</p>}
            {settlementControl?.last_broadcast_at&&
              <p style={{fontSize:11,color:'var(--muted)',marginTop:8}}>
                Previous notification request: {new Date(settlementControl.last_broadcast_at*1000).toLocaleString('en-AU')}
              </p>}
          </section>
        )}

        {game.status!=='cancelled'&&<section className="card" aria-label="Game Night tools"
          style={{padding:'16px 18px',marginBottom:16,border:'1px solid var(--gold-dim)'}}>
          <div style={{fontSize:12,color:'var(--gold)',letterSpacing:'0.08em'}}>GAME NIGHT</div>
          <h3 style={{fontSize:18,margin:'6px 0'}}>RSVPs, seats & sharing</h3>
          <p style={{fontSize:12,color:'var(--muted)',lineHeight:1.55,marginBottom:12}}>
            Open live attendance, share the current game details, manage reminders and see results — without writing a WhatsApp message.
          </p>
          <button className="btn btn-primary" style={{width:'100%',padding:12}} type="button"
            onClick={()=>router.push('/events/'+encodeURIComponent(game.event_id)+'?tab=night&game='+encodeURIComponent(id))}>
            ↗ Open Game Night
          </button>
        </section>}
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
            {isHost&&<button type="button" className="btn btn-ghost"
              style={{fontSize:11,padding:'7px 12px'}}
              onClick={()=>router.push('/events/'+encodeURIComponent(game.event_id)+'?tab=night&game='+encodeURIComponent(id))}>
              📱 Share group-safe results
            </button>}
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
                    x{p.buy_ins} buy-in{p.buy_ins!==1?'s':''}
                    {p.cashout!=null ? ' · cashed $'+(p.cashout/100).toFixed(0) : ' · still in'}
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
                <span style={{fontSize:13,color:'var(--red)',fontFamily:'var(--font-display),serif',flex:1}}>{t.from_name}</span>
                <span style={{fontSize:12,color:'var(--muted)',fontFamily:'var(--font-body),sans-serif'}}>
                  pays ${(t.amount/100).toFixed(2)}
                </span>
                <span style={{fontSize:13,color:'var(--green)',fontFamily:'var(--font-display),serif',flex:1,textAlign:'right'}}>{t.to_name}</span>
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
        <AppDialog className="modal-overlay" onClick={()=>!acting&&setConfirm(null)}>
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
              <button className="btn btn-ghost" style={{fontSize:12}} onClick={()=>setConfirm(null)} disabled={acting}>Keep it</button>
              <button className={confirm==='unsettle'?'btn btn-primary':'btn btn-danger'}
                style={{fontSize:12}} disabled={acting}
                onClick={confirm==='cancel'?doCancel:confirm==='delete'?doDelete:doUnsettle}>
                {acting?'Working…':confirm==='cancel'?'Cancel game':confirm==='delete'?'Delete permanently':'Yes, Unsettle'}
              </button>
            </div>
          </div>
        </AppDialog>
      )}
    </div>
  );
}
