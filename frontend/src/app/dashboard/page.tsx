'use client';
// frontend/src/app/dashboard/page.tsx — FULL REPLACEMENT
// Changes vs original:
//  - Imports UpgradeModal
//  - Shows plan badge in nav (Trial X days / Starter / Pro)
//  - "Upgrade" button in nav when on trial/expired
//  - <UpgradeModal /> renders at bottom (catches all 402s globally on this page)
//  - create() error handling now distinguishes 402 (modal handles it) vs other errors
import { useEffect, useState, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { api, User, Event, fmt, saveToken, clearToken, getToken } from '@/lib/api';
import UpgradeModal from '@/components/UpgradeModal';
import PkrMobileNav from '@/components/PkrMobileNav';
import CasinoArtwork from '@/components/CasinoArtwork';

function DashboardInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [user, setUser]   = useState<User|null>(null);
  const [events, setEvents] = useState<Event[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm]   = useState({name:'',description:'',buy_in:'',master_password:''});
  const [saving, setSaving] = useState(false);
  const [installPrompt, setInstallPrompt] = useState<any>(null);
  const [showInstallBanner, setShowInstallBanner] = useState(false);
  const [showScanner, setShowScanner] = useState(false);
  const [confirmEndEventId, setConfirmEndEventId] = useState<string|null>(null);
  const [endingEvent, setEndingEvent] = useState(false);
  const [scanStatus, setScanStatus] = useState('');
  const [scanning, setScanning] = useState(false);
  const [manageLoading, setManageLoading] = useState(false);

  useEffect(()=>{
    const handler = (e:any) => { e.preventDefault(); setInstallPrompt(e); setShowInstallBanner(true); };
    window.addEventListener('beforeinstallprompt', handler);
    return ()=>window.removeEventListener('beforeinstallprompt', handler);
  },[]);

  async function installApp() {
    if (!installPrompt) return;
    installPrompt.prompt();
    const { outcome } = await installPrompt.userChoice;
    if (outcome==='accepted') setShowInstallBanner(false);
  }

  // Handle ?upgraded=1 and ?upgrade_cancelled=1 query params
  useEffect(() => {
    if (searchParams.get('upgraded') === '1') {
      window.history.replaceState({}, '', '/dashboard');
      // Refresh user to get updated plan
      api.auth.me().then(u => setUser(u)).catch(() => {});
    }
    if (searchParams.get('upgrade_cancelled') === '1') {
      window.history.replaceState({}, '', '/dashboard');
    }
  }, [searchParams]);

  useEffect(()=>{
    async function init() {
      const code = searchParams.get('code');
      if (code) {
        try {
          const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8787';
          const res = await fetch(`${apiUrl}/auth/token?code=${code}`, { credentials:'include' });
          if (res.ok) { const { token } = await res.json(); if (token) saveToken(token); }
          else { router.push('/'); return; }
        } catch(e) { console.error('Token exchange failed', e); router.push('/'); return; }
        window.history.replaceState({},'','/dashboard');
      } else if (!getToken()) {
        router.push('/'); return;
      }
      try {
        const [u,e] = await Promise.all([api.auth.me(), api.events.list()]);
        setUser(u); setEvents(e.sort((a:any,b:any) => (a.status==='ended'?1:-1) - (b.status==='ended'?1:-1)));
      } catch { router.push('/'); }
      finally { setLoading(false); }
    }
    init();
  },[]);

  async function startScan() {
    setShowScanner(true);
    setScanStatus('');
    setScanning(true);
  }

  async function doEndEvent(eventId: string) {
    setEndingEvent(true);
    try {
      await api.events.end(eventId);
      setEvents(es => es.map(e => e.id===eventId ? {...e, status:'ended'} as any : e));
      setConfirmEndEventId(null);
    } catch(e) { alert('Failed to end event'); }
    finally { setEndingEvent(false); }
  }

  async function initCamera() {
    if (!(window as any).jsQR) {
      await new Promise<void>((res,rej) => {
        const s = document.createElement('script');
        s.src = 'https://cdn.jsdelivr.net/npm/jsqr@1.4.0/dist/jsQR.min.js';
        s.onload = () => res(); s.onerror = () => rej();
        document.head.appendChild(s);
      });
    }
    const jsQR = (window as any).jsQR;
    try {
      let constraints: any = { video: { facingMode: 'environment' } };
      let stream: MediaStream;
      try { stream = await navigator.mediaDevices.getUserMedia(constraints); }
      catch { stream = await navigator.mediaDevices.getUserMedia({ video: true }); }
      const video = document.getElementById('scanVideo') as HTMLVideoElement;
      if (!video) { stream.getTracks().forEach(t=>t.stop()); return; }
      video.setAttribute('playsinline', 'true');
      video.setAttribute('autoplay', 'true');
      video.setAttribute('muted', 'true');
      video.srcObject = stream;
      await new Promise<void>((res) => {
        video.onloadedmetadata = () => { video.play().then(res).catch(res); };
      });
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d')!;
      let found = false;
      const tick = async () => {
        if (!scanning || found) { stream.getTracks().forEach(t=>t.stop()); return; }
        if (video.readyState === video.HAVE_ENOUGH_DATA) {
          canvas.width = video.videoWidth;
          canvas.height = video.videoHeight;
          ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
          const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
          const code = jsQR(imageData.data, imageData.width, imageData.height);
          if (code?.data) {
            found = true;
            stream.getTracks().forEach(t=>t.stop());
            const url = code.data;
            const match = url.match(/\/invite\/([a-zA-Z0-9_-]+)/);
            if (match) {
              setScanStatus('Joining event...');
              try {
                const result = await api.events.redeemInvite(match[1]);
                if (result?.event?.id) {
                  setScanStatus('✅ Joined ' + (result.event.name||'event') + '! Taking you there...');
                  setTimeout(() => { setShowScanner(false); router.push('/events/' + result.event.id); }, 2000);
                }
              } catch(e) { setScanStatus('Invalid or expired invite.'); setScanning(false); }
            } else { setScanStatus('Not a valid PKR invite QR code.'); setScanning(false); }
            return;
          }
        }
        requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    } catch(e:any) { setScanStatus('Camera access denied: ' + (e?.message||e)); setScanning(false); }
  }

  useEffect(() => {
    if (!showScanner) return;
    const timer = setTimeout(() => { initCamera(); }, 300);
    return () => clearTimeout(timer);
  }, [showScanner]);

  async function create() {
    if (!form.name.trim()) return;
    setSaving(true);
    try {
      const evt = await api.events.create({
        name: form.name.trim(),
        description: form.description||undefined,
        buy_in: form.buy_in ? Math.round(parseFloat(form.buy_in)*100) : 0,
        master_password: form.master_password||undefined,
      });
      setEvents(e=>[evt,...e]);
      setShowCreate(false);
      setForm({name:'',description:'',buy_in:'',master_password:''});
    } catch(e:any) {
      // 402 errors are handled by the global UpgradeModal — don't show an alert
      if (!e.message?.toLowerCase().includes('upgrade') && !e.message?.toLowerCase().includes('plan')) {
        alert(e.message);
      }
      setShowCreate(false);
    }
    finally { setSaving(false); }
  }

  async function openBillingPortal() {
    setManageLoading(true);
    try {
      const { url } = await api.billing.portal();
      window.location.href = url;
    } catch(e:any) {
      alert(e.message || 'Could not open billing portal.');
    } finally { setManageLoading(false); }
  }

  // Plan badge helper
  function PlanBadge() {
    if (!user) return null;
    const plan = user.plan;
    if (plan === 'lifetime') return (
      <span style={{fontSize:10,padding:'2px 8px',borderRadius:2,background:'rgba(201,168,76,0.15)',
        color:'rgba(201,168,76,0.9)',fontFamily:'var(--font-body),sans-serif',
        letterSpacing:'0.1em',textTransform:'uppercase',fontWeight:600}}>⚡ Lifetime</span>
    );
    if (plan === 'pro') return (
      <span style={{fontSize:10,padding:'2px 8px',borderRadius:2,background:'rgba(201,168,76,0.15)',
        color:'rgba(201,168,76,0.9)',fontFamily:'var(--font-body),sans-serif',
        letterSpacing:'0.1em',textTransform:'uppercase',fontWeight:600}}>✦ Pro</span>
    );
    if (plan === 'starter') return (
      <span style={{fontSize:10,padding:'2px 8px',borderRadius:2,background:'rgba(100,180,100,0.12)',
        color:'rgba(100,200,100,0.8)',fontFamily:'var(--font-body),sans-serif',
        letterSpacing:'0.1em',textTransform:'uppercase',fontWeight:600}}>Starter</span>
    );
    // Trial
    if (user.trial_active) return (
      <span style={{fontSize:10,padding:'2px 8px',borderRadius:2,background:'rgba(255,160,30,0.12)',
        color:'rgba(255,170,50,0.85)',fontFamily:'var(--font-body),sans-serif',
        letterSpacing:'0.1em',textTransform:'uppercase',fontWeight:600}}>
        Trial · {user.trial_days_left}d left
      </span>
    );
    // Expired trial
    return (
      <span style={{fontSize:10,padding:'2px 8px',borderRadius:2,background:'rgba(220,60,60,0.12)',
        color:'rgba(220,80,80,0.85)',fontFamily:'var(--font-body),sans-serif',
        letterSpacing:'0.1em',textTransform:'uppercase',fontWeight:600}}>Trial Ended</span>
    );
  }

  const needsUpgrade = user && user.plan === 'trial' && !user.trial_active;
  const onTrial = user && user.plan === 'trial' && user.trial_active;
  const isPaid = user && (user.plan === 'starter' || user.plan === 'pro' || user.plan === 'lifetime');
  const activeRooms = events.filter(evt => (evt as any).status !== 'ended');
  const featuredRoom = activeRooms[0] || events[0] || null;
  // Keep active rooms ahead of archived rooms without altering source state.
  const visibleRooms = [...activeRooms, ...events.filter(evt => (evt as any).status === 'ended')];
  const totalGames = events.reduce((sum, evt) => sum + (Number(evt.game_count) || 0), 0);
  const openCreate = () => {
    setShowCreate(true);
    document.getElementById('pkr-rooms')?.scrollIntoView({ behavior: 'smooth' });
  };

  if (loading) return (
    <div style={{minHeight:'100vh',background:'var(--bg)',display:'flex',alignItems:'center',justifyContent:'center'}}>
      <div className="display" style={{fontSize:48,color:'var(--gold)',opacity:0.6}}>PKR</div>
    </div>
  );

  return (
    <div className="pkr-app pkr-dashboard pkr-casino" style={{minHeight:'100vh',paddingBottom:80}}>
      <div style={{position:'fixed',bottom:-60,right:-40,fontSize:420,opacity:0.018,
        color:'var(--gold)',lineHeight:1,userSelect:'none',pointerEvents:'none',fontFamily:'serif',zIndex:0}}>♠</div>

      {/* Install banner */}
      {showInstallBanner && (
        <div style={{background:'var(--bg3)',borderBottom:'1px solid var(--border)',
          padding:'10px 20px',display:'flex',alignItems:'center',justifyContent:'space-between',gap:12}}>
          <div>
            <span style={{fontSize:13,color:'var(--ivory)',fontWeight:500}}>Install PKR</span>
            <span style={{fontSize:12,color:'var(--muted)',marginLeft:8}}>Guided iPhone and Android setup</span>
          </div>
          <div style={{display:'flex',gap:8}}>
            <button className="btn btn-primary" style={{fontSize:11,padding:'5px 12px'}} onClick={()=>router.push('/install')}>Set up on phone</button>
            <button className="btn btn-ghost" style={{fontSize:11,padding:'5px 10px'}} onClick={()=>setShowInstallBanner(false)}>✕</button>
          </div>
        </div>
      )}

      {/* Trial expiry banner */}
      {onTrial && user.trial_days_left <= 2 && (
        <div style={{background:'rgba(255,160,30,0.08)',borderBottom:'1px solid rgba(255,160,30,0.2)',
          padding:'10px 20px',display:'flex',alignItems:'center',justifyContent:'space-between',gap:12}}>
          <div style={{fontSize:12,color:'rgba(255,170,50,0.9)',fontFamily:'var(--font-body),sans-serif'}}>
            ⏱ Your free trial ends in <strong>{user.trial_days_left} day{user.trial_days_left!==1?'s':''}</strong>
          </div>
          <button
            className="btn btn-primary"
            style={{fontSize:11,padding:'5px 14px'}}
            onClick={() => window.dispatchEvent(new CustomEvent('pkr:upgrade_required', {detail:{error:'Choose a plan before your trial ends.'}}))}
          >
            Upgrade
          </button>
        </div>
      )}

      {/* Expired trial banner */}
      {needsUpgrade && (
        <div style={{background:'rgba(220,60,60,0.08)',borderBottom:'1px solid rgba(220,60,60,0.2)',
          padding:'10px 20px',display:'flex',alignItems:'center',justifyContent:'space-between',gap:12}}>
          <div style={{fontSize:12,color:'rgba(220,90,90,0.9)',fontFamily:'var(--font-body),sans-serif'}}>
            ⚠️ Your free trial has ended. Upgrade to keep creating groups and games.
          </div>
          <button
            className="btn btn-primary"
            style={{fontSize:11,padding:'5px 14px'}}
            onClick={() => window.dispatchEvent(new CustomEvent('pkr:upgrade_required', {detail:{error:'Choose a plan to continue.'}}))}
          >
            Upgrade Now
          </button>
        </div>
      )}

      {/* Nav */}
      <nav className="nav pkr-topbar" style={{paddingTop:'env(safe-area-inset-top)'}}>
        <div style={{maxWidth:960,margin:'0 auto',padding:'0 16px',display:'flex',flexDirection:'column'}}>
          <div style={{height:52,display:'flex',alignItems:'center',justifyContent:'space-between',gap:8}}>
          <div className="pkr-brand"><span className="pkr-brand-mark" aria-hidden="true">♠</span>PKR<span className="pkr-brand-sub">HOME POKER</span></div>
          <div className="pkr-header-controls" style={{display:'flex',alignItems:'center',gap:6,flexShrink:0,minWidth:0}}>
            {user?.avatar_url && (
              <img src={user.avatar_url} alt={user.name}
                style={{width:28,height:28,borderRadius:'50%',border:'1px solid var(--border)'}}/>
            )}
            <span className="pkr-user-name" style={{fontSize:11,color:'var(--muted)',fontFamily:'var(--font-body),sans-serif',
              maxWidth:60,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap' as const,display:'block'}}>
              {user?.name?.split(' ')[0]}
            </span>
            <PlanBadge />
            {isPaid && (
              <button
                className="btn btn-ghost pkr-plan-manage"
                style={{fontSize:10,padding:'3px 8px'}}
                onClick={openBillingPortal}
                disabled={manageLoading}
              >
                {manageLoading ? '…' : 'Plan'}
              </button>
            )}
            {(onTrial || needsUpgrade) && (
              <button
                className="btn btn-primary"
                style={{fontSize:11,padding:'4px 12px',background:'linear-gradient(135deg,rgba(201,168,76,0.9),rgba(160,120,40,0.85))',color:'#000'}}
                onClick={() => window.dispatchEvent(new CustomEvent('pkr:upgrade_required', {detail:{error:'Start your subscription to keep the game going.'}}))}
              >
                Upgrade
              </button>
            )}
            <button className="btn btn-ghost" style={{fontSize:11,padding:'5px 12px'}}
              onClick={()=>{ clearToken(); api.auth.logout().then(()=>router.push('/')) }}>
              Sign Out
            </button>
          </div>
          </div>
        </div>
      </nav>

      <div className="pkr-content" style={{maxWidth:960,margin:'0 auto',padding:'38px 20px 45px',position:'relative',zIndex:1}}>
        {/* App-style introduction and featured room. No inferred 'live' status. */}
        <div className="pkr-intro pkr-compact-intro">
          <span className="pkr-eyebrow">Your poker night starts here</span>
          <h1>Welcome back{user?.name ? ', ' + user.name.split(' ')[0] : ''}.</h1>
          <p>Keep your poker rooms, players and results together — without losing track of a buy-in.</p>
        </div>

        <section className="pkr-hero" aria-label={featuredRoom ? 'Your featured poker room' : 'Create your first poker room'}>
          <CasinoArtwork variant="lounge" />
          <div className="pkr-hero-top">
            <span className="pkr-hero-tag"><span className="pkr-status-dot" />{featuredRoom ? 'YOUR POKER ROOM' : 'WELCOME TO PKR'}</span>
            {featuredRoom && (featuredRoom as any).status === 'ended' && <span className="badge badge-settled">Ended</span>}
          </div>
          <h2>{featuredRoom ? featuredRoom.name : 'Ready for game night?'}</h2>
          <p>{featuredRoom
            ? 'Your group, upcoming games and results — all in one place.'
            : 'Create a poker room for your group, then organise a game when you are ready.'}</p>
          <div className="pkr-hero-metrics">
            <div className="pkr-hero-metric">
              <small>{featuredRoom ? 'Games in this room' : 'Your rooms'}</small>
              <strong>{featuredRoom ? featuredRoom.game_count || 0 : 0}</strong>
            </div>
            <div className="pkr-hero-metric">
              <small>{featuredRoom ? 'Room members' : 'Games recorded'}</small>
              <strong>{featuredRoom ? featuredRoom.member_count || 1 : totalGames}</strong>
            </div>
          </div>
          <button type="button" className="pkr-hero-action"
            onClick={() => featuredRoom ? router.push('/events/' + featuredRoom.id) : openCreate()}>
            {featuredRoom ? 'Open poker room' : 'Create your first room'} <span aria-hidden="true">→</span>
          </button>
        </section>

        <section className="pkr-list-head" id="pkr-rooms" aria-label="Your poker rooms">
          <div>
            <span className="pkr-eyebrow">Your groups</span>
            <h2>Poker rooms <span style={{fontSize:13,color:'var(--muted)',fontWeight:600}}>({activeRooms.length} active)</span></h2>
          </div>
          <div className="pkr-list-head-actions">
            <button type="button" className="btn btn-ghost" onClick={startScan}>Scan invite</button>
            <button type="button" className="btn btn-primary" onClick={openCreate}>+ New room</button>
          </div>
        </section>

        {/* QR Scanner Modal */}
        {showScanner && (
          <div style={{position:'fixed',inset:0,background:'rgba(0,0,0,0.92)',zIndex:1000,display:'flex',flexDirection:'column',alignItems:'center',justifyContent:'center',padding:24}}>
            <div style={{width:'100%',maxWidth:360,background:'#0d1a0f',borderRadius:12,border:'1px solid rgba(201,168,76,0.3)',overflow:'hidden'}}>
              <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',padding:'16px 20px',borderBottom:'1px solid rgba(201,168,76,0.15)'}}>
                <div style={{fontFamily:"'Playfair Display',serif",fontSize:16,color:'var(--gold)',fontWeight:600}}>Scan Invite QR</div>
                <button onClick={()=>{setShowScanner(false);setScanning(false);}} style={{background:'none',border:'none',color:'var(--muted)',fontSize:20,cursor:'pointer',padding:4}}>✕</button>
              </div>
              <div style={{padding:20}}>
                <video id="scanVideo" style={{width:'100%',borderRadius:8,background:'#000',display:'block'}} playsInline autoPlay muted/>
                {scanStatus && (
                  <div style={{marginTop:12,textAlign:'center',fontSize:13,color:scanStatus.includes('Invalid')||scanStatus.includes('denied')||scanStatus.includes('Not a')?'var(--red)':'var(--green)',fontFamily:'var(--font-body),sans-serif'}}>
                    {scanStatus}
                  </div>
                )}
                {!scanStatus && (
                  <div style={{marginTop:12,textAlign:'center',fontSize:12,color:'var(--muted)',fontFamily:'var(--font-body),sans-serif'}}>
                    Point camera at the invite QR code
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {/* Create form */}
        {showCreate && (
          <div id="pkr-create-form" className="card-gold animate-up" style={{padding:'28px',marginBottom:24}}>
            <div style={{fontSize:16,color:'var(--white)',marginBottom:20,
              fontFamily:'var(--font-display),serif',fontWeight:500}}>
              New Table
            </div>
            <div style={{display:'grid',gap:14}}>
              <div>
                <div className="lbl" style={{marginBottom:6}}>Table Name *</div>
                <input className="inp" placeholder="e.g. Friday Night Poker"
                  value={form.name} onChange={e=>setForm(p=>({...p,name:e.target.value}))}
                  autoFocus/>
              </div>
              <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:12}}>
                <div>
                  <div className="lbl" style={{marginBottom:6}}>Default Buy-in ($)</div>
                  <input className="inp" type="number" placeholder="20"
                    value={form.buy_in} onChange={e=>setForm(p=>({...p,buy_in:e.target.value}))}/>
                </div>
                <div>
                  <div className="lbl" style={{marginBottom:6}}>Master Password</div>
                  <input className="inp" placeholder="Optional"
                    value={form.master_password} onChange={e=>setForm(p=>({...p,master_password:e.target.value}))}/>
                </div>
              </div>
              <div>
                <div className="lbl" style={{marginBottom:6}}>Description</div>
                <input className="inp" placeholder="Optional"
                  value={form.description} onChange={e=>setForm(p=>({...p,description:e.target.value}))}/>
              </div>
            </div>
            <div style={{display:'flex',gap:8,marginTop:20}}>
              <button className="btn btn-primary" disabled={!form.name.trim()||saving} onClick={create} style={{flex:1}}>
                {saving ? 'Creating…' : 'Create Table'}
              </button>
              <button className="btn btn-ghost" onClick={()=>setShowCreate(false)}>Cancel</button>
            </div>
          </div>
        )}

        {/* Events list */}
        {events.length===0 && !showCreate && (
          <div className="empty-state">
            <div className="empty-state-icon">♠</div>
            <div className="empty-state-text">No tables yet.</div>
            <div style={{fontSize:12,color:'var(--faint)',marginTop:6}}>
              Create your first table to get started.
            </div>
          </div>
        )}

        <div className="pkr-room-grid">
          {visibleRooms.map(evt => (
            <article key={evt.id} className="pkr-room-card">
              <button type="button" className="pkr-room-main" onClick={() => router.push('/events/' + evt.id)}
                aria-label={'Open poker room ' + evt.name}>
                <span className="pkr-room-icon" aria-hidden="true">♠</span>
                <span className="pkr-room-copy">
                  <span className="pkr-room-name" style={{display:'block'}}>{evt.name}</span>
                  <span className="pkr-room-meta">
                    <span>{evt.game_count || 0} games</span>
                    <span>{evt.member_count || 1} members</span>
                    {evt.buy_in > 0 && <span>{fmt(evt.buy_in)} buy-in</span>}
                    {(evt as any).status === 'ended' && <span>Ended</span>}
                  </span>
                  {evt.role && <span className={'badge badge-' + evt.role} style={{marginTop:9}}>{evt.role}</span>}
                </span>
                <span className="pkr-room-arrow" aria-hidden="true">↗</span>
              </button>
              {evt.role === 'host' && (evt as any).status !== 'ended' && (
                <button type="button" className="pkr-room-end"
                  onClick={() => setConfirmEndEventId(evt.id)} aria-label={'End poker room ' + evt.name}>
                  End
                </button>
              )}
            </article>
          ))}
        </div>

        {/* End event confirm modal */}
        {confirmEndEventId && (
          <div className="modal-overlay" onClick={()=>setConfirmEndEventId(null)}>
            <div className="modal animate-up" onClick={e=>e.stopPropagation()} style={{maxWidth:360}}>
              <div style={{padding:'24px 24px 16px',borderBottom:'1px solid var(--border-sub)'}}>
                <div style={{fontSize:16,color:'var(--white)',fontFamily:"'Playfair Display',serif",fontWeight:600,marginBottom:8}}>End Event?</div>
                <div style={{fontSize:13,color:'var(--muted)',fontFamily:'var(--font-body),sans-serif',lineHeight:1.6}}>
                  This will archive the event. All game history and leaderboard data will be preserved. Members will lose access and no new games can be created.
                </div>
              </div>
              <div style={{padding:'16px 24px',display:'flex',gap:8,justifyContent:'flex-end'}}>
                <button className="btn btn-ghost" style={{fontSize:12}} onClick={()=>setConfirmEndEventId(null)}>Cancel</button>
                <button className="btn btn-danger" style={{fontSize:12}} disabled={endingEvent}
                  onClick={()=>doEndEvent(confirmEndEventId)}>
                  {endingEvent ? 'Ending...' : 'End Event'}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>

      <PkrMobileNav items={[
        {id:'home',label:'Home',icon:'home',active:true,onSelect:()=>window.scrollTo({top:0,behavior:'smooth'})},
        {id:'rooms',label:'Rooms',icon:'rooms',onSelect:()=>document.getElementById('pkr-rooms')?.scrollIntoView({behavior:'smooth'})},
        {id:'scan',label:'Scan',icon:'scan',onSelect:startScan},
        {id:'new',label:'New room',icon:'plus',onSelect:openCreate}
      ]} />

      {/* Global upgrade modal — catches all 402s from this page */}
      <UpgradeModal />
    </div>
  );
}

export default function Dashboard() {
  return <Suspense><DashboardInner/></Suspense>;
}
