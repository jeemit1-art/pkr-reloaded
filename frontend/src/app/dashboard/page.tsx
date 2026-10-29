'use client';
import RecordMetric from '@/components/RecordMetric';
import AppDialog from '@/components/AppDialog';

// frontend/src/app/dashboard/page.tsx — FULL REPLACEMENT
// Changes vs original:
//  - Imports UpgradeModal
//  - Shows plan badge in nav (Trial X days / Starter / Pro)
//  - "Upgrade" button in nav when on trial/expired
//  - <UpgradeModal /> renders at bottom (catches all 402s globally on this page)
//  - create() error handling now distinguishes 402 (modal handles it) vs other errors
import { useEffect, useState, Suspense, useRef } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { api, User, Event, Game, EventMember, fmt, fmtDate, fmtSign, saveToken, clearToken, getToken } from '@/lib/api';
import UpgradeModal from '@/components/UpgradeModal';
import PkrMobileNav from '@/components/PkrMobileNav';
import CasinoArtwork from '@/components/CasinoArtwork';
import RoomOutstandingCard from '@/components/RoomOutstandingCard';
import {playPkrSound} from '@/lib/sounds';
import {isCurrentGame,isUnfinishedGame,isLiveGame} from '@/lib/game-status';

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
  const [featuredGames,setFeaturedGames]=useState<Game[]>([]);
  const [preferredRoomId,setPreferredRoomId]=useState('');
  const [featuredHistory,setFeaturedHistory]=useState<Game[]>([]);
  const [featuredMembers,setFeaturedMembers]=useState<EventMember[]>([]);
  const [search,setSearch]=useState('');
  const [showArchivedRooms,setShowArchivedRooms]=useState(false);
  const [reopeningRoomId,setReopeningRoomId]=useState<string|null>(null);
  const [pendingByRoom,setPendingByRoom]=useState<Record<string,number>>({});
  const previousPendingTotal=useRef<number|null>(null);

  useEffect(()=>{
    try{setPreferredRoomId(localStorage.getItem('pkr_preferred_room')||'');}catch{}
  },[]);

  // A visitor selecting Starter/Pro on a public page should find that
  // exact plan after Google sign-in, without an automatic charge.
  useEffect(()=>{
    if(loading||!user)return;
    let plan='';
    try{
      const requested=searchParams.get('subscribe');
      const stored=sessionStorage.getItem('pkr_host_plan_intent');
      plan=(requested==='starter'||requested==='pro')?requested:(stored||'');
      if(plan==='starter'||plan==='pro'){
        sessionStorage.removeItem('pkr_host_plan_intent');
        if(requested)window.history.replaceState({},'','/dashboard');
      }
    }catch{}
    if(plan!=='starter'&&plan!=='pro')return;
    const selected=plan;
    const timeout=window.setTimeout(()=>{
      window.dispatchEvent(new CustomEvent('pkr:upgrade_required',{detail:{
        preferredPlan:selected,
        error:'You selected the '+(selected==='pro'?'Pro':'Starter')+' host plan. Review the terms and then select Subscribe to open secure Stripe checkout.'
      }}));
    },150);
    return()=>window.clearTimeout(timeout);
  },[loading,user?.id,searchParams]);

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
      setEvents(es => es.map(e => e.id===eventId ? {...e, status:'ended'} : e));
      setConfirmEndEventId(null);
    } catch(e) { alert('Failed to end event'); }
    finally { setEndingEvent(false); }
  }

  async function reopenArchivedRoom(eventId: string) {
    setReopeningRoomId(eventId);
    try {
      await api.events.reopen(eventId);
      setEvents(es => {
        const room=es.find(e=>e.id===eventId);
        return room ? [{...room,status:'active'},...es.filter(e=>e.id!==eventId)] : es;
      });
    } catch(e) { alert('Failed to reopen poker room'); }
    finally { setReopeningRoomId(null); }
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
            const value = code.data.trim();
            try {
              const parsed = new URL(value,window.location.origin);
              if(parsed.origin!==window.location.origin)throw new Error('Not a PKR invitation');
              const phone=parsed.pathname.match(/^\/phone-invite\/([a-zA-Z0-9_-]+)\/?$/);
              const email=parsed.pathname.match(/^\/invite\/([a-zA-Z0-9_-]+)\/?$/);
              if(phone){
                // Personal QR codes must go through the explicit host-approval
                // flow, never the legacy immediate membership redemption API.
                setScanStatus('Opening your private join request…');
                setShowScanner(false);setScanning(false);
                router.push('/phone-invite/'+encodeURIComponent(phone[1]));
              }else if(email){
                setScanStatus('Checking the invited account…');
                try{
                  const result=await api.events.redeemInvite(email[1]);
                  if(result?.event?.id){
                    setScanStatus('Invite accepted. Opening your poker room…');
                    setTimeout(()=>{setShowScanner(false);router.push('/events/'+result.event.id);},800);
                  }else{setScanStatus('Invitation unavailable.');setScanning(false);}
                }catch{setScanStatus('This invite is expired or for another account.');setScanning(false);}
              }else throw new Error('Not a supported PKR invite');
            }catch{
              setScanStatus('Not a valid PKR invitation QR. Ask your host for a personal invite.');
              setScanning(false);
            }
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
    if(!user.is_active)return (
      <span style={{fontSize:10,padding:'2px 8px',borderRadius:2,
        background:'rgba(220,60,60,0.12)',color:'rgba(220,80,80,0.85)',
        letterSpacing:'0.1em',textTransform:'uppercase'}}>Subscription required</span>
    );
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

  const needsUpgrade = user && !user.is_active;
  const onTrial = user && user.plan === 'trial' && user.trial_active;
  const isPaid = user && user.is_active;
  const activeRooms = events.filter(evt => evt.status !== 'ended');
  const totalPending = Object.values(pendingByRoom).reduce((sum,count)=>sum+count,0);
  // Only hosts can read the private approval queue. The backend enforces host access.
  useEffect(()=>{
    const ownedRooms=events.filter(evt=>evt.status!=='ended' && evt.role==='host');
    let active=true;
    const refresh=async()=>{
      const counts=await Promise.all(ownedRooms.map(async room=>{
        try{const result=await api.events.joinRequests(room.id);return [room.id,result.requests.length] as const;}
        catch{return [room.id,0] as const;}
      }));
      if(active){
        const total=counts.reduce((sum,[,n])=>sum+n,0);
        if(previousPendingTotal.current!==null&&total>previousPendingTotal.current)
          playPkrSound('new-request');
        previousPendingTotal.current=total;
        setPendingByRoom(Object.fromEntries(counts));
      }
    };
    void refresh();
    const timer=window.setInterval(()=>void refresh(),15000);
    return()=>{active=false;window.clearInterval(timer)};
  },[events]);
  const archivedRooms = events.filter(evt => evt.status === 'ended');
  // Exclude ended rooms from active/featured dashboard content by default.
  const featuredRoom = activeRooms.find(room=>room.id===preferredRoomId)||activeRooms[0]||null;
  const totalGames = events.reduce((sum, evt) => sum + (Number(evt.game_count) || 0), 0);
  useEffect(()=>{
    if(!featuredRoom?.id){setFeaturedGames([]);setFeaturedHistory([]);setFeaturedMembers([]);return;}
    let active=true;
    setFeaturedGames([]);setFeaturedHistory([]);setFeaturedMembers([]);
    Promise.allSettled([api.games.list(featuredRoom.id),api.events.history(featuredRoom.id),api.events.get(featuredRoom.id)]).then(items=>{
      if(!active)return;
      if(items[0].status==='fulfilled')setFeaturedGames(items[0].value);
      if(items[1].status==='fulfilled')setFeaturedHistory(items[1].value);
      if(items[2].status==='fulfilled')setFeaturedMembers(items[2].value.members||[]);
    });
    return()=>{active=false};
  },[featuredRoom?.id]);
  const upcomingGames=featuredGames.filter(g=>isCurrentGame(g)).sort((a,b)=>a.scheduled_at-b.scheduled_at);
  const unfinishedGames=featuredGames.filter(g=>isUnfinishedGame(g)).sort((a,b)=>b.scheduled_at-a.scheduled_at);
  const nextGame=upcomingGames[0];
  const recentResults=featuredHistory.slice().sort((a,b)=>b.scheduled_at-a.scheduled_at).slice(0,4);
  const searchedRooms=activeRooms.filter(room=>room.name.toLowerCase().includes(search.toLowerCase().trim()));
  const searchedArchivedRooms=archivedRooms.filter(room=>room.name.toLowerCase().includes(search.toLowerCase().trim()));
  const openCreate = () => {
    setShowCreate(true);
    document.getElementById('pkr-rooms')?.scrollIntoView({ behavior: 'smooth' });
  };

  const renderRoomCard = (evt: Event) => {
    const archived=evt.status==='ended';
    return (
      <article key={evt.id} className={'pkr-room-card'+(archived?' pkr-room-archived':'')}>
        <button type="button" className="pkr-room-main" onClick={() => {try{localStorage.setItem('pkr_preferred_room',evt.id);}catch{} setPreferredRoomId(evt.id);router.push('/events/' + evt.id);}}
          aria-label={(archived?'View archived poker room ':'Open poker room ') + evt.name}>
          <span className="pkr-room-icon" aria-hidden="true">♠</span>
          <span className="pkr-room-copy">
            <span className="pkr-room-name" style={{display:'block'}}>{evt.name}</span>
            <span className="pkr-room-meta">
              <span>{evt.game_count || 0} games</span>
              <span>{evt.member_count || 1} members</span>
              {evt.buy_in > 0 && <span>{fmt(evt.buy_in)} buy-in</span>}
              {archived && <span>Ended</span>}
            </span>
            {evt.role && <span className={'badge badge-' + evt.role} style={{marginTop:9}}>{evt.role}</span>}
          </span>
          <span className="pkr-room-arrow" aria-hidden="true">↗</span>
        </button>
        {evt.role === 'host' && (archived ?
          <button type="button" className="pkr-room-end pkr-room-reopen"
            disabled={reopeningRoomId===evt.id}
            onClick={() => reopenArchivedRoom(evt.id)}
            aria-label={'Reopen poker room ' + evt.name}>
            {reopeningRoomId===evt.id?'Reopening…':'Reopen'}
          </button> :
          <button type="button" className="pkr-room-end"
            onClick={() => setConfirmEndEventId(evt.id)} aria-label={'End poker room ' + evt.name}>
            End
          </button>)}
      </article>
    );
  };

  if (loading) return (
    <div style={{minHeight:'100vh',background:'var(--bg)',display:'flex',alignItems:'center',justifyContent:'center'}}>
      <div className="display" style={{fontSize:48,color:'var(--gold)',opacity:0.6}}>PKR</div>
    </div>
  );

  return (
    <div className="pkr-app pkr-dashboard pkr-casino pkr-premium-shell" style={{minHeight:'100vh',paddingBottom:80}}>
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
            onClick={() => window.dispatchEvent(new CustomEvent('pkr:upgrade_required', {detail:{error:'Choose a paid host subscription.'}}))}
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
          <label className="pkr-pro-search"><span>⌕</span><input aria-label="Search poker rooms" placeholder="Search poker rooms…" value={search} onChange={e=>setSearch(e.target.value)}/></label>
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

      <div className="pkr-content" style={{maxWidth:1600,margin:'0 auto',padding:'22px 22px 45px',position:'relative',zIndex:1}}>
        {totalPending > 0 && (
          <section aria-label="Pending membership approvals" role="status"
            style={{padding:'14px 17px',marginBottom:17,border:'1px solid var(--gold)',
              background:'rgba(201,168,76,.12)',borderRadius:10,color:'var(--ivory)'}}>
            <strong style={{color:'var(--gold)'}}>🔔 {totalPending} player{totalPending===1?'':'s'} waiting for your approval</strong>
            <div style={{display:'flex',gap:9,flexWrap:'wrap',marginTop:10}}>
              {activeRooms.filter(room=>pendingByRoom[room.id]>0).map(room=>(
                <button key={room.id} type="button" className="btn btn-primary"
                  onClick={()=>router.push('/events/'+room.id+'?tab=members')}>
                  Review {room.name} ({pendingByRoom[room.id]})
                </button>
              ))}
            </div>
          </section>
        )}
        {featuredRoom && activeRooms.every(room=>room.role!=='host') && (
          <section className="pkr-player-setup-card" style={{marginBottom:17,border:'1px solid rgba(201,168,76,.28)',
            borderRadius:12,background:'linear-gradient(115deg,rgba(21,47,32,.97),rgba(7,17,11,.97))',
            padding:'17px 19px',display:'flex',gap:15,justifyContent:'space-between',alignItems:'center',flexWrap:'wrap'}}>
            <div><span className="pkr-eyebrow">YOUR PLAYER SETUP</span>
              <h2 style={{margin:'4px 0',fontSize:20,fontFamily:'var(--font-display),serif',color:'var(--white)'}}>Ready for poker night?</h2>
              <p style={{margin:0,fontSize:12,color:'var(--muted)',maxWidth:440}}>
                Install PKR, enable game alerts and check your RSVP in one place.</p>
            </div>
            <button type="button" className="btn btn-primary"
              onClick={()=>router.push('/install?group='+encodeURIComponent(featuredRoom.id))}>
              Finish phone setup →
            </button>
          </section>
        )}
        <section className="pkr-pro-home" aria-label="Poker room overview">
          {nextGame&&<section className="pkr-mobile-featured" aria-label="Next game">
            <span className="pkr-eyebrow">♠ NEXT GAME</span>
            <h2>{featuredRoom?.name||'Poker night'}</h2>
            <span className="pkr-mobile-featured-status">● {nextGame.status==='active'?'Live game':'Upcoming game'}</span>
            <div className="pkr-mobile-featured-meta">
              <span>▦ {fmtDate(nextGame.scheduled_at)}</span>
              <span>⌖ {nextGame.location||'Location to confirm'}</span>
              <span>♟ {(nextGame as any).player_count||0} players</span>
            </div>
            <div className="pkr-mobile-featured-actions">
              <button type="button" onClick={()=>router.push('/games/'+nextGame.id+(nextGame.status==='active'?'/play':'/rsvp'))}>▶ {nextGame.status==='active'?'Open Live Table':'RSVP for Game'}</button>
              <button type="button" onClick={()=>router.push('/games/'+nextGame.id)}>View Details →</button>
            </div>
          </section>}
          {unfinishedGames.length>0&&<div className="pkr-unfinished-note" role="status">
            <strong>{unfinishedGames.length} unfinished or past-due session{unfinishedGames.length===1?'':'s'} in {featuredRoom?.name}</strong>
            <p>These older games are preserved, not live. Open your poker room's Games tab to review them.</p>
            <button type="button" onClick={()=>featuredRoom&&router.push('/events/'+featuredRoom.id+'?tab=games')}
              style={{marginTop:8,padding:'8px 12px',color:'#f8db9e',border:'1px solid #b9965f',borderRadius:8,background:'#153324'}}>Review unfinished games</button>
          </div>}
          <div className="pkr-pro-hero">
            <div className="pkr-pro-hero-content">
              <span className="pkr-eyebrow">♠ YOUR POKER ROOM</span>
              <div className="pkr-pro-title"><h1>{featuredRoom?.name||'Your poker club'}</h1><span className="pkr-pro-live">● {featuredRoom?'Active':'Get started'}</span></div>
              <p>Your group, upcoming games and results — all in one place.</p>
              <div className="pkr-pro-stats">
                <div><RecordMetric request={{kind:'games',title:"Games recorded",roomId:featuredRoom?.id}}><span>♧</span><strong>{featuredRoom?.game_count||0}</strong><small>Games recorded</small></RecordMetric></div>
                <div><RecordMetric request={{kind:'members',title:"Room members",roomId:featuredRoom?.id}}><span>♟</span><strong>{featuredRoom?.member_count||0}</strong><small>Room members</small></RecordMetric></div>
                <div><RecordMetric request={{kind:'games',title:"Games across rooms"}}><span>♛</span><strong>{totalGames}</strong><small>Games across rooms</small></RecordMetric></div>
                <div><RecordMetric request={nextGame?{kind:'game',title:"Next game",gameId:nextGame.id}:{kind:'games',title:"Upcoming games",roomId:featuredRoom?.id,filter:'upcoming'}}><span>▦</span><strong className="pkr-pro-next-date">{nextGame?new Date(nextGame.scheduled_at*1000).toLocaleDateString('en-AU',{day:'numeric',month:'short'}):'—'}</strong><small>Next game</small></RecordMetric></div>
              </div>
              <div className="pkr-pro-actions"><button className="btn btn-primary" onClick={()=>featuredRoom?router.push('/events/'+featuredRoom.id):openCreate()}>▶ {featuredRoom?'Open Room':'Create Room'} →</button><button className="btn btn-ghost" onClick={()=>featuredRoom?router.push('/events/'+featuredRoom.id+'?tab=members'):openCreate()}>♟ Invite Players</button></div>
            </div>
            <div className="pkr-pro-art" aria-hidden="true"><CasinoArtwork variant="lounge"/></div>
          </div>
          <div className="pkr-pro-panels">
            <section className="pkr-pro-panel"><div className="pkr-pro-panel-head"><h2>▦ Upcoming Games</h2><button onClick={()=>router.push('/schedule')}>View all →</button></div>
              {nextGame?<div className="pkr-pro-feature-game"><div className="pkr-pro-date"><strong>{new Date(nextGame.scheduled_at*1000).toLocaleDateString('en-AU',{day:'2-digit'})}</strong><small>{new Date(nextGame.scheduled_at*1000).toLocaleDateString('en-AU',{month:'short'})}</small></div><div><strong>{featuredRoom?.name}</strong><p>{fmtDate(nextGame.scheduled_at)} · {nextGame.location||'Location to confirm'}</p><span className="pkr-pro-live">● {nextGame.status==='active'?'In progress':'Upcoming'}</span></div></div>:<p className="pkr-pro-empty">No upcoming games. Open your room to schedule poker night.</p>}
              <div className="pkr-pro-panel-ctas"><button className="pkr-pro-wide-button" onClick={()=>nextGame?router.push('/games/'+nextGame.id):featuredRoom?router.push('/events/'+featuredRoom.id):openCreate()}>{nextGame?'View Game →':'Open Room →'}</button>{nextGame&&<button className="pkr-pro-wide-button" onClick={()=>router.push('/games/'+nextGame.id+'/rsvp')}>Manage RSVP</button>}</div>
            </section>
            <section className="pkr-pro-panel"><div className="pkr-pro-panel-head"><h2>♟ Members</h2><button onClick={()=>featuredRoom?router.push('/events/'+featuredRoom.id+'?tab=members'):openCreate()}>View all →</button></div>
              <div className="pkr-pro-member-stats"><div><RecordMetric request={{kind:'members',title:"Room members",roomId:featuredRoom?.id}}><strong>{featuredRoom?.member_count||0}</strong><small>Total members</small></RecordMetric></div><div><RecordMetric request={{kind:'rooms',title:"Active rooms"}}><strong>{activeRooms.length}</strong><small>Active rooms</small></RecordMetric></div></div>
              <div className="pkr-pro-member-list">{featuredMembers.slice(0,4).map(m=><div key={m.id} className="pkr-pro-member"><span className="pkr-pro-member-avatar" aria-hidden="true">{m.name?.trim().charAt(0)?.toUpperCase()||'♠'}{m.avatar_url&&<img key={m.avatar_url} src={m.avatar_url} alt="" loading="lazy" referrerPolicy="no-referrer" onError={e=>{e.currentTarget.style.display='none';}}/>}</span><strong>{m.name}</strong><small>{m.role}</small></div>)}{!featuredMembers.length&&<p className="pkr-pro-empty">Members appear after joining a room.</p>}</div>
              <button className="pkr-pro-wide-button" onClick={()=>featuredRoom?router.push('/events/'+featuredRoom.id+'?tab=members'):openCreate()}>Manage Members →</button>
            </section>
            <section className="pkr-pro-panel"><div className="pkr-pro-panel-head"><h2>♛ Recent Results</h2><button onClick={()=>featuredRoom?router.push('/events/'+featuredRoom.id+'?tab=history'):openCreate()}>View all →</button></div>
              {recentResults.length?recentResults.map(g=><button className="pkr-pro-result-row" key={g.id} onClick={()=>router.push('/games/'+g.id)}><span>♛</span><span><strong>{fmtDate(g.scheduled_at)}</strong><small>{(g as any).player_count||0} players · Settled</small></span><span>→</span></button>):<p className="pkr-pro-empty">No settled games yet. Results appear here after settlement.</p>}
              <button className="pkr-pro-wide-button" onClick={()=>featuredRoom?router.push('/events/'+featuredRoom.id+'?tab=history'):openCreate()}>Review Results →</button>
            </section>
          </div>
          <div className="pkr-pro-bottom">
            <section className="pkr-pro-panel"><div className="pkr-pro-panel-head"><h2>♧ Active Rooms</h2><button onClick={openCreate}>+ New room</button></div>
              {activeRooms.length?activeRooms.slice(0,3).map(room=><button key={room.id} className="pkr-pro-room-row" onClick={()=>router.push('/events/'+room.id)}><span>♠</span><span><strong>{room.name}</strong><small>{room.member_count||0} members · {room.game_count||0} games</small></span><span>→</span></button>):<p className="pkr-pro-empty">No active rooms yet.</p>}
            </section>
            <section className="pkr-pro-panel"><div className="pkr-pro-panel-head"><h2>ϟ Quick Actions</h2></div><div className="pkr-pro-shortcuts">
              <button onClick={()=>featuredRoom?router.push('/events/'+featuredRoom.id):openCreate()}><span>▶</span><strong>Open Game</strong><small>Manage a session</small></button>
              <button onClick={()=>featuredRoom?router.push('/events/'+featuredRoom.id+'?tab=members'):openCreate()}><span>♟</span><strong>Invite Players</strong><small>Share your room</small></button>
              <button onClick={()=>router.push('/schedule')}><span>▦</span><strong>Schedule</strong><small>Next game night</small></button>
              <button onClick={startScan}><span>⊞</span><strong>Scan Invite</strong><small>Join a group</small></button>
            </div></section>
            {featuredRoom&&<RoomOutstandingCard roomId={featuredRoom.id}/>}
          </div>
        </section>

        <section className="pkr-list-head" id="pkr-rooms" aria-label="Your poker rooms">
          <div>
            <span className="pkr-eyebrow">Your groups</span>
            <h2>Poker rooms <span style={{fontSize:13,color:'var(--muted)',fontWeight:600}}>({activeRooms.length} active)</span></h2>
          </div>
          <div className="pkr-list-head-actions">
            {archivedRooms.length>0&&
              <button type="button" className="btn btn-ghost" aria-expanded={showArchivedRooms}
                aria-controls="pkr-archived-rooms" onClick={()=>setShowArchivedRooms(show=>!show)}>
                {showArchivedRooms?'Hide archived rooms':`Show archived rooms (${archivedRooms.length})`}
              </button>}
            <button type="button" className="btn btn-ghost" onClick={startScan}>Scan invite</button>
            <button type="button" className="btn btn-primary" onClick={openCreate}>+ New room</button>
          </div>
        </section>

        {/* QR Scanner Modal */}
        {showScanner && (
          <AppDialog style={{position:'fixed',inset:0,background:'rgba(0,0,0,0.92)',zIndex:1000,display:'flex',flexDirection:'column',alignItems:'center',justifyContent:'center',padding:24}} aria-label="Scan invite" onDismiss={()=>{setShowScanner(false);setScanning(false);}}>
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
          </AppDialog>
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

        <div className="pkr-room-grid" id="pkr-active-rooms">
          {searchedRooms.map(renderRoomCard)}
        </div>
        {activeRooms.length===0&&events.length>0&&
          <p className="pkr-pro-empty">No active rooms. Create a room or open Archived rooms to view previous ones.</p>}
        {activeRooms.length>0&&searchedRooms.length===0&&
          <p className="pkr-pro-empty">No active rooms match your search.</p>}
        {showArchivedRooms&&archivedRooms.length>0&&
          <section className="pkr-archived-rooms" id="pkr-archived-rooms" aria-label="Archived poker rooms">
            <div className="pkr-archived-room-head">
              <h3>Archived rooms</h3>
              <p>Ended rooms are hidden from the active list. Their game history and financial records are preserved.</p>
            </div>
            <div className="pkr-room-grid">
              {searchedArchivedRooms.map(renderRoomCard)}
            </div>
            {searchedArchivedRooms.length===0&&<p className="pkr-pro-empty">No archived rooms match your search.</p>}
          </section>}

        {/* End event confirm modal */}
        {confirmEndEventId && (
          <AppDialog className="modal-overlay" onClick={()=>setConfirmEndEventId(null)}>
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
          </AppDialog>
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
