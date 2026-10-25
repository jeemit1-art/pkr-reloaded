'use client';
import {useEffect,useState} from 'react';
import {useParams,useRouter} from 'next/navigation';
import {api,saveToken} from '@/lib/api';

type Preview={event_name:string;masked_phone:string;verification_ready:boolean};
export default function PhoneInvite(){
 const {token}=useParams<{token:string}>(),router=useRouter();
 const [preview,setPreview]=useState<Preview|null>(null);
 const [sent,setSent]=useState(false),[code,setCode]=useState('');
 const [busy,setBusy]=useState(false),[status,setStatus]=useState(''),[error,setError]=useState('');
 useEffect(()=>{api.phoneInvites.preview(token).then(setPreview).catch(e=>setError(e.message));},[token]);
 async function send(){
  setBusy(true);setError('');setStatus('');
  try{const r=await api.phoneInvites.sendCode(token);
   setSent(true);setStatus(r.message||'A WhatsApp code was requested. Check your messages.');
  }catch(e:any){setError(e.message||'Could not send the WhatsApp code.');}
  finally{setBusy(false);}
 }
 async function confirm(){
  setBusy(true);setError('');
  try{const r=await api.phoneInvites.confirm(token,code);
   saveToken(r.token);router.replace('/install?group='+encodeURIComponent(r.event_id));
  }catch(e:any){setError(e.message||'The WhatsApp code was not accepted.');}
  finally{setBusy(false);}
 }
 const buttonStyle={padding:14,background:'var(--gold)',color:'#17120a',fontWeight:700};
 return <main style={{maxWidth:470,margin:'60px auto',padding:20}}>
  <a href="/" style={{color:'var(--gold)'}}>♠ PKR</a>
  <h1 style={{fontSize:32,marginTop:24}}>{preview?preview.event_name:'Private poker invitation'}</h1>
  <p>Invitation for the WhatsApp number <strong>{preview?.masked_phone||'provided by your host'}</strong>.</p>
  <p style={{opacity:.75}}>Confirm that you receive a one-time code in WhatsApp on your invited number before joining this private group.</p>
  {preview&&!preview.verification_ready&&
   <p role="status">WhatsApp OTP is not configured yet. Contact your host.</p>}
  {preview?.verification_ready&&(!sent?
   <div style={{display:'grid',gap:12}}>
    <p>We'll request a six-digit WhatsApp code. It expires after 10 minutes.</p>
    <button type="button" style={buttonStyle} disabled={busy} onClick={send}>
      {busy?'Sending…':'Send WhatsApp code'}
    </button>
   </div>:
   <form onSubmit={e=>{e.preventDefault();void confirm();}} style={{display:'grid',gap:12}}>
    <label htmlFor="pkr-wa-code">Six-digit WhatsApp verification code</label>
    <input id="pkr-wa-code" value={code} inputMode="numeric" autoComplete="one-time-code"
      maxLength={6} onChange={e=>setCode(e.target.value.replace(/\D/g,''))}
      style={{padding:14,background:'var(--bg2)',color:'white',
        border:'1px solid var(--border-hi)',borderRadius:8}}/>
    <button type="submit" style={buttonStyle} disabled={busy||code.length!==6}>
      {busy?'Verifying…':'Verify and join PKR'}
    </button>
    <button type="button" disabled={busy} onClick={()=>{setSent(false);setCode('');setError('');}}
      style={{padding:12,background:'transparent',color:'var(--gold)',border:'1px solid var(--border-hi)',borderRadius:8}}>
      Request a new code
    </button>
   </form>)}
  {status&&<p role="status">{status}</p>}
  {error&&<p role="alert" style={{color:'var(--red)'}}>{error}</p>}
 </main>;
}
