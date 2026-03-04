'use client';
import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { api, LiveData, fmt, fmtSign, fmtDate } from '@/lib/api';

export default function LivePage() {
  const { token } = useParams<{token:string}>();
  const [data, setData]   = useState<LiveData|null>(null);
  const [error, setError] = useState('');

  useEffect(()=>{
    const load = ()=>api.games.live(token).then(setData).catch(()=>setError('Table not found'));
    load();
    const t = setInterval(load,5000);
    return ()=>clearInterval(t);
  },[token]);

  if (error) return (
    <div style={{minHeight:'100vh',background:'var(--bg)',display:'flex',alignItems:'center',justifyContent:'center'}}>
      <div className="card" style={{padding:32,textAlign:'center'}}><p style={{color:'var(--red)',fontSize:14}}>{error}</p></div>
    </div>
  );
  if (!data) return <Loader/>;

  const { game, event, players, totalIn, totalOut, bank } = data;
  const sorted = [...players].sort((a,b)=>(b.buy_ins||0)-(a.buy_ins||0));

  return (
    <div style={{minHeight:'100vh',background:'var(--bg)',paddingBottom:80}}>
      <div style={{position:'fixed',bottom:-60,right:-40,fontSize:420,opacity:0.018,
        color:'var(--gold)',lineHeight:1,userSelect:'none',pointerEvents:'none',fontFamily:'serif',zIndex:0}}>♠</div>

      <div style={{background:'var(--bg2)',borderBottom:'1px solid var(--border-sub)'}}>
        <div style={{maxWidth:480,margin:'0 auto',padding:'16px 20px',
          display:'flex',alignItems:'center',justifyContent:'space-between'}}>
          <div>
            <div className="display" style={{fontSize:20,color:'var(--white)',fontWeight:500}}>{event.name}</div>
            <div style={{fontSize:11,color:'var(--muted)',marginTop:2,fontFamily:'var(--font-body),sans-serif'}}>
              Live · Read Only · Refreshes every 5s
            </div>
          </div>
          <span style={{fontSize:9,padding:'3px 9px',borderRadius:1,fontWeight:500,
            border:'1px solid rgba(76,175,125,0.3)',color:'var(--green)',background:'rgba(76,175,125,0.06)',
            letterSpacing:'0.16em',textTransform:'uppercase',fontFamily:'var(--font-body),sans-serif'}}>
            {game.status}
          </span>
        </div>
      </div>

      <div style={{maxWidth:480,margin:'0 auto',padding:'20px 16px',position:'relative',zIndex:1}}>

        {/* Bank summary */}
        <div style={{display:'grid',gridTemplateColumns:'1fr 1fr 1fr',gap:6,marginBottom:16}}>
          {[
            {l:'Buy-ins', v:fmt(totalIn)},
            {l:'Cashouts',v:fmt(totalOut)},
            {l:'In Bank', v:fmt(bank), gold:bank>0},
          ].map(s=>(
            <div key={s.l} style={{background:'var(--bg3)',border:'1px solid var(--border-sub)',
              borderRadius:2,padding:'14px 10px',textAlign:'center'}}>
              <div className="display" style={{fontSize:18,color:s.gold?'var(--gold)':'var(--white)',fontWeight:500}}>
                {s.v}
              </div>
              <div style={{fontSize:9,letterSpacing:'0.16em',textTransform:'uppercase',color:'var(--muted)',
                marginTop:4,fontFamily:'var(--font-body),sans-serif',fontWeight:500}}>{s.l}</div>
            </div>
          ))}
        </div>

        <div className="card">
          <div className="section-header">{players.length} Players</div>
          {sorted.map((p,i)=>{
            const net = p.cashout!=null ? p.cashout-p.buy_ins : null;
            return (
              <div key={i} style={{display:'flex',alignItems:'center',gap:12,padding:'12px 16px',
                borderBottom:'1px solid var(--border-sub)'}}>
                <span style={{fontSize:11,color:'var(--faint)',width:20,textAlign:'center'}}>{p.seat_number||i+1}</span>
                <span style={{flex:1,fontSize:14,color:'var(--white)',fontFamily:'var(--font-display),serif'}}>
                  {p.display_name}
                </span>
                <div style={{textAlign:'right'}}>
                  <div style={{fontSize:13,color:'var(--muted)',fontFamily:'var(--font-body),sans-serif'}}>
                    ×{p.buy_ins}
                  </div>
                  {net!=null && (
                    <div className="display" style={{fontSize:14,fontWeight:500,
                      color:net>0?'var(--green)':net<0?'var(--red)':'var(--muted)'}}>
                      {fmtSign(net)}
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>

        <div style={{textAlign:'center',marginTop:20,fontSize:11,color:'var(--faint)',
          fontFamily:'var(--font-body),sans-serif'}}>
          {fmtDate(game.scheduled_at)}{game.location?` · ${game.location}`:''}
        </div>
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
