'use client';

import {useState} from 'react';
import Link from 'next/link';

type TourItem={
 id:string;
 tab:string;
 eyebrow:string;
 title:string;
 description:string;
 desktop:string;
 mobile?:string;
 alt:string;
 points:string[];
 href:string;
 cta:string;
};

const items:TourItem[]=[
 {
  id:'table',tab:'Live poker table',eyebrow:'03 / GAME NIGHT',
  title:'Your poker table. Your rules.',
  description:'See the real PKR table, player positions and host controls. Run the night without scattered notes or an improvised spreadsheet.',
  desktop:'/demo/live-table.webp',mobile:'/demo/mobile-live-table.webp',
  alt:'PKR poker game table with seats and host controls, shown with fictional sample data',
  points:['Live poker table with available seats','Host game controls and bank summary','Track buy-ins, cash-outs and final results'],
  href:'/home-poker-game-tracker',cta:'Explore cash games'
 },
 {
  id:'dashboard',tab:'Host dashboard',eyebrow:'01 / ORGANISE',
  title:'Everything happening in your room.',
  description:'Your games, people and recent results stay together. Open the next session, find your room and manage your private club from one home screen.',
  desktop:'/demo/host-dashboard.webp',mobile:'/demo/mobile-dashboard.webp',
  alt:'Actual PKR host dashboard with poker club room, upcoming games, members and results using fictional sample data',
  points:['Private group and player management','Upcoming games and quick actions','Desktop and phone-ready'],
  href:'/pricing',cta:'Compare host plans'
 },
 {
  id:'rsvp',tab:'Invites & RSVPs',eyebrow:'02 / GET THE CREW TOGETHER',
  title:'Know who is coming before you deal.',
  description:'Share invites with your regulars and let players respond. See RSVPs, arrivals and seat availability instead of chasing separate messages.',
  desktop:'/demo/rsvp-board.webp',mobile:'/demo/mobile-rsvp.webp',
  alt:'Actual PKR player RSVP page showing a private poker room, response choices and a seat reservation flow using sample data',
  points:['Private invitation and host approval','Player RSVPs and arrival planning','Seat and guest management'],
  href:'/home-poker-game-tracker',cta:'See how PKR works'
 },
 {
  id:'games',tab:'Game management',eyebrow:'03 / START THE SESSION',
  title:'From the next game to the final hand.',
  description:'Schedule a session and see the game details before starting play. PKR also supports cash-game tracking and tournament modes with blind structures.',
  desktop:'/demo/game-detail.webp',
  alt:'Actual PKR game details page showing a scheduled private poker game and Start Game action',
  points:['Plan and start games','Cash game or tournament modes','Built-in host tools'],
  href:'/poker-tournament-manager',cta:'Explore tournaments'
 },
 {
  id:'standings',tab:'Player standings',eyebrow:'04 / EVERY PLAYER COUNTS',
  title:'Every player. Every recorded result.',
  description:'A complete ranking of all players with settled games in the room—not just the first few names. Search player history and see who is up across game nights.',
  desktop:'/demo/standings.webp',mobile:'/demo/mobile-standings.webp',
  alt:'Actual PKR player standings screen showing ranked fictional players and their recorded results',
  points:['Full rankings and game history','Searchable player performance','Lifetime profit and loss records'],
  href:'/home-poker-game-tracker',cta:'Learn about standings'
 },
 {
  id:'insights',tab:'Insights & settlement',eyebrow:'05 / FINISH WITH CLARITY',
  title:'Know the results. Settle up clearly.',
  description:'Review game performance, player balances and settlements after the last hand. PKR records what your group needs to settle; it does not transfer player funds.',
  desktop:'/demo/insights.webp',mobile:'/demo/mobile-insights.webp',
  alt:'Actual PKR Insights and Settlement dashboard showing demo game statistics, charts, balances and settlement controls',
  points:['Player net results and trends','Who-pays-whom settlement records','Payment status and history'],
  href:'/home-poker-settlement',cta:'Explore settlements'
 },
];

const highlights=[
 {title:'Run the table',label:'From the actual PKR app',image:'/demo/live-table.webp',alt:'PKR live table screen, shown with demo data',link:'/home-poker-game-tracker'},
 {title:'Players and RSVPs',label:'See who is coming',image:'/demo/rsvp-board.webp',alt:'PKR RSVP page showing an illustrated private poker room and response options',link:'/home-poker-game-tracker'},
 {title:'Every result recorded',label:'Insights and settlement',image:'/demo/insights.webp',alt:'PKR Insights screen with sample totals, balance summary and game trends',link:'/home-poker-settlement'},
];

