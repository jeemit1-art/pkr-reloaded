'use client';

import {useEffect, useState} from 'react';
import {useRouter} from 'next/navigation';
import {ProductTour,MobileProductShowcase} from '@/components/ProductShowcase';

const steps = [
  {number:'01',symbol:'♠',title:'Create your private room',detail:'Keep your regular players, hosts and upcoming games together.'},
  {number:'02',symbol:'↗',title:'Send the invites',detail:'Share personal WhatsApp links and approve who joins the room.'},
  {number:'03',symbol:'◷',title:'Get everyone seated',detail:'See RSVPs, arrival times and seat choices before the first hand.'},
  {number:'04',symbol:'♛',title:'Play. Track. Settle.',detail:'Manage the table, run tournament blinds and record final results.'},
];

const faqs = [
  {q:'What is PKR?',a:'PKR is a browser-based home poker game management app. It helps private groups plan games, record buy-ins and cash-outs, run tournament blinds, track player results and work out who owes whom.'},
  {q:'How do I track buy-ins and rebuys during a home poker game?',a:'Create a private room, open a game and record each player’s buy-ins or rebuys as they happen. When play ends, record cash-outs and review the results and settlement.'},
  {q:'Can I run a poker tournament with blind levels?',a:'Yes. PKR supports tournament games with blind-level structures and a host-controlled tournament flow. You can plan longer games using additional blind stages.'},
  {q:'Does every player need a paid subscription?',a:'No. Only the host needs the relevant hosting plan. Invited players can join their host’s private room without purchasing a hosting subscription.'},
  {q:'Can PKR calculate who owes whom after poker night?',a:'Yes. PKR records the results and produces a settlement record so the group can review who needs to pay whom. The players arrange transfers themselves outside PKR.'},
  {q:'Does PKR handle gambling or transfer money between players?',a:'No. PKR is a management and record-keeping tool for privately arranged games. It does not offer online real-money poker, take wagers, hold players’ funds or transfer settlement money.'},
  {q:'Can I use PKR on my iPhone, Android phone or computer?',a:'Yes. PKR runs in compatible web browsers on phones, tablets and computers. You can also add the web app to your phone’s home screen where supported; PKR is not an App Store or Google Play download.'},
  {q:'What does PKR cost?',a:'Host subscriptions are listed in Australian dollars: Starter is AUD $9.99 per month for one group with up to nine seats, and Pro is AUD $19.99 per month for multiple groups with up to fifteen seats. Check the final Stripe checkout before paying.'},
];

const structuredData = {
  '@context':'https://schema.org',
  '@graph':[
    {'@type':'WebSite','@id':'https://mypkr.app/#website',url:'https://mypkr.app/',name:'PKR',inLanguage:'en-AU',description:'Private home poker game tracker and tournament management software.'},
    {'@type':'WebApplication','@id':'https://mypkr.app/#application',name:'PKR',url:'https://mypkr.app/',applicationCategory:'GameApplication',operatingSystem:'Web browser',description:'Manage private home poker rooms, record buy-ins and cash-outs, track tournament blind levels, see player results and review settlements.',image:'https://mypkr.app/og-image.png',offers:[
      {'@type':'Offer',name:'PKR Starter host plan',price:'9.99',priceCurrency:'AUD',url:'https://mypkr.app/pricing',priceSpecification:{'@type':'UnitPriceSpecification',price:'9.99',priceCurrency:'AUD',billingDuration:'P1M'}},
      {'@type':'Offer',name:'PKR Pro host plan',price:'19.99',priceCurrency:'AUD',url:'https://mypkr.app/pricing',priceSpecification:{'@type':'UnitPriceSpecification',price:'19.99',priceCurrency:'AUD',billingDuration:'P1M'}}
    ]},
    {'@type':'FAQPage','@id':'https://mypkr.app/#faq',mainEntity:faqs.map(item=>({'@type':'Question',name:item.q,acceptedAnswer:{'@type':'Answer',text:item.a}}))}
  ]
};


