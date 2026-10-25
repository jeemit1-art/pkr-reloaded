'use client';
import {useEffect,useState} from 'react';
import {useParams,useRouter} from 'next/navigation';
import {api,saveToken} from '@/lib/api';

type InvitePreview={event_name:string;masked_phone:string;role:string;verification_ready:boolean};
const inputStyle:React.CSSProperties={
  display:'block',width:'100%',background:'var(--bg3)',border:'1px solid var(--border-hi)',
  color:'var(--white)',borderRadius:6,padding:'13px 14px',fontSize:16,letterSpacing:'0.08em'
};
const buttonStyle:React.CSSProperties={
  width:'100%',border:'none',borderRadius:6,background:'var(--gold)',color:'#16120b',
  fontSize:14,fontWeight:700,padding:'14px 18px',cursor:'pointer'
};
export default function PrivatePhoneInvitePage(){
  const {token}=useParams<{token:string}>();
  const router=useRouter();
  const [data,setData]=useState<InvitePreview|null>(null);
  const [busy,setBusy]=useState(false),[requested,setRequested]=useState(false);
  const [code,setCode]=useState(''),[error,setError]=useState(''),[notice,setNotice]=useState('');
  useEffect(()=>{
    api.phoneInvites.preview(token).then(setData).catch(e=>setError(e.message||'Invitation is unavailable.'));
  },[token]);
  async function requestCode(){
    setBusy(true);setError('');setNotice('');
    try{
      const r=await api.phoneInvites.sendCode(token);
      setRequested(true);setNotice(r.message);
    }catch(e:any){setError(e.message||'Could not send code.');}
    finally{setBusy(false);}
  }
  async function confirm(){
    if(!/^\d{4,10}$/.test(code)){setError('Enter the code sent to your mobile.');return;}
    setBusy(true);setError('');
    try{
      const result=await api.phoneInvites.confirm(token,code);
      saveToken(result.token);
      router.replace('/events/'+result.event_id);
    }catch(e:any){setError(e.message||'Could not verify your phone.');}
    finally{setBusy(false);}
  }
  return <main style={{minHeight:'100vh',display:'flex',alignItems:'center',justifyContent:'center',padding:24}}>
    <div style={{width:'100%',maxWidth:440,padding:'32px 26px',background:'var(--bg2)',
      border:'1px solid var(--border-hi)',borderRadius:14,boxShadow:'0 18px 80px rgba(0,0,0,0.3)'}}>
      <a href="/" style={{textDecoration:'none',color:'var(--gold)',fontWeight:700,letterSpacing:'0.15em',fontSize:14}}>♠ PKR</a>
      <p style={{marginTop:20,color:'var(--gold)',fontSize:10,letterSpacing:'0.16em'}}>PRIVATE GROUP INVITATION</p>
      <h1 style={{fontFamily:'var(--font-display),serif',fontSize:32,lineHeight:1.15,marginTop:10}}>
        {data?data.event_name:'Opening your invitation'}
      </h1>
      {data&&<div style={{marginTop:18,display:'grid',gap:9,color:'var(--ivory)',fontSize:13,lineHeight:1.6}}>
        <p>This invitation is assigned to the mobile number ending <strong>{data.masked_phone.slice(-4)}</strong>.</p>
        <p>For privacy, only the person who receives a verification code at this number can join.</p>
        {!data.verification_ready&&<p style={{color:'var(--amber)'}}>The group host needs to finish configuring WhatsApp verification before you can join.</p>}
        {!requested
          ?<button style={buttonStyle} disabled={busy||!data.verification_ready} onClick={requestCode}>
            {busy?'Sending…':'Send verification code to my mobile'}
           </button>
          :<form onSubmit={e=>{e.preventDefault();void confirm();}} style={{display:'grid',gap:12}}>
            <label htmlFor="phone-invite-code" style={{fontSize:12}}>Mobile verification code</label>
            <input id="phone-invite-code" type="text" inputMode="numeric" autoComplete="one-time-code"
              placeholder="6-digit code" maxLength={10} value={code} onChange={e=>setCode(e.target.value.replace(/\D/g,''))} style={inputStyle}/>
            <button type="submit" disabled={busy} style={buttonStyle}>{busy?'Checking…':'Verify mobile and join group'}</button>
            <button type="button" onClick={requestCode} disabled={busy} style={{color:'var(--gold)',fontSize:12,background:'none',border:'none',cursor:'pointer'}}>Resend code</button>
          </form>}
      </div>}
      {!data&&!error&&<p style={{color:'var(--muted)',marginTop:12,fontSize:13}}>Checking your private invitation…</p>}
      {notice&&<p role="status" style={{color:'var(--green)',fontSize:13,marginTop:16}}>{notice}</p>}
      {error&&<p role="alert" style={{color:'var(--red)',fontSize:13,marginTop:16}}>{error}</p>}
      <p style={{fontSize:11,color:'var(--muted)',lineHeight:1.6,marginTop:22}}>
        A WhatsApp link by itself does not give access. Your number is kept private from other groups and members.
      </p>
    </div>
  </main>;
}
