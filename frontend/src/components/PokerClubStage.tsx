'use client';

import {useEffect,useState,type ReactNode} from 'react';
import type {RoomDashboardLayout} from '@/lib/api';
import type {RecordRequest} from '@/lib/record-details';
import RecordMetric from '@/components/RecordMetric';
import PkrGlyph from '@/components/PkrGlyph';

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

type StageMetric={label:string;value:string|number}&(
 {request:RecordRequest;onClick?:never}|{onClick:()=>void;request?:never}
);
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
 const metric=(item:StageMetric,index:number,live=false)=>{
  const className=live?'pkr-experience-live-metric':'pkr-experience-command-stat stat-'+index;
  const contents=live?<><strong>{item.value}</strong><small>{item.label}</small></>:
   <><span>{item.label}</span><strong>{item.value}</strong></>;
  return item.request?<RecordMetric bare key={item.label} className={className} request={item.request}>{contents}</RecordMetric>:
   <button type="button" key={item.label} className={'pkr-record-action '+className}
    aria-label={'View underlying records: '+item.label} onClick={item.onClick}>{contents}</button>;
 };
 if(mode==='live'){
  return <section className={'pkr-experience-stage pkr-experience-stage-live pkr-experience-live pkr-experience-'+kind}
    data-testid={kind+'-live-stage'} aria-label={title+' — Live Poker'}>
    <div className="pkr-experience-live-copy">
      <span className="pkr-experience-eyebrow"><PkrGlyph name="table"/> LIVE POKER · {club}</span>
      <h1>{title}</h1><p>{subtitle}</p>
      <div className="pkr-experience-live-metrics">
       {metrics.map((item,index)=>metric(item,index,true))}
      </div>
      {children}
    </div>
    <div className="pkr-experience-felt" aria-label="Poker club atmosphere">
      <span className="pkr-experience-chip chip-a"><PkrGlyph name="spade"/></span>
      <span className="pkr-experience-chip chip-b"><PkrGlyph name="club"/></span>
      <span className="pkr-experience-chip chip-c"><PkrGlyph name="diamond"/></span>
      <div className="pkr-experience-felt-table"><strong>PKR</strong><small>{kind==='games'?'GAME NIGHT':kind==='payments'?'SETTLE UP':'PLAYERS CLUB'}</small></div>
      {players.slice(0,4).map((name,i)=><span className={'pkr-experience-felt-seat seat-'+i} key={name+i}
        title={name}>{name.split(' ')[0]}</span>)}
    </div>
   </section>;
 }
 return <section className={'pkr-experience-stage pkr-experience-stage-command pkr-experience-command pkr-experience-'+kind}
   data-testid={kind+'-command-stage'} aria-label={title+' — Command Centre'}>
   <div className="pkr-experience-command-copy">
     <span className="pkr-experience-eyebrow"><PkrGlyph name="grid"/> COMMAND CENTRE · {club}</span>
     <h1>{title}</h1><p>{subtitle}</p>
     {children}
   </div>
   <div className="pkr-experience-command-stats">
     {metrics.map((item,index)=>metric(item,index))}
   </div>
  </section>;
}
