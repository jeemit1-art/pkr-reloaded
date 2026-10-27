'use client';
import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { api, getToken, ResultsData, Transfer, fmt, fmtSign, fmtDate, waLink } from '@/lib/api';
import { subscribePush, canUsePush, isIOS, isPWAInstalled } from '@/lib/push';

export default function ResultsPage() {
  const { token } = useParams<{token:string}>();
  const [data, setData]       = useState<ResultsData|null>(null);
  const [error, setError]     = useState('');
  const [copied, setCopied]   = useState<number|null>(null);
  const [busy, setBusy]       = useState<string|null>(null);
  const [isBanker,setIsBanker]=useState(false);
  const [myUserId,setMyUserId]=useState<string|null>(null);
  const [settlementNotice,setSettlementNotice]=useState('');
  const [collectionStarted,setCollectionStarted]=useState(false);

  useEffect(()=>{ api.games.results(token as string).then(setData).catch(()=>setError('Results not found')); },[token]);
  useEffect(()=>{
    if(!data?.game?.id||!getToken()){setCollectionStarted(false);return}
    let active=true;
    api.games.settlementControl(data.game.id).then(info=>{
      if(active)setCollectionStarted(!!info.enabled);
    }).catch(()=>{if(active)setCollectionStarted(false)});
    return()=>{active=false};
  },[data?.game?.id]);
  useEffect(()=>{
    if(!getToken()){setMyUserId(null);return}
    api.auth.me().then(u=>setMyUserId(u?.id||null)).catch(()=>setMyUserId(null));
  },[token]);

  useEffect(()=>{
    if(!data?.game?.event_id||!getToken()){setIsBanker(false);return;}
    let active=true;
    api.events.list().then(events=>{
      if(active){
        const role=events.find(e=>e.id===data.game.event_id)?.role;
        setIsBanker(role==='host'||role==='cohost');
      }
    }).catch(()=>{if(active)setIsBanker(false);});
    return()=>{active=false};
  },[data?.game?.event_id]);

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
    const link=typeof window!=='undefined'?window.location.origin+'/games/results/'+encodeURIComponent(token as string):'';
    return `Hi ${t.from_name}! You owe ${t.to_name} ${fmt(t.amount)} from ${event.name}. Once paid, please tell the host so they can confirm receipt in PKR. 🃏${link?'\\nReview results: '+link:''}`;
  }

  function patchTransfer(id:string, p:Partial<Transfer>) {
    setData(d => d ? {...d, transfers:d.transfers.map(x => x.id===id ? {...x,...p} : x)} : d);
  }

  async function respond(t:Transfer,action:'sent'|'received'|'not_received'){
    if(!t.id||busy)return;
    const confirmation=action==='sent'?'Confirm you have sent '+fmt(t.amount)+' to '+t.to_name+'?'
      :action==='received'?'Confirm you have received '+fmt(t.amount)+' from '+t.from_name+'?'
      :'Confirm that '+fmt(t.amount)+' has not been received?';
    if(!window.confirm(confirmation))return;
    setBusy(t.id);setSettlementNotice('');
    try{
      const updated=await api.games.respondToTransfer(data!.game.id,t.id,action);
      patchTransfer(t.id,{status:updated.status as Transfer['status'],
        paid_at:updated.status==='paid'?Math.floor(Date.now()/1000):null});
      setSettlementNotice(action==='sent'
        ?'Marked as sent. The recipient must confirm receipt before the balance is treated as paid.'
        :action==='received'?'Receipt confirmed. This payment is now settled.'
        :'Not received recorded; the payer can review and send again.');
    }catch(e:any){setSettlementNotice(e?.message||'Could not update your transfer')}
    finally{setBusy(null)}
  }

  async function bankerSet(t: Transfer, status:'owed'|'paid'|'not_received') {
    if (!t.id || t.status === 'legacy') return;
    setBusy(t.id);
    try { await api.games.setTransferStatus(data!.game.id, t.id, status); patchTransfer(t.id, {status}); }
    catch(e:any) { alert(e.message || 'Could not update'); }
    setBusy(null);
  }

  async function enableReminders() {
    if (isIOS() && !isPWAInstalled()) {
      alert('On iPhone: tap Share, then Add to Home Screen. Open PKR from the Home Screen to enable alerts.');
      return;
    }
    // Viewing a shared results link must not let somebody subscribe as another payer.
    const user=await api.auth.me().catch(()=>null);
    if(!user){
      alert('Sign in to PKR to enable notifications for your account.');
      return;
    }
    const ok=await subscribePush(data!.game.event_id,user.id,user.name);
    alert(ok
      ?'PKR room notifications enabled. Personal payment reminders require your game seat to be linked to this verified PKR account.'
      :'Could not enable notifications. Check room membership and browser settings.');
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

        {settlementNotice&&<div className="card" role="status" style={{padding:'12px 14px',fontSize:12,lineHeight:1.5,marginBottom:12}}>
          {settlementNotice}
        </div>}

        {(game.variance||0)!==0 && (
          <div className="card" style={{marginBottom:14,padding:'12px 16px',fontSize:12,color:'var(--amber)'}}>
            ⚠ Bank variance of {fmt(Math.abs(game.variance||0))}: chips cashed out did not match chips bought in. Transfers below are scaled pro-rata so they balance.
          </div>
        )}
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
                  {t.status==='legacy' && (
                    <p role="note" style={{fontSize:12,lineHeight:1.55,color:'var(--ivory)',marginBottom:9}}>
                      Payment status requires review. Ask the host before changing this record.
                    </p>
                  )}
                  {/* Only the verified logged-in payer or recipient can
                      confirm the transfer. A name or public results link alone
                      never grants financial write permissions. */}
                  {collectionStarted&&t.id&&t.status!=='legacy'&&myUserId===t.from&&
                    ['owed','not_received'].includes(t.status||'owed')&&(
                    <button type="button" className="btn btn-primary" disabled={!!busy}
                      style={{fontSize:12,padding:'9px 12px',marginBottom:9,width:'100%'}}
                      onClick={()=>void respond(t,'sent')}>I have paid {fmt(t.amount)} · Mark sent</button>
                  )}
                  {collectionStarted&&t.id&&t.status==='payer_claimed'&&myUserId===t.to&&(
                    <div style={{display:'flex',gap:8,marginBottom:9}}>
                      <button type="button" className="btn btn-primary" disabled={!!busy}
                        style={{fontSize:12,padding:'9px 10px',flex:1}}
                        onClick={()=>void respond(t,'received')}>Confirm received</button>
                      <button type="button" className="btn btn-outline" disabled={!!busy}
                        style={{fontSize:12,padding:'9px 10px',flex:1}}
                        onClick={()=>void respond(t,'not_received')}>Not received</button>
                    </div>
                  )}
                  {t.status && t.status!=='legacy' && (
                    <div style={{display:'flex',alignItems:'center',gap:6,marginBottom:8,flexWrap:'wrap'}}>
                      <span style={{fontSize:11,padding:'2px 10px',borderRadius:10,border:'1px solid var(--border-sub)',
                        color:t.status==='paid'?'var(--green)':t.status==='not_received'?'var(--red)':'var(--amber)'}}>
                        {t.status==='paid'?'✓ Paid · recorded':t.status==='payer_claimed'?'↗ Sent · awaiting confirmation':t.status==='not_received'?'⚠ Not received':'Owed'}
                      </span>
                      {!isBanker && t.status!=='paid' && (
                        <span style={{fontSize:11,color:'var(--muted)'}}>Ask the host to confirm payment</span>
                      )}
                      {t.status!=='paid' && (canUsePush() || isIOS()) && (
                        <button className="btn btn-ghost" onClick={()=>enableReminders()}
                          style={{fontSize:11,padding:'5px 10px'}}>🔔 Enable my alerts</button>
                      )}
                      {isBanker && t.status!=='paid' && (
                        <button className="btn btn-ghost" disabled={busy===t.id} onClick={()=>bankerSet(t,'paid')}
                          style={{fontSize:11,padding:'5px 10px'}}>✓ Mark paid</button>
                      )}
                      {isBanker && t.status==='paid' && (
                        <button className="btn btn-ghost" disabled={busy===t.id} onClick={()=>bankerSet(t,'not_received')}
                          style={{fontSize:11,padding:'5px 10px'}}>↶ Mark not received</button>
                      )}
                      {isBanker && !!t.reminder_count && (
                        <span style={{fontSize:10,color:'var(--faint)'}}>reminded ×{t.reminder_count}</span>
                      )}
                    </div>
                  )}
                  {/* Recorded-as-paid and unreviewed transfers must not offer payment reminders. */}
                  {t.status!=='paid'&&t.status!=='legacy'&&<div style={{display:'flex',gap:6}}>
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
                  </div>}
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