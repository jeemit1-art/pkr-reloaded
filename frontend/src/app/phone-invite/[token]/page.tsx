'use client';
import {useEffect,useRef,useState} from 'react';
import {useParams,useRouter} from 'next/navigation';
import {api,saveToken} from '@/lib/api';
import {playPkrSound} from '@/lib/sounds';
import {isIOS,isPWAInstalled} from '@/lib/push';

type Preview={event_name:string;masked_phone:string;role:string;expires_at:number};

export default function PhoneInvite(){
 const {token}=useParams<{token:string}>();
 const router=useRouter();
 const [data,setData]=useState<Preview|null>(null);
 const [name,setName]=useState('');
 const [claim,setClaim]=useState('');
 const [status,setStatus]=useState('');
 const [busy,setBusy]=useState(false);
 const [checking,setChecking]=useState(false);
 const [error,setError]=useState('');
 const [installFirst,setInstallFirst]=useState(false);
 const [copied,setCopied]=useState(false);
 const checkingRef=useRef(false),completedRef=useRef(false);

 useEffect(()=>{setInstallFirst(isIOS()&&!isPWAInstalled());},[]);
 useEffect(()=>{
   api.phoneInvites.preview(token).then(setData).catch(e=>setError(e.message||'Invitation expired or unavailable.'));
   try{const value=localStorage.getItem('pkr:join-claim:'+token);if(value)setClaim(value);}catch{}
 },[token]);

 async function ask(){
   setBusy(true);setError('');
   try{
     const result=await api.phoneInvites.requestApproval(token,name);
     try{localStorage.setItem('pkr:join-claim:'+token,result.claim);}catch{}
     setClaim(result.claim);
     setStatus('Request sent. Your host can approve it from Members in PKR. This page checks automatically while it stays open.');
   }catch(e:any){setError(e.message||'Unable to request group access.');}
   finally{setBusy(false);}
 }

 async function check(silent=false){
   if(!claim||checkingRef.current||completedRef.current)return;
   checkingRef.current=true;
   if(!silent){setChecking(true);setError('');}
   try{
     const result=await api.phoneInvites.completeApproval(claim);
     if(result.ok&&result.token){
       completedRef.current=true;
       saveToken(result.token);
       try{localStorage.removeItem('pkr:join-claim:'+token);}catch{}
       playPkrSound('approved');
       setStatus('Approved! Opening your quick phone setup…');
       router.replace('/install?group='+encodeURIComponent(result.event_id));
     }else if(!silent){
       setStatus('Still waiting for your host. PKR will check again automatically.');
     }
   }catch(e:any){if(!silent)setError(e.message||'Could not check approval. Try again.');}
   finally{checkingRef.current=false;if(!silent)setChecking(false);}
 }
 useEffect(()=>{
   if(!claim)return;
   const poll=()=>{if(document.visibilityState==='visible')void check(true);};
   poll();
   const timer=window.setInterval(poll,11000);
   window.addEventListener('focus',poll);
   document.addEventListener('visibilitychange',poll);
   return()=>{window.clearInterval(timer);window.removeEventListener('focus',poll);document.removeEventListener('visibilitychange',poll);};
 },[claim,token]);

 return <main className="pkr-onboarding" style={{maxWidth:590,margin:'24px auto',padding:'24px 18px 85px'}}>
   <a href="/" style={{color:'var(--gold)',textDecoration:'none',fontWeight:800,letterSpacing:'.06em'}}>♠ PKR</a>
   <section className="pkr-onboard-pending" aria-label="Join your private poker room">
     <span className="pkr-eyebrow">YOUR PRIVATE POKER ROOM</span>
     <h1 style={{fontFamily:'var(--font-display),serif',fontSize:'clamp(26px,5vw,35px)',color:'var(--white)',margin:'7px 0'}}>
       {data?data.event_name:'Your private invitation'}
     </h1>
     <p>One invitation. One approval. Then you're ready for game night.</p>
     <div className="pkr-onboard-steps" aria-label="Joining progress">
       <span className="complete">✓ QR or link opened</span>
       <span className={claim?'complete':'current'}>{claim?'✓ Request sent':'2 · Request access'}</span>
       <span className={claim?'current':''}>3 · Start playing</span>
     </div>
     {data&&<p style={{fontSize:12}}>Private invite for <strong style={{color:'var(--ivory)'}}>{data.masked_phone}</strong>
       {' · '}{data.role==='cohost'?'Co-host':'Player'} access</p>}
     {!claim&&installFirst&&<div style={{margin:'15px 0',padding:14,borderRadius:9,
       border:'1px solid rgba(173,130,255,.32)',background:'rgba(173,130,255,.07)'}}>
       <strong style={{color:'var(--gold)',fontSize:13}}>iPhone: install PKR before joining</strong>
       <p>For reliable app notifications and sign-in, install PKR to your Home Screen first,
         open the new app and paste your invitation on the welcome screen. Safari and a Home Screen app
         may not share your login.</p>
       <div style={{display:'flex',gap:8,flexWrap:'wrap'}}>
         <button type="button" className="btn btn-outline" onClick={async()=>{
           try{await navigator.clipboard.writeText(window.location.href);setCopied(true);}
           catch{setStatus('Copy the link from your browser address bar and paste it in the installed PKR app.');}
         }}>{copied?'✓ Link copied':'Copy my invitation link'}</button>
         <a className="btn btn-ghost" href="/install" style={{textDecoration:'none'}}>How to install →</a>
       </div>
     </div>}
     {!claim?
       <form onSubmit={e=>{e.preventDefault();void ask();}} className="pkr-pending-actions">
         <label htmlFor="join-name" style={{color:'var(--ivory)',fontSize:13,fontWeight:600}}>What name will your host recognise?</label>
         <input id="join-name" value={name} maxLength={60} autoComplete="name"
           onChange={e=>setName(e.target.value)} placeholder="Your name"
           style={{padding:14,minHeight:46,background:'var(--bg3)',color:'var(--white)',border:'1px solid var(--border-hi)',borderRadius:8}}/>
         <button className="btn btn-primary" type="submit" disabled={busy||name.trim().length<2||!data}>
           {busy?'Sending request…':'Request access to this room →'}
         </button>
         <p>Your host must approve this request. Scanning the QR never gives automatic access or verifies your phone number.</p>
       </form>:
       <div className="pkr-pending-actions">
         <div style={{borderRadius:10,padding:13,background:'rgba(173,130,255,.09)',border:'1px solid rgba(173,130,255,.25)'}}>
           <strong style={{color:'var(--gold)',fontSize:14}}>◷ Waiting for host approval</strong>
           <p style={{marginBottom:0}}>Your host will see a request in <strong>PKR → Members → Approvals</strong>.
             If they enabled push alerts, they'll also get a notification on their device.</p>
         </div>
         <p>PKR checks approval automatically about every 11 seconds while this page is open.
            You can also check manually below. You will be taken to phone setup when approved.</p>
         <button type="button" className="btn btn-primary" disabled={checking}
           onClick={()=>void check(false)}>
           {checking?'Checking approval…':'Check approval now'}
         </button>
       </div>}
     {status&&<p role="status" style={{marginTop:14,color:'var(--green)',fontSize:12}}>{status}</p>}
     {error&&<p role="alert" style={{color:'var(--red)',marginTop:14,fontSize:12}}>{error}</p>}
     <p style={{fontSize:11,color:'var(--muted)',marginTop:22,lineHeight:1.7}}>
       Your invitation expires after 48 hours and is single-use. A forwarded link does not prove phone ownership.
       If access is rejected or expires, ask the host to send a new personal invitation.
     </p>
   </section>
 </main>;
}
