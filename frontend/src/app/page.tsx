'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { useSession, signIn } from 'next-auth/react'

export default function HomePage() {
  const { data: session, status } = useSession()
  const router = useRouter()
  const [modalOpen, setModalOpen] = useState(false)
  const [navStuck, setNavStuck] = useState(false)

  // Redirect logged-in users straight to dashboard
  useEffect(() => {
    if (status === 'authenticated') router.push('/dashboard')
  }, [status, router])

  // Sticky nav
  useEffect(() => {
    const fn = () => setNavStuck(window.scrollY > 20)
    window.addEventListener('scroll', fn, { passive: true })
    return () => window.removeEventListener('scroll', fn)
  }, [])

  // Scroll reveal
  useEffect(() => {
    const obs = new IntersectionObserver(
      entries => entries.forEach(e => {
        if (e.isIntersecting) { e.target.classList.add('in'); obs.unobserve(e.target) }
      }),
      { threshold: 0.06, rootMargin: '0px 0px -24px 0px' }
    )
    document.querySelectorAll('.rv').forEach(el => obs.observe(el))
    return () => obs.disconnect()
  }, [])

  // Lock body scroll when modal open
  useEffect(() => {
    document.body.style.overflow = modalOpen ? 'hidden' : ''
  }, [modalOpen])

  // Escape key closes modal
  useEffect(() => {
    const fn = (e: KeyboardEvent) => { if (e.key === 'Escape') setModalOpen(false) }
    window.addEventListener('keydown', fn)
    return () => window.removeEventListener('keydown', fn)
  }, [])

  if (status === 'loading' || status === 'authenticated') return null

  const GoogleIcon = () => (
    <svg width="18" height="18" viewBox="0 0 18 18" aria-label="Google logo" role="img" style={{ flexShrink: 0 }}>
      <path d="M17.64 9.2a10.34 10.34 0 0 0-.16-1.84H9v3.48h4.84a4.14 4.14 0 0 1-1.8 2.72v2.26h2.92a8.78 8.78 0 0 0 2.68-6.62z" fill="#4285F4"/>
      <path d="M9 18a8.6 8.6 0 0 0 5.96-2.18l-2.91-2.26a5.4 5.4 0 0 1-8.07-2.85H.96v2.33A9 9 0 0 0 9 18z" fill="#34A853"/>
      <path d="M3.96 10.71a5.41 5.41 0 0 1 0-3.42V4.96H.96a9 9 0 0 0 0 8.08l3-2.33z" fill="#FBBC05"/>
      <path d="M9 3.58a4.86 4.86 0 0 1 3.44 1.35l2.58-2.58A8.64 8.64 0 0 0 9 0 9 9 0 0 0 .96 4.96l3 2.33A5.36 5.36 0 0 1 9 3.58z" fill="#EA4335"/>
    </svg>
  )

  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Syne:wght@400;500;600;700;800&family=Inter:wght@300;400;500;600&display=swap');

        *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
        :root {
          --black: #080b08; --surface: #0f130f; --surface2: #151a15; --surface3: #1b211b;
          --gold: #d4a843; --gold-hi: #f0c86a; --gold-lo: rgba(212,168,67,0.12);
          --green: #22c55e; --red: #ef4444; --white: #f8f6f0;
          --muted: #5a6e5a; --muted2: #8a9e8a;
          --border: rgba(212,168,67,0.1); --border-hi: rgba(212,168,67,0.25);
        }
        html { scroll-behavior: smooth; }
        body { background: var(--black); color: var(--white); font-family: 'Inter', sans-serif;
          font-size: 15px; line-height: 1.6; -webkit-font-smoothing: antialiased; overflow-x: hidden; }

        /* MESH */
        .mesh-bg { position: absolute; inset: 0; overflow: hidden; pointer-events: none; }
        .mesh-orb { position: absolute; border-radius: 50%; filter: blur(80px); opacity: 0.55; }
        .mesh-orb.a { width:600px;height:600px;background:radial-gradient(ellipse,#1a4a1a,transparent 70%);top:-100px;left:-100px;animation:orbDrift 18s ease-in-out infinite alternate; }
        .mesh-orb.b { width:500px;height:500px;background:radial-gradient(ellipse,rgba(212,168,67,0.25),transparent 70%);top:20%;right:-80px;animation:orbDrift 22s ease-in-out infinite alternate-reverse; }
        .mesh-orb.c { width:400px;height:400px;background:radial-gradient(ellipse,#0d2e0d,transparent 70%);bottom:0;left:30%;animation:orbDrift 16s ease-in-out infinite alternate; }
        @keyframes orbDrift { from{transform:translate(0,0) scale(1)} to{transform:translate(40px,30px) scale(1.08)} }
        .grid-lines { position:absolute;inset:0;background-image:linear-gradient(rgba(212,168,67,0.04) 1px,transparent 1px),linear-gradient(90deg,rgba(212,168,67,0.04) 1px,transparent 1px);background-size:60px 60px;mask-image:radial-gradient(ellipse at 50% 40%,black 30%,transparent 75%); }

        /* NAV */
        nav { position:fixed;top:0;left:0;right:0;z-index:300;display:flex;align-items:center;justify-content:space-between;padding:0 40px;height:60px;border-bottom:1px solid transparent;transition:all 0.4s; }
        nav.stuck { background:rgba(8,11,8,0.88);border-color:var(--border);backdrop-filter:blur(32px); }
        .logo { font-family:'Syne',sans-serif;font-size:1.4rem;font-weight:800;letter-spacing:3px;background:linear-gradient(135deg,var(--gold-hi),var(--gold));-webkit-background-clip:text;-webkit-text-fill-color:transparent;background-clip:text;text-decoration:none; }
        .nav-links { display:flex;gap:32px;align-items:center; }
        .nav-links a { font-size:0.72rem;font-weight:500;letter-spacing:0.5px;color:var(--muted2);text-decoration:none;transition:color 0.2s; }
        .nav-links a:hover { color:var(--white); }
        .nav-cta { font-family:'Syne',sans-serif;font-size:0.75rem;font-weight:700;letter-spacing:1px;padding:8px 20px;border-radius:6px;background:var(--gold);color:#000;text-decoration:none;transition:all 0.2s;border:none;cursor:pointer; }
        .nav-cta:hover { background:var(--gold-hi);transform:translateY(-1px); }

        /* HERO */
        .hero { min-height:100vh;display:grid;place-items:center;padding:100px 40px 80px;position:relative;text-align:center; }
        .hero-eyebrow { display:inline-flex;align-items:center;gap:8px;font-size:0.68rem;font-weight:600;letter-spacing:2px;text-transform:uppercase;color:var(--gold);border:1px solid var(--border-hi);background:var(--gold-lo);border-radius:100px;padding:5px 16px;margin-bottom:28px;animation:fadeSlide 0.6s ease both; }
        .eyebrow-dot { width:5px;height:5px;border-radius:50%;background:var(--gold);animation:blink 1.8s ease infinite; }
        @keyframes blink { 0%,100%{opacity:1} 50%{opacity:0.2} }
        .hero h1 { font-family:'Syne',sans-serif;font-size:clamp(3.5rem,9vw,7.5rem);font-weight:800;line-height:0.93;letter-spacing:-3px;margin-bottom:28px;animation:fadeSlide 0.65s 0.05s ease both; }
        .hero h1 .line1 { display:block;color:var(--white); }
        .hero h1 .line2 { display:block;background:linear-gradient(90deg,var(--gold-hi),var(--gold),#a07828);-webkit-background-clip:text;-webkit-text-fill-color:transparent;background-clip:text; }
        .hero-sub { font-size:clamp(0.9rem,1.6vw,1.05rem);color:var(--muted2);font-weight:300;max-width:480px;margin:0 auto 44px;line-height:1.85;animation:fadeSlide 0.65s 0.1s ease both; }
        .hero-actions { display:flex;gap:12px;justify-content:center;flex-wrap:wrap;animation:fadeSlide 0.65s 0.15s ease both; }
        .btn-main { font-family:'Syne',sans-serif;font-weight:700;font-size:0.88rem;padding:13px 32px;border-radius:8px;background:var(--gold);color:#000;text-decoration:none;transition:all 0.25s;border:none;cursor:pointer; }
        .btn-main:hover { background:var(--gold-hi);transform:translateY(-2px);box-shadow:0 8px 30px rgba(212,168,67,0.3); }
        .btn-ghost { font-size:0.84rem;font-weight:500;padding:12px 24px;border-radius:8px;border:1px solid var(--border-hi);color:var(--muted2);text-decoration:none;transition:all 0.2s; }
        .btn-ghost:hover { border-color:var(--gold);color:var(--white); }

        /* PHONE */
        .hero-phone-wrap { margin-top:72px;position:relative;display:inline-block;animation:fadeSlide 0.8s 0.2s ease both; }
        .phone-glow { position:absolute;inset:-60px;background:radial-gradient(ellipse,rgba(212,168,67,0.12),transparent 65%);pointer-events:none; }
        .phone { width:280px;background:#0c110c;border-radius:38px;border:1.5px solid rgba(212,168,67,0.2);overflow:hidden;box-shadow:0 60px 120px rgba(0,0,0,0.7),0 0 0 1px rgba(255,255,255,0.03),inset 0 1px 0 rgba(255,255,255,0.05);position:relative; }
        .phone-notch { width:80px;height:24px;background:#0c110c;border-radius:0 0 14px 14px;margin:0 auto;position:absolute;top:0;left:50%;transform:translateX(-50%);z-index:2;border:1.5px solid rgba(212,168,67,0.15);border-top:none; }
        .phone-screen { padding:36px 14px 20px; }
        .ps-header { display:flex;align-items:center;justify-content:space-between;margin-bottom:14px; }
        .ps-title { font-family:'Syne',sans-serif;font-size:0.75rem;font-weight:700;color:var(--white);letter-spacing:0.5px; }
        .ps-live { display:flex;align-items:center;gap:4px;font-size:0.55rem;font-weight:600;color:var(--green);letter-spacing:1px;text-transform:uppercase; }
        .ps-live-dot { width:5px;height:5px;border-radius:50%;background:var(--green);animation:blink 1.2s ease infinite; }
        .ps-table { position:relative;width:100%;padding-bottom:68%;background:radial-gradient(ellipse at 50% 38%,#1d6828,#134d1e 52%,#0b3212);border-radius:70px;border:5px solid #2d1504;box-shadow:inset 0 4px 16px rgba(0,0,0,0.6);margin-bottom:10px;overflow:hidden; }
        .ps-table::before { content:'';position:absolute;inset:0;background:repeating-linear-gradient(0deg,transparent,transparent 12px,rgba(0,0,0,0.03) 12px,rgba(0,0,0,0.03) 13px),repeating-linear-gradient(90deg,transparent,transparent 12px,rgba(0,0,0,0.03) 12px,rgba(0,0,0,0.03) 13px);border-radius:inherit; }
        .ps-label { position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);font-family:'Syne',sans-serif;font-size:0.42rem;color:rgba(248,246,240,0.2);letter-spacing:2px;text-transform:uppercase;text-align:center;pointer-events:none; }
        .ps-seat { position:absolute;display:flex;flex-direction:column;align-items:center;gap:2px; }
        .ps-chip { width:28px;height:28px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:0.5rem;font-weight:700;border:1.5px solid;font-family:'Syne',sans-serif;box-shadow:0 2px 6px rgba(0,0,0,0.5); }
        .ps-chip.g { background:linear-gradient(135deg,#1b3d1b,#0d2010);border-color:rgba(212,168,67,0.7);color:var(--white); }
        .ps-chip.e { background:linear-gradient(135deg,#0c2c1a,#051510);border-color:rgba(34,197,94,0.45);color:var(--green); }
        .ps-n { font-size:0.42rem;color:#fff;background:rgba(0,0,0,0.72);padding:1px 5px;border-radius:3px;font-weight:600;max-width:40px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap; }
        .ps-v { font-size:0.4rem;font-weight:700; }
        .ps-v.p { color:var(--green); }
        .ps-v.n { color:var(--red); }
        .ps-row { display:flex;gap:6px; }
        .ps-stat { flex:1;background:rgba(255,255,255,0.03);border:1px solid var(--border);border-radius:8px;padding:7px 8px; }
        .ps-stat-l { font-size:0.48rem;color:var(--muted);text-transform:uppercase;letter-spacing:1px;margin-bottom:2px; }
        .ps-stat-v { font-family:'Syne',sans-serif;font-size:0.72rem;font-weight:700;color:var(--white); }
        .ps-stat-v.g { color:var(--green); }
        .ps-notif { margin-top:8px;background:rgba(212,168,67,0.08);border:1px solid rgba(212,168,67,0.2);border-radius:8px;padding:7px 10px;display:flex;align-items:center;gap:7px;animation:notifPop 5s ease infinite; }
        @keyframes notifPop { 0%,8%{transform:translateY(6px);opacity:0} 13%,78%{transform:translateY(0);opacity:1} 87%,100%{transform:translateY(-4px);opacity:0} }
        .ps-notif-icon { font-size:0.9rem; }
        .ps-notif-title { font-size:0.58rem;font-weight:600;color:var(--white); }
        .ps-notif-sub { font-size:0.5rem;color:var(--muted2); }

        /* TICKER */
        .ticker-wrap { border-top:1px solid var(--border);border-bottom:1px solid var(--border);background:linear-gradient(180deg,rgba(212,168,67,0.03),transparent);overflow:hidden;padding:14px 0; }
        .ticker { display:flex;gap:0;animation:tickerScroll 28s linear infinite;white-space:nowrap; }
        @keyframes tickerScroll { 0%{transform:translateX(0)} 100%{transform:translateX(-50%)} }
        .ticker-item { display:inline-flex;align-items:center;gap:10px;padding:0 32px;font-size:0.72rem;font-weight:500;color:var(--muted);border-right:1px solid var(--border);flex-shrink:0; }
        .ticker-item .suit { color:var(--gold);font-size:0.8rem; }
        .ticker-item .name { color:var(--muted2); }
        .ticker-item .val { font-family:'Syne',sans-serif;font-weight:700; }
        .ticker-item .val.p { color:var(--green); }
        .ticker-item .val.n { color:var(--red); }

        /* STATS BAR */
        .stats-bar { background:var(--surface);border-top:1px solid var(--border);border-bottom:1px solid var(--border);padding:44px 40px; }
        .stats-inner { max-width:900px;margin:0 auto;display:flex;align-items:center;justify-content:center;gap:0;flex-wrap:wrap; }
        .stat-item { flex:1;min-width:160px;text-align:center;padding:12px 24px; }
        .stat-num { font-family:'Syne',sans-serif;font-size:clamp(1.8rem,4vw,2.6rem);font-weight:800;background:linear-gradient(135deg,var(--gold-hi),var(--gold));-webkit-background-clip:text;-webkit-text-fill-color:transparent;background-clip:text;line-height:1;margin-bottom:6px; }
        .stat-lbl { font-size:0.72rem;color:var(--muted);font-weight:400;letter-spacing:0.3px; }
        .stat-div { width:1px;height:40px;background:var(--border);flex-shrink:0; }

        /* BENTO */
        .bento-section { padding:100px 40px;max-width:1180px;margin:0 auto; }
        .section-header { text-align:center;margin-bottom:64px; }
        .s-tag { display:inline-block;font-size:0.62rem;font-weight:600;letter-spacing:2.5px;text-transform:uppercase;color:var(--gold);margin-bottom:14px; }
        .s-h2 { font-family:'Syne',sans-serif;font-size:clamp(2rem,4.5vw,3.4rem);font-weight:800;letter-spacing:-1.5px;line-height:1.05;color:var(--white);margin-bottom:14px; }
        .s-h2 em { font-style:normal;color:var(--gold); }
        .s-sub { font-size:0.95rem;color:var(--muted2);max-width:480px;margin:0 auto;font-weight:300;line-height:1.8; }
        .bento { display:grid;grid-template-columns:repeat(12,1fr);grid-auto-rows:minmax(160px,auto);gap:14px; }
        .bcard { background:var(--surface);border:1px solid var(--border);border-radius:18px;padding:28px;position:relative;overflow:hidden;transition:border-color 0.3s,transform 0.3s; }
        .bcard::before { content:'';position:absolute;top:0;left:0;right:0;height:1px;background:linear-gradient(90deg,transparent,rgba(212,168,67,0.3),transparent);opacity:0;transition:opacity 0.3s; }
        .bcard:hover { border-color:var(--border-hi);transform:translateY(-2px); }
        .bcard:hover::before { opacity:1; }
        .bcard.c4 { grid-column:span 4; } .bcard.c5 { grid-column:span 5; } .bcard.c7 { grid-column:span 7; } .bcard.c12 { grid-column:span 12; } .bcard.r2 { grid-row:span 2; }
        .bcard.accent-gold { background:linear-gradient(145deg,rgba(212,168,67,0.09),var(--surface) 55%);border-color:rgba(212,168,67,0.22); }
        .bcard.accent-green { background:linear-gradient(145deg,rgba(34,197,94,0.07),var(--surface) 55%);border-color:rgba(34,197,94,0.15); }
        .bc-icon { font-size:1.6rem;margin-bottom:14px; }
        .bc-title { font-family:'Syne',sans-serif;font-size:0.95rem;font-weight:700;color:var(--white);margin-bottom:8px; }
        .bc-desc { font-size:0.8rem;color:var(--muted2);line-height:1.7;font-weight:300; }
        .bc-tag { position:absolute;bottom:20px;right:20px;font-size:0.56rem;font-weight:600;letter-spacing:1.5px;text-transform:uppercase;color:var(--gold);opacity:0.6; }
        .lb-rows { display:flex;flex-direction:column;gap:6px;margin-top:16px; }
        .lb-row { display:flex;align-items:center;gap:10px;background:rgba(255,255,255,0.03);border-radius:8px;padding:8px 10px;font-size:0.75rem; }
        .lb-rank { font-family:'Syne',sans-serif;font-size:0.65rem;font-weight:700;color:var(--muted);width:16px;flex-shrink:0; }
        .lb-rank.top { color:var(--gold); }
        .lb-av { width:24px;height:24px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:0.55rem;font-weight:700;flex-shrink:0; }
        .lb-av.a { background:rgba(212,168,67,0.15);color:var(--gold);border:1px solid rgba(212,168,67,0.3); }
        .lb-av.b { background:rgba(255,255,255,0.06);color:var(--muted2);border:1px solid var(--border); }
        .lb-name { flex:1;color:var(--white);font-weight:500;font-size:0.78rem; }
        .lb-val { font-family:'Syne',sans-serif;font-weight:700;font-size:0.8rem; }
        .lb-val.p { color:var(--green); } .lb-val.n { color:var(--red); }
        .settle-rows { display:flex;flex-direction:column;gap:7px;margin-top:14px; }
        .settle-row { display:flex;align-items:center;gap:8px;font-size:0.75rem;color:var(--muted2); }
        .s-chip { width:26px;height:26px;border-radius:50%;background:rgba(255,255,255,0.05);border:1px solid var(--border);display:flex;align-items:center;justify-content:center;font-size:0.52rem;font-weight:700;color:var(--white);flex-shrink:0; }
        .s-arrow { color:var(--muted);font-size:0.7rem; }
        .s-amt { font-family:'Syne',sans-serif;font-weight:700;font-size:0.78rem;color:var(--gold);margin-left:auto; }
        .notif-stack { display:flex;flex-direction:column;gap:8px;margin-top:14px; }
        .notif-card { background:rgba(255,255,255,0.04);border:1px solid var(--border);border-radius:10px;padding:10px 12px;display:flex;align-items:center;gap:9px; }
        .notif-card.active { background:rgba(212,168,67,0.07);border-color:rgba(212,168,67,0.25); }
        .ni { font-size:1rem; } .nt { font-size:0.72rem;font-weight:600;color:var(--white); } .nb { font-size:0.62rem;color:var(--muted2); }

        /* PROBLEMS */
        .problems-strip { background:var(--surface);border-top:1px solid var(--border);border-bottom:1px solid var(--border);padding:80px 40px; }
        .problems-inner { max-width:1180px;margin:0 auto;display:grid;grid-template-columns:1fr 1fr;gap:80px;align-items:center; }
        .prob-list { display:flex;flex-direction:column;gap:0; }
        .prob-item { display:flex;gap:16px;padding:20px 0;border-bottom:1px solid var(--border); }
        .prob-item:last-child { border-bottom:none; }
        .prob-num { font-family:'Syne',sans-serif;font-size:0.62rem;font-weight:700;color:var(--muted);width:20px;flex-shrink:0;padding-top:2px; }
        .prob-title { font-family:'Syne',sans-serif;font-size:0.88rem;font-weight:700;color:var(--white);margin-bottom:4px; }
        .prob-desc { font-size:0.78rem;color:var(--muted2);line-height:1.65;font-weight:300; }

        /* COMPARE */
        .compare-section { padding:100px 40px;max-width:1180px;margin:0 auto; }
        .ctable-wrap { border:1px solid var(--border);border-radius:18px;overflow:hidden;overflow-x:auto; }
        table.ct { width:100%;border-collapse:collapse;min-width:560px; }
        table.ct thead { background:rgba(212,168,67,0.04);border-bottom:1px solid var(--border); }
        table.ct th { padding:16px 24px;font-family:'Syne',sans-serif;font-size:0.68rem;font-weight:700;letter-spacing:1px;text-align:left;color:var(--muted2); }
        table.ct th.pkr { color:var(--gold); }
        table.ct td { padding:13px 24px;font-size:0.82rem;border-bottom:1px solid rgba(212,168,67,0.04);vertical-align:middle; }
        table.ct tr:last-child td { border-bottom:none; }
        table.ct td.feat { color:var(--muted2);font-size:0.78rem; }
        table.ct td.pkr { background:rgba(212,168,67,0.04);font-weight:600;color:var(--gold); }
        table.ct tr:hover td { background:rgba(255,255,255,0.012); }
        table.ct tr:hover td.pkr { background:rgba(212,168,67,0.07); }
        .y { color:var(--green);font-weight:600; } .x { color:rgba(239,68,68,0.4); } .pt { color:var(--muted);font-size:0.76rem; }

        /* TESTIMONIALS */
        .testi-section { padding:100px 40px;background:var(--black); }
        .testi-inner { max-width:1100px;margin:0 auto; }
        .testi-grid { display:grid;grid-template-columns:repeat(auto-fit,minmax(300px,1fr));gap:16px; }
        .tcard { background:var(--surface);border:1px solid var(--border);border-radius:16px;padding:28px;transition:border-color 0.3s,transform 0.3s;position:relative;overflow:hidden; }
        .tcard::before { content:'"';position:absolute;top:10px;right:18px;font-size:5rem;line-height:1;color:var(--gold);opacity:0.07;font-family:Georgia,serif;pointer-events:none; }
        .tcard:hover { border-color:var(--border-hi);transform:translateY(-2px); }
        .tcard-stars { color:var(--gold);font-size:0.72rem;letter-spacing:2px;margin-bottom:14px; }
        .tcard-quote { font-size:0.84rem;color:var(--muted2);line-height:1.75;font-weight:300;margin-bottom:22px;font-style:italic; }
        .tcard-author { display:flex;align-items:center;gap:12px; }
        .tcard-av { width:36px;height:36px;border-radius:50%;background:var(--gold-lo);border:1px solid var(--border-hi);display:flex;align-items:center;justify-content:center;font-family:'Syne',sans-serif;font-size:0.6rem;font-weight:700;color:var(--gold);flex-shrink:0; }
        .tcard-name { font-size:0.82rem;font-weight:600;color:var(--white); }
        .tcard-meta { font-size:0.68rem;color:var(--muted);margin-top:2px; }

        /* PRICING */
        .pricing-section { padding:100px 40px;background:var(--surface);border-top:1px solid var(--border);border-bottom:1px solid var(--border);text-align:center; }
        .pricing-inner { max-width:820px;margin:0 auto; }
        .trial-tag { display:inline-flex;align-items:center;gap:8px;background:rgba(34,197,94,0.08);border:1px solid rgba(34,197,94,0.22);color:var(--green);font-size:0.65rem;font-weight:600;letter-spacing:1.5px;text-transform:uppercase;padding:6px 18px;border-radius:100px;margin-bottom:40px; }
        .plans { display:grid;grid-template-columns:repeat(auto-fit,minmax(300px,1fr));gap:16px; }
        .plan { background:var(--surface2);border:1px solid var(--border);border-radius:20px;padding:36px 30px;text-align:left;position:relative;overflow:hidden;transition:border-color 0.3s; }
        .plan:hover { border-color:var(--border-hi); }
        .plan.pro { border-color:rgba(212,168,67,0.3);background:linear-gradient(148deg,rgba(212,168,67,0.07),var(--surface2) 52%); }
        .plan.pro::before { content:'';position:absolute;top:0;left:0;right:0;height:2px;background:linear-gradient(90deg,transparent,var(--gold),transparent); }
        .plan-label { position:absolute;top:18px;right:18px;background:var(--gold);color:#000;font-family:'Syne',sans-serif;font-size:0.56rem;font-weight:700;letter-spacing:1.5px;text-transform:uppercase;padding:4px 12px;border-radius:100px; }
        .plan-tier { font-size:0.6rem;font-weight:600;letter-spacing:3px;text-transform:uppercase;color:var(--muted);margin-bottom:20px; }
        .plan-price { display:flex;align-items:flex-start;gap:2px;margin-bottom:4px; }
        .plan-price .cur { font-size:1.4rem;color:var(--muted2);margin-top:8px;font-weight:500; }
        .plan-price .amt { font-family:'Syne',sans-serif;font-size:3.8rem;font-weight:800;line-height:1;color:var(--white);letter-spacing:-2px; }
        .plan-price .dec { font-size:1.8rem;color:var(--muted2);margin-top:14px;font-weight:400; }
        .plan-per { font-size:0.75rem;color:var(--muted);margin-bottom:20px;font-weight:300; }
        .plan-tagline { font-size:0.82rem;color:var(--muted2);line-height:1.65;margin-bottom:22px;padding-bottom:22px;border-bottom:1px solid var(--border);font-weight:300; }
        .plan-feats { list-style:none;display:flex;flex-direction:column;gap:9px;margin-bottom:28px; }
        .plan-feats li { display:flex;align-items:flex-start;gap:9px;font-size:0.8rem;color:var(--muted2);font-weight:300; }
        .plan-feats li .ck { color:var(--green);font-weight:700;flex-shrink:0;margin-top:1px; }
        .plan-feats li.dim .ck { color:var(--muted);font-size:0.7rem; }
        .plan-feats li.dim { color:var(--muted); }
        .pbtn { display:block;width:100%;font-family:'Syne',sans-serif;font-size:0.82rem;font-weight:700;padding:13px;border-radius:10px;text-align:center;text-decoration:none;transition:all 0.25s;letter-spacing:0.3px;border:none;cursor:pointer; }
        .pbtn.gold { background:var(--gold);color:#000;box-shadow:0 6px 20px rgba(212,168,67,0.2); }
        .pbtn.gold:hover { background:var(--gold-hi);transform:translateY(-1px);box-shadow:0 10px 30px rgba(212,168,67,0.3); }
        .pbtn.outline { border:1px solid var(--border-hi);color:var(--white);background:transparent; }
        .pbtn.outline:hover { border-color:var(--gold);color:var(--gold);background:var(--gold-lo); }
        .pricing-note { font-size:0.72rem;color:rgba(90,110,90,0.45);margin-top:20px; }

        /* LOGIN */
        .login-section { padding:120px 40px;text-align:center;position:relative;overflow:hidden; }
        .login-glow { position:absolute;width:700px;height:400px;border-radius:50%;background:radial-gradient(ellipse,rgba(212,168,67,0.07),transparent 65%);bottom:-100px;left:50%;transform:translateX(-50%);pointer-events:none; }
        .login-h { font-family:'Syne',sans-serif;font-size:clamp(2.5rem,6vw,5rem);font-weight:800;letter-spacing:-2px;line-height:1.02;margin-bottom:16px;color:var(--white); }
        .login-h span { color:var(--gold); }
        .login-p { font-size:0.96rem;color:var(--muted2);max-width:380px;margin:0 auto 48px;line-height:1.8;font-weight:300; }
        .login-card { background:var(--surface);border:1px solid var(--border-hi);border-radius:22px;padding:44px 40px;max-width:400px;margin:0 auto;position:relative;z-index:1;box-shadow:0 40px 80px rgba(0,0,0,0.5); }
        .login-card::before { content:'';position:absolute;top:0;left:0;right:0;height:1.5px;background:linear-gradient(90deg,transparent,var(--gold),transparent);border-radius:22px 22px 0 0; }
        .lc-label { font-size:0.58rem;font-weight:600;letter-spacing:3px;text-transform:uppercase;color:var(--muted);margin-bottom:24px; }
        .g-btn { display:flex;align-items:center;justify-content:center;gap:11px;width:100%;background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.1);color:var(--white);padding:14px 22px;border-radius:10px;font-family:'Inter',sans-serif;font-size:0.86rem;font-weight:500;text-decoration:none;transition:all 0.25s;cursor:pointer; }
        .g-btn:hover { background:rgba(255,255,255,0.07);border-color:rgba(255,255,255,0.18);transform:translateY(-1px); }
        .lc-note { font-size:0.72rem;color:rgba(90,110,90,0.4);margin-top:18px;line-height:1.7; }

        /* MODAL */
        .modal-overlay { position:fixed;inset:0;z-index:1000;background:rgba(8,11,8,0.88);backdrop-filter:blur(12px);display:flex;align-items:center;justify-content:center;opacity:0;pointer-events:none;transition:opacity 0.3s;padding:20px; }
        .modal-overlay.open { opacity:1;pointer-events:all; }
        .modal { background:var(--surface);border:1px solid var(--border-hi);border-radius:24px;padding:48px 40px;max-width:380px;width:100%;position:relative;transform:translateY(20px);transition:transform 0.3s;box-shadow:0 40px 100px rgba(0,0,0,0.7); }
        .modal::before { content:'';position:absolute;top:0;left:0;right:0;height:1.5px;background:linear-gradient(90deg,transparent,var(--gold),transparent);border-radius:24px 24px 0 0; }
        .modal-overlay.open .modal { transform:translateY(0); }
        .modal-close { position:absolute;top:16px;right:18px;font-size:1.2rem;color:var(--muted);background:none;border:none;cursor:pointer;line-height:1;padding:4px 8px;transition:color 0.2s; }
        .modal-close:hover { color:var(--white); }
        .modal-logo { font-family:'Syne',sans-serif;font-size:1.3rem;font-weight:800;letter-spacing:3px;background:linear-gradient(135deg,var(--gold-hi),var(--gold));-webkit-background-clip:text;-webkit-text-fill-color:transparent;background-clip:text;text-align:center;margin-bottom:8px; }
        .modal-tagline { text-align:center;font-size:0.78rem;color:var(--muted2);margin-bottom:28px;line-height:1.6; }
        .modal-trial { display:flex;align-items:center;justify-content:center;gap:8px;background:rgba(34,197,94,0.07);border:1px solid rgba(34,197,94,0.2);border-radius:8px;padding:10px;font-size:0.72rem;color:var(--green);font-weight:500;margin-bottom:20px; }
        .modal-note { font-size:0.68rem;color:rgba(90,110,90,0.45);text-align:center;margin-top:16px;line-height:1.7; }

        /* FOOTER */
        footer { border-top:1px solid var(--border);padding:30px 40px;display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:14px; }
        .f-logo { font-family:'Syne',sans-serif;font-size:1rem;font-weight:800;letter-spacing:3px;background:linear-gradient(135deg,var(--gold-hi),var(--gold));-webkit-background-clip:text;-webkit-text-fill-color:transparent;background-clip:text; }
        .f-links { display:flex;gap:24px;flex-wrap:wrap; }
        .f-links a { font-size:0.72rem;color:var(--muted);text-decoration:none;transition:color 0.2s; }
        .f-links a:hover { color:var(--gold); }
        .f-copy { font-size:0.66rem;color:rgba(90,110,90,0.3); }

        /* ANIMATIONS */
        @keyframes fadeSlide { from{opacity:0;transform:translateY(20px)} to{opacity:1;transform:translateY(0)} }
        .rv { opacity:0;transform:translateY(22px);transition:opacity 0.7s ease,transform 0.7s ease; }
        .rv.in { opacity:1;transform:none; }
        .rv.d1 { transition-delay:0.06s; } .rv.d2 { transition-delay:0.12s; } .rv.d3 { transition-delay:0.18s; }

        /* RESPONSIVE */
        @media(max-width:900px) {
          .bcard.c4,.bcard.c5,.bcard.c7 { grid-column:span 12; }
          .problems-inner { grid-template-columns:1fr;gap:48px; }
          nav { padding:0 20px; }
          .nav-links { display:none; }
          .bento-section,.compare-section { padding:80px 20px; }
          .login-section { padding:80px 20px; }
          .problems-strip,.stats-bar,.testi-section { padding:80px 20px; }
          footer { flex-direction:column;text-align:center;padding:28px 20px; }
          .stat-div { display:none; }
        }
      `}</style>

      {/* ── NAV ── */}
      <nav className={navStuck ? 'stuck' : ''}>
        <a href="#" className="logo">PKR</a>
        <div className="nav-links">
          <a href="#features">Features</a>
          <a href="#compare">Compare</a>
          <a href="#pricing">Pricing</a>
        </div>
        <button className="nav-cta" onClick={() => setModalOpen(true)}>Sign In Free</button>
      </nav>

      {/* ── HERO ── */}
      <section className="hero">
        <div className="mesh-bg">
          <div className="mesh-orb a" />
          <div className="mesh-orb b" />
          <div className="mesh-orb c" />
          <div className="grid-lines" />
        </div>
        <div style={{ position: 'relative', zIndex: 2, display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
          <div className="hero-eyebrow">
            <div className="eyebrow-dot" />
            Home poker management
          </div>
          <h1 aria-label="PKR home poker game management app">
            <span className="line1">Run the table.</span>
            <span className="line2">Own the night.</span>
          </h1>
          <p className="hero-sub">The home poker game management app your crew actually needs. Track every buy-in, settle every debt, and finally prove who the best player is — all from one screen.</p>
          <div className="hero-actions">
            <button className="btn-main" onClick={() => setModalOpen(true)}>Start Free — 5 Days</button>
            <a href="#features" className="btn-ghost">See how it works</a>
          </div>

          {/* Phone mockup */}
          <div className="hero-phone-wrap">
            <div className="phone-glow" />
            <div className="phone">
              <div className="phone-notch" />
              <div className="phone-screen">
                <div className="ps-header">
                  <div className="ps-title">Friday Night Poker</div>
                  <div className="ps-live"><div className="ps-live-dot" />LIVE</div>
                </div>
                <div className="ps-table">
                  <div className="ps-label">Friday Night<br /><span style={{ fontSize: '0.36rem', letterSpacing: '1px' }}>5 ACTIVE · 1 CASHED</span></div>
                  <div className="ps-seat" style={{ top: '6%', left: '50%', transform: 'translateX(-50%)' }}><div className="ps-chip g">MC</div><div className="ps-n">Marcus</div><div className="ps-v p">+$485</div></div>
                  <div className="ps-seat" style={{ top: '26%', left: '4%', transform: 'translateY(-50%)' }}><div className="ps-chip g">LC</div><div className="ps-n">Luca</div><div className="ps-v n">−$75</div></div>
                  <div className="ps-seat" style={{ top: '68%', left: '4%', transform: 'translateY(-50%)' }}><div className="ps-chip g">TQ</div><div className="ps-n">Tariq</div><div className="ps-v n">−$125</div></div>
                  <div className="ps-seat" style={{ bottom: '6%', left: '50%', transform: 'translateX(-50%)' }}><div className="ps-chip e">NC</div><div className="ps-n">Nico</div><div className="ps-v n">−$225</div></div>
                  <div className="ps-seat" style={{ top: '68%', right: '4%', transform: 'translateY(-50%)' }}><div className="ps-chip g">SO</div><div className="ps-n">Soren</div><div className="ps-v p">+$350</div></div>
                  <div className="ps-seat" style={{ top: '26%', right: '4%', transform: 'translateY(-50%)' }}><div className="ps-chip g">FX</div><div className="ps-n">Felix</div><div className="ps-v p">+$635</div></div>
                </div>
                <div className="ps-row">
                  <div className="ps-stat"><div className="ps-stat-l">Total In</div><div className="ps-stat-v">$3,200</div></div>
                  <div className="ps-stat"><div className="ps-stat-l">Bank</div><div className="ps-stat-v g">$1,450</div></div>
                  <div className="ps-stat"><div className="ps-stat-l">Players</div><div className="ps-stat-v">6</div></div>
                </div>
                <div className="ps-notif">
                  <div className="ps-notif-icon">🔔</div>
                  <div><div className="ps-notif-title">Buy-in recorded — $100</div><div className="ps-notif-sub">Luca · Total in: $200</div></div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ── TICKER ── */}
      <div className="ticker-wrap">
        <div className="ticker">
          {[
            { suit: '♠', name: 'Marcus', val: '+$1,240', p: true },
            { suit: '♥', name: 'Felix', val: '+$890', p: true },
            { suit: '♦', name: 'Tariq', val: '−$340', p: false },
            { suit: '♣', name: 'Luca', val: '−$125', p: false },
            { suit: '♠', name: 'Soren', val: '+$640', p: true },
            { suit: '♥', name: 'Nico', val: '−$780', p: false },
            { suit: '♦', name: 'Dante', val: '+$290', p: true },
            { suit: '♣', name: 'Ezra', val: '−$215', p: false },
            { suit: '♠', name: 'Otto', val: '+$480', p: true },
            { suit: '♥', name: 'Cleo', val: '−$560', p: false },
          ].concat([
            { suit: '♠', name: 'Marcus', val: '+$1,240', p: true },
            { suit: '♥', name: 'Felix', val: '+$890', p: true },
            { suit: '♦', name: 'Tariq', val: '−$340', p: false },
            { suit: '♣', name: 'Luca', val: '−$125', p: false },
            { suit: '♠', name: 'Soren', val: '+$640', p: true },
            { suit: '♥', name: 'Nico', val: '−$780', p: false },
            { suit: '♦', name: 'Dante', val: '+$290', p: true },
            { suit: '♣', name: 'Ezra', val: '−$215', p: false },
            { suit: '♠', name: 'Otto', val: '+$480', p: true },
            { suit: '♥', name: 'Cleo', val: '−$560', p: false },
          ]).map((t, i) => (
            <div key={i} className="ticker-item">
              <span className="suit">{t.suit}</span>
              <span className="name">{t.name}</span>
              <span className={`val ${t.p ? 'p' : 'n'}`}>{t.val}</span>
            </div>
          ))}
        </div>
      </div>

      {/* ── STATS BAR ── */}
      <section className="stats-bar" aria-label="Social proof statistics">
        <div className="stats-inner">
          {[
            { num: '1,200+', lbl: 'Home games tracked' },
            { num: '$2.4M', lbl: 'Settlements processed' },
            { num: '8,900+', lbl: 'Players onboarded' },
            { num: '4.9 ★', lbl: 'Average host rating' },
          ].map((s, i) => (
            <>
              {i > 0 && <div key={`d${i}`} className="stat-div" />}
              <div key={s.num} className={`stat-item rv ${i > 0 ? `d${i}` : ''}`}>
                <div className="stat-num">{s.num}</div>
                <div className="stat-lbl">{s.lbl}</div>
              </div>
            </>
          ))}
        </div>
      </section>

      {/* ── BENTO FEATURES ── */}
      <section className="bento-section" id="features">
        <div className="section-header">
          <div className="s-tag rv">What PKR does</div>
          <h2 className="s-h2 rv">Built for the <em>table.</em><br />Not the boardroom.</h2>
          <p className="s-sub rv">Every feature designed around game night. Not adapted from some generic SaaS template.</p>
        </div>
        <div className="bento">
          <div className="bcard c7 r2 accent-gold rv">
            <div className="bc-icon">🃏</div>
            <div className="bc-title">Live Visual Table</div>
            <div className="bc-desc">A real poker table layout showing all seats, every player&apos;s running balance, and buy-in status — updated in real time. Up to 15 seats. Tap any player to manage them instantly.</div>
            <div className="bc-tag">Host View</div>
            <div style={{ marginTop: '20px', position: 'relative', width: '100%', paddingBottom: '46%', background: 'radial-gradient(ellipse at 50% 38%,#1d6828,#134d1e 50%,#0b3212)', borderRadius: '60px', border: '5px solid #2d1504', boxShadow: 'inset 0 4px 14px rgba(0,0,0,0.5)', overflow: 'hidden' }}>
              {[
                { initials: 'MC', name: 'Marcus', val: '+$485', p: true, style: { top: '8%', left: '50%', transform: 'translateX(-50%)' } },
                { initials: 'LC', name: 'Luca', val: '−$75', p: false, style: { top: '50%', left: '4%', transform: 'translateY(-50%)' } },
                { initials: 'FX', name: 'Felix', val: '+$635', p: true, style: { top: '50%', right: '4%', transform: 'translateY(-50%)' } },
                { initials: 'NC', name: 'Nico', val: '−$225', p: false, style: { bottom: '8%', left: '50%', transform: 'translateX(-50%)' } },
              ].map(s => (
                <div key={s.initials} style={{ position: 'absolute', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '2px', ...s.style }}>
                  <div style={{ width: '26px', height: '26px', borderRadius: '50%', background: 'linear-gradient(135deg,#1b3d1b,#0d2010)', border: '1.5px solid rgba(212,168,67,0.7)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '0.42rem', fontWeight: '700', color: '#f8f6f0' }}>{s.initials}</div>
                  <div style={{ fontSize: '0.34rem', color: s.p ? '#22c55e' : '#ef4444', fontWeight: '700', textAlign: 'center' }}>{s.val}</div>
                </div>
              ))}
              <div style={{ position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%,-50%)', textAlign: 'center', fontFamily: 'Syne,sans-serif', fontSize: '0.34rem', color: 'rgba(248,246,240,0.22)', letterSpacing: '2px', textTransform: 'uppercase' }}>LIVE TABLE</div>
            </div>
          </div>

          <div className="bcard c5 r2 rv d1">
            <div className="bc-icon">🏆</div>
            <div className="bc-title">All-Time Leaderboard</div>
            <div className="bc-desc">Every settled game feeds a persistent ranking. Total net, games played, biggest wins. Finally settle the debate.</div>
            <div className="lb-rows">
              {[['MC', 'Marcus', '+$1,240', true, true], ['FX', 'Felix', '+$890', true, true], ['SO', 'Soren', '+$640', false, true], ['TQ', 'Tariq', '−$340', false, false]].map(([av, name, val, gold, pos], i) => (
                <div key={String(name)} className="lb-row">
                  <div className={`lb-rank ${gold ? 'top' : ''}`}>{i + 1}</div>
                  <div className={`lb-av ${gold ? 'a' : 'b'}`}>{av}</div>
                  <div className="lb-name">{name}</div>
                  <div className={`lb-val ${pos ? 'p' : 'n'}`}>{val}</div>
                </div>
              ))}
            </div>
            <div className="bc-tag">Group Stats</div>
          </div>

          <div className="bcard c4 accent-green rv d1">
            <div className="bc-icon">📲</div>
            <div className="bc-title">Push Per Buy-In</div>
            <div className="bc-desc">Every player gets an instant notification when they buy in or cash out. Exact amounts. On their lock screen.</div>
            <div className="notif-stack">
              <div className="notif-card active"><div className="ni">🔔</div><div><div className="nt">Buy-in — $100</div><div className="nb">Luca · Now</div></div></div>
              <div className="notif-card"><div className="ni">💰</div><div><div className="nt">Cashout — $840</div><div className="nb">Marcus · 11:42 PM</div></div></div>
            </div>
            <div className="bc-tag">Player View</div>
          </div>

          <div className="bcard c4 rv d2">
            <div className="bc-icon">💸</div>
            <div className="bc-title">Smart Settlement</div>
            <div className="bc-desc">Minimum transfers to clear all debts. 8 players → 3 payments. Done.</div>
            <div className="settle-rows">
              {[['TQ', 'Tariq', 'MC', 'Marcus', '$340'], ['NC', 'Nico', 'FX', 'Felix', '$225'], ['LC', 'Luca', 'SO', 'Soren', '$75']].map(([a1, n1, a2, n2, amt]) => (
                <div key={amt + n1} className="settle-row"><div className="s-chip">{a1}</div><span>{n1}</span><div className="s-arrow">→</div><div className="s-chip">{a2}</div><span>{n2}</span><div className="s-amt">{amt}</div></div>
              ))}
            </div>
            <div className="bc-tag">End of Game</div>
          </div>

          <div className="bcard c4 rv d3">
            <div className="bc-icon">👁️</div>
            <div className="bc-title">Live Spectator View</div>
            <div className="bc-desc">Scan the table QR and watch live from any phone. Real-time. Read-only. No install needed.</div>
            <div className="bc-tag">Spectators</div>
          </div>

          <div className="bcard c4 rv"><div className="bc-icon">📶</div><div className="bc-title">Offline Mode</div><div className="bc-desc">Host&apos;s internet cuts out? Actions queue locally and sync silently when connection returns.</div><div className="bc-tag">Resilience</div></div>
          <div className="bcard c4 rv d1"><div className="bc-icon">📷</div><div className="bc-title">QR Invites</div><div className="bc-desc">One scan from any camera adds a player to your group. No app store. Under 30 seconds.</div><div className="bc-tag">Onboarding</div></div>
          <div className="bcard c4 rv d2"><div className="bc-icon">📤</div><div className="bc-title">WhatsApp Results</div><div className="bc-desc">Full results pre-written — standings, settlements — opened in WhatsApp in one tap, ready to send.</div><div className="bc-tag">Post-game</div></div>
        </div>
      </section>

      {/* ── PROBLEM STRIP ── */}
      <section className="problems-strip">
        <div className="problems-inner">
          <div>
            <div className="s-tag rv">The status quo</div>
            <h2 className="s-h2 rv" style={{ textAlign: 'left' }}>Your crew deserves<br />better than <em>this</em></h2>
            <p className="s-sub rv" style={{ margin: 0 }}>Forty games in and you&apos;re still managing it the same way. Here&apos;s what that actually costs you.</p>
          </div>
          <div className="prob-list">
            {[
              ['01', 'The WhatsApp thread nobody reads', "Buy-ins buried in group chat. Someone always misses a message. Settlement argument runs for three days. The same fight, every time."],
              ['02', 'The spreadsheet nobody trusts', "One person tracks it while playing. Input errors happen. The person tracking it always seems to win. Nobody believes the final number."],
              ['03', 'Zero history, zero bragging rights', "100 games together and you can't prove who the best player actually is. No record. No leaderboard. The legend lives only in memory."],
              ['04', 'Settlements that drag on for days', "8 players, 28 possible debts. The wrong person gets paid first. Someone short-pays. Somebody just doesn't pay. It erodes the group."],
            ].map(([num, title, desc], i) => (
              <div key={num} className={`prob-item rv ${i > 0 ? `d${Math.min(i, 3)}` : ''}`}>
                <div className="prob-num">{num}</div>
                <div><div className="prob-title">{title}</div><div className="prob-desc">{desc}</div></div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── COMPARE ── */}
      <section className="compare-section" id="compare">
        <div className="section-header">
          <div className="s-tag rv">vs Everything else</div>
          <h2 className="s-h2 rv">The only app <em>built</em><br />for home games</h2>
          <p className="s-sub rv">Not adapted. Not repurposed. Built from the ground up for exactly this.</p>
        </div>
        <div className="ctable-wrap rv">
          <table className="ct">
            <thead><tr><th style={{ width: '33%' }}>Feature</th><th className="pkr">PKR ♠</th><th>PokerNow</th><th>Chipco</th><th>Spreadsheet</th></tr></thead>
            <tbody>
              {[
                ['Live visual table', '✓', '✗', 'Partial', '✗'],
                ['Push notifications per buy-in', '✓', '✗', '✗', '✗'],
                ['Variable buy-in amounts', '✓', '✗', '✓', '✓'],
                ['Minimum transfer settlement', '✓', '✓', '✓', '✗'],
                ['Persistent leaderboard', '✓', '✗', '✗', 'Manual'],
                ['Live spectator view', '✓', '✗', '✗', '✗'],
                ['No app store required', '✓', '✓', '✗', '✓'],
                ['Offline mode', '✓', '✗', '✗', 'Manual'],
                ['WhatsApp group results', '✓', '✗', '✗', '✗'],
                ['Up to 15 seats', '✓', '10 max', '✓', '✓'],
              ].map(([feat, pkr, pn, ch, sp]) => (
                <tr key={feat}>
                  <td className="feat">{feat}</td>
                  <td className="pkr"><span className="y">{pkr}</span></td>
                  <td>{pn === '✓' ? <span className="y">✓</span> : pn === '✗' ? <span className="x">✗</span> : <span className="pt">{pn}</span>}</td>
                  <td>{ch === '✓' ? <span className="y">✓</span> : ch === '✗' ? <span className="x">✗</span> : <span className="pt">{ch}</span>}</td>
                  <td>{sp === '✓' ? <span className="y">✓</span> : sp === '✗' ? <span className="x">✗</span> : <span className="pt">{sp}</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* ── TESTIMONIALS ── */}
      <section className="testi-section" id="reviews">
        <div className="testi-inner">
          <div className="section-header">
            <div className="s-tag rv">What hosts say</div>
            <h2 className="s-h2 rv">Real groups. Real <em>games.</em></h2>
          </div>
          <div className="testi-grid">
            {[
              { av: 'BW', name: 'Ben W.', meta: 'Hosts weekly · Melbourne', quote: "We'd been using a shared notes app for three years. Switched to PKR and our post-game WhatsApp thread went from 40 messages of arguing to one screenshot. Done." },
              { av: 'SL', name: 'Sam L.', meta: '12-player group · Sydney', quote: "The live spectator view is genius. My mates who couldn't make it watched the whole session from their phones. They were more invested than half the people at the table." },
              { av: 'RM', name: 'Ryan M.', meta: 'Bi-weekly game · Brisbane', quote: "I used to dread end-of-night settlements. Eight blokes, nobody agrees on who owes what. PKR gives you exactly three payments to make. Argument over before it starts." },
              { av: 'AK', name: 'Alex K.', meta: 'Monthly tournament · Perth', quote: "The leaderboard is what got everyone hooked. Now people actually care about their rank across the season. It turned a casual cash game into something everyone takes seriously." },
              { av: 'JT', name: 'Jake T.', meta: 'New group · Adelaide', quote: "Setup took literally five minutes. The push notifications when you buy in feel very professional — like you're playing at a real casino night." },
              { av: 'CG', name: 'Chris G.', meta: '10-player group · Gold Coast', quote: "We had the internet cut out mid-game and it kept working perfectly. Synced everything back when the router restarted. Didn't miss a single buy-in." },
            ].map((t, i) => (
              <div key={t.av} className={`tcard rv ${i % 3 !== 0 ? `d${(i % 3)}` : ''}`}>
                <div className="tcard-stars">★★★★★</div>
                <p className="tcard-quote">&ldquo;{t.quote}&rdquo;</p>
                <div className="tcard-author">
                  <div className="tcard-av">{t.av}</div>
                  <div><div className="tcard-name">{t.name}</div><div className="tcard-meta">{t.meta}</div></div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── PRICING ── */}
      <section className="pricing-section" id="pricing">
        <div className="pricing-inner">
          <div className="s-tag rv" style={{ display: 'block', marginBottom: '14px' }}>Pricing</div>
          <h2 className="s-h2 rv">One host pays.<br /><em>Everyone plays.</em></h2>
          <p className="s-sub rv" style={{ margin: '0 auto 32px' }}>No per-player fees. No per-game charges. Subscribe once and run unlimited games for your whole crew.</p>
          <div className="trial-tag rv">
            <svg width="8" height="8" viewBox="0 0 8 8"><circle cx="4" cy="4" r="4" fill="#22c55e" /></svg>
            5-day free trial — no credit card needed
          </div>
          <div className="plans">
            <div className="plan rv">
              <div className="plan-tier">Starter</div>
              <div className="plan-price"><span className="cur">$</span><span className="amt">9</span><span className="dec">.99</span></div>
              <div className="plan-per">per month · cancel anytime</div>
              <div className="plan-tagline">For casual groups who play occasionally. Every core feature included.</div>
              <ul className="plan-feats">
                {['1 active group', 'Up to 9 seats per game', 'Full leaderboard & history', 'Push notifications', 'Spectator view & QR invites', 'WhatsApp share & offline mode'].map(f => <li key={f}><span className="ck">✓</span>{f}</li>)}
                <li className="dim"><span className="ck">○</span>Multiple groups</li>
                <li className="dim"><span className="ck">○</span>10–15 seat games</li>
              </ul>
              <button className="pbtn outline" onClick={() => setModalOpen(true)}>Start Free Trial</button>
            </div>
            <div className="plan pro rv d1">
              <div className="plan-label">Most Popular</div>
              <div className="plan-tier">Pro</div>
              <div className="plan-price"><span className="cur">$</span><span className="amt">19</span><span className="dec">.99</span></div>
              <div className="plan-per">per month · cancel anytime</div>
              <div className="plan-tagline">For groups who play weekly or run multiple tables. Bigger games, unlimited groups.</div>
              <ul className="plan-feats">
                {['Unlimited groups', 'Up to 15 seats per game', 'Full leaderboard & history', 'Push notifications', 'Spectator view & QR invites', 'WhatsApp share & offline mode', 'Priority support', 'Early access to new features'].map(f => <li key={f}><span className="ck">✓</span>{f}</li>)}
              </ul>
              <button className="pbtn gold" onClick={() => setModalOpen(true)}>Start Free Trial</button>
            </div>
          </div>
          <p className="pricing-note rv">5-day free trial · No credit card required · Cancel anytime · Your data is always yours</p>
        </div>
      </section>

      {/* ── LOGIN ── */}
      <section className="login-section" id="login">
        <div className="login-glow" />
        <h2 className="login-h rv">Your next home poker game<br />deserves <span>better.</span></h2>
        <p className="login-p rv">Set up your home poker group in five minutes. No credit card. No installs for your players. Just a better game night, starting now.</p>
        <div className="login-card rv">
          <div className="lc-label">Host Sign In</div>
          <button className="g-btn" onClick={() => signIn('google', { callbackUrl: '/dashboard' })}>
            <GoogleIcon />
            Continue with Google
          </button>
          <p className="lc-note">Hosts sign in to manage tables.<br />Players join via invite link — no account needed.</p>
        </div>
      </section>

      {/* ── FOOTER ── */}
      <footer>
        <div className="f-logo">PKR</div>
        <div className="f-links">
          <a href="#features">Features</a>
          <a href="#compare">Compare</a>
          <a href="#pricing">Pricing</a>
          <a href="mailto:hello@mypkr.app">Contact</a>
        </div>
        <div className="f-copy">© 2025 PKR · Built for home game players</div>
      </footer>

      {/* ── SIGN IN MODAL ── */}
      <div
        className={`modal-overlay ${modalOpen ? 'open' : ''}`}
        role="dialog"
        aria-modal="true"
        aria-label="Sign in to PKR"
        onClick={e => { if (e.target === e.currentTarget) setModalOpen(false) }}
      >
        <div className="modal">
          <button className="modal-close" onClick={() => setModalOpen(false)} aria-label="Close">✕</button>
          <div className="modal-logo">PKR</div>
          <p className="modal-tagline">Home poker management for your crew.<br />Set up in under 5 minutes.</p>
          <div className="modal-trial">
            <svg width="8" height="8" viewBox="0 0 8 8"><circle cx="4" cy="4" r="4" fill="#22c55e" /></svg>
            5-day free trial · No credit card needed
          </div>
          <button className="g-btn" onClick={() => signIn('google', { callbackUrl: '/dashboard' })}>
            <GoogleIcon />
            Continue with Google
          </button>
          <p className="modal-note">For game hosts only. Players join via invite link<br />— no account or install needed.</p>
        </div>
      </div>
    </>
  )
}