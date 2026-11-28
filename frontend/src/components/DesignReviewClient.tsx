'use client';

import {useState} from 'react';
import PkrGlyph,{type PkrGlyphName} from '@/components/PkrGlyph';

type Area='Home'|'Games'|'Players'|'Results'|'Payments';
type Role='host'|'player';
type Mode='dark'|'light';

const tabs:{name:Area;icon:PkrGlyphName}[]=[
 {name:'Home',icon:'home'},{name:'Games',icon:'games'},
 {name:'Players',icon:'members'},{name:'Results',icon:'trophy'},
 {name:'Payments',icon:'settle'},
];
const initialPlayers=[
 {id:1,name:'Jordan Lee',tag:'JORDAN',initials:'JL',played:18,net:420,status:'host',rsvp:true},
 {id:2,name:'Alex Chen',tag:'ACE',initials:'AC',played:16,net:185,status:'player',rsvp:true},
 {id:3,name:'Sam Patel',tag:'SPLIT',initials:'SP',played:14,net:-120,status:'player',rsvp:true},
 {id:4,name:'Casey Morgan',tag:'KING',initials:'CM',played:12,net:-290,status:'player',rsvp:false},
 {id:5,name:'Taylor Singh',tag:'T',initials:'TS',played:11,net:95,status:'player',rsvp:false},
 {id:6,name:'Riley Brooks',tag:'RB',initials:'RB',played:9,net:-290,status:'player',rsvp:false},
];
const games=[
 {id:1,date:'SAT 05 DEC',name:'Saturday Night Poker',time:'7:00 pm',location:'River City Club',kind:'Upcoming',seats:'6 of 9',buyIn:'$50'},
 {id:2,date:'FRI 11 DEC',name:'Friday Night Cash',time:'7:30 pm',location:'River City Club',kind:'Upcoming',seats:'4 of 9',buyIn:'$50'},
 {id:3,date:'SAT 21 NOV',name:'Saturday Showdown',time:'7:00 pm',location:'River City Club',kind:'Completed',seats:'6 played',buyIn:'$50'},
 {id:4,date:'FRI 13 NOV',name:'Friday Night Cash',time:'7:30 pm',location:'River City Club',kind:'Completed',seats:'5 played',buyIn:'$50'},
];
const money=[{id:1,name:'Sam Patel',direction:'Pay',amount:120,status:'Outstanding'},
 {id:2,name:'Jordan Lee',direction:'Receive',amount:175,status:'Outstanding'},
 {id:3,name:'Alex Chen',direction:'Receive',amount:90,status:'Settled'},
 {id:4,name:'Riley Brooks',direction:'Pay',amount:145,status:'Outstanding'}];
const asMoney=(n:number)=>new Intl.NumberFormat('en-AU',{style:'currency',currency:'AUD',maximumFractionDigits:0}).format(n);
const moneyClass=(n:number)=>n>0?'gain':n<0?'loss':'';
const selectedClub='RIVER CITY POKER';
function Badge({children,tone='blue'}:{children:React.ReactNode;tone?:string}){
 return <span className={'no-demo-badge '+tone}>{children}</span>;
}
function Glyph({name,size=18}:{name:PkrGlyphName;size?:number}){return <PkrGlyph name={name} size={size}/>;}

