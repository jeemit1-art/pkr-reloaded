'use client';
import {useState} from 'react';
import {useRouter} from 'next/navigation';
import {api,saveToken} from '@/lib/api';

export default function MobileLogin(){
  const router=useRouter();
  const [code,setCode]=useState('');
  const [busy,setBusy]=useState(false);
  const [message,setMessage]=useState('');
  async function restore(){
    const normalised=code.toUpperCase().replace(/[\s-]/g,'');
    if(!/^[A-HJ-NP-Z2-9]{16}$/.test(normalised)){
      setMessage('Enter the 16-character code from your original PKR browser.');return;
    }
    setBusy(true);setMessage('');
    try{
      const result=await api.auth.transferRedeem(normalised);
      saveToken(result.token);
      router.replace('/dashboard');
    }catch(e:any){setMessage(e?.message||'Could not restore access. Generate a new code and retry.');}
    finally{setBusy(false);}
  }
  return (
    <main className="pkr-classic-mobile-login" style={{minHeight:'100vh',display:'grid',placeItems:'center',padding:24}}>
      <section style={{width:'100%',maxWidth:440,border:'1px solid var(--border-hi)',
        background:'var(--bg2)',borderRadius:14,padding:'32px 26px'}}>
        <a href="/" style={{color:'var(--gold)',textDecoration:'none',fontWeight:700}}>♠ PKR</a>
        <p style={{color:'var(--gold)',letterSpacing:'0.14em',fontSize:10,marginTop:20}}>PRIVATE MEMBERS ONLY</p>
        <h1 style={{fontFamily:'var(--font-display),serif',fontSize:32,margin:'10px 0'}}>
          Join or recover access
        </h1>
        <p style={{fontSize:14,color:'var(--ivory)',lineHeight:1.7,marginBottom:20}}>
          PKR uses personal WhatsApp invitations, not automated WhatsApp or SMS codes.
          Your group host sends the link directly to you from WhatsApp.
        </p>
        <div style={{background:'var(--bg3)',border:'1px solid var(--border-hi)',
          borderRadius:10,padding:'14px 16px',fontSize:13,lineHeight:1.7}}>
          <strong>New to the group?</strong>
          <p>Ask your host to send you a private PKR invitation through WhatsApp.
            Open that link, enter the name your host recognises, and request access.</p>
          <strong>Returning on a new device?</strong>
          <p>Ask your host to send a fresh WhatsApp recovery link. Your host must
            approve the recovery request before your account is opened.</p>
        </div>
        <form onSubmit={e=>{e.preventDefault();void restore();}}
          style={{border:'1px solid var(--border-hi)',borderRadius:10,padding:'16px',marginTop:18}}>
          <h2 style={{fontSize:19,margin:'0 0 10px'}}>Already joined? Restore without another approval</h2>
          <p style={{fontSize:12,lineHeight:1.6}}>
            In the browser where you originally joined PKR, open <a href="/install" style={{color:'var(--gold)'}}>Phone setup</a>
            {' '}and generate a five-minute transfer code. Then paste it here in your installed PKR app.
          </p>
          <label htmlFor="pkr-transfer-code" style={{display:'block',fontSize:13,marginBottom:8}}>Private transfer code</label>
          <input id="pkr-transfer-code" value={code} onChange={e=>setCode(e.target.value)}
            autoComplete="one-time-code" autoCapitalize="characters" spellCheck={false}
            maxLength={23} placeholder="XXXX XXXX XXXX XXXX"
            style={{width:'100%',padding:14,letterSpacing:2,fontSize:16,background:'var(--bg3)',color:'var(--white)',border:'1px solid var(--border-hi)',borderRadius:8}}/>
          <button className="btn btn-primary" type="submit" disabled={busy||code.trim().length<16}
            style={{display:'block',width:'100%',marginTop:12,padding:'13px'}}>
            {busy?'Checking code…':'Restore my PKR access'}
          </button>
          {message&&<p role="alert" style={{marginTop:12,color:'var(--amber)',fontSize:12}}>{message}</p>}
          <p style={{fontSize:11,marginTop:12,color:'var(--muted)'}}>Keep the code private. It expires after five minutes and is intended for transferring your own login.</p>
        </form>
        <p style={{fontSize:12,color:'var(--muted)',lineHeight:1.6,margin:'18px 0'}}>
          Invitations are personal and single-use. Sharing a link is not proof
          that someone owns a particular phone number.
        </p>
        <a className="btn btn-primary" href="/" style={{display:'block',textAlign:'center',
          padding:'13px',textDecoration:'none',marginTop:12}}>Back to PKR</a>
        <a className="btn btn-ghost" href={api.auth.loginUrl()} style={{
          display:'block',textAlign:'center',padding:'13px',
          textDecoration:'none',marginTop:10}}>Use Google sign-in instead</a>
      </section>
    </main>
  );
}
