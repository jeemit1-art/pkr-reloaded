"use client";
import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';

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

  const gold='#c9a84c', muted='#6b8c6e', bg='#060e07', border='rgba(201,168,76,0.15)';

  if (pageLoading) return <div style={{minHeight:'100vh',background:bg,display:'flex',alignItems:'center',justifyContent:'center'}}><div style={{fontFamily:"'Playfair Display',serif",fontSize:36,color:gold,opacity:0.6}}>PKR</div></div>;

  return (
    <div style={{minHeight:'100vh',background:bg,paddingBottom:80}}>
      <nav style={{background:bg,borderBottom:`1px solid ${border}`,padding:'0 16px',height:52,display:'flex',alignItems:'center',gap:12}}>
        <button onClick={()=>router.back()} style={{background:'none',border:'none',color:muted,cursor:'pointer',fontSize:20}}>←</button>
        <div style={{fontFamily:"'Playfair Display',serif",fontSize:16,color:gold,fontWeight:600}}>Analysis</div>
        {game&&<div style={{fontSize:12,color:muted}}>· {game.event_name||''}</div>}
      </nav>
      <div style={{maxWidth:640,margin:'0 auto',padding:'20px 16px'}}>
        <div style={{background:'rgba(201,168,76,0.04)',border:`1px solid ${border}`,borderRadius:12,padding:'18px 16px',marginBottom:20}}>
          <div style={{fontSize:16,fontWeight:700,color:'#f0e6c8',marginBottom:4}}>🤖 AI Hand Analysis</div>
          <div style={{fontSize:12,color:muted,marginBottom:16,lineHeight:1.5}}>Claude analyses your hand history and gives actionable coaching feedback</div>
          <div style={{display:'flex',gap:6,marginBottom:14}}>
            {(['game','player'] as const).map(t=>(
              <button key={t} onClick={()=>setType(t)} style={{flex:1,padding:'9px',borderRadius:7,cursor:'pointer',fontFamily:'DM Sans,sans-serif',fontWeight:600,fontSize:13,background:type===t?'rgba(201,168,76,0.15)':'rgba(255,255,255,0.03)',border:`1px solid ${type===t?'rgba(201,168,76,0.4)':'rgba(255,255,255,0.07)'}`,color:type===t?gold:muted}}>
                {t==='game'?'🃏 Full Session':'👤 By Player'}
              </button>
            ))}
          </div>
          {type==='player'&&(
            <div style={{marginBottom:14}}>
              <div style={{fontSize:11,textTransform:'uppercase',letterSpacing:'1px',color:muted,marginBottom:6,fontWeight:600}}>Select Player</div>
              <div style={{display:'flex',flexWrap:'wrap',gap:6}}>
                {game?.players?.filter((p:any)=>p.buy_ins>0).map((p:any)=>(
                  <button key={p.user_id} onClick={()=>setSelPlayer(p.display_name)} style={{padding:'6px 12px',borderRadius:6,cursor:'pointer',fontFamily:'DM Sans,sans-serif',fontSize:13,background:selPlayer===p.display_name?'rgba(201,168,76,0.15)':'rgba(255,255,255,0.04)',border:`1px solid ${selPlayer===p.display_name?'rgba(201,168,76,0.4)':'rgba(255,255,255,0.08)'}`,color:selPlayer===p.display_name?gold:'#f0e6c8'}}>
                    {p.display_name}
                  </button>
                ))}
              </div>
            </div>
          )}
          <button onClick={runAnalysis} disabled={loading||(type==='player'&&!selPlayer)} style={{width:'100%',padding:'13px',borderRadius:8,cursor:loading?'wait':'pointer',fontFamily:'DM Sans,sans-serif',fontWeight:700,fontSize:14,background:loading?'rgba(255,255,255,0.05)':'rgba(201,168,76,0.12)',border:`1px solid ${loading?'rgba(255,255,255,0.1)':'rgba(201,168,76,0.35)'}`,color:loading?muted:gold,opacity:(type==='player'&&!selPlayer)?0.4:1}}>
            {loading?'🤔 Analysing...':'✨ Analyse with Claude'}
          </button>
          {result&&(
            <div style={{marginTop:16,background:'rgba(0,0,0,0.3)',borderRadius:8,padding:'14px',maxHeight:400,overflowY:'auto'}}>
              <div style={{fontSize:13,color:'#f0e6c8',lineHeight:1.7,whiteSpace:'pre-wrap',fontFamily:'DM Sans,sans-serif'}}>
                {result.split('\n').map((line,i)=>{
                  const bold=line.startsWith('**')&&line.includes('**',2);
                  return bold?<div key={i} style={{fontWeight:700,color:gold,marginTop:i>0?10:0}}>{line.replace(/\*\*/g,'')}</div>:<div key={i} style={{marginBottom:2}}>{line}</div>;
                })}
              </div>
            </div>
          )}
          {error&&<div style={{marginTop:10,fontSize:12,color:'#e74c3c'}}>⚠️ {error}</div>}
        </div>
        {players.length>0&&(
          <div style={{marginBottom:20}}>
            <div style={{fontSize:13,fontWeight:700,color:'#f0e6c8',marginBottom:12}}>📊 Player Stats (All Time)</div>
            {players.sort((a:any,b:any)=>b.total_net-a.total_net).map((p:any,idx:number)=>{
              const wr=p.games_played>0?Math.round((p.games_won/p.games_played)*100):0;
              return(
                <div key={p.display_name} style={{background:'rgba(255,255,255,0.02)',border:'1px solid rgba(255,255,255,0.05)',borderRadius:10,padding:'12px 14px',marginBottom:8}}>
                  <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:8}}>
                    <div style={{display:'flex',alignItems:'center',gap:8}}>
                      <div style={{width:28,height:28,borderRadius:'50%',background:idx===0?'rgba(201,168,76,0.2)':'rgba(255,255,255,0.06)',display:'flex',alignItems:'center',justifyContent:'center',fontSize:12,color:idx===0?gold:muted,fontWeight:700}}>{idx===0?'🥇':idx+1}</div>
                      <div style={{fontSize:14,color:'#f0e6c8',fontWeight:600}}>{p.display_name}</div>
                    </div>
                    <div style={{fontSize:15,fontWeight:700,color:p.total_net>0?'#2ecc71':p.total_net<0?'#e74c3c':muted}}>{fmt(p.total_net)}</div>
                  </div>
                  <div style={{display:'grid',gridTemplateColumns:'1fr 1fr 1fr 1fr',gap:6}}>
                    {[{l:'Games',v:String(p.games_played)},{l:'Win Rate',v:wr+'%'},{l:'Best Win',v:fmt(p.biggest_win)},{l:'Worst Loss',v:p.biggest_loss>0?'-'+fmt(p.biggest_loss).replace('+',''):'$0'}].map(s=>(
                      <div key={s.l} style={{background:'rgba(0,0,0,0.2)',borderRadius:6,padding:'6px 8px',textAlign:'center'}}>
                        <div style={{fontSize:13,color:'#f0e6c8',fontWeight:600}}>{s.v}</div>
                        <div style={{fontSize:10,color:muted,marginTop:2}}>{s.l}</div>
                      </div>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        )}
        {analyses.length>0&&(
          <div>
            <div style={{fontSize:13,fontWeight:700,color:'#f0e6c8',marginBottom:12}}>📋 Past Analyses</div>
            {analyses.map((a:any)=>(
              <details key={a.id} style={{background:'rgba(255,255,255,0.02)',border:'1px solid rgba(255,255,255,0.05)',borderRadius:8,marginBottom:6,overflow:'hidden'}}>
                <summary style={{padding:'10px 14px',cursor:'pointer',fontSize:12,color:muted,display:'flex',justifyContent:'space-between',alignItems:'center'}}>
                  <span>{a.analysis_type==='player'?`👤 ${a.player_name}`:'🃏 Full Session'}</span>
                  <span>{new Date(a.created_at*1000).toLocaleDateString('en-AU')}</span>
                </summary>
                <div style={{padding:'10px 14px 14px',borderTop:'1px solid rgba(255,255,255,0.05)',fontSize:12,color:'#d0c8b0',lineHeight:1.7,whiteSpace:'pre-wrap'}}>{a.analysis}</div>
              </details>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
