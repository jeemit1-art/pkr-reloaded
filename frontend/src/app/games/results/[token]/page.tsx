'use client';
import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { api, ResultsData, fmt, fmtSign, fmtDate, waLink } from '@/lib/api';

export default function ResultsPage() {
  const { token } = useParams<{token:string}>();
  const [data, setData]       = useState<ResultsData|null>(null);
  const [error, setError]     = useState('');
  const [copied, setCopied]   = useState<number|null>(null);

  useEffect(()=>{ api.games.results(token as string).then(setData).catch(()=>setError('Results not found')); },[token]);

  if (error) return (
    <div style={{minHeight:'100vh',background:'var(--bg)',display:'flex',alignItems:'center',justifyContent:'center'}}>
      <div className="card" style={{padding:32,textAlign:'center'}}><p style={{color:'var(--red)',fontSize:14}}>{error}</p></div>
    </div>
  );
  if (!data) return <Loader/>;

  const { game, event, players, transfers } = data;
  const sorted = [...players].sort((a,b)=>(b.net||0)-(a.net||0));
  const medals = ['♛','♝','♞'];

  function buildShareText() {
    return [
      `${event.name} — Results`,
      fmtDate(game.scheduled_at), '',
      ...sorted.map((p,i)=>`${i<3?medals[i]:`${i+1}.`} ${p.display_name}: ${fmtSign(p.net||0)}`),
      transfers.length?'\nTransfers:':null,
      ...transfers.map(t=>`  ${t.from_name} → ${t.to_name}: ${fmt(t.amount)}`),
    ].filter(Boolean).join('\n');
  }

  function buildTransferMsg(t: typeof transfers[0]) {
    return `Hi ${t.from_name}! You owe ${t.to_name} ${fmt(t.amount)} from ${event.name}. Please transfer when you get a chance 🃏`;
  }

  function share() {
    const text = buildShareText();
    if(navigator.share) navigator.share({title:`${event.name} Results`,text});
    else navigator.clipboard.writeText(text).then(()=>alert('Results copied!'));
  }

  function copyTransferMsg(t: typeof transfers[0], i: number) {
    navigator.clipboard.writeText(buildTransferMsg(t)).then(()=>{
      setCopied(i);
      setTimeout(()=>setCopied(null), 2000);
    });
  }

  return (
    <div style={{minHeight:'100vh',background:'var(--bg)',paddingBottom:80}}>
      <div style={{position:'fixed',bottom:-60,right:-40,fontSize:420,opacity:0.018,
        color:'var(--gold)',lineHeight:1,userSelect:'none',pointerEvents:'none',fontFamily:'serif',zIndex:0}}>♠</div>

      <div style={{background:'var(--bg2)',borderBottom:'1px solid var(--border-sub)'}}>
        <div style={{maxWidth:480,margin:'0 auto',padding:'16px 20px',
          display:'flex',alignItems:'center',justifyContent:'space-between'}}>
          <div>
            <div className="display" style={{fontSize:20,color:'var(--white)',fontWeight:500}}>{event.name}</div>
            <div style={{fontSize:12,color:'var(--muted)',marginTop:2,fontFamily:'var(--font-display),serif',fontStyle:'italic'}}>
              {fmtDate(game.scheduled_at)}
            </div>
          </div>
          <span className="badge badge-settled">Settled</span>
        </div>
      </div>

      <div style={{maxWidth:480,margin:'0 auto',padding:'20px 16px',position:'relative',zIndex:1}}>

        <div style={{display:'flex',gap:8,marginBottom:16}}>
          <button className="btn btn-primary" style={{flex:1,fontSize:12}} onClick={share}>Share Results</button>
          <a href={`https://wa.me/?text=${encodeURIComponent(buildShareText())}`}
            target="_blank" rel="noopener noreferrer" className="btn btn-outline"
            style={{flex:1,fontSize:12,textDecoration:'none',display:'flex',alignItems:'center',justifyContent:'center'}}>
            WhatsApp
          </a>
        </div>

        {/* Results */}
        <div className="card" style={{marginBottom:14}}>
          <div className="section-header">Results · {players.length} Players</div>
          {sorted.map((p,i)=>(
            <div key={p.user_id} style={{display:'flex',alignItems:'center',gap:14,padding:'14px 16px',
              borderBottom:i<sorted.length-1?'1px solid var(--border-sub)':'none'}}>
              <div style={{width:28,textAlign:'center',fontSize:i<3?16:12,
                color:i===0?'var(--gold)':i===1?'var(--ivory)':i===2?'var(--amber)':'var(--faint)'}}>
                {medals[i]||`${i+1}`}
              </div>
              <div style={{flex:1}}>
                <div style={{fontSize:15,color:'var(--white)',fontFamily:'var(--font-display),serif',
                  fontWeight:i===0?600:400}}>{p.display_name}</div>
                <div style={{fontSize:11,color:'var(--muted)',marginTop:2,fontFamily:'var(--font-body),sans-serif'}}>
                  ×{p.buy_ins} buy-in{p.buy_ins!==1?'s':''} · out {fmt(p.cashout||0)}
                </div>
              </div>
              <div className="display" style={{fontSize:20,fontWeight:500,
                color:(p.net||0)>0?'var(--green)':(p.net||0)<0?'var(--red)':'var(--muted)'}}>
                {fmtSign(p.net||0)}
              </div>
            </div>
          ))}
        </div>

        {/* Transfers — with copy + WA per row */}
        {transfers.length>0 && (
          <div className="card">
            <div className="section-header">Who Pays Who</div>
            {transfers.map((t,i)=>{
              const recipient = players.find(p=>p.user_id===t.to);
              const waMsg = buildTransferMsg(t);
              return (
                <div key={i} style={{padding:'12px 16px',
                  borderBottom:i<transfers.length-1?'1px solid var(--border-sub)':'none'}}>
                  {/* Transfer row */}
                  <div style={{display:'flex',alignItems:'center',gap:10,marginBottom:8}}>
                    <div style={{flex:1,fontSize:13}}>
                      <span style={{color:'var(--red)',fontFamily:'var(--font-display),serif'}}>{t.from_name}</span>
                      <span style={{color:'var(--faint)',margin:'0 8px'}}>→</span>
                      <span style={{color:'var(--green)',fontFamily:'var(--font-display),serif'}}>{t.to_name}</span>
                    </div>
                    <span className="display" style={{fontSize:18,color:'var(--ivory)',fontWeight:500}}>
                      {fmt(t.amount)}
                    </span>
                  </div>
                  {/* Actions row — always copy, WA only if number known */}
                  <div style={{display:'flex',gap:6}}>
                    <button
                      onClick={()=>copyTransferMsg(t,i)}
                      className="btn btn-ghost"
                      style={{flex:1,fontSize:11,padding:'5px 10px',
                        color:copied===i?'var(--green)':'var(--muted)',
                        borderColor:copied===i?'rgba(76,175,125,0.4)':'var(--border-sub)'}}>
                      {copied===i ? '✓ Copied!' : '📋 Copy reminder'}
                    </button>
                    {recipient?.whatsapp ? (
                      <a href={waLink(recipient.whatsapp, waMsg)} target="_blank" rel="noopener noreferrer"
                        className="btn btn-ghost"
                        style={{flex:1,fontSize:11,padding:'5px 10px',textDecoration:'none',
                          display:'flex',alignItems:'center',justifyContent:'center',color:'var(--muted)'}}>
                        📱 Send via WA
                      </a>
                    ) : (
                      <a href={`https://wa.me/?text=${encodeURIComponent(waMsg)}`}
                        target="_blank" rel="noopener noreferrer"
                        className="btn btn-ghost"
                        style={{flex:1,fontSize:11,padding:'5px 10px',textDecoration:'none',
                          display:'flex',alignItems:'center',justifyContent:'center',color:'var(--muted)'}}>
                        📱 WhatsApp
                      </a>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}

        <div style={{textAlign:'center',marginTop:24,fontSize:10,color:'var(--faint)',
          letterSpacing:'0.12em',textTransform:'uppercase',fontFamily:'var(--font-body),sans-serif'}}>
          PKR Private Poker
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