'use client';

import {useState} from 'react';
import Link from 'next/link';
import AppDialog from '@/components/AppDialog';
import PkrGlyph,{type PkrGlyphName} from '@/components/PkrGlyph';
import SwipeDismissHandle from '@/components/SwipeDismissHandle';

const images='/demo/launch-20261127/';
type Preview={src:string;title:string;alt:string;width:number;height:number};
type TourItem={
 id:string;tab:string;icon:PkrGlyphName;eyebrow:string;title:string;description:string;
 image:string;mobile?:string;portrait?:boolean;alt:string;points:string[];href:string;cta:string;
};
const items:TourItem[]=[
 {id:'dashboard',tab:'Home',icon:'home',eyebrow:'YOUR GAME NIGHT, AT A GLANCE',title:'A home for your poker club.',
  description:'Open PKR and see what your group needs next. Your next game, players, payments and recent results are together on Home.',
  image:'desktop-home.webp',mobile:'mobile-home.webp',alt:'PKR Home showing the next game, club activity, payments and results for a fictional private club',
  points:['Quick access to your next game','Games, players, results and payments','Full dashboard layouts remain available'],href:'/pricing',cta:'Find your host plan'},
 {id:'table',tab:'Live poker table',icon:'table',eyebrow:'KEEP THE GAME MOVING',title:'Every seat. Every buy-in.',
  description:'See players around the table, record buy-ins and cash-outs, and keep the bank in view. Switch table layouts to suit your screen and your group.',
  image:'desktop-live-table.webp',mobile:'mobile-live-table.webp',alt:'Actual PKR cash-game table with fictional seated players, buy-ins and host controls',
  points:['Player seats with names and avatars','Buy-ins, stacks and the game bank','Full and compact table views'],href:'/home-poker-game-tracker',cta:'Explore cash games'},
 {id:'rsvp',tab:'Invites & RSVPs',icon:'schedule',eyebrow:'GET EVERYONE TO THE TABLE',title:'Know who is coming.',
  description:'Collect responses before the game, plan arrivals and let your players choose seats. Share the useful details with your group when they need them.',
  image:'mobile-rsvp.webp',portrait:true,alt:'PKR RSVP screen for a fictional upcoming game, with attendance responses and seat planning',
  points:['Personal invitations and host approval','RSVPs and arrival times','Game links ready to share'],href:'/home-poker-game-tracker',cta:'See how PKR works'},
 {id:'tournaments',tab:'Tournaments',icon:'trophy',eyebrow:'YOUR GAME, YOUR FORMAT',title:'Keep the tournament on track.',
  description:'Run blind levels and the tournament clock alongside your player and game controls, with everything in one place.',
  image:'mobile-tournament.webp',portrait:true,alt:'Actual PKR tournament view with blind levels, timer and fictional game data',
  points:['Tournament blind structures','A clear tournament timer','Player and host controls together'],href:'/poker-tournament-manager',cta:'Explore tournaments'},
 {id:'players',tab:'Players',icon:'users',eyebrow:'YOUR REGULARS, ALL TOGETHER',title:'A club built around your people.',
  description:'Keep your members, profiles and invitations organised. Open a player’s game history when you want to see how their nights have played out.',
  image:'mobile-players.webp',portrait:true,alt:'Actual PKR Players screen with fictional member profiles and game-history links',
  points:['Player names, avatars and profiles','Invitations, QR codes and approvals','Individual game history'],href:'/home-poker-game-tracker',cta:'Explore your club tools'},
 {id:'results',tab:'Results & records',icon:'insights',eyebrow:'THE STORY BEHIND EVERY NUMBER',title:'See the result. Open the record.',
  description:'Compare standings and player performance, then tap a total to see the saved games behind it. Your history stays available after the night ends.',
  image:'mobile-results.webp',portrait:true,alt:'PKR Results showing fictional player standings and recorded performance',
  points:['Club standings and player results','Searchable underlying records','Game history across your club'],href:'/home-poker-game-tracker',cta:'Learn about game tracking'},
 {id:'payments',tab:'Payments',icon:'settle',eyebrow:'FINISH WITH CLARITY',title:'Everyone knows where they stand.',
  description:'See what is still to pay or receive, review settlement records and find past payments. Your group arranges the money transfers outside PKR.',
  image:'mobile-payments.webp',portrait:true,alt:'Actual PKR Payments overview with fictional amounts to pay and receive and payment records',
  points:['Personal and club payment views','Open payments and payment history','Search and filter saved records'],href:'/home-poker-settlement',cta:'Explore settlements'},
 {id:'settings',tab:'Your setup',icon:'settings',eyebrow:'MAKE PKR FIT YOUR CLUB',title:'Your club, your preferences.',
  description:'Choose the club dashboard layout, manage notifications and keep your installed app up to date from Account.',
  image:'mobile-account.webp',portrait:true,alt:'PKR Account screen with club layout choices, notification preferences and app settings',
  points:['Command Centre and Live Poker layouts','Club notification preferences','Home Screen installation and updates'],href:'/install',cta:'Use PKR on your phone'},
];

