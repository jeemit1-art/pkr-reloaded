'use client';
import {useEffect,useState} from 'react';
import {useParams,useRouter} from 'next/navigation';
import {api,saveToken} from '@/lib/api';

type Preview={event_name:string;masked_phone:string;role:string;expires_at:number};
export default function PhoneInvite(){
 const {token}=useParams<{token:string}>();
 const router=useRouter();
 const [data,setData]=useState<Preview|null>(null);
 const [name,setName]=useState('');
 const [claim,setClaim]=useState('');
 const [status,setStatus]=useState('');
 const [busy,setBusy]=useState(false);
 const [error,setError]=useState('');
 useEffect(()=>{
   api.phoneInvites.preview(token).then(setData).catch(e=>setError(e.message||'Invitation expired or unavailable.'));
 },[token]);
 useEffect(()=>{
   try{const value=localStorage.getItem('pkr:join-claim:'+token);if(value)setClaim(value);}
   catch{}
 },[token]);
 async function ask(){
   setBusy(true);setError('');
   try{
     const result=await api.phoneInvites.requestApproval(token,name);
     localStorage.setItem('pkr:join-claim:'+token,result.claim);
     setClaim(result.claim);
     setStatus('Your request was sent. Ask your group host to review and approve it.');
   }catch(e:any){setError(e.message||'Unable to request group access.');}
   finally{setBusy(false);}
 }
 async function check(){
   setBusy(true);setError('');
   try{
     const result=await api.phoneInvites.completeApproval(claim);
     if(result.ok){
       saveToken(result.token);
       try{localStorage.removeItem('pkr:join-claim:'+token);}catch{}
       router.replace('/install?group='+encodeURIComponent(result.event_id));
     }else setStatus('Your host has not approved the request yet.');
   }catch(e:any){setError(e.message||'Unable to check host approval.');}
   finally{setBusy(false);}
 }
 return <main style={{maxWidth:480,margin:'52px auto',padding:20}}>
   <a href="/" style={{color:'var(--gold)',textDecoration:'none'}}>♠ PKR</a>
   <h1 style={{fontFamily:'var(--font-display),serif',fontSize:32,marginTop:24}}>
     {data?data.event_name:'Your private invitation'}
   </h1>
   {data&&<p style={{opacity:.85}}>Personal WhatsApp invitation for
     <strong> {data.masked_phone}</strong>.</p>}
   <p style={{opacity:.78,lineHeight:1.65}}>
     This one-time link was sent by your group host. No automatic OTP is required.
     The host must approve the request before you can access the group.
   </p>
   {!claim?
     <form onSubmit={e=>{e.preventDefault();void ask();}} style={{display:'grid',gap:12,marginTop:24}}>
       <label htmlFor="join-name">Your name (so your host recognises you)</label>
       <input id="join-name" value={name} maxLength={60} autoComplete="name"
         onChange={e=>setName(e.target.value)}
         placeholder="Your name"
         style={{padding:14,background:'var(--bg2)',color:'white',
           border:'1px solid var(--border-hi)',borderRadius:8}}/>
       <button type="submit" disabled={busy||name.trim().length<2||!data}
         style={{padding:14,background:'var(--gold)',color:'#17120a',fontWeight:700}}>
         {busy?'Sending request…':'Request approval from host'}
       </button>
     </form>:
     <div style={{display:'grid',gap:12,marginTop:24}}>
       <p>Your host can now approve this request in the PKR group Members screen.
         Once they have approved it, select the button below.</p>
       <button disabled={busy} onClick={check}
         style={{padding:14,background:'var(--gold)',color:'#17120a',fontWeight:700}}>
         {busy?'Checking…':'Check approval and join PKR'}
       </button>
     </div>}
   {status&&<p role="status" style={{marginTop:14}}>{status}</p>}
   {error&&<p role="alert" style={{color:'var(--red)',marginTop:14}}>{error}</p>}
   <p style={{fontSize:12,opacity:.7,marginTop:20,lineHeight:1.6}}>
     This link expires after 48 hours and is single-use. A forwarded link
     does not verify phone ownership. For a new or replacement invitation,
     contact your group host.
   </p>
 </main>;
}
