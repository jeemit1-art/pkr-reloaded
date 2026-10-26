'use client';

import {useState,useEffect} from 'react';
import {useRouter} from 'next/navigation';

const journey=[
  {n:'01',icon:'♠',title:'Create your room',detail:'Set up a private poker group and choose the game night.'},
  {n:'02',icon:'↗',title:'Invite your players',detail:'Invite each player through a personal WhatsApp message. Your group host approves new members.'},
  {n:'03',icon:'◷',title:'Get the plan together',detail:'Players choose an arrival time and available seat. The group sees live responses.'},
  {n:'04',icon:'♣',title:'Open the table',detail:'Record buy-ins, track hands and settle up with a clear audit trail.'},
];
const capabilities=[
  {name:'Private poker groups',detail:'Create member-only rooms with host and co-host controls.'},
  {name:'Scheduling and invitations',detail:'Plan a game, share personal invitations and manage participation.'},
  {name:'RSVP and seating',detail:'Collect arrivals, late responses and seat choices before game night.'},
  {name:'Live poker table',detail:'Run the game with seats, chips, buy-ins and hand tracking.'},
  {name:'Cash-out and settlement',detail:'Record results and review the end-of-night settlement.'},
  {name:'History and leaderboards',detail:'Review previous sessions and group player performance.'},
  {name:'Tournament tools',detail:'Tournament and blind controls are being improved; availability depends on plan.'},
  {name:'Mobile access',detail:'Use the host and player flows on phones and larger screens.'},
];
const features=[
  {icon:'◷',name:'Live arrivals',description:'7 pm, 8 pm, 9 pm, late or not coming — you decide the options.'},
  {icon:'♠',name:'Choose a seat',description:'Players see the seating plan before they arrive.'},
  {icon:'↗',name:'WhatsApp invite',description:'Send each member a private WhatsApp invitation.'},
  {icon:'◎',name:'Shared RSVP board',description:'Approved members of that group can see who is coming.'},
];
export default function HomePage(){
  const router=useRouter();
  const [loginOpen,setLoginOpen]=useState(false);
  const [inviteLink,setInviteLink]=useState('');
  const [inviteError,setInviteError]=useState('');
  function joinWithLink(){
    setInviteError('');
    try{
      const parsed=new URL(inviteLink.trim(),window.location.origin);
      if(parsed.origin!==window.location.origin)throw new Error('Use a mypkr.app invitation link.');
      if(!/^\/(phone-invite|invite)\/[a-zA-Z0-9_-]+\/?$/.test(parsed.pathname))
        throw new Error('Paste the personal invitation link provided by your host.');
      router.push(parsed.pathname);
    }catch(e:any){setInviteError(e.message||'Invalid invitation link.');}
  }
  useEffect(()=>{
    if(localStorage.getItem('pkr_token'))router.replace('/dashboard');
  },[router]);
  useEffect(()=>{
    if(!loginOpen)return;
    const close=(e:KeyboardEvent)=>{if(e.key==='Escape')setLoginOpen(false);};
    window.addEventListener('keydown',close);
    return()=>window.removeEventListener('keydown',close);
  },[loginOpen]);
  const login=()=>{window.location.assign((process.env.NEXT_PUBLIC_API_URL||'http://localhost:8787')+'/auth/google');};
  return <div className="pkr-landing">
    <nav className="pkr-landing-nav" aria-label="Primary navigation">
      <a className="pkr-landing-logo" href="/" aria-label="PKR home"><span>♠</span>PKR</a>
      <div className="pkr-landing-navlinks">
        <a href="#how-it-works">How it works</a><a href="#features">Features</a><a href="#pricing">Pricing</a>
        <a href="#rsvp">Live RSVP</a>
        <a href="#game-night">Game night</a>
      </div>
      <div style={{display:"flex",gap:8,flexWrap:"wrap"}}><a className="pkr-landing-outline" href="/mobile-login">Player access</a><button className="pkr-landing-outline" onClick={()=>setLoginOpen(true)}>Host sign in</button></div>
    </nav>
    <main>
      <section className="pkr-landing-hero">
        <div className="pkr-landing-hero-copy">
          <div className="pkr-landing-kicker"><span className="pkr-landing-indicator"/> PRIVATE POKER NIGHTS, BETTER ORGANISED</div>
          <h1>Bring the crew.<br/><em>We'll set the table.</em></h1>
          <p>From the first WhatsApp invite to the final cash-out, PKR keeps your night organised. Give everyone a seat, know who's arriving and keep the poker where it belongs — at the table.</p>
          <div className="pkr-landing-hero-actions">
            <button className="pkr-landing-primary" onClick={()=>setLoginOpen(true)}>Create a poker room <span>→</span></button>
            <a className="pkr-landing-outline" href="#how-it-works">See how it works</a>
          </div>
          <div className="pkr-landing-note">Hosts use Google · Players join through a host-sent QR or WhatsApp invitation</div>
          <form className="pkr-landing-join" onSubmit={e=>{e.preventDefault();joinWithLink();}}>
            <label htmlFor="pkr-landing-invite-link">Already invited? Join your poker room</label>
            <div className="pkr-landing-join-controls">
              <input id="pkr-landing-invite-link" type="url" autoComplete="url"
                value={inviteLink} onChange={e=>setInviteLink(e.target.value)}
                placeholder="Paste your personal PKR invitation link"/>
              <button type="submit" disabled={!inviteLink.trim()}>Join room →</button>
            </div>
            {inviteError&&<span role="alert">{inviteError}</span>}
            <small>Useful after installing PKR on iPhone: open the new app and paste the invite here to finish joining inside it.</small>
          </form>
        </div>
        <div className="pkr-landing-demo" aria-label="Illustration of the PKR live RSVP experience">
          <div className="pkr-landing-demo-top">
            <div><span className="pkr-landing-kicker">FRIDAY NIGHT POKER</span><strong>Who's at the table?</strong></div>
            <span className="pkr-landing-live"><i/> LIVE</span>
          </div>
          <div className="pkr-landing-demo-date">◷ Friday · 7:00 PM  <span>⌖ Poker room</span></div>
          <div className="pkr-landing-demo-stats">
            <div><strong>5</strong><span>Coming</span></div><div><strong>1</strong><span>Late</span></div><div><strong>3</strong><span>Seats free</span></div>
          </div>
          <div className="pkr-landing-demo-title">GROUP RSVP BOARD <span>Illustrative</span></div>
          {[{i:'M',name:'Marcus',t:'7:00 pm',seat:'01'},
            {i:'J',name:'Jai',t:'8:00 pm',seat:'02'},
            {i:'R',name:'Rob',t:'Running late',seat:'05'},
            {i:'A',name:'Alex',t:'7:00 pm',seat:'06'}].map(x=>
            <div className="pkr-landing-demo-player" key={x.name}>
              <span className="pkr-landing-demo-avatar">{x.i}</span>
              <span><strong>{x.name}</strong><small>{x.t}</small></span>
              <b>SEAT {x.seat}</b>
            </div>)}
          <div className="pkr-landing-demo-share">↗ Share invite to WhatsApp</div>
          <div className="pkr-landing-demo-glow" aria-hidden="true">♠</div>
        </div>
      </section>
      <section className="pkr-landing-flow" id="how-it-works">
        <div className="pkr-landing-section-head">
          <span className="pkr-landing-kicker">YOUR GAME NIGHT, FROM START TO FINISH</span>
          <h2>One place for <em>every part of the night.</em></h2>
          <p>Make the plan before you play. No chasing messages to work out who's coming.</p>
        </div>
        <div className="pkr-landing-steps">
          {journey.map(item=><article key={item.n} className="pkr-landing-step">
            <span className="pkr-landing-step-icon">{item.icon}</span>
            <span className="pkr-landing-step-num">{item.n}</span>
            <h3>{item.title}</h3><p>{item.detail}</p>
          </article>)}
        </div>
      </section>
      <section id="features" className="pkr-landing-flow" aria-labelledby="pkr-features-heading">
        <div className="pkr-landing-section-head">
          <span className="pkr-landing-kicker">MORE THAN A POKER TABLE</span>
          <h2 id="pkr-features-heading">Everything around <em>game night.</em></h2>
          <p>Organise the group, prepare the session, play and review results in one place.</p>
        </div>
        <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(min(100%,240px),1fr))',gap:16,maxWidth:1120,margin:'0 auto'}}>
          {capabilities.map(item=><article key={item.name} className="pkr-landing-step" style={{minWidth:0}}>
            <h3>{item.name}</h3><p>{item.detail}</p>
          </article>)}
        </div>
        <p style={{textAlign:'center',marginTop:20,opacity:.65}}>All examples on this page are fictional illustrations. No real player records are displayed.</p>
      </section>
      <section className="pkr-landing-rsvp" id="rsvp">
        <div className="pkr-landing-rsvp-copy">
          <span className="pkr-landing-kicker">THE GROUP KNOWS THE PLAN</span>
          <h2>No more <em>“what time are you coming?”</em></h2>
          <p>The host chooses arrival slots. Approved group members can RSVP, reserve an available seat and see who's running late or can't make it.</p>
          <div className="pkr-landing-feature-grid">
            {features.map(x=><div key={x.name}>
              <span>{x.icon}</span><strong>{x.name}</strong><small>{x.description}</small>
            </div>)}
          </div>
        </div>
        <div className="pkr-landing-rsvp-visual">
          <div className="pkr-landing-rsvp-surface">
            <span className="pkr-landing-kicker">YOUR ARRIVAL TIME</span>
            <h3>When will you arrive?</h3>
            <div className="pkr-landing-rsvp-chips">
              <span className="selected">✓ 7:00 pm</span><span>8:00 pm</span><span>9:00 pm</span>
              <span>Running late</span><span>Not coming</span>
            </div>
            <span className="pkr-landing-kicker">CHOOSE A SEAT</span>
            <div className="pkr-landing-rsvp-seats">{Array.from({length:9},(_,i)=>
              <div className={i<4?'filled':''} key={i}>♠<small>{i+1}</small></div>)}</div>
            <div className="pkr-landing-rsvp-cta">Confirm RSVP →</div>
            <small className="pkr-landing-demo-caption">Illustrative preview. Actual choices are set by each host.</small>
          </div>
        </div>
      </section>
      <section id="pricing" className="pkr-landing-flow" aria-labelledby="pkr-pricing-heading">
        <div className="pkr-landing-section-head"><span className="pkr-landing-kicker">HOST SUBSCRIPTIONS</span>
          <h2 id="pkr-pricing-heading">Choose your <em>PKR plan.</em></h2>
          <p>Hosting requires a subscription. Invited players can join their host's private room without purchasing a separate host plan.</p>
        </div>
        <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(min(100%,260px),1fr))',gap:18,maxWidth:840,margin:'0 auto'}}>
          {[
            {name:'Starter',price:'$9.99',text:'1 group · Up to 9 seats · Core game-night management'},
            {name:'Pro',price:'$19.99',text:'Multiple groups · Up to 15 seats · Advanced features'},
          ].map(p=><article key={p.name} className="pkr-landing-step" style={{minWidth:0}}>
            <span className="pkr-landing-kicker">{p.name}</span>
            <h3 style={{fontSize:32,marginTop:12}}>{p.price}<small style={{fontSize:14,fontWeight:400}}> AUD/month</small></h3>
            <p>{p.text}</p><button className="pkr-landing-primary" style={{marginTop:20,maxWidth:'100%'}} onClick={()=>setLoginOpen(true)}>Choose {p.name} →</button>
          </article>)}
        </div>
        <p style={{textAlign:'center',marginTop:18,opacity:.65}}>Subscriptions are processed through Stripe. Final payment activation and plan enforcement are subject to release checks.</p>
      </section>
      <section className="pkr-landing-finish" id="game-night">
        <span className="pkr-landing-kicker">WHEN EVERYONE ARRIVES</span>
        <h2>Then the night <em>belongs to the table.</em></h2>
        <p>The same group and game flow leads straight into your live casino table: seats, buy-ins, hands, player results and settlement. No jumping between apps to finish the night.</p>
        <button className="pkr-landing-primary" onClick={()=>setLoginOpen(true)}>Host your next game <span>→</span></button>
      </section>
    </main>
    <footer className="pkr-landing-footer"><a className="pkr-landing-logo" href="/"><span>♠</span>PKR</a>
      <span>Private poker night management</span><a href="#how-it-works">How it works</a><a href="#pricing">Pricing</a></footer>
    {loginOpen&&<div className="pkr-landing-dialog-back" onClick={e=>{if(e.currentTarget===e.target)setLoginOpen(false);}}>
      <section className="pkr-landing-dialog" role="dialog" aria-modal="true" aria-label="Host sign in">
        <button className="pkr-landing-close" aria-label="Close sign in" onClick={()=>setLoginOpen(false)}>×</button>
        <div className="pkr-landing-dialog-logo">♠</div><h2>Host your poker night</h2>
        <p>Sign in to host a room. Players join privately after receiving your individual WhatsApp invitation and host approval.</p>
        <button className="pkr-landing-primary" onClick={login}>Continue with Google (host) →</button>
        <a href="/mobile-login" className="pkr-landing-outline" style={{display:'block',textAlign:'center',marginTop:12,padding:'12px'}}>Already a member? Request a recovery link</a>
      </section>
    </div>}
  </div>;
}
