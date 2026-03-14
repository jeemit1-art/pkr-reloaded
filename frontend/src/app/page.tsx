'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'

export default function HomePage() {
  const router = useRouter()
  const [modalOpen, setModalOpen] = useState(false)
  const [navStuck, setNavStuck] = useState(false)

  // Redirect logged-in users straight to dashboard (JWT-based)
  useEffect(() => {
    const token = typeof window !== 'undefined' ? localStorage.getItem('pkr_token') : null
    if (token) router.push('/dashboard')
  }, [router])

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

  const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8787'

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
          <button className="g-btn" onClick={() => { window.location.href = `${apiUrl}/auth/google` }}>
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
          <button className="g-btn" onClick={() => { window.location.href = `${apiUrl}/auth/google` }}>
            <GoogleIcon />
            Continue with Google
          </button>
          <p className="modal-note">For game hosts only. Players join via invite link<br />— no account or install needed.</p>
        </div>
      </div>
    </>
  )
}// force rebuild Sat Mar 14 13:17:35 UTC 2026
