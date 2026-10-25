'use client';

import {useState,useEffect} from 'react';
import {useRouter} from 'next/navigation';

const journey=[
  {n:'01',icon:'♠',title:'Create your room',detail:'Set up a private poker group and choose the game night.'},
  {n:'02',icon:'↗',title:'Invite your players',detail:'Invite players individually by mobile number. Only verified members can access the game.'},
  {n:'03',icon:'◷',title:'Get the plan together',detail:'Players choose an arrival time and available seat. The group sees live responses.'},
  {n:'04',icon:'♣',title:'Open the table',detail:'Record buy-ins, track hands and settle up with a clear audit trail.'},
];
const features=[
  {icon:'◷',name:'Live arrivals',description:'7 pm, 8 pm, 9 pm, late or not coming — you decide the options.'},
  {icon:'♠',name:'Choose a seat',description:'Players see the seating plan before they arrive.'},
  {icon:'↗',name:'WhatsApp invite',description:'Send each member a private WhatsApp invitation.'},
  {icon:'◎',name:'Shared RSVP board',description:'Verified members of that group can see who is coming.'},
];
export default function HomePage(){
  const router=useRouter();
  const [loginOpen,setLoginOpen]=useState(false);
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
        <a href="#how-it-works">How it works</a>
        <a href="#rsvp">Live RSVP</a>
        <a href="#game-night">Game night</a>
      </div>
      <button className="pkr-landing-outline" onClick={()=>setLoginOpen(true)}>Host sign in</button>
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
          <div className="pkr-landing-note">Hosts use Google · Players verify their WhatsApp mobile</div>
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
      <section className="pkr-landing-rsvp" id="rsvp">
        <div className="pkr-landing-rsvp-copy">
          <span className="pkr-landing-kicker">THE GROUP KNOWS THE PLAN</span>
          <h2>No more <em>“what time are you coming?”</em></h2>
          <p>The host chooses arrival slots. Verified members can RSVP, reserve an available seat and see who's running late or can't make it.</p>
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
      <section className="pkr-landing-finish" id="game-night">
        <span className="pkr-landing-kicker">WHEN EVERYONE ARRIVES</span>
        <h2>Then the night <em>belongs to the table.</em></h2>
        <p>The same group and game flow leads straight into your live casino table: seats, buy-ins, hands, player results and settlement. No jumping between apps to finish the night.</p>
        <button className="pkr-landing-primary" onClick={()=>setLoginOpen(true)}>Host your next game <span>→</span></button>
      </section>
    </main>
    <footer className="pkr-landing-footer"><a className="pkr-landing-logo" href="/"><span>♠</span>PKR</a>
      <span>Private poker night management</span><a href="#how-it-works">How it works</a></footer>
    {loginOpen&&<div className="pkr-landing-dialog-back" onClick={e=>{if(e.currentTarget===e.target)setLoginOpen(false);}}>
      <section className="pkr-landing-dialog" role="dialog" aria-modal="true" aria-label="Host sign in">
        <button className="pkr-landing-close" aria-label="Close sign in" onClick={()=>setLoginOpen(false)}>×</button>
        <div className="pkr-landing-dialog-logo">♠</div><h2>Host your poker night</h2>
        <p>Sign in to host a room. Players join privately with their verified WhatsApp mobile number.</p>
        <button className="pkr-landing-primary" onClick={login}>Continue with Google (host) →</button>
        <a href="/mobile-login" className="pkr-landing-outline" style={{display:'block',textAlign:'center',marginTop:12,padding:'12px'}}>Already a member? Sign in with mobile</a>
      </section>
    </div>}
  </div>;
}
