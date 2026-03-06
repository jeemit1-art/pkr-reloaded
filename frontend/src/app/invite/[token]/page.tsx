'use client';
type InviteStatus = 'loading' | 'success' | 'auth' | 'error';
import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { api } from '@/lib/api';

export default function InvitePage() {
  const { token } = useParams<{token:string}>();
  const router = useRouter();
  const [status, setStatus] = useState<InviteStatus>('loading');
  const [eventName, setEventName] = useState('');
  const [role, setRole] = useState('');
  const [err, setErr] = useState('');
  const apiUrl = process.env.NEXT_PUBLIC_API_URL||'http://localhost:8787';

  useEffect(()=>{
    api.events.redeemInvite(token as string)
      .then(({event,role:r})=>{ setEventName(event.name); setRole(r); setStatus('success'); setTimeout(()=>router.push(`/events/${event.id}`),2500); })
      .catch(e=>{ if(e.message==='Unauthorized'||e.message==='Session expired'){setStatus('auth');}else{setErr(e.message);setStatus('error');} });
  },[token]);

  return (
    <div style={{minHeight:'100vh',background:'var(--bg)',display:'flex',alignItems:'center',justifyContent:'center',padding:'40px 24px',position:'relative',overflow:'hidden'}}>
      <div style={{position:'absolute',bottom:-60,right:-40,fontSize:420,opacity:0.018,color:'var(--gold)',lineHeight:1,userSelect:'none',pointerEvents:'none',fontFamily:'serif'}}>♠</div>

      <div className="card-gold" style={{padding:'40px 32px',maxWidth:400,width:'100%',textAlign:'center',position:'relative',zIndex:1}}>

        {status==='loading' && (
          <>
            <div className="display" style={{fontSize:48,color:'var(--gold)',marginBottom:16,opacity:0.8}}>PKR</div>
            <div style={{fontSize:10,letterSpacing:'0.22em',textTransform:'uppercase',color:'var(--muted)',fontFamily:'var(--font-body),sans-serif'}}>Validating invite…</div>
          </>
        )}

        {status==='success' && (
          <>
            <div style={{fontSize:48,marginBottom:16}}>🃏</div>
            <div style={{fontSize:9,letterSpacing:'0.22em',textTransform:'uppercase',color:'var(--green)',fontFamily:'var(--font-body),sans-serif',marginBottom:10,fontWeight:600}}>Invite Accepted</div>
            <div className="display" style={{fontSize:26,color:'var(--white)',marginBottom:12,fontWeight:500}}>{eventName}</div>
            <div style={{fontSize:12,color:'var(--muted)',lineHeight:1.8,fontFamily:'var(--font-body),sans-serif'}}>
              You joined as <span style={{color:'var(--gold)',fontWeight:600}}>{role}</span>.<br/>Redirecting…
            </div>
          </>
        )}

        {status==='auth' && (
          <>
            <div style={{fontSize:40,marginBottom:16}}>🔐</div>
            <div style={{fontSize:9,letterSpacing:'0.22em',textTransform:'uppercase',color:'var(--amber)',fontFamily:'var(--font-body),sans-serif',marginBottom:10,fontWeight:600}}>Sign In Required</div>
            <div className="display" style={{fontSize:22,color:'var(--white)',marginBottom:8,fontWeight:500}}>You've been invited</div>
            <div style={{fontSize:12,color:'var(--muted)',lineHeight:1.8,fontFamily:'var(--font-body),sans-serif',marginBottom:24}}>
              Sign in with Google to claim your co-host seat.<br/>
              You'll be redirected back automatically.
            </div>
            <a href={`${apiUrl}/auth/google?returnTo=${encodeURIComponent(`/invite/${token}`)}`} className="btn btn-primary" style={{width:'100%',fontSize:13,display:'flex',alignItems:'center',justifyContent:'center',gap:10}}>
              <svg width="16" height="16" viewBox="0 0 18 18" style={{flexShrink:0}}>
                <path d="M17.64 9.2a10.34 10.34 0 0 0-.16-1.84H9v3.48h4.84a4.14 4.14 0 0 1-1.8 2.72v2.26h2.92a8.78 8.78 0 0 0 2.68-6.62z" fill="#4285F4"/>
                <path d="M9 18a8.6 8.6 0 0 0 5.96-2.18l-2.91-2.26a5.4 5.4 0 0 1-8.07-2.85H.96v2.33A9 9 0 0 0 9 18z" fill="#34A853"/>
                <path d="M3.96 10.71a5.41 5.41 0 0 1 0-3.42V4.96H.96a9 9 0 0 0 0 8.08l3-2.33z" fill="#FBBC05"/>
                <path d="M9 3.58a4.86 4.86 0 0 1 3.44 1.35l2.58-2.58A8.64 8.64 0 0 0 9 0 9 9 0 0 0 .96 4.96l3 2.33A5.36 5.36 0 0 1 9 3.58z" fill="#EA4335"/>
              </svg>
              Continue with Google
            </a>
          </>
        )}

        {status==='error' && (
          <>
            <div style={{fontSize:40,marginBottom:16}}>⏱️</div>
            <div style={{fontSize:9,letterSpacing:'0.22em',textTransform:'uppercase',color:'var(--red)',fontFamily:'var(--font-body),sans-serif',marginBottom:10,fontWeight:600}}>Invite Unavailable</div>
            <div style={{fontSize:13,color:'var(--muted)',lineHeight:1.7,fontFamily:'var(--font-body),sans-serif',marginBottom:20}}>
              {err||'This invite link has expired or already been used.'}
            </div>
            <div style={{background:'rgba(201,168,76,0.06)',border:'1px solid rgba(201,168,76,0.18)',borderRadius:2,
              padding:'12px 14px',marginBottom:20,textAlign:'left'}}>
              <div style={{fontSize:11,color:'var(--gold)',fontWeight:600,marginBottom:4,fontFamily:'var(--font-body),sans-serif'}}>What to do</div>
              <div style={{fontSize:11,color:'var(--muted)',lineHeight:1.7,fontFamily:'var(--font-body),sans-serif'}}>
                Ask the host to generate a new invite link — they expire after 48 hours and can only be used once.
              </div>
            </div>
            <button className="btn btn-ghost" style={{width:'100%',fontSize:13}} onClick={()=>router.push('/dashboard')}>
              Go to Dashboard
            </button>
          </>
        )}

      </div>
    </div>
  );
}