function ImagePreview({preview,onClose}:{preview:Preview;onClose:()=>void}){
 return <AppDialog className="pkr-launch-preview-dialog" aria-labelledby="pkr-launch-preview-title" onDismiss={onClose} swipeToDismiss
   onClick={event=>{if(event.target===event.currentTarget)onClose();}}>
  <div className={'pkr-launch-preview'+(preview.height>preview.width?' is-portrait':'')}>
   <SwipeDismissHandle/>
   <header><div><h2 id="pkr-launch-preview-title">{preview.title}</h2><p>Actual PKR screen · Fictional demo data</p></div><button type="button" onClick={onClose} aria-label="Close screenshot"><PkrGlyph name="close" size={20}/><span>Close</span></button></header>
   <div className="pkr-launch-preview-image"><img src={preview.src} width={preview.width} height={preview.height} alt={preview.alt}/></div>
  </div>
 </AppDialog>;
}

export function ProductTour(){
 const [active,setActive]=useState('dashboard');
 const [preview,setPreview]=useState<Preview|null>(null);
 const selected=items.find(item=>item.id===active)||items[0];
 const idx=items.findIndex(item=>item.id===active);
 function enlargeSelected(){
  const mobile=selected.mobile&&window.matchMedia('(max-width: 620px)').matches;
  const portrait=Boolean(mobile||selected.portrait);
  setPreview({src:images+(mobile?selected.mobile:selected.image),title:selected.tab,alt:selected.alt,width:portrait?430:1440,height:portrait?873:900});
 }
 return <section className="pkr-product-tour" id="product-tour" aria-labelledby="pkr-product-tour-title">
  <div className="pkr-product-tour-header"><span className="pkr-tour-overline">TAKE A LOOK INSIDE</span><h2 id="pkr-product-tour-title">Your whole game night.<br/><em>One connected app.</em></h2><p>Explore the current PKR app with fictional players and games. Select a feature, then tap its screen for a closer look.</p></div>
  <div className="pkr-tour-tabs" role="tablist" aria-label="PKR app features">
   {items.map((item,i)=><button type="button" role="tab" aria-selected={item.id===active} aria-controls="pkr-tour-panel" id={'pkr-tour-tab-'+item.id} tabIndex={item.id===active?0:-1}
    className={'pkr-tour-tab'+(item.id===active?' selected':'')} key={item.id} onClick={()=>setActive(item.id)}
    onKeyDown={event=>{if(!['ArrowLeft','ArrowRight','Home','End'].includes(event.key))return;event.preventDefault();const target=event.key==='Home'?0:event.key==='End'?items.length-1:(i+(event.key==='ArrowRight'?1:-1)+items.length)%items.length;setActive(items[target].id);document.getElementById('pkr-tour-tab-'+items[target].id)?.focus();}}>
    <PkrGlyph name={item.icon} size={19}/>{item.tab}
   </button>)}
  </div>
  <div className={'pkr-tour-panel'+(selected.portrait?' has-portrait':'')} id="pkr-tour-panel" role="tabpanel" aria-labelledby={'pkr-tour-tab-'+selected.id}>
   <div className="pkr-tour-copy"><span className="pkr-tour-overline">{selected.eyebrow}</span><h3>{selected.title}</h3><p>{selected.description}</p><ul>{selected.points.map(point=><li key={point}><PkrGlyph name="check" size={18}/>{point}</li>)}</ul><Link className="pkr-tour-cta" href={selected.href}>{selected.cta}</Link>
    <div className="pkr-tour-nav" aria-label="Browse PKR features"><button type="button" onClick={()=>setActive(items[(idx-1+items.length)%items.length].id)}>Previous</button><span>{idx+1} of {items.length}</span><button type="button" onClick={()=>setActive(items[(idx+1)%items.length].id)}>Next</button></div>
   </div>
   <button type="button" className={'pkr-tour-visual'+(selected.portrait?' is-portrait':'')} onClick={enlargeSelected} aria-label={'Enlarge screenshot: '+selected.tab}>
    <span className="pkr-tour-screen-top"><span>{selected.tab}</span><span><PkrGlyph name="search" size={15}/> Enlarge</span></span>
    <picture>{selected.mobile&&<source media="(max-width: 620px)" srcSet={images+selected.mobile}/>}<img src={images+selected.image} alt={selected.alt} width={selected.portrait?430:1440} height={selected.portrait?873:900} loading="lazy" decoding="async"/></picture>
    <span className="pkr-tour-sample-note">Actual app · Demo data</span>
   </button>
  </div>
  <div className="pkr-product-proof" aria-label="More PKR app screens">
   {[
    {src:'mobile-records.webp',title:'Go deeper into every result',label:'Searchable underlying records',alt:'PKR underlying-records window with fictional saved games and a swipe-down handle',portrait:true},
    {src:'desktop-command-centre.webp',title:'See the full club picture',label:'Command Centre layout',alt:'PKR Command Centre dashboard with fictional club games, people and results',portrait:false},
    {src:'desktop-live-dashboard.webp',title:'Focus on the next game',label:'Live Poker layout',alt:'PKR Live Poker dashboard with fictional club and game-night information',portrait:false},
   ].map(item=><button type="button" className="pkr-proof-card" key={item.src} onClick={()=>setPreview({src:images+item.src,title:item.label,alt:item.alt,width:item.portrait?430:1440,height:item.portrait?873:900})} aria-label={'Enlarge screenshot: '+item.label}>
    <span className={'pkr-proof-card-image'+(item.portrait?' is-portrait':'')}><img src={images+item.src} alt={item.alt} width={item.portrait?430:1440} height={item.portrait?873:900} loading="lazy" decoding="async"/></span><span className="pkr-proof-card-copy"><span>{item.label}</span><strong>{item.title}</strong><span className="pkr-proof-enlarge"><PkrGlyph name="search" size={16}/> View screen</span></span>
   </button>)}
  </div>
  {preview&&<ImagePreview preview={preview} onClose={()=>setPreview(null)}/>}
 </section>;
}