export default function HomePage() {
  const router = useRouter();
  const [loginOpen,setLoginOpen] = useState(false);
  const [selectedPlan,setSelectedPlan] = useState<'starter'|'pro'|null>(null);
  const [inviteLink,setInviteLink] = useState('');
  const [inviteError,setInviteError] = useState('');

  useEffect(() => {
    try {
      const wanted=new URLSearchParams(window.location.search).get('subscribe');
      const desired=wanted==='starter'||wanted==='pro'?wanted:null;
      if(desired){
        sessionStorage.setItem('pkr_host_plan_intent',desired);
        setSelectedPlan(desired);
      }
      if (localStorage.getItem('pkr_token')) {
        router.replace(desired?'/dashboard?subscribe='+desired:'/dashboard');
      }else if(desired){
        setLoginOpen(true);
      }
    } catch {
      // The public landing page must remain usable when storage is unavailable.
    }
  }, [router]);

  useEffect(() => {
    if (!loginOpen) return;
    const close = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setLoginOpen(false);
    };
    window.addEventListener('keydown', close);
    return () => window.removeEventListener('keydown', close);
  }, [loginOpen]);

  function joinWithLink() {
    setInviteError('');
    try {
      const parsed = new URL(inviteLink.trim(), window.location.origin);
      if (parsed.origin !== window.location.origin) throw new Error('Use a mypkr.app invitation link.');
      if (!/^\/(phone-invite|invite)\/[a-zA-Z0-9_-]+\/?$/.test(parsed.pathname)) {
        throw new Error('Paste the personal invitation link your host sent you.');
      }
      router.push(parsed.pathname);
    } catch (error) {
      setInviteError(error instanceof Error ? error.message : 'Invalid invitation link.');
    }
  }

  function choosePlan(plan:'starter'|'pro') {
    setSelectedPlan(plan);
    try { sessionStorage.setItem('pkr_host_plan_intent',plan); } catch {}
    try {
      if (localStorage.getItem('pkr_token')) {
        router.push('/dashboard?subscribe='+plan);
        return;
      }
    } catch {}
    setLoginOpen(true);
  }

  function hostSignIn() {
    window.location.assign((process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8787') + '/auth/google');
  }

  return (
    <div className="pkr-landing pkr-landing-v2">
      <header className="pkr-l2-topbar">
        <div className="pkr-l2-nav-inner">
          <a className="pkr-l2-brand" href="/" aria-label="PKR home"><span className="pkr-l2-brand-emblem" aria-hidden="true">♠</span><span>PKR<small>PRIVATE POKER CLUB</small></span></a>
          <nav className="pkr-l2-navlinks" aria-label="Landing page">
            <a href="#product-tour">See the app</a>
            <a href="#how-it-works">How it works</a>
            <a href="#pricing">Pricing</a><a href="#faq">FAQ</a>
          </nav>
          <div className="pkr-l2-header-actions">
            <a className="pkr-l2-player-link" href="/mobile-login">Player login</a>
            <button type="button" className="pkr-l2-btn pkr-l2-btn-outline" onClick={()=>setLoginOpen(true)}>Host sign in <span aria-hidden="true">↗</span></button>
          </div>
        </div>
      </header>

      <main>
        <section className="pkr-l2-hero" aria-labelledby="pkr-l2-main-heading">
          <div className="pkr-l2-hero-vignette" aria-hidden="true"/>
          <div className="pkr-l2-hero-inner">
            <div className="pkr-l2-hero-copy">
              <span className="pkr-l2-eyebrow"><i/> YOUR HOME GAME. FINALLY ORGANISED.</span>
              <h1 id="pkr-l2-main-heading">More poker.<br/><em>Less admin.</em></h1>
              <p>Run a smoother poker night from your first invite to the final payout. Players, buy-ins, tournaments, results and settlements — all in one place.</p>
              <div className="pkr-l2-hero-actions">
                <button type="button" className="pkr-l2-btn pkr-l2-btn-gold" onClick={()=>setLoginOpen(true)}>Start your poker club <span aria-hidden="true">↗</span></button>
                <a className="pkr-l2-btn pkr-l2-btn-glass" href="#product-tour">Explore the live app <span aria-hidden="true">↓</span></a>
              </div>
              <div className="pkr-l2-hero-trust"><span>♠ Private groups</span><span>♣ Live game tracking</span><span>♛ Clear settlements</span></div>
            </div>

            <div className="pkr-hero-real" aria-label="Real PKR desktop poker table and mobile Insights screens, with demo data">
              <div className="pkr-hero-desktop">
                <div className="pkr-hero-desktop-header"><span>PKR · THE LIVE TABLE</span><span>PKR APP INTERFACE</span></div>
                <img src="/demo/live-table.webp" alt="Actual PKR green felt oval poker table with host controls and eight player seats, sample data" width="1440" height="900" fetchPriority="high"/>
              </div>
              <div className="pkr-hero-mobile" aria-hidden="true">
                <img src="/demo/mobile-insights.webp" alt="" width="390" height="844" loading="eager"/>
              </div>
              <div className="pkr-hero-real-label"><i aria-hidden="true"/> PKR · REAL APP PREVIEW</div>
            </div>
          </div>
          <span className="pkr-l2-hero-annotation">HOME POKER TRACKING · CASH GAMES · TOURNAMENTS · SETTLEMENTS</span>
        </section>

        <section className="pkr-l2-ribbon" aria-label="What PKR brings together">
          <div><span className="pkr-l2-ribbon-icon">01</span><strong>Before the game</strong><small>Invites · RSVPs · Seats</small></div>
          <div><span className="pkr-l2-ribbon-icon">02</span><strong>During the game</strong><small>Buy-ins · Blinds · Players</small></div>
          <div><span className="pkr-l2-ribbon-icon">03</span><strong>After the game</strong><small>Results · Balances · History</small></div>
        </section>

        <ProductTour />

        <section id="features" className="pkr-l2-section pkr-l2-feature-intro">
          <div className="pkr-l2-intro-copy">
            <span className="pkr-l2-section-kicker">BUILT FOR THE PEOPLE WHO HOST</span>
            <h2>One place.<br/><em>Every poker night.</em></h2>
            <p>A good game should not end with missing buy-ins or an argument over payouts. Keep player records, arrivals, tournament blinds, results and settlement together.</p>
            <div className="pkr-l2-intro-highlights"><span><b>✓</b> Private room management</span><span><b>✓</b> Cash games and tournaments</span><span><b>✓</b> Full player history</span></div>
          </div>
          <div className="pkr-feature-photo-real">
            <img src="/demo/host-dashboard.webp" alt="Actual PKR host dashboard showing a private poker room, upcoming games, members and results using sample data" width="1225" height="845" loading="lazy" decoding="async"/>
            <span>THE PKR HOST DASHBOARD</span>
          </div>
        </section>

        <section className="pkr-l2-section pkr-l2-features">
          <div className="pkr-l2-section-heading">
            <span className="pkr-l2-section-kicker">A CLOSER LOOK AT THE PRODUCT</span>
            <h2>From first buy-in<br/><em>to final result.</em></h2>
            <p>Screens from PKR in action, captured using fictional players and results.</p>
          </div>
          <div className="pkr-l2-feature-grid">
            <article className="pkr-l2-feature-card">
              <div className="pkr-real-feature-image">
                <img src="/demo/rsvp-board.webp" alt="Real PKR RSVP screen with private room invitations and response choices" width="1225" height="845" loading="lazy" decoding="async"/>
                <span>PKR · RSVPS</span>
              </div>
              <div className="pkr-l2-feature-copy"><span>01 / BEFORE</span><h3>Know who&apos;s coming.</h3><p>Collect RSVPs and arrival times, offer available seats and stop chasing the group chat.</p></div>
            </article>
            <article className="pkr-l2-feature-card">
              <div className="pkr-real-feature-image">
                <img src="/demo/game-detail.webp" alt="Real PKR game details screen showing a scheduled game and Start Game controls" width="1225" height="845" loading="lazy" decoding="async"/>
                <span>PKR · GAME SETUP</span>
              </div>
              <div className="pkr-l2-feature-copy"><span>02 / DURING</span><h3>Run a better game.</h3><p>Keep buy-ins, player seating, blind levels and tournament progress together.</p></div>
            </article>
            <article className="pkr-l2-feature-card">
              <div className="pkr-real-feature-image">
                <img src="/demo/insights.webp" alt="Real PKR Insights screen showing demo game totals, player balances and settlement records" width="1225" height="845" loading="lazy" decoding="async"/>
                <span>PKR · INSIGHTS</span>
              </div>
              <div className="pkr-l2-feature-copy"><span>03 / AFTER</span><h3>Finish with clarity.</h3><p>Record cash-outs, review settlements and see every recorded player&apos;s results.</p></div>
            </article>
          </div>
        </section>

        <section id="how-it-works" className="pkr-l2-section pkr-l2-how">
          <div className="pkr-l2-section-heading">
            <span className="pkr-l2-section-kicker">SIMPLE FROM THE FIRST INVITE</span>
            <h2>From planning to payout.<br/><em>Four simple moves.</em></h2>
          </div>
          <div className="pkr-l2-steps">
            {steps.map(step=><article className="pkr-l2-step" key={step.number}>
              <div className="pkr-l2-step-top"><span>{step.symbol}</span><small>{step.number}</small></div>
              <h3>{step.title}</h3><p>{step.detail}</p>
            </article>)}
          </div>
        </section>

        <MobileProductShowcase />

        <section id="pricing" className="pkr-l2-section pkr-l2-pricing">
          <div className="pkr-l2-section-heading"><span className="pkr-l2-section-kicker">STRAIGHTFORWARD HOST PRICING · PLAYERS JOIN FREE</span><h2>Seen the app?<br/><em>Make it your game.</em></h2><p>One host subscription gives your private group a place to play. Members never need a separate hosting plan to join.</p></div>
          <div className="pkr-l2-plan-grid">
            <article className="pkr-l2-plan"><span className="pkr-l2-plan-name">STARTER</span><h3>Make every game night count.</h3><div className="pkr-l2-price">$9.99 <small>AUD / month</small></div><p>For one regular private poker group.</p><ul><li>One active poker group</li><li>Up to 9 seats</li><li>Scheduling, RSVPs and core game tracking</li><li>Results, balances and room history</li></ul><button type="button" className="pkr-l2-btn pkr-l2-btn-outline" onClick={()=>choosePlan('starter')}>Choose Starter <span aria-hidden="true">↗</span></button></article>
            <article className="pkr-l2-plan pkr-l2-plan-featured"><span className="pkr-l2-plan-badge">FOR THE REGULAR HOST</span><span className="pkr-l2-plan-name">PRO</span><h3>Everything your poker crew needs.</h3><div className="pkr-l2-price">$19.99 <small>AUD / month</small></div><p>More room for bigger games and more groups.</p><ul><li>Multiple poker groups</li><li>Up to 15 seats</li><li>Advanced game-night controls</li><li>Room history and player performance</li></ul><button type="button" className="pkr-l2-btn pkr-l2-btn-gold" onClick={()=>choosePlan('pro')}>Choose Pro <span aria-hidden="true">↗</span></button></article>
          </div>
          <p className="pkr-l2-pricing-note">Host billing is handled through Stripe. PKR records game balances but does not send or receive player settlement money.</p>
        </section>

        <section id="join" className="pkr-l2-join-section">
          <div><span className="pkr-l2-section-kicker">ALREADY PART OF THE CREW?</span><h2>Got an invite? <em>You&apos;re in.</em></h2><p>Paste the personal invitation your host sent you. No host subscription required for invited players.</p></div>
          <form className="pkr-l2-join-form" onSubmit={event=>{event.preventDefault();joinWithLink();}}>
            <label htmlFor="pkr-l2-invite">Your PKR invitation link</label>
            <div><input id="pkr-l2-invite" type="url" autoComplete="url" placeholder="https://mypkr.app/invite/…" value={inviteLink} onChange={event=>setInviteLink(event.target.value)}/><button type="submit" disabled={!inviteLink.trim()}>Join room <span aria-hidden="true">↗</span></button></div>
            {inviteError&&<p role="alert">{inviteError}</p>}
          </form>
        </section>

        <section className="pkr-l2-last-call">
          <img className="pkr-l2-closing-art" src="/brand/pkr-midnight-closing.svg" alt="" aria-hidden="true" loading="lazy" decoding="async" width="950" height="500"/>
          <div><span className="pkr-l2-section-kicker">MADE FOR REGULAR GAME NIGHTS</span><h2>Deal everyone in.</h2><p>Build your private poker room and make the next game night one to remember.</p><button type="button" className="pkr-l2-btn pkr-l2-btn-gold" onClick={()=>setLoginOpen(true)}>Start hosting <span aria-hidden="true">↗</span></button></div>
        </section>
        <section id="faq" className="pkr-l2-section pkr-l2-faq" aria-labelledby="pkr-faq-title">
          <div className="pkr-l2-section-heading">
            <span className="pkr-l2-section-kicker">STRAIGHT ANSWERS FOR HOME GAME HOSTS</span>
            <h2 id="pkr-faq-title">Before you <em>deal the cards.</em></h2>
            <p>How PKR works, what it costs and what happens after the last hand.</p>
          </div>
          <div className="pkr-l2-faq-list">
            {faqs.map(({q,a})=><details className="pkr-l2-faq-item" key={q}><summary><span>{q}</span><b aria-hidden="true">+</b></summary><p>{a}</p></details>)}
          </div>
        </section>
      </main>

      <script type="application/ld+json" dangerouslySetInnerHTML={{__html:JSON.stringify(structuredData).replace(/</g,'\\u003c')}}/>
      <footer className="pkr-l2-footer"><a className="pkr-l2-brand" href="/"><span className="pkr-l2-brand-emblem" aria-hidden="true">♠</span><span>PKR<small>PRIVATE POKER CLUB</small></span></a><p>Private poker night management. The game belongs to your crew.</p><div><a href="/home-poker-game-tracker">Game tracker</a><a href="/poker-tournament-manager">Tournaments</a><a href="/home-poker-settlement">Settlement</a><a href="/pricing">Plans</a><a href="/install">Install</a></div></footer>

      {loginOpen&&<div className="pkr-landing-dialog-back" onClick={event=>{if(event.target===event.currentTarget)setLoginOpen(false);}}>
        <section className="pkr-landing-dialog" role="dialog" aria-modal="true" aria-label="Host sign in">
          <button type="button" className="pkr-landing-close" aria-label="Close sign in" onClick={()=>setLoginOpen(false)}>×</button>
          <div className="pkr-landing-dialog-logo">♠</div><h2>Host your poker night</h2>
          <p>{selectedPlan
  ? 'Sign in with Google to review and activate the '+(selectedPlan==='pro'?'Pro':'Starter')+' host plan. No charge is made until you confirm Stripe checkout.'
  : 'Sign in to create a room. Players join through their private invitation after host approval.'}</p>
          <button type="button" className="pkr-landing-primary" onClick={hostSignIn}>Continue with Google (host) →</button>
          <a href="/mobile-login" className="pkr-landing-outline" style={{display:'block',textAlign:'center',marginTop:12,padding:'12px'}}>Already a player? Sign in here</a>
        </section>
      </div>}
    </div>
  );
}
