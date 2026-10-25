'use client';
import {useEffect,useState} from 'react';
type Notice={kind:string;gameId:string;at:number};
function play(kind:string){
 try{
  const C=(window as any).AudioContext||(window as any).webkitAudioContext;
  if(!C)return;
  const ctx=new C() as AudioContext;
  const sequence=kind==='buyin'?[660,880,1180]:kind==='cashout'?[920,700,510]:[540,720,960];
  sequence.forEach((hz,i)=>{
   const osc=ctx.createOscillator(),gain=ctx.createGain(),start=ctx.currentTime+i*0.085;
   osc.type=kind==='buyin'?'triangle':'sine';osc.frequency.setValueAtTime(hz,start);
   gain.gain.setValueAtTime(.0001,start);gain.gain.exponentialRampToValueAtTime(.10,start+.008);
   gain.gain.exponentialRampToValueAtTime(.0001,start+.095);
   osc.connect(gain);gain.connect(ctx.destination);osc.start(start);osc.stop(start+.10);
  });
  window.setTimeout(()=>void ctx.close(),750);
 }catch{}
}
export default function FinancialNotice(){
 const [notice,setNotice]=useState<Notice|null>(null);
 const [sound,setSound]=useState(false);
 useEffect(()=>{
  setSound(localStorage.getItem('pkr:financial-sound')==='yes');
  const handler=(ev:Event)=>{
   const next=(ev as CustomEvent<Notice>).detail;
   setNotice(next);
   if(localStorage.getItem('pkr:financial-sound')==='yes')play(next.kind);
  };
  window.addEventListener('pkr:financial-update',handler);
  return()=>window.removeEventListener('pkr:financial-update',handler);
 },[]);
 if(!notice)return null;
 const labels:Record<string,{heading:string;body:string}>={
  buyin:{heading:'🪙 Buy-in recorded',body:'The buy-in was saved. Check the game ledger for the updated amount.'},
  cashout:{heading:'💵 Cash-out recorded',body:'The cash-out was saved. Review the net result before settlement.'},
  settlement:{heading:'📋 Settlement calculated',body:'Review who owes whom. Payment is not complete until confirmed.'}
 };
 const label=labels[notice.kind]||labels.settlement;
 return <div role="status" aria-live="polite" style={{
  position:'fixed',bottom:80,left:16,right:16,maxWidth:450,margin:'0 auto',zIndex:10000,
  background:'#19241f',color:'#fff',border:'2px solid #d4ad55',borderRadius:14,
  padding:18,boxShadow:'0 15px 45px #0009'
 }}>
  <strong style={{fontSize:20,display:'block'}}>{label.heading}</strong>
  <p style={{fontSize:14,margin:'8px 0 14px'}}>{label.body}</p>
  <div style={{display:'flex',gap:10,alignItems:'center',flexWrap:'wrap'}}>
   <a href={'/games/'+encodeURIComponent(notice.gameId)} style={{color:'#f7d185',fontWeight:700}}>View game →</a>
   <button onClick={()=>{const v=!sound;setSound(v);localStorage.setItem('pkr:financial-sound',v?'yes':'no');if(v)play('buyin');}} style={{padding:7,background:'transparent',border:'1px solid #cba558',color:'#fff',borderRadius:6}}>{sound?'🔊 Sound on':'🔇 Enable sounds'}</button>
   <button onClick={()=>setNotice(null)} style={{marginLeft:'auto',padding:7,background:'transparent',color:'#fff',border:'1px solid #52645b',borderRadius:6}}>Dismiss</button>
  </div>
 </div>;
}
