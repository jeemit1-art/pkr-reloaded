'use client';
import {useEffect,useState} from 'react';
import {useRouter} from 'next/navigation';
import {api,saveToken} from '@/lib/api';

export default function MobileLogin(){
  const router=useRouter();
  const [phone,setPhone]=useState('');
  const [challenge,setChallenge]=useState('');
  const [code,setCode]=useState('');
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState(''),[notice,setNotice]=useState('');
  const [next,setNext]=useState('/dashboard');
  useEffect(()=>{
    const requested=new URLSearchParams(window.location.search).get('next')||'/dashboard';
    setNext(requested.startsWith('/')&&!requested.startsWith('//')&&!requested.includes('://')?requested:'/dashboard');
  },[]);
  async function start(){
    setBusy(true);setError('');setNotice('');
    try{
      const result=await api.mobileAuth.start(phone);
      setChallenge(result.challenge);setNotice(result.message);
    }catch(e:any){setError(e.message||'Unable to request a verification code.');}
    finally{setBusy(false);}
  }
  async function verify(){
    setBusy(true);setError('');
    try{
      const result=await api.mobileAuth.confirm(challenge,code);
      saveToken(result.token);
      router.replace(next);
    }catch(e:any){setError(e.message||'Verification failed.');}
    finally{setBusy(false);}
  }
  const inp:React.CSSProperties={width:'100%',padding:'13px 15px',fontSize:16,color:'var(--white)',
    background:'var(--bg3)',border:'1px solid var(--border-hi)',borderRadius:6,marginTop:10};
  return <main style={{minHeight:'100vh',display:'grid',placeItems:'center',padding:24}}>
    <div style={{width:'100%',maxWidth:420,border:'1px solid var(--border-hi)',background:'var(--bg2)',
      borderRadius:14,padding:'32px 26px'}}>
      <a href="/" style={{color:'var(--gold)',textDecoration:'none',fontWeight:700}}>♠ PKR</a>
      <p style={{color:'var(--gold)',letterSpacing:'0.14em',fontSize:10,marginTop:20}}>PRIVATE MEMBERS ONLY</p>
      <h1 style={{fontFamily:'var(--font-display),serif',fontSize:32,margin:'10px 0'}}>Sign in with mobile</h1>
      <p style={{fontSize:13,color:'var(--ivory)',lineHeight:1.65,marginBottom:20}}>
        Your verified mobile number is your PKR player identity. No email address is needed.
      </p>
      {!challenge?<form onSubmit={e=>{e.preventDefault();void start();}}>
        <label htmlFor="mobile-number" style={{fontSize:12}}>WhatsApp mobile number</label>
        <input id="mobile-number" value={phone} type="tel" autoComplete="tel"
          placeholder="04xx xxx xxx or +61…" style={inp} onChange={e=>setPhone(e.target.value)} required/>
        <button className="btn btn-primary" type="submit" disabled={busy}
          style={{width:'100%',padding:'13px',marginTop:14}}>{busy?'Checking…':'Send verification code'}</button>
      </form>:<form onSubmit={e=>{e.preventDefault();void verify();}}>
        <label htmlFor="mobile-otp" style={{fontSize:12}}>Verification code</label>
        <input id="mobile-otp" value={code} inputMode="numeric" autoComplete="one-time-code"
          maxLength={10} placeholder="Verification code" style={inp}
          onChange={e=>setCode(e.target.value.replace(/\D/g,''))} required/>
        <button className="btn btn-primary" type="submit" disabled={busy}
          style={{width:'100%',padding:'13px',marginTop:14}}>{busy?'Verifying…':'Verify and sign in'}</button>
        <button type="button" className="btn btn-ghost" style={{width:'100%',marginTop:10}}
          onClick={()=>{setChallenge('');setCode('');}}>Use another number</button>
      </form>}
      {notice&&<p role="status" style={{fontSize:12,color:'var(--green)',marginTop:15}}>{notice}</p>}
      {error&&<p role="alert" style={{fontSize:12,color:'var(--red)',marginTop:15}}>{error}</p>}
      <p style={{marginTop:20,color:'var(--muted)',fontSize:11,lineHeight:1.6}}>
        New player? Ask your group host to send a personal WhatsApp invitation first.
        Each group has its own private membership list.
      </p>
    </div>
  </main>;
}
