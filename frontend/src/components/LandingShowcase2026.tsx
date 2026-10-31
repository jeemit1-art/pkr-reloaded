'use client';

import {useEffect,useState} from 'react';
import Link from 'next/link';

type Scene={image:string;mobile?:boolean;alt:string;title:string;description:string};
type Film={id:string;short:string;title:string;description:string;scenes:Scene[]};

const films:Film[]=[
 {
  id:'organise',short:'Before the game',title:'Get the crew together',
  description:'A private club, a date in the diary, and a clear view of who is coming.',
  scenes:[
   {image:'/demo/theme-a/host-dashboard.webp',alt:'PKR host dashboard using fictional example game data',title:'Start with your private club',description:'Keep your regular group, the next game and key actions together.'},
   {image:'/demo/theme-a/rsvp-board.webp',alt:'PKR RSVP board with fictional names and attendance',title:'Know who is coming',description:'Collect attendance, arrival preferences and seat choices.'},
   {image:'/demo/theme-a/game-detail.webp',alt:'PKR game management interface with fictional event data',title:'One place for game night',description:'Open the session and manage the table when everyone is ready.'}
  ]
 },
 {
  id:'play',short:'During the game',title:'Run the table, not a spreadsheet',
  description:'See where everyone sits, record money going in, and keep the game moving.',
  scenes:[
   {image:'/demo/theme-a/game-detail.webp',alt:'PKR scheduled game screen with controls',title:'Open the session',description:'Move from planning into the cash game or tournament.'},
   {image:'/demo/theme-a/live-table.webp',alt:'PKR live table with example player seats and balances',title:'Track each seat',description:'Record buy-ins, rebuys and cash-outs against the right player.'},
   {image:'/demo/theme-a/mobile-live-table.webp',mobile:true,alt:'PKR live poker table shown on a phone-sized screen',title:'Keep an eye on the table',description:'Use the PKR table interface from a phone as well as a computer.'}
  ]
 },
 {
  id:'results',short:'After the game',title:'Finish with a clear record',
  description:'A final result everyone can refer to, plus a way to follow up outstanding payments.',
  scenes:[
   {image:'/demo/theme-a/insights.webp',alt:'PKR Insights showing fictional game balances and financial results',title:'Reconcile the night',description:'Review cash-outs, game totals and the recorded result.'},
   {image:'/demo/theme-a/standings.webp',alt:'PKR standings with fictional rankings and net results',title:'Make the history count',description:'Results feed game history and player standings.'},
   {image:'/demo/theme-a/mobile-insights.webp',mobile:true,alt:'PKR Insights shown on a mobile-sized screenshot',title:'Follow through on settlements',description:'See recorded obligations and confirmations; players transfer funds separately.'}
  ]
 }
];

const featureCards=[
 {number:'01',category:'BEFORE THE GAME',title:'Organise game night',description:'Schedule a session, invite your regulars and see RSVPs, arrival times and seat selections before anyone turns up.',image:'/demo/theme-a/rsvp-board.webp',alt:'PKR RSVP screen with fictional players and game details',bullets:['Upcoming games','RSVPs and arrival times','Seat availability']},
 {number:'02',category:'YOUR PRIVATE CLUB',title:'Players, profiles and approvals',description:'Keep your own group of players. Invite new members privately, approve requests and manage member or co-host access.',image:'/demo/theme-a/host-dashboard.webp',alt:'PKR private group dashboard using sample data',bullets:['Private membership','Host approvals','Player records']},
 {number:'03',category:'DURING THE GAME',title:'A live table that keeps score',description:'Track seat positions, buy-ins, rebuys, cash-outs and game balances. Host controls keep the information alongside the game.',image:'/demo/theme-a/live-table.webp',alt:'PKR desktop poker table with fictional seats and sample balances',bullets:['Cash games and tournaments','Live player balances','Bank and game overview']},
 {number:'04',category:'AFTER THE GAME',title:'Results worth keeping',description:'A recorded result is more than a single night. See standings, game history and how players have performed over time.',image:'/demo/theme-a/standings.webp',alt:'PKR player standings with sample game records',bullets:['Rankings and history','Player performance','Room-level insights']},
 {number:'05',category:'SETTLE WITHOUT THE CHASE',title:'Know what is still outstanding',description:'Review who owes whom, mark a transfer as sent and confirm when it is received. PKR tracks the status, not the transfer of money.',image:'/demo/theme-a/insights.webp',alt:'PKR settlement and Insights screen with fictional amounts',bullets:['Recorded settlement balances','Sent and received status','Private reminders']}
];