export function MobileProductShowcase(){
 const [preview,setPreview]=useState<Preview|null>(null);
 return <section className="pkr-mobile-product-showcase" aria-labelledby="pkr-mobile-showcase-title">
  <div className="pkr-mobile-product-intro"><span className="pkr-tour-overline">MADE TO GO WITH YOU</span><h2 id="pkr-mobile-showcase-title">The club.<br/>In <em>your pocket.</em></h2><p>Check the next game, open the records behind a result and keep track of payments from your phone.</p><p className="pkr-mobile-install-note">Use PKR in your browser or add it to your Home Screen. Your host and player tools stay together.</p><Link href="/install" className="pkr-tour-cta">Add PKR to your Home Screen</Link></div>
  <div className="pkr-mobile-devices">{[
    {src:'mobile-home.webp',title:'Your game night',alt:'Current PKR Home on a phone with fictional club activity'},
    {src:'mobile-records.webp',title:'Every record',alt:'PKR saved-records window on a phone with fictional game history'},
    {src:'mobile-payments.webp',title:'Clear payments',alt:'Current PKR payment overview on a phone with fictional amounts and records'},
   ].map(item=><figure className="pkr-mobile-device" key={item.src}><button type="button" className="pkr-mobile-device-shell" aria-label={'Enlarge screenshot: '+item.title} onClick={()=>setPreview({src:images+item.src,title:item.title,alt:item.alt,width:430,height:873})}><img src={images+item.src} width="430" height="873" alt={item.alt} loading="lazy" decoding="async"/></button><figcaption>{item.title}<small>Actual app · Demo data</small></figcaption></figure>)}</div>
  {preview&&<ImagePreview preview={preview} onClose={()=>setPreview(null)}/>}
 </section>;
}
