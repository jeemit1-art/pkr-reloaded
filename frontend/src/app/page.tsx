export default function HomePage() {
  const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8787';
  return (
    <main style={{
      minHeight:'100vh', background:'var(--bg)',
      display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center',
      position:'relative', overflow:'hidden', padding:'40px 24px',
    }}>
      {/* Watermark spade */}
      <div style={{position:'absolute',bottom:-60,right:-40,fontSize:420,opacity:0.022,
        color:'var(--gold)',lineHeight:1,userSelect:'none',pointerEvents:'none',fontFamily:'serif'}}>♠</div>
      {/* Gold hairlines */}
      <div style={{position:'absolute',top:0,left:0,right:0,height:1,
        background:'linear-gradient(90deg,transparent,var(--gold-dim),transparent)',opacity:0.5}}/>
      <div style={{position:'absolute',bottom:0,left:0,right:0,height:1,
        background:'linear-gradient(90deg,transparent,var(--gold-dim),transparent)',opacity:0.3}}/>

      <div style={{position:'relative',zIndex:10,textAlign:'center',maxWidth:420,width:'100%'}}>
        <div className="animate-up" style={{fontSize:10,letterSpacing:'0.28em',textTransform:'uppercase',
          color:'var(--gold-dim)',fontWeight:500,marginBottom:32,fontFamily:'var(--font-body),sans-serif'}}>
          Private · Competitive · Yours
        </div>
        <div className="animate-up" style={{animationDelay:'0.08s',marginBottom:8}}>
          <h1 className="display" style={{fontSize:'clamp(80px,22vw,160px)',lineHeight:0.88,
            color:'var(--white)',letterSpacing:'-0.01em',fontWeight:700}}>PKR</h1>
        </div>
        <div className="animate-up" style={{animationDelay:'0.12s',marginBottom:40}}>
          <div style={{fontSize:11,letterSpacing:'0.52em',textTransform:'uppercase',color:'var(--gold)',
            fontWeight:500,fontFamily:'var(--font-body),sans-serif'}}>Private Poker</div>
        </div>
        <div className="animate-up" style={{animationDelay:'0.16s',height:1,marginBottom:40,
          background:'linear-gradient(90deg,transparent,var(--border-hi),transparent)'}}/>
        <p className="animate-up" style={{animationDelay:'0.2s',fontSize:14,color:'var(--muted)',
          lineHeight:1.9,fontWeight:300,marginBottom:40,fontFamily:'var(--font-body),sans-serif'}}>
          Schedule sessions. Track every chip.<br/>Settle debts. Own the leaderboard.
        </p>
        <div className="animate-up card-gold" style={{animationDelay:'0.26s',padding:'32px 28px',marginBottom:32}}>
          <div style={{fontSize:9,letterSpacing:'0.22em',textTransform:'uppercase',color:'var(--muted)',
            marginBottom:20,fontFamily:'var(--font-body),sans-serif',fontWeight:500}}>Host Access</div>
          <a href={`${apiUrl}/auth/google`} className="btn btn-primary" style={{width:'100%',fontSize:12,display:'flex'}}>
            <svg width="16" height="16" viewBox="0 0 18 18" style={{flexShrink:0}}>
              <path d="M17.64 9.2a10.34 10.34 0 0 0-.16-1.84H9v3.48h4.84a4.14 4.14 0 0 1-1.8 2.72v2.26h2.92a8.78 8.78 0 0 0 2.68-6.62z" fill="#4285F4"/>
              <path d="M9 18a8.6 8.6 0 0 0 5.96-2.18l-2.91-2.26a5.4 5.4 0 0 1-8.07-2.85H.96v2.33A9 9 0 0 0 9 18z" fill="#34A853"/>
              <path d="M3.96 10.71a5.41 5.41 0 0 1 0-3.42V4.96H.96a9 9 0 0 0 0 8.08l3-2.33z" fill="#FBBC05"/>
              <path d="M9 3.58a4.86 4.86 0 0 1 3.44 1.35l2.58-2.58A8.64 8.64 0 0 0 9 0 9 9 0 0 0 .96 4.96l3 2.33A5.36 5.36 0 0 1 9 3.58z" fill="#EA4335"/>
            </svg>
            Continue with Google
          </a>
          <p style={{fontSize:11,color:'var(--muted)',marginTop:16,lineHeight:1.7,
            fontFamily:'var(--font-body),sans-serif',fontWeight:300}}>
            Hosts sign in to manage tables.<br/>Players join via invite link — no account needed.
          </p>
        </div>
        <div className="animate-up" style={{animationDelay:'0.32s',display:'flex',flexWrap:'wrap',justifyContent:'center',gap:6}}>
          {['Events','Scheduling','Push Alerts','Settlement','Leaderboard','Invite Links'].map(f=>(
            <div key={f} style={{fontSize:10,letterSpacing:'0.12em',padding:'4px 12px',
              border:'1px solid var(--border-sub)',color:'var(--faint)',borderRadius:2,
              fontFamily:'var(--font-body),sans-serif',textTransform:'uppercase',fontWeight:500}}>{f}</div>
          ))}
        </div>
      </div>
    </main>
  );
}
