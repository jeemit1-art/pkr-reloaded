'use client';

import {useEffect, useState} from 'react';
import {useRouter} from 'next/navigation';
import {hasApprovedDeviceCredential,renewApprovedDevice} from '@/lib/api';
import {ProductTour,MobileProductShowcase} from '@/components/ProductShowcase';
import AppDialog from '@/components/AppDialog';
import PkrGlyph,{type PkrGlyphName} from '@/components/PkrGlyph';
import PkrBrandMark from '@/components/PkrBrandMark';
import './pkr-launch.css';
import './chip-club-launch.css';
import './chip-club-launch-coverage.css';

const steps:{icon:PkrGlyphName;title:string;detail:string}[] = [
  {icon:'users',title:'Bring your people together',detail:'Create a private club, send personal invitations and approve your players.'},
  {icon:'schedule',title:'Plan the next game',detail:'Pick a date, collect RSVPs and help everyone find their seat.'},
  {icon:'table',title:'Keep the game moving',detail:'Record buy-ins and cash-outs, manage seats and run tournament blinds.'},
  {icon:'history',title:'Keep the whole story',detail:'Review results, follow settlement records and open each player’s history.'},
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
    {'@type':'WebApplication','@id':'https://mypkr.app/#application',name:'PKR',url:'https://mypkr.app/',applicationCategory:'GameApplication',operatingSystem:'Web browser',description:'Manage private home poker rooms, record buy-ins and cash-outs, track tournament blind levels, see player results and review settlements.',image:'https://mypkr.app/opengraph-image',offers:[
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
      }else if(hasApprovedDeviceCredential()){
        // A returning browser may have lost its short-lived JWT while its
        // approved device session is still valid. Recover it before showing
        // the marketing screen; never create another account automatically.
        void renewApprovedDevice().then(ok=>{
          if(ok)router.replace(desired?'/dashboard?subscribe='+desired:'/dashboard');
          else if(desired)setLoginOpen(true);
        }).catch(()=>{if(desired)setLoginOpen(true);});
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
    <div className="pkr-launch">
      <a className="pkr-launch-skip" href="#main-content">Skip to content</a>
      <header className="pkr-l2-topbar">
        <div className="pkr-l2-nav-inner">
          <a className="pkr-l2-brand" href="/" aria-label="PKR home"><span className="pkr-l2-brand-emblem"><PkrBrandMark className="pkr-brand-mark--landing"/></span><span>PKR<small>YOUR PRIVATE POKER CLUB</small></span></a>
          <nav className="pkr-l2-navlinks" aria-label="Landing page">
            <a href="#product-tour">See the app</a><a href="#how-it-works">How it works</a><a href="#pricing">Pricing</a><a href="#faq">FAQ</a>
          </nav>
          <div className="pkr-l2-header-actions">
            <a className="pkr-l2-player-link" href="/mobile-login">Player login</a>
            <button type="button" className="pkr-l2-btn pkr-l2-btn-outline" onClick={()=>setLoginOpen(true)}>Host sign in</button>
          </div>
        </div>
      </header>

      <main id="main-content">
        <section className="pkr-l2-hero" aria-labelledby="pkr-l2-main-heading">
          <div className="pkr-l2-hero-inner">
            <div className="pkr-l2-hero-copy">
              <span className="pkr-l2-eyebrow">FOR YOUR NEXT GREAT GAME NIGHT</span>
              <h1 id="pkr-l2-main-heading">More poker.<br/><em>Less admin.</em></h1>
              <p>The people, the plan, the game and every result. Keep your private poker club together in one app.</p>
              <div className="pkr-l2-hero-actions">
                <button type="button" className="pkr-l2-btn pkr-l2-btn-gold" onClick={()=>setLoginOpen(true)}>Start your poker club</button>
                <a className="pkr-l2-btn pkr-l2-btn-glass" href="#product-tour">Take a look inside</a>
              </div>
              <div className="pkr-l2-hero-trust"><span><PkrGlyph name="lock" size={17}/> Private clubs</span><span><PkrGlyph name="users" size={17}/> Players join free</span><span><PkrGlyph name="phone" size={17}/> Phone, tablet &amp; desktop</span></div>
              <p className="pkr-launch-availability">Available now in your browser. Add PKR to your Home Screen.</p>
            </div>
            <div className="pkr-hero-real" aria-label="Current PKR desktop and phone screens with fictional club data">
              <div className="pkr-hero-desktop">
                <div className="pkr-hero-desktop-header"><span>YOUR CLUB. ALL TOGETHER.</span><span>mypkr.app</span></div>
                <img src="/demo/launch-20261127/desktop-home.webp" alt="Current PKR Home dashboard with games, players, payments and results for the fictional River City Poker club" width="1440" height="900" fetchPriority="high"/>
              </div>
              <div className="pkr-hero-mobile" aria-hidden="true"><img src="/demo/launch-20261127/mobile-home.webp" alt="" width="430" height="873" loading="eager"/></div>
              <div className="pkr-hero-real-label"><PkrGlyph name="check" size={17}/> Actual app screens · Demo club</div>
            </div>
          </div>
        </section>

        <section className="pkr-l2-ribbon" aria-label="What PKR brings together">
          <div><PkrGlyph name="schedule" size={26}/><span><strong>Before the first hand</strong><small>Invites, RSVPs and seats</small></span></div>
          <div><PkrGlyph name="table" size={26}/><span><strong>While the game is on</strong><small>Buy-ins, blinds and players</small></span></div>
          <div><PkrGlyph name="history" size={26}/><span><strong>After the last hand</strong><small>Results, payments and history</small></span></div>
        </section>

        <ProductTour />

        <section id="how-it-works" className="pkr-l2-section pkr-l2-how">
          <div className="pkr-l2-section-heading"><span className="pkr-l2-section-kicker">A GOOD NIGHT STARTS HERE</span><h2>Less chasing.<br/><em>More playing.</em></h2><p>One place for everything your group already does, from the invitation to the final result.</p></div>
          <div className="pkr-l2-steps">{steps.map(step=><article className="pkr-l2-step" key={step.title}><span className="pkr-launch-step-icon"><PkrGlyph name={step.icon} size={27}/></span><h3>{step.title}</h3><p>{step.detail}</p></article>)}</div>
        </section>

        <MobileProductShowcase />

        <section id="pricing" className="pkr-l2-section pkr-l2-pricing">
          <div className="pkr-l2-section-heading"><span className="pkr-l2-section-kicker">ONE HOST PLAN. YOUR WHOLE GROUP.</span><h2>Make it <em>your game.</em></h2><p>The host chooses a plan. Invited players join their private club without buying a hosting subscription.</p></div>
          <div className="pkr-l2-plan-grid">
            <article className="pkr-l2-plan"><span className="pkr-l2-plan-name">STARTER</span><h3>For your regular home game.</h3><div className="pkr-l2-price">$9.99 <small>AUD / month</small></div><p>One private group, ready for game night.</p><ul><li>One active poker group</li><li>Up to 9 seats</li><li>Scheduling, RSVPs and core game tracking</li><li>Results, balances and room history</li></ul><button type="button" className="pkr-l2-btn pkr-l2-btn-outline" onClick={()=>choosePlan('starter')}>Choose Starter</button></article>
            <article className="pkr-l2-plan pkr-l2-plan-featured"><span className="pkr-l2-plan-badge">MORE ROOM TO PLAY</span><span className="pkr-l2-plan-name">PRO</span><h3>For bigger games and more groups.</h3><div className="pkr-l2-price">$19.99 <small>AUD / month</small></div><p>Bring your poker nights together.</p><ul><li>Multiple poker groups</li><li>Up to 15 seats</li><li>Advanced game-night controls</li><li>Room history and player performance</li></ul><button type="button" className="pkr-l2-btn pkr-l2-btn-gold" onClick={()=>choosePlan('pro')}>Choose Pro</button></article>
          </div>
          <p className="pkr-l2-pricing-note">Host billing is handled through Stripe. Players arrange settlement payments outside PKR.</p>
          <a className="pkr-launch-text-link" href="/pricing">View plan details</a>
        </section>

        <section id="join" className="pkr-l2-join-section">
          <div><span className="pkr-l2-section-kicker">YOUR SEAT IS WAITING</span><h2>Already have <em>an invite?</em></h2><p>Paste the personal invitation link your host sent you. Already a member? <a href="/mobile-login">Sign in as a player.</a></p></div>
          <form className="pkr-l2-join-form" onSubmit={event=>{event.preventDefault();joinWithLink();}}>
            <label htmlFor="pkr-l2-invite">Your PKR invitation link</label>
            <div><input id="pkr-l2-invite" type="url" autoComplete="url" placeholder="https://mypkr.app/invite/…" value={inviteLink} onChange={event=>setInviteLink(event.target.value)}/><button type="submit" disabled={!inviteLink.trim()}>Join room</button></div>
            {inviteError&&<p role="alert">{inviteError}</p>}
          </form>
        </section>

        <section id="faq" className="pkr-l2-section pkr-l2-faq" aria-labelledby="pkr-faq-title">
          <div className="pkr-l2-section-heading"><span className="pkr-l2-section-kicker">BEFORE YOU DEAL</span><h2 id="pkr-faq-title">A few good <em>questions.</em></h2><p>How PKR works, what it costs and what happens after the last hand.</p></div>
          <div className="pkr-l2-faq-list">{faqs.map(({q,a})=><details className="pkr-l2-faq-item" key={q}><summary><span>{q}</span><b aria-hidden="true">+</b></summary><p>{a}</p></details>)}</div>
        </section>

        <section className="pkr-l2-last-call">
          <div><span className="pkr-l2-section-kicker">BRING THE CARDS. WE’LL KEEP THE RECORDS.</span><h2>Your next game night<br/>starts here.</h2><p>Create your private poker club and get everyone together.</p><button type="button" className="pkr-l2-btn pkr-l2-btn-gold" onClick={()=>setLoginOpen(true)}>Start hosting</button></div>
          <div className="pkr-launch-closing-screen"><img className="pkr-l2-closing-art" src="/demo/launch-20261127/desktop-live-table.webp" alt="Actual PKR poker table with fictional players and recorded buy-ins" loading="lazy" decoding="async" width="1440" height="900"/></div>
        </section>
      </main>

      <script type="application/ld+json" dangerouslySetInnerHTML={{__html:JSON.stringify(structuredData).replace(/</g,'\\u003c')}}/>
      <footer className="pkr-l2-footer"><a className="pkr-l2-brand" href="/" aria-label="PKR home"><span className="pkr-l2-brand-emblem"><PkrBrandMark className="pkr-brand-mark--landing"/></span><span>PKR<small>YOUR PRIVATE POKER CLUB</small></span></a><p>Private poker night management.<br/>The game belongs to your crew.</p><nav aria-label="More about PKR"><a href="/home-poker-game-tracker">Game tracker</a><a href="/poker-tournament-manager">Tournaments</a><a href="/home-poker-settlement">Settlement</a><a href="/pricing">Plans</a><a href="/install">Install</a></nav></footer>

      {loginOpen&&<AppDialog aria-label="Host sign in" onDismiss={()=>setLoginOpen(false)} onClick={event=>{if(event.target===event.currentTarget)setLoginOpen(false);}}>
        <div className="pkr-launch-signin">
          <button type="button" className="pkr-launch-dialog-close" aria-label="Close sign in" onClick={()=>setLoginOpen(false)}><PkrGlyph name="close" size={22}/></button>
          <span className="pkr-launch-signin-mark"><PkrGlyph name="spade" size={36}/></span><h2>Host your poker night</h2>
          <p>{selectedPlan
  ? 'Sign in with Google to review and activate the '+(selectedPlan==='pro'?'Pro':'Starter')+' host plan. No charge is made until you confirm Stripe checkout.'
  : 'Sign in to create a room. Players join through their private invitation after host approval.'}</p>
          <button type="button" className="pkr-launch-signin-primary" onClick={hostSignIn}>Continue with Google (host)</button>
          <a href="/mobile-login">Already a player? Sign in here</a>
        </div>
      </AppDialog>}
    </div>
  );
}