export default function DesignReviewClient(){
 const [area,setArea]=useState<Area>('Home');
 const [role,setRole]=useState<Role>('host');
 const [mode,setMode]=useState<Mode>('dark');
 const [filter,setFilter]=useState<'Upcoming'|'Completed'|'All'>('Upcoming');
 const [query,setQuery]=useState('');
 const [myRsvp,setRsvp]=useState<'Going'|'Maybe'|'Not going'>('Going');
 const [settled,setSettled]=useState<number[]>([3]);
 const [selectedPlayer,setSelectedPlayer]=useState<number|null>(null);
 const [dialog,setDialog]=useState<string|null>(null);
 const confirmed=3+(myRsvp==='Going'?1:0);
 const viewPayments=money.map(x=>({...x,status:settled.includes(x.id)?'Settled':'Outstanding'}));
 const players=initialPlayers.filter(x=>(x.name+' '+x.tag).toLowerCase().includes(query.trim().toLowerCase()));
 const paymentOutstanding=viewPayments.filter(x=>x.status==='Outstanding');
 const select=(a:Area)=>{setArea(a);setDialog(null);setSelectedPlayer(null);window.scrollTo({top:0,behavior:'instant'});};
 const go=(label:string)=>setDialog(label);
 const showPlayer=(id:number)=>{setSelectedPlayer(id);setArea('Players');window.scrollTo({top:0,behavior:'instant'});};
 const selected=initialPlayers.find(x=>x.id===selectedPlayer);

 function nextPass(){
  return <section className="no-demo-pass" aria-label="Next game night ticket">
   <div className="no-demo-pass-strip"><span>01 / GAME NIGHT PASS</span><img src="/brand/pkr-night-mark.svg" alt="" width={31} height={31}/></div>
   <div className="no-demo-pass-main">
    <div className="no-demo-date"><strong>05</strong><span>DEC</span></div>
    <div className="no-demo-pass-copy"><span>UPCOMING GAME</span><h3>Saturday Night Poker</h3><p><Glyph name="clock" size={16}/> 7:00 pm · Saturday, 5 December</p><p><Glyph name="map-pin" size={16}/> River City Club</p><Badge tone="citron">{confirmed} confirmed · 9 seats</Badge></div>
   </div>
   <div className="no-demo-pass-actions">
    <button type="button" onClick={()=>select('Games')}><Glyph name="members"/> Manage RSVP</button>
    <button type="button" onClick={()=>go('Share game-night invitation')}><Glyph name="share"/> Share invite</button>
   </div>
  </section>;
 }
 const cardStats=role==='host'
  ?[{label:'RSVPS',value:String(confirmed),sub:'Going to the next game',area:'Games' as Area},{label:'PLAYERS',value:'6',sub:'In your club',area:'Players' as Area},{label:'PAYMENTS',value:String(paymentOutstanding.length),sub:'Records to review',area:'Payments' as Area}]
  :[{label:'GAMES PLAYED',value:'16',sub:'Your playing history',area:'Results' as Area},{label:'MY RESULTS',value:'+$185',sub:'Illustrative total',area:'Results' as Area},{label:'MY RSVP',value:myRsvp,sub:'Next game night',area:'Games' as Area}];

 return <div className={'no-demo-app mode-'+mode}>
  <aside className="no-demo-sidebar" aria-label="Demo navigation">
   <div className="no-demo-sidebrand"><img src="/brand/pkr-night-mark.svg" alt="PKR" width={56} height={56}/><div><strong>PKR</strong><small>YOUR PRIVATE GAME CLUB</small></div></div>
   <span className="no-demo-side-kicker">THE NIGHT IS ON.</span>
   <div className="no-demo-club-pill"><Glyph name="club" size={16}/><span>{selectedClub}</span></div>
   <nav aria-label="PKR demo areas">{tabs.map(t=><button key={t.name} type="button" onClick={()=>select(t.name)} className={area===t.name?'active':''} aria-current={area===t.name?'page':undefined}><Glyph name={t.icon} size={21}/><span>{t.name}</span></button>)}</nav>
   <div className="no-demo-sidefoot"><span>DEMONSTRATION ONLY</span><a href="/" className="no-demo-exit"><Glyph name="arrow-up-right" size={16}/> Exit design review</a></div>
  </aside>
  <div className="no-demo-workspace">
   <header className="no-demo-topbar">
    <div className="no-demo-mobile-logo"><img src="/brand/pkr-night-mark.svg" alt="PKR" width={42} height={42}/><div><strong>PKR</strong><small>YOUR PRIVATE GAME CLUB</small></div></div>
    <div className="no-demo-top-venue"><span className="no-demo-top-label">CLUB</span><strong>{selectedClub}</strong></div>
    <span className="no-demo-live-pill"><span/> DESIGN PREVIEW</span>
   </header>
   <div className="no-demo-review-strap">
    <div><Glyph name="shield-check" size={19}/><span><strong>Interactive design review</strong> — fictional players, games and balances. Nothing is saved or connected to your live club.</span></div>
    <a href="/">Leave preview <Glyph name="chevron-right" size={15}/></a>
   </div>
   <div className="no-demo-controls" aria-label="Design review options">
    <div className="no-demo-segment" role="group" aria-label="Preview as">
     <button type="button" className={role==='host'?'active':''} aria-pressed={role==='host'} onClick={()=>{setRole('host');setDialog(null);}}><Glyph name="shield-check" size={16}/> Host</button>
     <button type="button" className={role==='player'?'active':''} aria-pressed={role==='player'} onClick={()=>{setRole('player');setDialog(null);}}><Glyph name="account" size={16}/> Player</button>
    </div>
    <div className="no-demo-segment" role="group" aria-label="Preview colour mode">
     <button type="button" className={mode==='dark'?'active':''} aria-pressed={mode==='dark'} onClick={()=>setMode('dark')}><Glyph name="spade" size={15}/> Dark</button>
     <button type="button" className={mode==='light'?'active':''} aria-pressed={mode==='light'} onClick={()=>setMode('light')}><Glyph name="check" size={15}/> Light</button>
    </div>
   </div>
   <main className="no-demo-content" id="no-demo-main" tabIndex={-1}>
    {area==='Home'&&<>
     {role==='host'?<header className="no-demo-hero">
      <span className="no-demo-cut" aria-hidden="true"/>
      <div className="no-demo-hero-row"><span>PKR / YOUR PRIVATE GAME CLUB</span><Badge tone="coral">HOST</Badge></div>
      <p className="no-demo-eyebrow">UPCOMING GAME</p><h1>THE NIGHT<br/><em>IS ON.</em></h1><p className="no-demo-hero-desc">Your crew. Your table. Your night.</p>
      <div className="no-demo-hero-actions"><button type="button" className="no-demo-primary" onClick={()=>select('Games')}>VIEW GAME NIGHT <Glyph name="chevron-right"/></button><span>{confirmed} confirmed RSVPs</span></div>
     </header>:<header className="no-demo-player-pass">
      <div className="no-demo-pass-top"><span>YOUR CLUB PASS</span><img src="/brand/pkr-night-mark.svg" alt="PKR" width={72} height={72}/></div>
      <h1>{selectedClub}</h1><strong>PKR / CLUB MEMBER</strong>
     </header>}
     <div className="no-demo-section-head"><span>{role==='host'?'YOUR CLUB':'THE NIGHT IS ON.'}</span><h2>{role==='host'?'Your next game night':'Your next game'}</h2><p>{role==='host'?'Everything for the next session, in one place.':'Game details, RSVP and your playing history.'}</p></div>
     {nextPass()}
     <div className="no-demo-kpis">{cardStats.map((x,i)=><button key={x.label} type="button" onClick={()=>select(x.area)} className={'no-demo-kpi kpi-'+i}><span>{x.label}</span><strong>{x.value}</strong><small>{x.sub}</small></button>)}</div>
     <div className="no-demo-section-head smaller"><span>{role==='host'?'HOST CONTROLS':'PLAYER SHORTCUTS'}</span><h2>{role==='host'?'Keep the night moving.':'Your club, organised.'}</h2></div>
     <div className="no-demo-quick-grid">{(role==='host'?
      [{icon:'schedule' as PkrGlyphName,name:'Schedule a game',act:()=>go('Schedule a game')},{icon:'user-add' as PkrGlyphName,name:'Invite your players',act:()=>go('Invite a player')},{icon:'settle' as PkrGlyphName,name:'Settlement records',act:()=>select('Payments')},{icon:'trophy' as PkrGlyphName,name:'Leaderboard',act:()=>select('Results')}]:
      [{icon:'games' as PkrGlyphName,name:'My next game',act:()=>select('Games')},{icon:'trophy' as PkrGlyphName,name:'My results',act:()=>select('Results')},{icon:'members' as PkrGlyphName,name:'Club members',act:()=>select('Players')},{icon:'settle' as PkrGlyphName,name:'Payment records',act:()=>select('Payments')}]
     ).map(x=><button type="button" key={x.name} onClick={x.act}><Glyph name={x.icon} size={22}/><span>{x.name}</span><Glyph name="chevron-right" size={16}/></button>)}</div>
    </>}
    {area==='Games'&&<>
     <header className="no-demo-hero no-demo-hero-small"><span className="no-demo-cut" aria-hidden="true"/><div className="no-demo-hero-row"><span>PKR / GAME NIGHTS</span><Badge tone="coral">{role.toUpperCase()}</Badge></div><h1>THE NIGHT<br/><em>IS ON.</em></h1><p className="no-demo-hero-desc">{selectedClub}</p>
     <div className="no-demo-hero-metrics"><button type="button" onClick={()=>setFilter('Upcoming')}><strong>2</strong>UPCOMING</button><button type="button" onClick={()=>setFilter('All')}><strong>0</strong>LIVE</button><button type="button" onClick={()=>setFilter('Completed')}><strong>2</strong>PLAYED</button></div></header>
     <div className="no-demo-content-head"><div><span>THE SCHEDULE</span><h2>Your game nights</h2></div>{role==='host'&&<button type="button" className="no-demo-outline" onClick={()=>go('Schedule a game')}><Glyph name="schedule"/> + New game</button>}</div>
     <div className="no-demo-filter" role="group" aria-label="Game status">{(['Upcoming','Completed','All'] as const).map(x=><button key={x} aria-pressed={filter===x} className={filter===x?'active':''} onClick={()=>setFilter(x)}>{x}</button>)}</div>
     <div className="no-demo-game-list">{games.filter(x=>filter==='All'||x.kind===filter).map((game,i)=><article key={game.id} className="no-demo-game">
      <div className="no-demo-game-heading"><span>GAME NIGHT / {String(game.id).padStart(2,'0')}</span><Badge tone={game.kind==='Upcoming'?'citron':'slate'}>{game.kind}</Badge></div>
      <div className="no-demo-game-body"><div className="no-demo-date"><strong>{game.date.split(' ')[1]}</strong><span>{game.date.split(' ')[2]}</span></div><div><h3>{game.name}</h3><p><Glyph name="clock" size={15}/> {game.time} · {game.location}</p><p><Glyph name="members" size={15}/> {game.seats} · Buy-in {game.buyIn}</p></div></div>
      <div className="no-demo-game-actions">{game.kind==='Upcoming'?<>
       <button type="button" className="no-demo-outline" onClick={()=>go('Game details: '+game.name)}>Game details</button>
       <button type="button" className="no-demo-primary" onClick={()=>go(role==='host'?'RSVP list: '+game.name:'My RSVP: '+myRsvp)}>RSVPs & seats <Glyph name="chevron-right"/></button>
      </>:<button type="button" className="no-demo-primary" onClick={()=>select('Results')}>View saved results <Glyph name="chevron-right"/></button>}
      </div></article>)}</div>
     <div className="no-demo-rsvp"><div><span>YOUR RSVP / 05 DEC</span><h3>Will you be there?</h3><p>Change your response to see the interface update.</p></div><div className="no-demo-rsvp-opts">{(['Going','Maybe','Not going'] as const).map(x=><button key={x} aria-pressed={myRsvp===x} className={myRsvp===x?'active':''} onClick={()=>setRsvp(x)}>{x}</button>)}</div></div>
    </>}
    {area==='Players'&&<>
     <header className="no-demo-people-hero"><div><span>PKR / YOUR PEOPLE</span><h1>THE <em>CREW.</em></h1><p>{selectedClub}</p><Badge tone="blue">6 club members</Badge></div><div className="no-demo-numbered" aria-hidden="true"><b>01</b><b>02</b><b>03</b></div></header>
     <div className="no-demo-content-head"><div><span>CLUB DIRECTORY</span><h2>Player profiles</h2></div>{role==='host'&&<button className="no-demo-outline" onClick={()=>go('Invite a player')} type="button"><Glyph name="user-add"/> Invite</button>}</div>
     <label className="no-demo-search"><Glyph name="search" size={19}/><input value={query} onChange={e=>setQuery(e.target.value)} placeholder="Search players or nicknames" aria-label="Search players"/></label>
     <div className="no-demo-roster">{players.map((p,i)=><button type="button" key={p.id} className="no-demo-person" onClick={()=>setSelectedPlayer(selectedPlayer===p.id?null:p.id)} aria-expanded={selectedPlayer===p.id}><span className={'no-demo-avatar av-'+(p.id%3)}>{p.initials}</span><span className="no-demo-person-info"><strong>{p.name}</strong><small>@{p.tag} · {p.played} games</small></span><strong className={'no-demo-net '+moneyClass(p.net)}>{p.net>0?'+':''}{asMoney(p.net)}</strong><Glyph name="chevron-right" size={17}/></button>)}
      {!players.length&&<p className="no-demo-empty">No players match that search.</p>}</div>
     {selected&&<section className="no-demo-drawer" aria-label="Selected player"><div><span>PLAYER PASS / {String(selected.id).padStart(2,'0')}</span><button onClick={()=>setSelectedPlayer(null)} aria-label="Close player details"><Glyph name="close"/></button></div><h3>{selected.name}</h3><p>Screen name @{selected.tag} · {selected.played} games played</p><div><span>Illustrative result</span><strong className={moneyClass(selected.net)}>{selected.net>0?'+':''}{asMoney(selected.net)}</strong></div><button className="no-demo-outline" onClick={()=>select('Results')}>View game history <Glyph name="chevron-right"/></button></section>}
    </>}
    {area==='Results'&&<>
     <header className="no-demo-record-head"><div><span>PKR / CLUB RESULTS</span><h1>THE <em>RESULTS.</em></h1><p>{selectedClub} · Every game has a story.</p></div><img src="/brand/pkr-night-mark.svg" alt="" width={72} height={72}/></header>
     <div className="no-demo-content-head"><div><span>LEADERBOARD</span><h2>Top performers</h2></div><Badge tone="citron">2 settled games</Badge></div>
     <div className="no-demo-podium">{initialPlayers.slice(0,3).map((p,i)=><button className={'no-demo-podium-member rank-'+i} type="button" key={p.id} onClick={()=>showPlayer(p.id)}><span>#{i+1}</span><span className={'no-demo-avatar av-'+i}>{p.initials}</span><strong>{p.name}</strong><small>{p.played} games played</small><b className={moneyClass(p.net)}>{p.net>0?'+':''}{asMoney(p.net)}</b></button>)}</div>
     <div className="no-demo-content-head"><div><span>GAME HISTORY</span><h2>Past sessions</h2></div></div>
     {games.filter(x=>x.kind==='Completed').map(g=><article className="no-demo-history" key={g.id}><div className="no-demo-history-symbol"><Glyph name="trophy" size={25}/></div><div><h3>{g.name}</h3><p>{g.date} · {g.seats}</p></div><button type="button" className="no-demo-outline" onClick={()=>go('Session results: '+g.name)}>Open results <Glyph name="chevron-right"/></button></article>)}
     <button className="no-demo-share" type="button" onClick={()=>go('Share club results')}><Glyph name="share"/> Share results graphic <Glyph name="chevron-right"/></button>
    </>}
    {area==='Payments'&&<>
     <header className="no-demo-record-head payment"><div><span>PKR / PAYMENT RECORDS</span><h1>THE <em>LEDGER.</em></h1><p>Review who owes whom after the last hand.</p></div><img src="/brand/pkr-night-mark.svg" alt="" width={72} height={72}/></header>
     <div className="no-demo-payment-summary"><div><span>TO RECEIVE</span><strong className="gain">{asMoney(paymentOutstanding.filter(x=>x.direction==='Receive').reduce((v,x)=>v+x.amount,0))}</strong><small>Outstanding records</small></div><div><span>TO PAY</span><strong className="loss">{asMoney(paymentOutstanding.filter(x=>x.direction==='Pay').reduce((v,x)=>v+x.amount,0))}</strong><small>Outstanding records</small></div></div>
     <div className="no-demo-content-head"><div><span>SETTLEMENT TRACKER</span><h2>{role==='host'?'Club transactions':'My payment records'}</h2></div><Badge tone="coral">{paymentOutstanding.length} to review</Badge></div>
     <div className="no-demo-payment-list">{viewPayments.map(m=><article className="no-demo-payment-row" key={m.id}><span className={'no-demo-avatar av-'+(m.id%3)}>{m.name.split(' ').map(x=>x[0]).join('')}</span><div className="no-demo-payment-name"><strong>{m.name}</strong><small>{m.direction==='Pay'?'Payment owed':'Payment expected'}</small></div><div className="no-demo-payment-amount"><strong className={m.direction==='Pay'?'loss':'gain'}>{asMoney(m.amount)}</strong><small>{m.status}</small></div><button type="button" disabled={role==='player'} className={'no-demo-mark '+(m.status==='Settled'?'done':'')} onClick={()=>setSettled(p=>p.includes(m.id)?p.filter(id=>id!==m.id):[...p,m.id])} aria-label={(m.status==='Settled'?'Mark outstanding for ':'Mark settled for ')+m.name}>{m.status==='Settled'?'Settled':'Settle'}</button></article>)}</div>
     <p className="no-demo-financial"><Glyph name="shield-check" size={18}/> PKR records settlements; it does not handle or transfer money. All amounts and actions on this page are fictional and local to this preview.</p>
    </>}
   </main>
   <nav className="no-demo-bottom" aria-label="Demo navigation">{tabs.map(t=><button type="button" key={t.name} className={area===t.name?'active':''} onClick={()=>select(t.name)} aria-current={area===t.name?'page':undefined}><Glyph name={t.icon} size={21}/><span>{t.name}</span></button>)}</nav>
  </div>
  {dialog&&<div className="no-demo-dialog-mask" role="presentation" onMouseDown={e=>{if(e.target===e.currentTarget)setDialog(null);}}>
   <section role="dialog" aria-modal="true" aria-label={dialog} className="no-demo-dialog">
    <div className="no-demo-dialog-top"><span>PKR / DEMONSTRATION</span><button onClick={()=>setDialog(null)} aria-label="Close dialog"><Glyph name="close" size={20}/></button></div>
    <img src="/brand/pkr-night-mark.svg" alt="" width={62} height={62}/>
    <h2>{dialog}</h2>
    <p>This is an interactive design walkthrough using fictional club data. Real invitations, sessions, payments and player changes are unavailable in review mode.</p>
    {dialog.includes('RSVP')&&<div className="no-demo-rsvp-opts">{(['Going','Maybe','Not going'] as const).map(x=><button key={x} className={myRsvp===x?'active':''} onClick={()=>{setRsvp(x);setDialog(null);}}>{x}</button>)}</div>}
    <button className="no-demo-primary" onClick={()=>setDialog(null)}>Continue reviewing <Glyph name="chevron-right"/></button>
   </section>
  </div>}
 </div>;
}
