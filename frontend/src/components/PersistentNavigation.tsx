'use client';
import AppDialog from '@/components/AppDialog';

import {Fragment,useEffect,useState} from 'react';
import {usePathname,useRouter} from 'next/navigation';
import {api,Event,getToken} from '@/lib/api';
import PkrGlyph from '@/components/PkrGlyph';

/* Primary actions stay visible. Less-frequent tools live in the More drawer.
   This is navigation only: it never changes game data or financial records. */
const mobileNavigation=[
 {name:'Home',icon:'home',href:'/dashboard'},
 {name:'Games',icon:'games',href:'room'},
 {name:'Game Night',icon:'schedule',href:'night'},
 {name:'Members',icon:'members',href:'members'},
 {name:'More',icon:'install',href:'#more'},
] as const;
const playerNavigation=[
 {name:'Home',icon:'home',href:'/dashboard'},
 {name:'Games',icon:'games',href:'room'},
 {name:'Game Night',icon:'schedule',href:'night'},
 {name:'Standings',icon:'players',href:'leaderboard'},
 {name:'More',icon:'install',href:'#more'},
] as const;

const navigation=[
 {name:'Home',icon:'home',href:'/dashboard',group:'OVERVIEW'},
 {name:'Games',icon:'games',href:'room',group:'PLAY & SCHEDULE'},
 {name:'Game Night',icon:'schedule',href:'night',group:'RSVPS & UPDATES'},
 {name:'Game history',icon:'games',href:'history',group:'GAME NIGHT'},
 {name:'Standings',icon:'players',href:'leaderboard',group:'GAME NIGHT'},
 {name:'Schedule',icon:'schedule',href:'/schedule',group:'GAME NIGHT'},
 {name:'Members',icon:'members',href:'members',group:'CLUB & PEOPLE'},
 {name:'Insights',icon:'insights',href:'/insights',group:'FINANCES & RESULTS'},
 {name:'Settlements',icon:'settle',href:'/insights#pkr-settlement',group:'FINANCES & RESULTS'},
 {name:'Install PKR',icon:'install',href:'/install',group:'YOUR ACCOUNT'},
] as const;
const playerDesktopNavigation=[
 {name:'Home',icon:'home',href:'/dashboard',group:'PLAYER HOME'},
 {name:'Games',icon:'games',href:'room',group:'YOUR ROOM'},
 {name:'Game Night',icon:'schedule',href:'night',group:'YOUR ROOM'},
 {name:'Standings',icon:'players',href:'leaderboard',group:'YOUR ROOM'},
 {name:'Members',icon:'members',href:'members',group:'YOUR ROOM'},
 {name:'My payments',icon:'settle',href:'payments',group:'YOUR RECORDS'},
 {name:'Install PKR',icon:'install',href:'/install',group:'YOUR ACCOUNT'},
] as const;

const moreNavigation=[
 {name:'Insights',icon:'insights',href:'/insights'},
 {name:'Game history',icon:'games',href:'history'},
 {name:'Standings',icon:'players',href:'leaderboard'},
 {name:'Schedule',icon:'schedule',href:'/schedule'},
 {name:'Settlements',icon:'settle',href:'/insights#pkr-settlement'},
 {name:'Share room',icon:'members',href:'share'},
 {name:'Install PKR',icon:'install',href:'/install'},
] as const;
const playerMoreNavigation=[
 {name:'My payments',icon:'settle',href:'payments'},
 {name:'Room members',icon:'members',href:'members'},
 {name:'Game history',icon:'games',href:'history'},
 {name:'Scan invitation',icon:'games',href:'scan'},
 {name:'Install PKR',icon:'install',href:'/install'},
] as const;