export function LandingVideoStories(){
 const [filmId,setFilmId]=useState(films[0].id);
 const [sceneIndex,setSceneIndex]=useState(0);
 const [playing,setPlaying]=useState(false);
 const film=films.find(item=>item.id===filmId)||films[0];
 const scene=film.scenes[sceneIndex]||film.scenes[0];

 useEffect(()=>{
  if(!playing)return;
  const interval=window.setInterval(()=>{
   if(sceneIndex>=film.scenes.length-1){setPlaying(false);return;}
   setSceneIndex(sceneIndex+1);
  },4200);
  return()=>window.clearInterval(interval);
 },[playing,film.id,film.scenes.length,sceneIndex]);

 function selectFilm(id:string){setFilmId(id);setSceneIndex(0);setPlaying(false);}
 function playPause(){
  if(playing){setPlaying(false);return;}
  if(sceneIndex===film.scenes.length-1)setSceneIndex(0);
  setPlaying(true);
 }
 function goTo(index:number){setSceneIndex(Math.min(film.scenes.length-1,Math.max(0,index)));setPlaying(false);}

 return <section className="pkr-26-films" id="watch-demo" aria-labelledby="pkr-26-film-title">
  <div className="pkr-26-wrap">
   <div className="pkr-26-heading">
    <span className="pkr-26-overline">A LOOK INSIDE PKR</span>
    <h2 id="pkr-26-film-title">See the night unfold. <em>Before, during and after.</em></h2>
    <p>Three short, playable visual walkthroughs using real PKR interface screenshots and fictional sample data. No account is needed to explore.</p>
   </div>
   <div className="pkr-26-film-switcher" role="group" aria-label="Choose a PKR walkthrough">
    {films.map((item,i)=><button key={item.id} type="button" className={'pkr-26-film-tab'+(filmId===item.id?' is-active':'')}
      aria-pressed={filmId===item.id} onClick={()=>selectFilm(item.id)}>
      <span>{String(i+1).padStart(2,'0')}</span>{item.short}
    </button>)}
   </div>
   <div className="pkr-26-film-player">
    <div className="pkr-26-film-text">
     <span className="pkr-26-film-number">{film.short.toUpperCase()}</span>
     <h3>{film.title}</h3>
     <p>{film.description}</p>
     <div className="pkr-26-now-showing" aria-live="off">
      <span>STEP {sceneIndex+1} OF {film.scenes.length}</span>
      <strong>{scene.title}</strong>
      <p>{scene.description}</p>
     </div>
     <div className="pkr-26-film-controls">
      <button className="pkr-26-play" type="button" onClick={playPause}
       aria-label={playing?'Pause walkthrough':sceneIndex===film.scenes.length-1?'Replay walkthrough':'Play walkthrough'}>
       <span aria-hidden="true">{playing?'Ⅱ':'▶'}</span>
       {playing?'Pause':sceneIndex===film.scenes.length-1?'Replay walkthrough':'Play walkthrough'}
      </button>
      <span className="pkr-26-duration">{String(sceneIndex*4).padStart(2,'0')}s / 12s</span>
     </div>
    </div>
    <div className="pkr-26-film-screen">
     <div className="pkr-26-film-chrome"><span><i/><i/><i/></span><strong>PKR APP · SAMPLE DATA</strong><small>VISUAL WALKTHROUGH</small></div>
     <div className={'pkr-26-scene'+(scene.mobile?' is-mobile':'')} key={film.id+'-'+sceneIndex}>
      <img src={scene.image} alt={scene.alt} loading="lazy" decoding="async" width={scene.mobile?390:1440} height={scene.mobile?844:900}/>
     </div>
     <div className="pkr-26-scene-progress" aria-label="Walkthrough steps">
      {film.scenes.map((part,i)=><button key={part.title} type="button" onClick={()=>goTo(i)}
        aria-label={'Show step '+(i+1)+': '+part.title} aria-current={i===sceneIndex?'step':undefined}
        className={i===sceneIndex?'is-active':''}><span/></button>)}
     </div>
    </div>
   </div>
   <p className="pkr-26-disclaimer">These are animated screenshot walkthroughs, not recordings of a live poker game. Screens were captured from an earlier PKR build using fictional players; the current interface may differ.</p>
  </div>
 </section>;
}

