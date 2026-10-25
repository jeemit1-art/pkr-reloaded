'use client';
import {useEffect,useState} from 'react';
import {useParams,useRouter} from 'next/navigation';
import {api,saveToken} from '@/lib/api';
export default function PhoneInvite(){
 const {token}=useParams<{token:string}>(),router=useRouter();
 const [data,setData]=useState<{event_name:string;masked_phone:string}|null>(null);
 const [name,setName]=useState(''),[claim,setClaim]=useState(''),[status,setStatus]=useState('');
 const [busy,setBusy]=useState(false),[error,setError]=useState('');
 useEffect(()=>{api.phoneInvites.preview(token).then(setData).catch(e=>setError(e.message));},[token]);
 useEffect(()=>{try{const value=localStorage.getItem('pkr:join-claim:'+token);if(value)setClaim(value);}catch{}},[token]);
 async function ask(){
  setBusy(true);setError('');
  try{const r=await api.phoneInvites.requestApproval(token,name);localStorage.setItem('pkr:join-claim:'+token,r.claim);setClaim(r.claim);setStatus('Request sent. The host will review it.');}
  catch(e:any){setError(e.message);}finally{setBusy(false);}
 }
 async function check(){
  setBusy(true);setError('');
  try{const r=await api.phoneInvites.completeApproval(claim);
   if(r.ok){saveToken(r.token);localStorage.removeItem('pkr:join-claim:'+token);router.replace('/install?group='+encodeURIComponent(r.event_id));}
   else setStatus('Still awaiting host approval.');
  }catch(e:any){setError(e.message);}finally{setBusy(false);}
 }
 return <main style={{maxWidth:470,margin:'60px auto',padding:'20px'}}>
  <a href="/" style={{color:'var(--gold)'}}>♠ PKR</a>
  <h1 style={{fontSize:32,marginTop:24}}>{data?data.event_name:'Private poker invitation'}</h1>
  <p>Private WhatsApp invitation for the number ending <strong>{data?.masked_phone.slice(-4)||'••••'}</strong>.</p>
  <p style={{opacity:.75}}>For your safety, joining requires approval by the group host. This free method does not verify ownership of a mobile number.</p>
  {!claim?<div style={{display:'grid',gap:12}}>
   <label htmlFor="join-name">Your name (so the host recognises you)</label>
   <input id="join-name" value={name} onChange={e=>setName(e.target.value)} maxLength={60} placeholder="Your name" style={{padding:14,background:'var(--bg2)',color:'white',border:'1px solid var(--border-hi)',borderRadius:8}}/>
   <button disabled={busy||name.trim().length<2||!data} onClick={ask} style={{padding:14,background:'var(--gold)',color:'#17120a',fontWeight:700}}>Request to join group</button>
  </div>:<div style={{display:'grid',gap:12}}>
   <p>⏳ Waiting for the host. Once approved, tap below to finish.</p>
   <button disabled={busy} onClick={check} style={{padding:14,background:'var(--gold)',color:'#17120a',fontWeight:700}}>Check approval and join</button>
  </div>}
  {status&&<p role="status">{status}</p>}{error&&<p role="alert" style={{color:'var(--red)'}}>{error}</p>}
 </main>;
}
