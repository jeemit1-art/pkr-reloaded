'use client';

import {useEffect,useState,type ReactNode} from 'react';
import type {RoomDashboardLayout} from '@/lib/api';

/** React-facing read-only mirror of the existing, host-saved room choice.
 * No extra API calls: RoomExperienceTheme already resolves this per room.
 */
export function useRoomExperience():RoomDashboardLayout{
 const [mode,setMode]=useState<RoomDashboardLayout>('command');
 useEffect(()=>{
  const root=document.documentElement;
  const sync=()=>setMode(root.getAttribute('data-pkr-room-experience')==='live'?'live':'command');
  sync();
  const observer=new MutationObserver(sync);
  observer.observe(root,{attributes:true,attributeFilter:['data-pkr-room-experience']});
  return()=>observer.disconnect();
 },[]);
 return mode;
}

type StageMetric={label:string;value:string|number};
type StageProps={
 kind:'games'|'players'|'payments';
 title:string;
 subtitle:string;
 club:string;
 metrics:StageMetric[];
 players?:string[];
 children?:ReactNode;
};

/**
 * The two previously approved dashboard *compositions* carry into the other
 * rooms. This is actual alternate markup, not a class that recolours one card.
 * Uses only real counts/names passed by the parent.
 */
export function PokerClubStage({kind,title,subtitle,club,metrics,players=[],children}:StageProps){
 const mode=useRoomExperience();
 if(mode==='live'){
  return <section className={'pkr-experience-stage pkr-experience-stage-live pkr-experience-'+kind}
    data-testid={kind+'-live-stage'} aria-label={title+' — Live Poker'}>
    <div className="pkr-experience-live-copy">
      <span className="pkr-experience-eyebrow">♠ LIVE POKER · {club}</span>
      <h1>{title}</h1><p>{subtitle}</p>
      <div className="pkr-experience-live-metrics">
       {metrics.map(m=><span key={m.label}><strong>{m.value}</strong><small>{m.label}</small></span>)}
      </div>
      {children}
    </div>
    <div className="pkr-experience-felt" aria-label="Poker club atmosphere">
      <span className="pkr-experience-chip chip-a">♠</span>
      <span className="pkr-experience-chip chip-b">♣</span>
      <span className="pkr-experience-chip chip-c">♦</span>
      <div className="pkr-experience-felt-table"><strong>PKR</strong><small>{kind==='games'?'GAME NIGHT':kind==='payments'?'SETTLE UP':'PLAYERS CLUB'}</small></div>
      {players.slice(0,4).map((name,i)=><span className={'pkr-experience-felt-seat seat-'+i} key={name+i}
        title={name}>{name.split(' ')[0]}</span>)}
    </div>
   </section>;
 }
 return <section className={'pkr-experience-stage pkr-experience-stage-command pkr-experience-'+kind}
   data-testid={kind+'-command-stage'} aria-label={title+' — Command Centre'}>
   <div className="pkr-experience-command-copy">
     <span className="pkr-experience-eyebrow">◆ COMMAND CENTRE · {club}</span>
     <h1>{title}</h1><p>{subtitle}</p>
     {children}
   </div>
   <div className="pkr-experience-command-stats">
     {metrics.map((m,i)=><div className={'pkr-experience-command-stat stat-'+i} key={m.label}>
       <span>{m.label}</span><strong>{m.value}</strong>
     </div>)}
   </div>
  </section>;
}
