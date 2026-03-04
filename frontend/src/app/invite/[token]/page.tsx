'use client';
import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { api } from '@/lib/api';

export default function InvitePage() {
  const { token } = useParams<{token:string}>();
  const router = useRouter();
  const [status, setStatus] = useState<'loading'|'success'|'auth'|'error'>('loading');
  const [eventName, setEventName] = useState('');
  const [role, setRole] = useState('');
  const [err, setErr] = useState('');
  const apiUrl = process.env.NEXT_PUBLIC_API_URL||'http://localhost:8787';

  useEffect(()=>{
    api.events.redeemInvite(token)
      .then(({event,role:r})=>{ setEventName(event.name); setRole(r); setStatus('success'); setTimeout(()=>router.push(`/events/${event.id}`),2500); })
      .catch(e=>{ if(e.message==='Unauthorized'){setStatus('auth');}else{setErr(e.message);setStatus('error');} });
  },[token]);

  return (
    <div className="min-h-screen grid-bg flex items-center justify-center px-6">
      <div className="card-hi p-10 max-w-md w-full text-center animate-up">
        {status==='loading' && (
          <>
            <div className="display animate-flicker" style={{fontSize:48,color:'var(--neon)',marginBottom:16,letterSpacing:'0.1em'}}>PKR</div>
            <div className="lbl">VALIDATING INVITE...</div>
          </>
        )}
        {status==='success' && (
          <>
            <div style={{fontSize:48,marginBottom:16}}>🃏</div>
            <div className="lbl mb-3" style={{color:'var(--neon)'}}>INVITE ACCEPTED</div>
            <h2 className="display mb-3" style={{fontSize:28,color:'var(--white)',letterSpacing:'0.05em'}}>{eventName}</h2>
            <p className="mono" style={{fontSize:12,color:'var(--muted)',lineHeight:1.8}}>
              You joined as <span style={{color:'var(--neon)'}}>{role.toUpperCase()}</span>.<br/>
              Redirecting to table...
            </p>
          </>
        )}
        {status==='auth' && (
          <>
            <div style={{fontSize:40,marginBottom:16}}>🔐</div>
            <div className="lbl mb-3">AUTHENTICATION REQUIRED</div>
            <h2 className="display mb-2" style={{fontSize:26,color:'var(--white)',letterSpacing:'0.05em'}}>You've been invited</h2>
            <p className="mono mb-6" style={{fontSize:12,color:'var(--muted)',lineHeight:1.8}}>Sign in with Google to claim your co-host seat.</p>
            <a href={`${apiUrl}/auth/google`} className="btn btn-neon w-full" style={{fontSize:16,letterSpacing:'0.1em'}}>
              <svg width="16" height="16" viewBox="0 0 18 18">
                <path d="M17.64 9.2a10.34 10.34 0 0 0-.16-1.84H9v3.48h4.84a4.14 4.14 0 0 1-1.8 2.72v2.26h2.92a8.78 8.78 0 0 0 2.68-6.62z" fill="#4285F4"/>
                <path d="M9 18a8.6 8.6 0 0 0 5.96-2.18l-2.91-2.26a5.4 5.4 0 0 1-8.07-2.85H.96v2.33A9 9 0 0 0 9 18z" fill="#34A853"/>
                <path d="M3.96 10.71a5.41 5.41 0 0 1 0-3.42V4.96H.96a9 9 0 0 0 0 8.08l3-2.33z" fill="#FBBC05"/>
                <path d="M9 3.58a4.86 4.86 0 0 1 3.44 1.35l2.58-2.58A8.64 8.64 0 0 0 9 0 9 9 0 0 0 .96 4.96l3 2.33A5.36 5.36 0 0 1 9 3.58z" fill="#EA4335"/>
              </svg>
              SIGN IN WITH GOOGLE
            </a>
          </>
        )}
        {status==='error' && (
          <>
            <div style={{fontSize:40,marginBottom:16}}>⚠️</div>
            <div className="lbl mb-3" style={{color:'var(--red)'}}>INVITE INVALID</div>
            <p className="mono mb-6" style={{fontSize:12,color:'var(--muted)',lineHeight:1.8}}>{err||'This invite has expired or already been used.'}</p>
            <Link href="/dashboard" className="btn btn-outline" style={{fontSize:14}}>GO TO DASHBOARD</Link>
          </>
        )}
      </div>
    </div>
  );
}
