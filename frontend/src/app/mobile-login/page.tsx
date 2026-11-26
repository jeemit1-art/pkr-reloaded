'use client';
import {useEffect,useState} from 'react';
import {useRouter} from 'next/navigation';
import {
  api,getToken,renewApprovedDevice,ensureApprovedDevice,
  saveToken,rememberApprovedDevice,
} from '@/lib/api';

type HelpChoice='options'|'transfer'|'recover'|'new';
const recoveryRequest='Hi, I am already a member of our PKR poker group, but I cannot get back into my account. Please open PKR Members and select Recover access on my existing member profile, not Invite new player. If my phone contact is not linked, please Match existing member first. I will request access using the private WhatsApp link and you can approve it. Thanks.';

export default function MobileLogin(){
  const router=useRouter();
  const [view,setView]=useState<HelpChoice>('options');
  const [code,setCode]=useState('');
  const [busy,setBusy]=useState(false);
  const [checking,setChecking]=useState(true);
  const [message,setMessage]=useState('');
  const [copied,setCopied]=useState(false);

  async function checkExisting(silent=false){
    setChecking(true);
    if(!silent)setMessage('');
    try{
      if(!getToken()&&!(await renewApprovedDevice())){
        if(!silent)setMessage('There is no active PKR sign-in in this browser. Your existing member profile is still available; use the options below.');
        return;
      }
      // Validate with the server before recognising a member or restoring
      // session renewal. Local storage by itself cannot prove membership.
      const me=await api.auth.me();
      void ensureApprovedDevice().catch(()=>{});
      router.replace('/dashboard');
    }catch(error){
      if(!silent)setMessage(error instanceof Error?error.message:'PKR could not confirm this login. Choose a recovery option below.');
    }finally{setChecking(false);}
  }

  useEffect(()=>{
    const hint=new URLSearchParams(window.location.search).get('help');
    if(hint==='recover'||hint==='invite')setView('recover');
    if(hint==='transfer')setView('transfer');
    void checkExisting(true);
    // Do not repeatedly validate while an embedded WhatsApp browser
    // changes focus; the account is checked again on an explicit retry.
  },[]);

  async function restore(){
    const normalised=code.toUpperCase().replace(/[\s-]/g,'');
    if(!/^[A-HJ-NP-Z2-9]{16}$/.test(normalised)){
      setMessage('Enter the 16-character private transfer code from your original signed-in PKR browser.');return;
    }
    setBusy(true);setMessage('');
    try{
      const result=await api.auth.transferRedeem(normalised);
      saveToken(result.token);
      void rememberApprovedDevice().catch(()=>{});
      router.replace('/dashboard');
    }catch(error){
      setMessage(error instanceof Error?error.message:'The code could not be used. Generate a fresh one from your original browser.');
    }finally{setBusy(false);}
  }

  async function copyRequest(){
    try{
      await navigator.clipboard.writeText(recoveryRequest);
      setCopied(true);setMessage('Message copied. Send it to your poker host through WhatsApp.');
    }catch{
      setMessage('Copy the message below and send it to your host in WhatsApp.');
    }
  }

  const buttonStyle={width:'100%',textAlign:'left' as const,background:'var(--bg3)',
    color:'var(--ivory)',padding:15,border:'1px solid var(--border-hi)',
    borderRadius:10,cursor:'pointer',fontSize:14,lineHeight:1.5};
  const linkStyle={color:'var(--gold)',textDecoration:'underline'};
  return (
    <main className="pkr-classic-mobile-login" style={{minHeight:'100vh',display:'grid',placeItems:'center',padding:'24px 16px 70px'}}>
      <section style={{width:'100%',maxWidth:530,border:'1px solid var(--border-hi)',
        background:'var(--bg2)',borderRadius:14,padding:'28px 22px'}}>
        <a href="/" style={{color:'var(--gold)',textDecoration:'none',fontWeight:700}}>♠ PKR</a>
        <p style={{color:'var(--gold)',letterSpacing:'0.12em',fontSize:11,marginTop:18}}>PRIVATE POKER CLUB</p>
        <h1 style={{fontFamily:'var(--font-display),serif',fontSize:30,margin:'10px 0'}}>Get back into PKR</h1>
        <p style={{fontSize:14,color:'var(--ivory)',lineHeight:1.7}}>
          Already a member? Your account, game history and payment records are linked to your original membership.
          You do not need to join as a new player.
        </p>

        {checking?<p role="status" style={{fontSize:13,color:'var(--gold)'}}>Checking for your existing PKR sign-in…</p>:
          <button type="button" className="btn btn-ghost" onClick={()=>void checkExisting()}
            style={{marginBottom:18,fontSize:12,padding:'10px 12px'}}>↻ Check if I am already signed in</button>}

        <div style={{display:'grid',gap:9}}>
          <button type="button" onClick={()=>{setView('transfer');setMessage('');}}
            style={buttonStyle} aria-pressed={view==='transfer'}>
            <strong>PKR still works in another browser or on another device</strong>
            <span style={{display:'block',fontSize:12,color:'var(--muted)',marginTop:4}}>
              Move your existing login to the installed app or a different phone.
            </span>
          </button>
          <button type="button" onClick={()=>{setView('recover');setMessage('');}}
            style={buttonStyle} aria-pressed={view==='recover'}>
            <strong>I cannot open PKR anywhere</strong>
            <span style={{display:'block',fontSize:12,color:'var(--muted)',marginTop:4}}>
              Ask your host to restore your original membership securely.
            </span>
          </button>
          <button type="button" onClick={()=>{setView('new');setMessage('');}}
            style={buttonStyle} aria-pressed={view==='new'}>
            <strong>I have never joined PKR before</strong>
            <span style={{display:'block',fontSize:12,color:'var(--muted)',marginTop:4}}>
              Join using a personal invitation and your host's approval.
            </span>
          </button>
        </div>

        {view==='transfer'&&<section style={{background:'var(--bg3)',border:'1px solid var(--border-hi)',borderRadius:10,padding:16,marginTop:17}}>
          <h2 style={{fontSize:19,margin:'0 0 8px'}}>Transfer your existing account</h2>
          <p style={{fontSize:13,lineHeight:1.7}}>
            1. In the browser where PKR still works, open <a href="/install" style={linkStyle}>Phone setup</a> and generate a private transfer code.
            <br/>2. Return to this screen in the new phone or installed PKR app.
            <br/>3. Enter the code within five minutes. Your membership stays the same.
          </p>
          <form onSubmit={event=>{event.preventDefault();void restore();}}>
            <label htmlFor="pkr-transfer-code" style={{display:'block',fontSize:13,marginBottom:8}}>16-character transfer code</label>
            <input id="pkr-transfer-code" value={code} onChange={event=>setCode(event.target.value)}
              autoComplete="one-time-code" autoCapitalize="characters" spellCheck={false}
              maxLength={23} placeholder="XXXX XXXX XXXX XXXX"
              style={{width:'100%',padding:14,letterSpacing:2,fontSize:16,
                background:'var(--bg2)',color:'var(--white)',border:'1px solid var(--border-hi)',borderRadius:8}}/>
            <button className="btn btn-primary" type="submit" disabled={busy||code.trim().length<16}
              style={{display:'block',width:'100%',marginTop:12,padding:13}}>
              {busy?'Restoring your account…':'Restore my existing account'}
            </button>
          </form>
          <p style={{fontSize:12,color:'var(--muted)',marginTop:12}}>
            On iPhone, WhatsApp, Safari and the Home Screen app may each have different sign-in storage.
            If the old browser is no longer signed in, choose the host recovery option instead.
          </p>
        </section>}

        {view==='recover'&&<section style={{background:'var(--bg3)',border:'1px solid var(--border-hi)',borderRadius:10,padding:16,marginTop:17}}>
          <h2 style={{fontSize:19,margin:'0 0 8px'}}>Restore your original membership</h2>
          <p style={{fontSize:13,lineHeight:1.7}}>
            1. Ask your host to open <strong>Members</strong> in your poker room.
            <br/>2. The host selects <strong>Recover access</strong> for your existing profile and sends you a new private WhatsApp link.
            <br/>3. Open the link, request access and let your host approve it.
            <br/>4. Return to the <strong>same browser</strong> and tap <strong>Check approval now</strong>.
          </p>
          <p style={{fontSize:12,lineHeight:1.65}}>
            If you originally signed in using Google, select the same Google account below instead of requesting a new invitation.
          </p>
          <p style={{fontSize:12,lineHeight:1.65}}>
            If you were approved but are stuck on Pending, reopen the original WhatsApp invitation in the same browser.
            If that browser or the private request is lost, ask the host for a fresh recovery link.
            Do not sign up as a different person.
          </p>
          <button className="btn btn-primary" type="button" onClick={()=>void copyRequest()}
            style={{padding:'12px 14px',marginTop:7}}>{copied?'✓ Message copied':'Copy a recovery request for my host'}</button>
          <details style={{marginTop:12,fontSize:12,color:'var(--muted)'}}>
            <summary>See the message to send</summary><p style={{whiteSpace:'pre-wrap'}}>{recoveryRequest}</p>
          </details>
        </section>}

        {view==='new'&&<section style={{background:'var(--bg3)',border:'1px solid var(--border-hi)',borderRadius:10,padding:16,marginTop:17}}>
          <h2 style={{fontSize:19,margin:'0 0 8px'}}>Join your first poker room</h2>
          <p style={{fontSize:13,lineHeight:1.7}}>
            Ask your host for your personal WhatsApp invitation. Open the link, enter the name your host recognises
            and request approval. Once the host approves you, return to that same browser and PKR will finish joining.
            No App Store installation or paid messaging service is required.
          </p>
          <a href="/#join" style={linkStyle}>Already have a private invitation? Open it here</a>
        </section>}

        {!!message&&<p role="status" style={{marginTop:16,color:'var(--amber)',fontSize:13,lineHeight:1.6}}>{message}</p>}
        <p style={{fontSize:12,color:'var(--muted)',lineHeight:1.6,marginTop:22}}>
          Your host should use <strong>Recover access</strong> rather than create a new member.
          PKR never verifies phone ownership solely from a forwarded WhatsApp link.
        </p>
        <a href={api.auth.loginUrl()} style={{...linkStyle,fontSize:12}}>
          Originally signed in with Google? Use the same Google account
        </a>
        <p style={{fontSize:11,color:'var(--muted)',lineHeight:1.5,marginTop:6}}>
          Choosing a different Google account may open a separate PKR profile.
        </p>
      </section>
    </main>
  );
}
