"use client";
import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import RecordMetric from '@/components/RecordMetric';
import PkrGlyph from '@/components/PkrGlyph';

function fmt(cents: number): string {
  const abs = Math.abs(cents);
  const s = `$${(abs/100).toFixed(0)}`;
  return cents < 0 ? `-${s}` : cents > 0 ? `+${s}` : '$0';
}

export default function AnalysisPage() {
  const { id: gameId } = useParams<{id:string}>();
  const router = useRouter();
  const [game, setGame]       = useState<any>(null);
  const [players, setPlayers] = useState<any[]>([]);
  const [analyses, setAnalyses] = useState<any[]>([]);
  const [selPlayer, setSelPlayer] = useState<string|null>(null);
  const [type, setType]       = useState<'game'|'player'>('game');
  const [loading, setLoading] = useState(false);
  const [result, setResult]   = useState<string|null>(null);
  const [error, setError]     = useState('');
  const [pageLoading, setPageLoading] = useState(true);
  const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8787';

  function authFetch(path: string, opts?: RequestInit) {
    const token = typeof window !== 'undefined' ? localStorage.getItem('pkr_token') || '' : '';
    return fetch(`${apiUrl}${path}`, { ...opts, credentials: 'include', headers: { 'Content-Type':'application/json', ...(token?{'Authorization':`Bearer ${token}`}:{}), ...opts?.headers } })
      .then(r => { if (!r.ok) return r.json().catch(()=>({error:'Error'})).then(e=>{throw new Error((e as any).error);}); return r.json(); });
  }

  useEffect(() => {
    Promise.all([authFetch(`/games/${gameId}`), authFetch(`/games/${gameId}/analysis`)])
      .then(([g, a]) => {
        setGame(g); setAnalyses(a||[]);
        if (g?.event_id) authFetch(`/events/${g.event_id}/leaderboard`).then(lb => setPlayers(lb||[])).catch(()=>{});
      }).catch(e => setError(e.message)).finally(() => setPageLoading(false));
  }, [gameId]);

  async function runAnalysis() {
    setLoading(true); setResult(null); setError('');
    try {
      const path = type==='game' ? `/games/${gameId}/analysis/game` : `/games/${gameId}/analysis/player`;
      const body = type==='player' ? JSON.stringify({player_name:selPlayer}) : undefined;
      const r = await authFetch(path, {method:'POST',body});
      setResult(r.analysis);
      const a = await authFetch(`/games/${gameId}/analysis`); setAnalyses(a||[]);
    } catch(e:any) { setError(e.message); }
    finally { setLoading(false); }
  }

  const accent='var(--pkr-personal-accent)', muted='var(--pkr-personal-muted)', bg='var(--pkr-personal-canvas)', border='var(--pkr-personal-line)';
  const bodyFont='var(--font-ui),Plus Jakarta Sans,system-ui,sans-serif';

  if (pageLoading) return <div style={{minHeight:'100vh',background:bg,display:'flex',alignItems:'center',justifyContent:'center'}}><div style={{fontFamily:bodyFont,fontSize:36,color:accent,opacity:0.6}}>PKR</div></div>;

  return (
    <main className="pkr-analysis-page" style={{minHeight:'100vh',background:bg,paddingBottom:80,color:'var(--pkr-personal-ink)',fontFamily:bodyFont}}>
      <nav aria-label="Analysis navigation" style={{background:'var(--pkr-personal-surface)',borderBottom:`1px solid ${border}`,padding:'0 16px',display:'flex',alignItems:'center',gap:12,flexWrap:'wrap',height:'auto',minHeight:52}}>
        <button type="button" aria-label="Back to game" onClick={()=>router.back()} style={{background:'none',border:'none',color:muted,cursor:'pointer',fontSize:20,minWidth:44,minHeight:44}}><PkrGlyph name="chevron-right" style={{transform:'rotate(180deg)'}}/></button>
        <div style={{fontFamily:bodyFont,fontSize:16,color:accent,fontWeight:600}}>Analysis</div>
        {game&&<div style={{fontSize:12,color:muted}}>· {game.event_name||''}</div>}
      </nav>
      <div style={{maxWidth:640,margin:'0 auto',padding:'20px 16px'}}>
        <div style={{background:'var(--pkr-personal-surface)',border:`1px solid ${border}`,borderRadius:12,padding:'18px 16px',marginBottom:20}}>
          <div style={{fontSize:16,fontWeight:700,color:'var(--pkr-personal-ink)',marginBottom:4}}><PkrGlyph name="insights"/> AI Hand Analysis</div>
          <div style={{fontSize:12,color:muted,marginBottom:16,lineHeight:1.5}}>Claude analyses your hand history and gives actionable coaching feedback</div>
          <div style={{display:'flex',gap:6,marginBottom:14}}>
            {(['game','player'] as const).map(t=>(
              <button type="button" aria-pressed={type===t} key={t} onClick={()=>setType(t)} style={{flex:1,padding:'10px',minHeight:44,borderRadius:10,cursor:'pointer',fontFamily:bodyFont,fontWeight:600,fontSize:13,background:type===t?'var(--pkr-personal-accent-surface)':'var(--pkr-personal-raised)',border:`1px solid ${type===t?'var(--pkr-personal-accent-line)':border}`,color:type===t?accent:muted}}>
                <PkrGlyph name={t==='game'?'games':'account'}/> {t==='game'?'Full Session':'By Player'}
              </button>
            ))}
          </div>
          {type==='player'&&(
            <div style={{marginBottom:14}}>
              <div style={{fontSize:11,textTransform:'uppercase',letterSpacing:'1px',color:muted,marginBottom:6,fontWeight:600}}>Select Player</div>
              <div style={{display:'flex',flexWrap:'wrap',gap:6}}>
                {game?.players?.filter((p:any)=>p.buy_ins>0).map((p:any)=>(
                  <button type="button" aria-pressed={selPlayer===p.display_name} key={p.user_id} onClick={()=>setSelPlayer(p.display_name)} style={{padding:'8px 12px',minHeight:44,borderRadius:10,cursor:'pointer',fontFamily:bodyFont,fontSize:13,background:selPlayer===p.display_name?'var(--pkr-personal-accent-surface)':'var(--pkr-personal-raised)',border:`1px solid ${selPlayer===p.display_name?'var(--pkr-personal-accent-line)':border}`,color:selPlayer===p.display_name?accent:'var(--pkr-personal-ink)'}}>
                    {p.display_name}
                  </button>
                ))}
              </div>
            </div>
          )}
          <button type="button" onClick={runAnalysis} disabled={loading||(type==='player'&&!selPlayer)} style={{width:'100%',padding:'13px',borderRadius:8,cursor:loading?'wait':'pointer',fontFamily:bodyFont,fontWeight:700,fontSize:14,background:loading?'var(--pkr-personal-raised)':'var(--pkr-personal-primary)',border:`1px solid ${loading?border:'var(--pkr-personal-primary)'}`,color:loading?muted:'var(--pkr-personal-on-dark)',opacity:(type==='player'&&!selPlayer)?0.4:1}}>
            <PkrGlyph name={loading?'clock':'insights'}/> {loading?'Analysing…':'Analyse with Claude'}
          </button>
          {result&&(
            <div style={{marginTop:16,background:'var(--pkr-personal-canvas)',borderRadius:8,padding:'14px',maxHeight:400,overflowY:'auto'}}>
              <div style={{fontSize:13,color:'var(--pkr-personal-ink)',lineHeight:1.7,whiteSpace:'pre-wrap',fontFamily:bodyFont}}>
                {result.split('\n').map((line,i)=>{
                  const bold=line.startsWith('**')&&line.includes('**',2);
                  return bold?<div key={i} style={{fontWeight:700,color:accent,marginTop:i>0?10:0}}>{line.replace(/\*\*/g,'')}</div>:<div key={i} style={{marginBottom:2}}>{line}</div>;
                })}
              </div>
            </div>
          )}
          {error&&<div style={{marginTop:10,fontSize:12,color:'var(--pkr-personal-loss)'}} role="alert"><PkrGlyph name="warning" size={16}/> {error}</div>}
        </div>
        {players.length>0&&(
          <div style={{marginBottom:20}}>
            <div style={{fontSize:13,fontWeight:700,color:'var(--pkr-personal-ink)',marginBottom:12}}><PkrGlyph name="insights"/> Player Stats (All Time)</div>
            {players.slice().sort((a:any,b:any)=>b.total_net-a.total_net).map((p:any,idx:number)=>{
              const wr=p.games_played>0?Math.round((p.games_won/p.games_played)*100):0;
              return(
                <div key={p.user_id||p.display_name} style={{background:'var(--pkr-personal-surface)',border:`1px solid ${border}`,borderRadius:14,marginBottom:8,overflow:'hidden'}}>
                  <RecordMetric bare className="pkr-analysis-player-record" disabled={!game?.event_id}
                    request={{kind:'player',title:p.display_name+' — all-time game history',roomId:game?.event_id,playerId:p.user_id,playerName:p.display_name}}
                    style={{display:'block',width:'100%',padding:'14px',textAlign:'left',border:0}}>
                  <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',gap:10,marginBottom:10}}>
                    <div style={{display:'flex',alignItems:'center',gap:8}}>
                      <div style={{width:28,height:28,borderRadius:'50%',background:idx===0?'var(--pkr-personal-accent-surface)':'var(--pkr-personal-raised)',display:'flex',alignItems:'center',justifyContent:'center',fontSize:12,color:idx===0?accent:muted,fontWeight:700}}>{idx===0?<PkrGlyph name="medal" size={18}/>:idx+1}</div>
                      <div style={{fontSize:14,color:'var(--pkr-personal-ink)',fontWeight:600,minWidth:0,overflowWrap:'anywhere'}}>{p.display_name}</div>
                    </div>
                    <div style={{fontSize:15,fontWeight:700,color:p.total_net>0?'var(--pkr-personal-gain)':p.total_net<0?'var(--pkr-personal-loss)':muted}}>{fmt(p.total_net)}</div>
                  </div>
                  <div style={{display:'grid',gridTemplateColumns:'repeat(4,minmax(0,1fr))',gap:6}}>
                    {[{l:'Games',v:String(p.games_played)},{l:'Win Rate',v:wr+'%'},{l:'Best Win',v:fmt(p.biggest_win)},{l:'Worst Loss',v:p.biggest_loss>0?'-'+fmt(p.biggest_loss).replace('+',''):'$0'}].map(s=>(
                      <div key={s.l} style={{background:'var(--pkr-personal-canvas)',borderRadius:6,padding:'6px 8px',textAlign:'center'}}>
                        <div style={{fontSize:13,color:'var(--pkr-personal-ink)',fontWeight:600}}>{s.v}</div>
                        <div style={{fontSize:10,color:muted,marginTop:2}}>{s.l}</div>
                      </div>
                    ))}
                  </div>
                  <span style={{display:'flex',alignItems:'center',gap:4,fontSize:12,color:accent,marginTop:10}}>View underlying games <PkrGlyph name="chevron-right" size={14}/></span>
                  </RecordMetric>
                </div>
              );
            })}
          </div>
        )}
        {analyses.length>0&&(
          <div>
            <div style={{fontSize:13,fontWeight:700,color:'var(--pkr-personal-ink)',marginBottom:12}}><PkrGlyph name="history"/> Past Analyses</div>
            {analyses.map((a:any)=>(
              <details key={a.id} style={{background:'var(--pkr-personal-surface)',border:`1px solid ${border}`,borderRadius:8,marginBottom:6,overflow:'hidden'}}>
                <summary style={{padding:'10px 14px',cursor:'pointer',fontSize:12,color:muted,display:'flex',justifyContent:'space-between',alignItems:'center'}}>
                  <span><PkrGlyph name={a.analysis_type==='player'?'account':'games'} size={16}/> {a.analysis_type==='player'?a.player_name:'Full Session'}</span>
                  <span>{new Date(a.created_at*1000).toLocaleDateString('en-AU')}</span>
                </summary>
                <div style={{padding:'10px 14px 14px',borderTop:`1px solid ${border}`,fontSize:12,color:'var(--pkr-personal-muted)',lineHeight:1.7,whiteSpace:'pre-wrap'}}>{a.analysis}</div>
              </details>
            ))}
          </div>
        )}
      </div>
    </main>
  );
}