export default function PersistentNavigation(){
 const pathname=usePathname()||'';
 const router=useRouter();
 const [rooms,setRooms]=useState<Event[]>([]);
 const [hasSession,setHasSession]=useState(false);
 const [gameEventId,setGameEventId]=useState<string|null>(null);
 const [roomTab,setRoomTab]=useState('games');
 const [preferredRoomId,setPreferredRoomId]=useState('');
 const [insightsHash,setInsightsHash]=useState('');
 const [moreOpen,setMoreOpen]=useState(false);

 useEffect(()=>{
  try{setPreferredRoomId(localStorage.getItem('pkr_preferred_room')||'')}catch{}
 },[]);
 useEffect(()=>{
  const room=pathname.match(/^\/events\/([^/]+)/)?.[1];
  if(!room)return;
  setPreferredRoomId(room);
  try{localStorage.setItem('pkr_preferred_room',room)}catch{}
 },[pathname]);
 useEffect(()=>{
  if(!gameEventId)return;
  setPreferredRoomId(gameEventId);
  try{localStorage.setItem('pkr_preferred_room',gameEventId)}catch{}
 },[gameEventId]);
 useEffect(()=>{
  const sync=()=>setInsightsHash(window.location.hash);
  sync();
  window.addEventListener('hashchange',sync);
  window.addEventListener('popstate',sync);
  return()=>{window.removeEventListener('hashchange',sync);window.removeEventListener('popstate',sync)};
 },[pathname]);
 useEffect(()=>{
  setRoomTab(typeof window==='undefined'?'games':new URLSearchParams(window.location.search).get('tab')||'games');
 },[pathname]);
 useEffect(()=>{
  const onRoomTab=(e:globalThis.Event)=>{
   const tab=(e as CustomEvent<string>).detail;
   if(['games','night','leaderboard','history','members'].includes(tab))setRoomTab(tab);
  };
  window.addEventListener('pkr:select-room-tab',onRoomTab);
  return()=>window.removeEventListener('pkr:select-room-tab',onRoomTab);
 },[]);
 useEffect(()=>{
  if(!moreOpen)return;
  const escape=(event:KeyboardEvent)=>{if(event.key==='Escape')setMoreOpen(false)};
  window.addEventListener('keydown',escape);
  return()=>window.removeEventListener('keydown',escape);
 },[moreOpen]);
 // The playable table is full-screen: never render a sidebar, drawer or bottom nav.
 const isActiveGameplay=/^\/games\/[^/]+\/(play|tv)\/?$/.test(pathname);
 const allowed=/^\/(dashboard|insights|schedule|events\/[^/]+|games\/[^/]+|install)(\/|$)/.test(pathname)
  && !/^\/games\/live\//.test(pathname) && !isActiveGameplay;
 useEffect(()=>{setHasSession(Boolean(getToken()))},[pathname]);
 useEffect(()=>{
  if(!allowed||!hasSession)return;
  let live=true;
  api.events.list().then(r=>{if(live)setRooms(r)}).catch(()=>{});
  return()=>{live=false};
 },[allowed,hasSession]);
 // A game belongs to its actual room; never silently navigate to another room.
 useEffect(()=>{
  const match=pathname.match(/^\/games\/([^/]+)/);
  setGameEventId(null);
  if(!hasSession||!match||match[1]==='live'||match[1]==='results')return;
  let live=true;
  api.games.get(match[1]).then(game=>{if(live)setGameEventId(game.event_id)}).catch(()=>{});
  return()=>{live=false};
 },[pathname,hasSession]);
 if(!allowed||!hasSession)return null;

 // Archived rooms remain accessible from history, but never become the default.
 const preferredRoom=rooms.find(r=>r.id===preferredRoomId&&r.status!=='ended');
 const eventId=pathname.match(/^\/events\/([^/]+)/)?.[1]
  ||gameEventId||preferredRoom?.id||rooms.find(r=>r.status!=='ended')?.id||rooms[0]?.id;
 const roomPath=eventId?'/events/'+encodeURIComponent(eventId):'/dashboard';
 const roomChoices=rooms.filter(r=>r.status!=='ended'||r.id===eventId);
 const isMemberView=rooms.find(r=>r.id===eventId)?.role==='member';
 const inRoom=pathname.startsWith('/events/');
 const inGame=pathname.startsWith('/games/');
 const isSettlement=pathname==='/insights'&&insightsHash==='#pkr-settlement';

 function selected(name:string,mobile=false){
  switch(name){
   case 'Home':return pathname==='/dashboard';
   case 'Games':case 'Rooms':case 'Rooms & games':
    return inGame||(inRoom&&roomTab==='games');
   case 'Game history':return inRoom&&roomTab==='history';
   case 'Game Night':return inRoom&&roomTab==='night';
   case 'Standings':case 'Players':return inRoom&&roomTab==='leaderboard';
   case 'Members':return inRoom&&roomTab==='members';
   case 'Insights':return pathname==='/insights'&&!isSettlement;
   case 'Settlements':case 'Settle':return isSettlement;
   case 'Schedule':return pathname==='/schedule';
   case 'Install':case 'Install PKR':return pathname==='/install';
   case 'More':return moreOpen||pathname==='/schedule'||pathname==='/install'||isSettlement||(inRoom&&roomTab==='history');
   default:return false;
  }
 }
 function visit(destination:string){
  setMoreOpen(false);
  if(destination==='scan'){
   if(pathname==='/dashboard')window.dispatchEvent(new window.Event('pkr:scan-invite'));
   else router.push('/dashboard?scanInvite=1');
   return;
  }
  if(destination==='share'){
   if(!eventId){router.push('/dashboard');return;}
   if(pathname==='/events/'+eventId)window.dispatchEvent(new CustomEvent('pkr:share-room'));
   else router.push(roomPath+'?share=1');
   return;
  }
  if(destination==='payments'){
   // Players only see their own ledger on Home, never the host Insights page.
   if(eventId){
    setPreferredRoomId(eventId);
    try{localStorage.setItem('pkr_preferred_room',eventId)}catch{}
   }
   router.push('/dashboard#pkr-my-payments');
   return;
  }
  if(destination==='room'||destination==='night'||destination==='members'||destination==='leaderboard'||destination==='history'){
   if(!eventId){router.push('/dashboard');return}
   const next=destination==='room'?'games':destination;
   if(pathname==='/events/'+eventId){
    setRoomTab(next);
    const url=new URL(window.location.href);
    url.searchParams.set('tab',next);
    window.history.replaceState(window.history.state,'',url.pathname+url.search+url.hash);
    window.dispatchEvent(new CustomEvent('pkr:select-room-tab',{detail:next}));
   }else{
    router.push(roomPath+'?tab='+encodeURIComponent(next));
   }
  }else if(destination==='/install'&&eventId){
   router.push('/install?group='+encodeURIComponent(eventId));
  }else{
   if(destination.startsWith('/insights'))setInsightsHash(destination.includes('#pkr-settlement')?'#pkr-settlement':'');
   router.push(destination);
  }
 }
 function switchRoom(roomId:string){
  if(!roomId)return;
  setMoreOpen(false);
  setPreferredRoomId(roomId);
  try{localStorage.setItem('pkr_preferred_room',roomId)}catch{}
  router.push('/events/'+encodeURIComponent(roomId));
 }

 return <>
  <aside className="pkr-persistent-nav" aria-label={isMemberView?'Player navigation':'Host navigation'}>
   <div className="pkr-persistent-brand"><span aria-hidden="true">♠</span> PKR</div>
   <div className="pkr-persistent-room">
    <span>YOUR POKER CLUB</span>
    <strong title={rooms.find(r=>r.id===eventId)?.name||'Poker rooms'}>{rooms.find(r=>r.id===eventId)?.name||'Poker rooms'}</strong>
    {roomChoices.length>1&&<>
     <label className="pkr-room-switch-label" htmlFor="pkr-room-switcher">SWITCH ROOM</label>
     <select id="pkr-room-switcher" className="pkr-room-switcher" value={roomChoices.some(r=>r.id===eventId)?eventId:''} onChange={e=>switchRoom(e.target.value)}>
      <option value="" disabled>Select a poker room</option>
      {roomChoices.map(room=><option key={room.id} value={room.id}>{room.name}</option>)}
     </select>
    </>}
   </div>
   <nav>
    {(isMemberView?playerDesktopNavigation:navigation).map((item,index,all)=><Fragment key={item.name}>
     {(index===0||all[index-1].group!==item.group)&&<p className="pkr-nav-group-label">{item.group}</p>}
     <button type="button" onClick={()=>visit(item.href)} aria-current={selected(item.name)?'page':undefined}
      className={selected(item.name)?'active':''}>
      <PkrGlyph name={item.icon}/>{item.name}
     </button>
    </Fragment>)}
   </nav>
   <div className="pkr-persistent-footer">PRIVATE POKER · YOUR GAME</div>
  </aside>
  <nav className={'pkr-universal-bottom-nav'+(isMemberView?' pkr-player-universal-nav':'')}
    aria-label={isMemberView?'Player navigation':'Main navigation'}>
   {(isMemberView?playerNavigation:mobileNavigation).map(item=><button key={item.name} type="button"
    className={selected(item.name,true)||item.name==='More'&&moreOpen?'active':''}
    aria-current={selected(item.name,true)&&item.name!=='More'?'page':undefined}
    aria-expanded={item.name==='More'?moreOpen:undefined}
    onClick={()=>item.name==='More'?setMoreOpen(v=>!v):visit(item.href)}>
    {item.name==='More'?<span aria-hidden="true" className="pkr-more-icon">•••</span>:<PkrGlyph name={item.icon}/>}
    <small>{item.name}</small>
   </button>)}
  </nav>
  {moreOpen&&<AppDialog aria-label="More PKR navigation" onDismiss={()=>setMoreOpen(false)}
   onClick={event=>{if(event.target===event.currentTarget)setMoreOpen(false);}}>
    <div className="pkr-mobile-more-panel pkr-navigation-more-panel">
     <div className="pkr-mobile-more-title">
      <strong>More from PKR</strong>
      <button type="button" aria-label="Close menu" onClick={()=>setMoreOpen(false)}>×</button>
     </div>
     {roomChoices.length>0&&<div className="pkr-more-club-switch">
      <label htmlFor="pkr-mobile-club-switch">Current poker club</label>
      <select id="pkr-mobile-club-switch" value={roomChoices.some(r=>r.id===eventId)?eventId:roomChoices[0].id}
       onChange={e=>switchRoom(e.target.value)}>
       {roomChoices.map(room=><option key={room.id} value={room.id}>{room.name}</option>)}
      </select>
      <p>Switch clubs here. Games and members below belong to the selected club.</p>
     </div>}
     <div className="pkr-mobile-more-grid">
      {(isMemberView?playerMoreNavigation:moreNavigation).map(item=><button key={item.name} type="button"
       aria-current={selected(item.name)?'page':undefined} onClick={()=>visit(item.href)}>
       <PkrGlyph name={item.icon}/>{item.name}
      </button>)}
     </div>
     <button className="pkr-more-club-home" type="button" onClick={()=>visit('/dashboard')}>
      <PkrGlyph name="home"/> Club overview and room selection
     </button>
    </div>
   </AppDialog>}
 </>;
}