export function ProductTour(){
 const [active,setActive]=useState('table');
 const selected=items.find(item=>item.id===active)||items[0];
 const idx=items.findIndex(item=>item.id===active);
 const next=()=>setActive(items[(idx+1)%items.length].id);
 const previous=()=>setActive(items[(idx-1+items.length)%items.length].id);

 return <section className="pkr-product-tour" id="product-tour" aria-labelledby="pkr-product-tour-title">
  <div className="pkr-product-tour-header">
   <span className="pkr-tour-overline"><span aria-hidden="true">●</span> SEE THE ACTUAL APP</span>
   <h2 id="pkr-product-tour-title">See exactly what <em>PKR does.</em></h2>
   <p>Real screens from the PKR app, captured in desktop and mobile browsers. All names, games and balances shown are sample data.</p>
  </div>
  <div className="pkr-tour-tabs" role="tablist" aria-label="PKR app features">
   {items.map((item,i)=><button type="button" role="tab" aria-selected={item.id===active}
     aria-controls="pkr-tour-panel" id={'pkr-tour-tab-'+item.id} tabIndex={item.id===active?0:-1}
     className={'pkr-tour-tab'+(item.id===active?' selected':'')} key={item.id}
     onClick={()=>setActive(item.id)}
     onKeyDown={event=>{
       if(!['ArrowLeft','ArrowRight','Home','End'].includes(event.key))return;
       event.preventDefault();
       const target=event.key==='Home'?0:event.key==='End'?items.length-1:(i+(event.key==='ArrowRight'?1:-1)+items.length)%items.length;
       setActive(items[target].id);
       document.getElementById('pkr-tour-tab-'+items[target].id)?.focus();
     }}>
    <span aria-hidden="true">{String(i+1).padStart(2,'0')}</span>{item.tab}
   </button>)}
  </div>

  <div className="pkr-tour-panel" id="pkr-tour-panel" role="tabpanel" aria-labelledby={'pkr-tour-tab-'+selected.id} key={selected.id}>
   <div className="pkr-tour-copy">
    <span className="pkr-tour-overline">{selected.eyebrow}</span>
    <h3>{selected.title}</h3>
    <p>{selected.description}</p>
    <ul>{selected.points.map(point=><li key={point}><span aria-hidden="true">✓</span>{point}</li>)}</ul>
    <Link className="pkr-tour-cta" href={selected.href}>{selected.cta} <span aria-hidden="true">↗</span></Link>
    <div className="pkr-tour-nav" aria-label="Browse PKR features">
     <button type="button" aria-label="Previous feature" onClick={previous}>←</button>
     <span>{String(idx+1).padStart(2,'0')} <b>/</b> {String(items.length).padStart(2,'0')}</span>
     <button type="button" aria-label="Next feature" onClick={next}>→</button>
    </div>
   </div>
   <div className={'pkr-tour-visual'+(selected.id==='table'?' is-table':'')}>
    <div className="pkr-tour-screen-top"><div className="pkr-tour-browser-dots" aria-hidden="true"><i/><i/><i/></div><span>mypkr.app · PKR APP</span><span>● DEMO</span></div>
    <picture>
     {selected.mobile&&<source media="(max-width: 620px)" srcSet={selected.mobile}/>}
     <img src={selected.desktop} alt={selected.alt} width={selected.id==='table'?1440:1225} height={selected.id==='table'?900:845} loading="lazy" decoding="async"/>
    </picture>
    <div className="pkr-tour-sample-note"><span aria-hidden="true">◉</span> REAL PKR SCREEN <span aria-hidden="true">·</span> SAMPLE DATA</div>
   </div>
  </div>

  <div className="pkr-product-proof" aria-label="PKR application screenshot gallery">
   {highlights.map((item)=><Link className="pkr-proof-card" href={item.link} key={item.title}>
    <div className="pkr-proof-card-image"><img src={item.image} alt={item.alt} width={item.title==='Run the table'?1440:1225} height={item.title==='Run the table'?900:845} loading="lazy" decoding="async"/></div>
    <div className="pkr-proof-card-copy"><div><span>{item.label}</span><strong>{item.title}</strong></div><span className="pkr-proof-card-arrow" aria-hidden="true">↗</span></div>
   </Link>)}
  </div>
 </section>;
}

export function MobileProductShowcase(){
 return <section className="pkr-mobile-product-showcase" aria-labelledby="pkr-mobile-showcase-title">
  <div className="pkr-mobile-product-intro">
   <span className="pkr-tour-overline">FROM YOUR PHONE</span>
   <h2 id="pkr-mobile-showcase-title">Your game night <em>in your pocket.</em></h2>
   <p>Check the next game, open the table and view every recorded result from your phone. These are screenshots of PKR running on a real mobile-sized browser.</p>
   <Link href="/install" className="pkr-tour-cta">Use PKR on your phone <span aria-hidden="true">↗</span></Link>
  </div>
  <div className="pkr-mobile-devices">
   {[
    {src:'/demo/mobile-dashboard.webp',title:'Home and rooms',alt:'PKR mobile dashboard screenshot with a fictional poker game and hosts'},
    {src:'/demo/mobile-live-table.webp',title:'The poker table',alt:'PKR live poker table mobile screenshot with a gold-trimmed oval felt'},
    {src:'/demo/mobile-insights.webp',title:'Insights and results',alt:'PKR mobile Insights dashboard screenshot with sample game balances and totals'},
   ].map(item=><figure className="pkr-mobile-device" key={item.src}>
      <div className="pkr-mobile-device-shell"><div className="pkr-mobile-device-speaker" aria-hidden="true"/><img src={item.src} width="390" height="844" alt={item.alt} loading="lazy" decoding="async"/></div>
      <figcaption>{item.title} <span>· Demo</span></figcaption>
    </figure>)}
  </div>
 </section>;
}
