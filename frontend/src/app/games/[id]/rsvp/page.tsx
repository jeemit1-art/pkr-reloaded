"use client";
import{useEffect,useState}from'react';
import{useParams}from'next/navigation';
export default function RsvpPage(){
  const{id:gameId}=useParams<{id:string}>();
  const[game,setGame]=useState<any>(null);
  const[players,setPlayers]=useState<any[]>([]);
  const[seat,setSeat]=useState<number|null>(null);
  const[form,setForm]=useState({name:'',wa:''});
  const[step,setStep]=useState<'seats'|'details'|'done'>('seats');
  const[saving,setSaving]=useState(false);
  const[err,setErr]=useState('');
  const[loading,setLoading]=useState(true);
  const api=process.env.NEXT_PUBLIC_API_URL||'http://localhost:8787';
  function hdrs():Record<string,string>{const ctx=typeof window!=='undefined'?JSON.parse(localStorage.getItem('pkrCtx')||'null'):null;const h:Record<string,string>={'Content-Type':'application/json'};if(ctx?.token)h.Authorization=`Bearer ${ctx.token}`;return h;}
  useEffect(()=>{fetch(`${api}/games/${gameId}`,{credentials:'include',headers:hdrs()}).then(r=>r.json()).then(g=>{setGame(g);setPlayers(g.players||[]);}).catch(e=>setErr(e.message)).finally(()=>setLoading(false));},[gameId]);
  async function confirm(){
    if(!form.name.trim()){setErr('Please enter your name');return;}
    setSaving(true);setErr('');
    try{await fetch(`${api}/games/${gameId}/seat`,{method:'POST',credentials:'include',headers:hdrs(),body:JSON.stringify({display_name:form.name.trim(),whatsapp:form.wa||undefined,seat_number:seat,rsvp:true,buy_ins:0})});setStep('done');}
    catch(e:any){setErr(e.message);}finally{setSaving(false);}
  }
  function fmtD(ts:number){return new Date(ts*1000).toLocaleDateString('en-AU',{weekday:'long',day:'numeric',month:'long',hour:'2-digit',minute:'2-digit'});}
  const gold='#c9a84c',green='#2ecc71',bg='#060e07',bdr='rgba(201,168,76,0.15)';
  const total=game?.seats||9;
  const taken=new Set(players.filter((p:any)=>p.seat_number).map((p:any)=>p.seat_number));
  if(loading)return<div style={{minHeight:'100vh',background:bg,display:'flex',alignItems:'center',justifyContent:'center'}}><div style={{fontFamily:"'Playfair Display',serif",fontSize:36,color:gold,opacity:0.6}}>PKR</div></div>;
  return<div style={{minHeight:'100vh',background:bg,paddingBottom:60,fontFamily:'DM Sans,sans-serif'}}>
    <div style={{background:'rgba(0,0,0,0.4)',borderBottom:`1px solid ${bdr}`,padding:'16px 20px',textAlign:'center'}}>
      <div style={{fontFamily:"'Playfair Display',serif",fontSize:22,color:gold,marginBottom:4}}>PKR</div>
      {game&&<><div style={{fontSize:16,fontWeight:600,color:'#f0e6c8',marginBottom:4}}>{game.event_name||'Poker Night'}</div>
      <div style={{fontSize:13,color:'#6b8c6e'}}>{game.scheduled_at?fmtD(game.scheduled_at):''}</div>
      {game.location&&<div style={{fontSize:12,color:'#6b8c6e',marginTop:2}}>📍 {game.location}</div>}
      <div style={{display:'flex',gap:8,justifyContent:'center',marginTop:10}}>
        <span style={{padding:'3px 10px',borderRadius:12,background:'rgba(46,204,113,0.1)',border:'1px solid rgba(46,204,113,0.2)',fontSize:12,color:green}}>{players.filter((p:any)=>p.rsvp||p.buy_ins>0).length} confirmed</span>
        <span style={{padding:'3px 10px',borderRadius:12,background:'rgba(201,168,76,0.08)',border:`1px solid ${bdr}`,fontSize:12,color:gold}}>{total-taken.size} seats left</span>
      </div></>}
    </div>
    <div style={{maxWidth:480,margin:'0 auto',padding:'20px 16px'}}>
      {step==='done'?<div style={{textAlign:'center',padding:'40px 20px'}}>
        <div style={{fontSize:'3rem',marginBottom:16}}>✅</div>
        <div style={{fontSize:20,fontWeight:700,color:'#f0e6c8',marginBottom:8}}>You're in!</div>
        <div style={{fontSize:14,color:'#6b8c6e',lineHeight:1.6}}>Seat {seat} confirmed for {form.name}.<br/>See you at the table!</div>
        {game?.location&&<a href={`https://maps.google.com/?q=${encodeURIComponent(game.location)}`} target="_blank" rel="noreferrer" style={{display:'inline-block',marginTop:20,padding:'10px 20px',background:'rgba(201,168,76,0.1)',border:`1px solid ${bdr}`,borderRadius:8,color:gold,fontSize:13,textDecoration:'none'}}>📍 Get directions</a>}
      </div>:step==='details'?<>
        <button onClick={()=>setStep('seats')} style={{background:'none',border:'none',color:'#6b8c6e',cursor:'pointer',fontSize:13,marginBottom:16,padding:0}}>← Back to seats</button>
        <div style={{fontSize:15,fontWeight:700,color:'#f0e6c8',marginBottom:4}}>Your details</div>
        <div style={{fontSize:13,color:'#6b8c6e',marginBottom:20}}>Seat {seat} selected</div>
        {['Your name *','WhatsApp (optional)'].map((lbl,i)=><div key={lbl} style={{marginBottom:12}}>
          <div style={{fontSize:11,textTransform:'uppercase',letterSpacing:'1px',color:'#6b8c6e',marginBottom:6,fontWeight:600}}>{lbl}</div>
          <input value={i===0?form.name:form.wa} onChange={e=>setForm(f=>i===0?{...f,name:e.target.value}:{...f,wa:e.target.value})} placeholder={i===0?'Enter your name':'04xx xxx xxx'} type={i===1?'tel':'text'}
            style={{width:'100%',background:'rgba(0,0,0,0.4)',border:'1px solid rgba(255,255,255,0.12)',color:'#f0e6c8',padding:'10px 12px',borderRadius:8,fontSize:15,outline:'none',fontFamily:'DM Sans,sans-serif',boxSizing:'border-box'}}/>
        </div>)}
        {game?.buy_in>0&&<div style={{background:'rgba(201,168,76,0.06)',border:`1px solid ${bdr}`,borderRadius:8,padding:'10px 14px',marginBottom:20}}>
          <div style={{fontSize:13,color:'#f0e6c8'}}>Buy-in: <span style={{color:gold,fontWeight:700}}>${game.buy_in/100}</span></div>
          <div style={{fontSize:11,color:'#6b8c6e',marginTop:2}}>Payable on the night</div>
        </div>}
        {err&&<div style={{fontSize:12,color:'#e74c3c',marginBottom:12}}>{err}</div>}
        <button onClick={confirm} disabled={saving} style={{width:'100%',padding:'14px',borderRadius:10,cursor:saving?'wait':'pointer',background:'linear-gradient(135deg,rgba(201,168,76,0.9),rgba(160,118,30,0.85))',color:'#000',border:'none',fontSize:15,fontWeight:700,fontFamily:'DM Sans,sans-serif'}}>
          {saving?'Confirming...':`Confirm Seat ${seat}`}
        </button>
      </>:<>
        <div style={{fontSize:15,fontWeight:700,color:'#f0e6c8',marginBottom:4}}>Pick your seat</div>
        <div style={{fontSize:13,color:'#6b8c6e',marginBottom:20}}>Tap an available seat to claim it</div>
        <div style={{display:'grid',gridTemplateColumns:'repeat(3,1fr)',gap:10,marginBottom:24}}>
          {Array.from({length:total},(_,i)=>{const n=i+1,tk=taken.has(n),pl=players.find((p:any)=>p.seat_number===n),sel=seat===n;
          return<div key={n} onClick={()=>!tk&&setSeat(sel?null:n)} style={{padding:'14px 10px',borderRadius:12,textAlign:'center',cursor:tk?'default':'pointer',border:`1px solid ${tk?'rgba(46,204,113,0.25)':sel?'rgba(201,168,76,0.6)':'rgba(255,255,255,0.08)'}`,background:tk?'rgba(46,204,113,0.06)':sel?'rgba(201,168,76,0.12)':'rgba(255,255,255,0.02)',transition:'all 0.15s'}}>
            <div style={{fontSize:10,textTransform:'uppercase',letterSpacing:'1px',color:'#6b8c6e',marginBottom:8}}>Seat {n}</div>
            {tk?<><div style={{width:36,height:36,borderRadius:'50%',background:'rgba(46,204,113,0.15)',display:'flex',alignItems:'center',justifyContent:'center',margin:'0 auto 6px',fontSize:13,fontWeight:700,color:green}}>{(pl?.display_name||'?').slice(0,2).toUpperCase()}</div>
            <div style={{fontSize:12,color:green,fontWeight:600}}>{pl?.display_name||'Taken'}</div></>
            :<><div style={{width:36,height:36,borderRadius:'50%',background:sel?'rgba(201,168,76,0.2)':'rgba(255,255,255,0.04)',display:'flex',alignItems:'center',justifyContent:'center',margin:'0 auto 6px',fontSize:20,color:sel?gold:'rgba(255,255,255,0.15)'}}>{sel?'★':'○'}</div>
            <div style={{fontSize:12,color:sel?gold:'#6b8c6e',fontWeight:sel?600:400}}>{sel?'Selected':'Open'}</div></>}
          </div>;})}
        </div>
        {seat&&<button onClick={()=>setStep('details')} style={{width:'100%',padding:'14px',borderRadius:10,cursor:'pointer',background:'linear-gradient(135deg,rgba(201,168,76,0.9),rgba(160,118,30,0.85))',color:'#000',border:'none',fontSize:15,fontWeight:700,fontFamily:'DM Sans,sans-serif'}}>Claim Seat {seat} →</button>}
        {players.filter((p:any)=>p.rsvp||p.buy_ins>0).length>0&&<div style={{marginTop:24}}>
          <div style={{fontSize:11,textTransform:'uppercase',letterSpacing:'1.5px',color:'#6b8c6e',fontWeight:600,marginBottom:10}}>Confirmed players</div>
          {players.filter((p:any)=>p.rsvp||p.buy_ins>0).map((p:any)=><div key={p.user_id} style={{display:'flex',alignItems:'center',gap:10,padding:'8px 0',borderBottom:'1px solid rgba(255,255,255,0.04)'}}>
            <div style={{width:28,height:28,borderRadius:'50%',background:'rgba(46,204,113,0.12)',display:'flex',alignItems:'center',justifyContent:'center',fontSize:11,fontWeight:700,color:green,flexShrink:0}}>{p.display_name.slice(0,2).toUpperCase()}</div>
            <div style={{fontSize:13,color:'#f0e6c8',fontWeight:500}}>{p.display_name}</div>
            {p.seat_number&&<div style={{marginLeft:'auto',fontSize:11,color:'#6b8c6e'}}>Seat {p.seat_number}</div>}
          </div>)}
        </div>}
      </>}
    </div>
  </div>;
}
