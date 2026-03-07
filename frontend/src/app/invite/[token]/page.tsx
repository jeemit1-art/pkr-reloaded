'use client';
type InviteStatus = 'loading' | 'onboarding' | 'auth' | 'error';
type OnboardStep  = 'welcome' | 'install' | 'notify' | 'done';

import { useEffect, useState, useCallback } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { api } from '@/lib/api';
import { isPWAInstalled, isIOS, isSafari, canUsePush, getNotificationPermission, subscribePush } from '@/lib/push';

export default function InvitePage() {
  const { token } = useParams<{token:string}>();
  const router    = useRouter();

  const [status,    setStatus]    = useState<InviteStatus>('loading');
  const [step,      setStep]      = useState<OnboardStep>('welcome');
  const [eventName, setEventName] = useState('');
  const [eventId,   setEventId]   = useState('');
  const [role,      setRole]      = useState('');
  const [err,       setErr]       = useState('');
  const [installed, setInstalled] = useState(false);
  const [notified,  setNotified]  = useState(false);
  const [subscribing, setSubscribing] = useState(false);
  const [userId, setUserId] = useState('');
  const [userName, setUserName] = useState('');
  const [installPrompt, setInstallPrompt] = useState<any>(null);

  const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8787';
  const ios    = isIOS();
  const safari = isSafari();

  useEffect(() => {
    const handler = (e: any) => { e.preventDefault(); setInstallPrompt(e); };
    window.addEventListener('beforeinstallprompt', handler);
    return () => window.removeEventListener('beforeinstallprompt', handler);
  }, []);

  useEffect(() => {
    setInstalled(isPWAInstalled());
    const perm = getNotificationPermission();
    setNotified(perm === 'granted');
  }, []);

  useEffect(() => {
    const run = async () => {
      // If returning from Google OAuth, exchange the one-time code for a JWT first
      const urlParams = new URLSearchParams(window.location.search);
      const code = urlParams.get('code');
      if (code) {
        try {
          const res = await fetch(`${apiUrl}/auth/token?code=${code}`);
          const data = await res.json() as any;
          if (data.token) {
            localStorage.setItem('pkr_token', data.token);
            // Clean code from URL without reload
            const clean = new URL(window.location.href);
            clean.searchParams.delete('code');
            window.history.replaceState({}, '', clean.toString());
          }
        } catch {}
      }
      // Now attempt to redeem the invite (token is set if we just exchanged it)
      try {
        const { event, role: r } = await api.events.redeemInvite(token as string);
        setEventName(event.name); setEventId(event.id); setRole(r);
        try {
          const me = await api.auth.me() as any;
          setUserId(me.id || '');
          setUserName(me.name || '');
        } catch {}
        setStatus('onboarding'); setStep('welcome');
      } catch(e: any) {
        if (e.message === 'Unauthorized' || e.message === 'Session expired') setStatus('auth');
        else { setErr(e.message); setStatus('error'); }
      }
    };
    run();
  }, [token]);

  async function handleInstall() {
    if (installPrompt) {
      installPrompt.prompt();
      const { outcome } = await installPrompt.userChoice;
      if (outcome === 'accepted') setInstalled(true);
    }
  }

  async function handleNotify() {
    if (!canUsePush()) { goToEvent(); return; }
    setSubscribing(true);
    try {
      const perm = await Notification.requestPermission();
      if (perm === 'granted') {
        await subscribePush(eventId, userId || undefined, userName || undefined);
        setNotified(true); setStep('done');
        setTimeout(goToEvent, 2000);
      } else { goToEvent(); }
    } catch { goToEvent(); }
    finally { setSubscribing(false); }
  }

  function goToEvent() { router.push(`/events/${eventId}`); }

  function nextStep() {
    if (step === 'welcome') { setStep(installed ? 'notify' : 'install'); }
    else if (step === 'install') {
      if (notified || !canUsePush()) { setStep('done'); setTimeout(goToEvent, 1500); }
      else setStep('notify');
    } else if (step === 'notify') { setStep('done'); setTimeout(goToEvent, 1500); }
  }

  const card = (children: React.ReactNode) => (
    <div style={{minHeight:'100vh',background:'var(--bg)',display:'flex',alignItems:'center',
      justifyContent:'center',padding:'40px 24px',position:'relative',overflow:'hidden'}}>
      <div style={{position:'absolute',bottom:-60,right:-40,fontSize:420,opacity:0.018,
        color:'var(--gold)',lineHeight:1,userSelect:'none',pointerEvents:'none',fontFamily:'serif'}}>♠</div>
      <div className="card-gold" style={{padding:'36px 28px',maxWidth:400,width:'100%',position:'relative',zIndex:1}}>
        {children}
      </div>
    </div>
  );

  if (status === 'loading') return card(
    <div style={{textAlign:'center'}}>
      <div className="display" style={{fontSize:48,color:'var(--gold)',marginBottom:16,opacity:0.8}}>PKR</div>
      <div style={{fontSize:10,letterSpacing:'0.22em',textTransform:'uppercase',color:'var(--muted)',fontFamily:'var(--font-body),sans-serif'}}>Validating invite…</div>
    </div>
  );

  if (status === 'auth') return card(
    <div style={{textAlign:'center'}}>
      <div style={{fontSize:40,marginBottom:16}}>🔐</div>
      <div style={{fontSize:9,letterSpacing:'0.22em',textTransform:'uppercase',color:'var(--amber)',fontFamily:'var(--font-body),sans-serif',marginBottom:10,fontWeight:600}}>Sign In Required</div>
      <div className="display" style={{fontSize:22,color:'var(--white)',marginBottom:8,fontWeight:500}}>You've been invited</div>
      <div style={{fontSize:12,color:'var(--muted)',lineHeight:1.8,fontFamily:'var(--font-body),sans-serif',marginBottom:24}}>
        Sign in with Google to claim your seat.<br/>You'll be redirected back automatically.
      </div>
      <a href={`${apiUrl}/auth/google?returnTo=${encodeURIComponent(`/invite/${token}`)}`}
        className="btn btn-primary" style={{width:'100%',fontSize:13,display:'flex',alignItems:'center',justifyContent:'center',gap:10}}>
        <svg width="16" height="16" viewBox="0 0 18 18" style={{flexShrink:0}}>
          <path d="M17.64 9.2a10.34 10.34 0 0 0-.16-1.84H9v3.48h4.84a4.14 4.14 0 0 1-1.8 2.72v2.26h2.92a8.78 8.78 0 0 0 2.68-6.62z" fill="#4285F4"/>
          <path d="M9 18a8.6 8.6 0 0 0 5.96-2.18l-2.91-2.26a5.4 5.4 0 0 1-8.07-2.85H.96v2.33A9 9 0 0 0 9 18z" fill="#34A853"/>
          <path d="M3.96 10.71a5.41 5.41 0 0 1 0-3.42V4.96H.96a9 9 0 0 0 0 8.08l3-2.33z" fill="#FBBC05"/>
          <path d="M9 3.58a4.86 4.86 0 0 1 3.44 1.35l2.58-2.58A8.64 8.64 0 0 0 9 0 9 9 0 0 0 .96 4.96l3 2.33A5.36 5.36 0 0 1 9 3.58z" fill="#EA4335"/>
        </svg>
        Continue with Google
      </a>
    </div>
  );

  if (status === 'error') return card(
    <div style={{textAlign:'center'}}>
      <div style={{fontSize:40,marginBottom:16}}>⏱️</div>
      <div style={{fontSize:9,letterSpacing:'0.22em',textTransform:'uppercase',color:'var(--red)',fontFamily:'var(--font-body),sans-serif',marginBottom:10,fontWeight:600}}>Invite Unavailable</div>
      <div style={{fontSize:13,color:'var(--muted)',lineHeight:1.7,fontFamily:'var(--font-body),sans-serif',marginBottom:20}}>
        {err || 'This invite link has expired or already been used.'}
      </div>
      <div style={{background:'rgba(201,168,76,0.06)',border:'1px solid rgba(201,168,76,0.18)',borderRadius:2,padding:'12px 14px',marginBottom:20,textAlign:'left'}}>
        <div style={{fontSize:11,color:'var(--gold)',fontWeight:600,marginBottom:4,fontFamily:'var(--font-body),sans-serif'}}>What to do</div>
        <div style={{fontSize:11,color:'var(--muted)',lineHeight:1.7,fontFamily:'var(--font-body),sans-serif'}}>Ask the host to generate a new invite link — they expire after 48 hours and can only be used once.</div>
      </div>
      <button className="btn btn-ghost" style={{width:'100%',fontSize:13}} onClick={()=>router.push('/dashboard')}>Go to Dashboard</button>
    </div>
  );

  if (step === 'welcome') return card(
    <>
      <div style={{textAlign:'center',marginBottom:28}}>
        <div style={{fontSize:48,marginBottom:12}}>🃏</div>
        <div style={{fontSize:9,letterSpacing:'0.22em',textTransform:'uppercase',color:'var(--green)',fontFamily:'var(--font-body),sans-serif',marginBottom:10,fontWeight:600}}>Invite Accepted</div>
        <div className="display" style={{fontSize:26,color:'var(--white)',marginBottom:8,fontWeight:500}}>Welcome to {eventName}</div>
        <div style={{fontSize:12,color:'var(--muted)',lineHeight:1.8,fontFamily:'var(--font-body),sans-serif'}}>
          You joined as <span style={{color:'var(--gold)',fontWeight:600}}>{role}</span>.
        </div>
      </div>
      <div style={{marginBottom:24}}>
        <div style={{fontSize:9,letterSpacing:'0.18em',textTransform:'uppercase',color:'var(--gold)',fontFamily:'var(--font-body),sans-serif',fontWeight:600,marginBottom:12}}>Get the full experience</div>
        {[
          {icon:'🃏',title:'New games',    desc:'Instant alert when a game is scheduled'},
          {icon:'💰',title:'Your buy-ins', desc:'Notified when the host records your chips'},
          {icon:'💸',title:'Your cashout', desc:'Alert when your chips are cashed out'},
          {icon:'✅',title:'Results',       desc:'Push when the game settles — see your P&L'},
        ].map(f=>(
          <div key={f.title} style={{display:'flex',alignItems:'flex-start',gap:12,padding:'10px 12px',background:'var(--bg3)',border:'1px solid var(--border-sub)',borderRadius:2,marginBottom:6}}>
            <span style={{fontSize:18,flexShrink:0,lineHeight:1.3}}>{f.icon}</span>
            <div>
              <div style={{fontSize:12,color:'var(--ivory)',fontWeight:500,fontFamily:'var(--font-body),sans-serif'}}>{f.title}</div>
              <div style={{fontSize:11,color:'var(--muted)',lineHeight:1.4,fontFamily:'var(--font-body),sans-serif'}}>{f.desc}</div>
            </div>
          </div>
        ))}
      </div>
      <button className="btn btn-primary" style={{width:'100%',fontSize:13}} onClick={nextStep}>
        {installed ? 'Enable Notifications →' : 'Set Up PKR →'}
      </button>
      <button className="btn btn-ghost" style={{width:'100%',fontSize:12,marginTop:8}} onClick={goToEvent}>Skip, take me to the event</button>
    </>
  );

  if (step === 'install') return card(
    <>
      <div style={{textAlign:'center',marginBottom:24}}>
        <div style={{fontSize:40,marginBottom:12}}>📲</div>
        <div style={{fontSize:9,letterSpacing:'0.22em',textTransform:'uppercase',color:'var(--gold)',fontFamily:'var(--font-body),sans-serif',marginBottom:8,fontWeight:600}}>Step 1 of 2</div>
        <div className="display" style={{fontSize:22,color:'var(--white)',marginBottom:8,fontWeight:500}}>Add PKR to your home screen</div>
        <div style={{fontSize:12,color:'var(--muted)',lineHeight:1.7,fontFamily:'var(--font-body),sans-serif'}}>Install PKR like a native app — no App Store needed. Get push notifications straight to your lock screen.</div>
      </div>
      {!ios && installPrompt && (
        <button className="btn btn-primary" style={{width:'100%',fontSize:13,marginBottom:10}} onClick={handleInstall}>📲 Install PKR Now</button>
      )}
      {ios && safari && (
        <div style={{background:'var(--bg3)',border:'1px solid var(--border-sub)',borderRadius:3,padding:'16px',marginBottom:16}}>
          <div style={{fontSize:10,letterSpacing:'0.16em',textTransform:'uppercase',color:'var(--gold)',fontFamily:'var(--font-body),sans-serif',fontWeight:600,marginBottom:12}}>How to install on iPhone</div>
          {[
            {step:'1',text:'Tap the Share button at the bottom of Safari (the box with an arrow ↑)'},
            {step:'2',text:'Scroll down and tap "Add to Home Screen"'},
            {step:'3',text:'Tap "Add" in the top-right corner'},
          ].map(s=>(
            <div key={s.step} style={{display:'flex',alignItems:'flex-start',gap:10,marginBottom:10}}>
              <div style={{width:20,height:20,borderRadius:'50%',background:'rgba(201,168,76,0.15)',border:'1px solid rgba(201,168,76,0.3)',display:'flex',alignItems:'center',justifyContent:'center',fontSize:10,color:'var(--gold)',fontWeight:600,flexShrink:0,marginTop:1}}>{s.step}</div>
              <div style={{fontSize:12,color:'var(--ivory)',lineHeight:1.5,fontFamily:'var(--font-body),sans-serif'}}>{s.text}</div>
            </div>
          ))}
        </div>
      )}
      {ios && !safari && (
        <div style={{background:'rgba(201,168,76,0.06)',border:'1px solid rgba(201,168,76,0.2)',borderRadius:3,padding:'12px 14px',marginBottom:16}}>
          <div style={{fontSize:12,color:'var(--amber)',lineHeight:1.6,fontFamily:'var(--font-body),sans-serif'}}><strong>Open this page in Safari</strong> to install PKR on your home screen. Chrome on iPhone doesn't support PWA install.</div>
        </div>
      )}
      {!ios && !installPrompt && (
        <div style={{background:'var(--bg3)',border:'1px solid var(--border-sub)',borderRadius:3,padding:'16px',marginBottom:16}}>
          <div style={{fontSize:10,letterSpacing:'0.16em',textTransform:'uppercase',color:'var(--gold)',fontFamily:'var(--font-body),sans-serif',fontWeight:600,marginBottom:12}}>How to install on Android</div>
          {[
            {step:'1',text:'Tap the ⋮ menu in the top-right of Chrome'},
            {step:'2',text:'Tap "Add to Home screen" or "Install app"'},
          ].map(s=>(
            <div key={s.step} style={{display:'flex',alignItems:'flex-start',gap:10,marginBottom:10}}>
              <div style={{width:20,height:20,borderRadius:'50%',background:'rgba(201,168,76,0.15)',border:'1px solid rgba(201,168,76,0.3)',display:'flex',alignItems:'center',justifyContent:'center',fontSize:10,color:'var(--gold)',fontWeight:600,flexShrink:0,marginTop:1}}>{s.step}</div>
              <div style={{fontSize:12,color:'var(--ivory)',lineHeight:1.5,fontFamily:'var(--font-body),sans-serif'}}>{s.text}</div>
            </div>
          ))}
        </div>
      )}
      <button className="btn btn-primary" style={{width:'100%',fontSize:13}} onClick={nextStep}>Done, next →</button>
      <button className="btn btn-ghost" style={{width:'100%',fontSize:12,marginTop:8}} onClick={goToEvent}>Skip</button>
    </>
  );

  if (step === 'notify') return card(
    <>
      <div style={{textAlign:'center',marginBottom:24}}>
        <div style={{fontSize:40,marginBottom:12}}>🔔</div>
        <div style={{fontSize:9,letterSpacing:'0.22em',textTransform:'uppercase',color:'var(--gold)',fontFamily:'var(--font-body),sans-serif',marginBottom:8,fontWeight:600}}>Step 2 of 2</div>
        <div className="display" style={{fontSize:22,color:'var(--white)',marginBottom:8,fontWeight:500}}>Enable notifications</div>
        <div style={{fontSize:12,color:'var(--muted)',lineHeight:1.7,fontFamily:'var(--font-body),sans-serif'}}>Stay in the loop for every game — buy-ins, cashouts, and results sent straight to your lock screen.</div>
      </div>
      <div style={{background:'var(--bg3)',border:'1px solid var(--border-sub)',borderRadius:3,padding:'14px',marginBottom:20}}>
        {[
          {icon:'🃏',text:'New game scheduled for ' + eventName},
          {icon:'💰',text:"Your buy-in recorded — you're at the table"},
          {icon:'💸',text:'You cashed out $240 — results incoming'},
          {icon:'✅',text:"Game settled! You're up +$65 tonight 🎉"},
        ].map((n,i)=>(
          <div key={i} style={{display:'flex',alignItems:'center',gap:10,padding:'8px 0',borderBottom:i<3?'1px solid var(--border-sub)':'none'}}>
            <span style={{fontSize:16,flexShrink:0}}>{n.icon}</span>
            <span style={{fontSize:11,color:'var(--muted)',fontFamily:'var(--font-body),sans-serif',lineHeight:1.4}}>{n.text}</span>
          </div>
        ))}
      </div>
      <button className="btn btn-primary" style={{width:'100%',fontSize:13,marginBottom:8}} disabled={subscribing} onClick={handleNotify}>
        {subscribing ? 'Enabling…' : '🔔 Enable Notifications'}
      </button>
      <button className="btn btn-ghost" style={{width:'100%',fontSize:12}} onClick={goToEvent}>Skip for now</button>
    </>
  );

  if (step === 'done') return card(
    <div style={{textAlign:'center'}}>
      <div style={{fontSize:48,marginBottom:16}}>✅</div>
      <div className="display" style={{fontSize:24,color:'var(--white)',marginBottom:8,fontWeight:500}}>You're all set!</div>
      <div style={{fontSize:12,color:'var(--muted)',lineHeight:1.8,fontFamily:'var(--font-body),sans-serif'}}>
        {notified ? 'Notifications enabled. ' : ''}Heading to {eventName}…
      </div>
    </div>
  );

  return null;
}
