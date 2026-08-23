"use client";
import { useEffect, useState, useRef } from 'react';
import { useParams } from 'next/navigation';
function ft(s:number){const m=Math.floor(s/60),sc=s%60;return`${m<10?'0':''}${m}:${sc<10?'0':''}${sc}`;}
export default function TVPage(){
  const{id:gameId}=useParams<{id:string}>();
  const[data,setData]=useState<any>(null);
  const[secs,setSecs]=useState(0);
  const ref=useRef<any>(null);
  const api=process.env.NEXT_PUBLIC_API_URL||'http://localhost:8787';
  async function poll(){try{
    const ctx=typeof window!=='undefined'?JSON.parse(localStorage.getItem('pkrCtx')||'null'):null;
    const r=await fetch(`${api}/games/${gameId}/tournament`,{credentials:'include',headers:ctx?.token?{Authorization:`Bearer ${ctx.token}`}:{}});
    if(r.ok)setData(await r.json());
  }catch{}}
  useEffect(()=>{poll();const i=setInterval(poll,15000);return()=>clearInterval(i);},[gameId]);
  useEffect(()=>{
    if(!data?.state||data.state.status!=='running')return;
    const lv=data.levels?.find((l:any)=>l.level_num===data.state.current_level);
    if(!lv)return;
    const tick=()=>setSecs(Math.max(0,lv.duration_secs-(Math.floor(Date.now()/1000)-(data.state.level_started_at||0))));
    tick();ref.current=setInterval(tick,1000);return()=>clearInterval(ref.current);
  },[data]);
  const gold='#c9a84c',bg='#040c05';
  if(!data)return<div style={{minHeight:'100vh',background:bg,display:'flex',alignItems:'center',justifyContent:'center'}}><div style={{fontFamily:"'Playfair Display',serif",fontSize:32,color:gold,opacity:0.5}}>PKR</div></div>;
  const ts=data.state,lvs=data.levels||[];
  const lv=lvs.find((l:any)=>l.level_num===ts?.current_level);
  const nxt=lvs.find((l:any)=>l.level_num===(ts?.current_level||0)+1);
  const isBreak=lv?.is_break,isRun=ts?.status==='running';
  const tc=secs<60?'#e74c3c':secs<120?'#f39c12':'#f0e6c8';
  return<div style={{minHeight:'100vh',background:bg,display:'flex',flexDirection:'column',fontFamily:'DM Sans,sans-serif'}}>
    <div style={{background:'rgba(0,0,0,0.4)',padding:'10px 32px',display:'flex',justifyContent:'space-between',alignItems:'center',borderBottom:'1px solid rgba(201,168,76,0.15)'}}>
      <div style={{fontFamily:"'Playfair Display',serif",fontSize:18,color:gold,fontWeight:700}}>PKR</div>
      <div style={{fontSize:13,color:isRun?'#2ecc71':'#6b8c6e',fontWeight:600}}>{isRun?'● LIVE':ts?.status?.toUpperCase()}</div>
      <div style={{fontSize:12,color:'#6b8c6e'}}>{lvs.length} levels</div>
    </div>
    <div style={{flex:1,display:'flex',flexDirection:'column',alignItems:'center',justifyContent:'center',gap:20,padding:'20px 40px'}}>
      {lv&&<div style={{fontSize:'clamp(14px,2vw,18px)',textTransform:'uppercase',letterSpacing:'4px',color:isBreak?'#6aaaee':gold,fontWeight:600}}>{isBreak?'☕ BREAK':`LEVEL ${ts?.current_level} OF ${lvs.filter((l:any)=>!l.is_break).length}`}</div>}
      <div style={{fontSize:'clamp(80px,18vw,160px)',fontWeight:700,color:tc,letterSpacing:'4px',fontFamily:'monospace',lineHeight:1}}>{ft(secs)}</div>
      {lv&&!isBreak&&<div style={{display:'flex',gap:48,alignItems:'center'}}>
        <div style={{textAlign:'center'}}><div style={{fontSize:'clamp(10px,1.5vw,14px)',color:'#6b8c6e',textTransform:'uppercase',letterSpacing:'2px',marginBottom:6}}>Blinds</div>
        <div style={{fontSize:'clamp(36px,7vw,72px)',fontWeight:700,color:'#f0e6c8'}}>{lv.small_blind}/{lv.big_blind}</div></div>
        {lv.ante>0&&<><div style={{width:1,height:60,background:'rgba(255,255,255,0.1)'}}/>
        <div style={{textAlign:'center'}}><div style={{fontSize:'clamp(10px,1.5vw,14px)',color:'#6b8c6e',textTransform:'uppercase',letterSpacing:'2px',marginBottom:6}}>Ante</div>
        <div style={{fontSize:'clamp(36px,7vw,72px)',fontWeight:700,color:gold}}>{lv.ante}</div></div></>}
      </div>}
      {nxt&&<div style={{padding:'10px 28px',background:'rgba(255,255,255,0.04)',border:'1px solid rgba(255,255,255,0.08)',borderRadius:8}}>
        <span style={{fontSize:'clamp(13px,1.8vw,16px)',color:'#6b8c6e'}}>Next: </span>
        <span style={{fontSize:'clamp(13px,1.8vw,16px)',color:'#f0e6c8',fontWeight:600}}>{nxt.is_break?'Break':`${nxt.small_blind}/${nxt.big_blind}${nxt.ante?` ante ${nxt.ante}`:''}`}</span>
      </div>}
    </div>
    <div style={{background:'rgba(0,0,0,0.3)',borderTop:'1px solid rgba(255,255,255,0.05)',padding:'10px 32px',display:'flex',gap:6,overflowX:'auto',justifyContent:'center'}}>
      {lvs.map((l:any)=>{const cur=l.level_num===ts?.current_level,past=l.level_num<(ts?.current_level||0);
      return<div key={l.level_num} style={{padding:'4px 10px',borderRadius:6,flexShrink:0,background:cur?(l.is_break?'rgba(106,170,238,0.15)':'rgba(201,168,76,0.15)'):'transparent',border:`1px solid ${cur?(l.is_break?'#6aaaee':gold):'rgba(255,255,255,0.06)'}`,opacity:past?0.3:1}}>
        <div style={{fontSize:11,color:cur?(l.is_break?'#6aaaee':gold):'#6b8c6e',fontWeight:cur?700:400}}>{l.is_break?'☕':`${l.small_blind}/${l.big_blind}`}</div>
      </div>;})}
    </div>
  </div>;
}