export function LandingFeatureUpdates(){
 return <section className="pkr-26-features" id="features" aria-labelledby="pkr-26-features-title">
  <div className="pkr-26-wrap">
   <div className="pkr-26-heading">
    <span className="pkr-26-overline">THE WHOLE POKER NIGHT, CONNECTED</span>
    <h2 id="pkr-26-features-title">More than a table. <em>A complete poker club.</em></h2>
    <p>Five areas in PKR — Home, Games, Players, Results and Payments — keep everything in reach without burying useful tools in a menu.</p>
   </div>
   <div className="pkr-26-app-areas" aria-label="PKR main areas">
    {['Home','Games','Players','Results','Payments'].map(item=><span key={item}>{item}</span>)}
   </div>
   <div className="pkr-26-feature-grid">
    {featureCards.map(item=><article className="pkr-26-feature" key={item.number}>
     <div className="pkr-26-feature-image">
      <img src={item.image} alt={item.alt} width="1440" height="900" loading="lazy" decoding="async"/>
      <span>PKR APP SCREEN · DEMO DATA</span>
     </div>
     <div className="pkr-26-feature-body">
      <span className="pkr-26-feature-tag">{item.number} / {item.category}</span>
      <h3>{item.title}</h3>
      <p>{item.description}</p>
      <ul>{item.bullets.map(point=><li key={point}>{point}</li>)}</ul>
     </div>
    </article>)}
    <article className="pkr-26-feature pkr-26-whatsapp">
     <div className="pkr-26-whatsapp-visual" aria-label="Illustrative example of a WhatsApp RSVP status update">
      <span className="pkr-26-message-label">EXAMPLE SHARE MESSAGE</span>
      <div className="pkr-26-message-top"><span>♠</span><strong>PKR game-night update</strong></div>
      <div className="pkr-26-message">
       <b>Friday Poker · RSVP update</b>
       <span>✓ Confirmed: 6 of 9 seats</span>
       <span>◷ Arrival times and seats updated</span>
       <span className="pkr-26-message-link">Check your RSVP in PKR</span>
      </div>
      <div className="pkr-26-message-private"><span>↗</span> Host reviews and taps Send in WhatsApp</div>
     </div>
     <div className="pkr-26-feature-body">
      <span className="pkr-26-feature-tag">06 / HELPFUL WHATSAPP SHARING</span>
      <h3>Send the update that actually matters.</h3>
      <p>Open a ready-to-send WhatsApp invitation, RSVP summary or game result. Private payment reminders go to individuals, not the entire group. You always press Send yourself; no paid WhatsApp API is required.</p>
      <ul><li>Personal invite links</li><li>Shareable RSVP and results updates</li><li>Private settlement reminders</li></ul>
     </div>
    </article>
   </div>
   <div className="pkr-26-phone-banner">
    <div><span className="pkr-26-overline">MADE FOR REAL GAME NIGHTS</span><h3>Join from WhatsApp. Install when you're ready.</h3>
     <p>Invited players can get into their approved club from a browser link. Adding PKR to a phone's Home Screen is optional. Guided setup helps with installation and notification preferences.</p>
    </div>
    <div className="pkr-26-phone-actions"><Link href="/install">Phone setup guide <span aria-hidden="true">↗</span></Link><Link href="/pricing">Explore plans <span aria-hidden="true">↗</span></Link></div>
   </div>
  </div>
 </section>;
}
