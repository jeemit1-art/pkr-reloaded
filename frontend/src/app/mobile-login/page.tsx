'use client';
import {api} from '@/lib/api';

export default function MobileLogin(){
  return (
    <main style={{minHeight:'100vh',display:'grid',placeItems:'center',padding:24}}>
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
