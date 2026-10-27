'use client';
import {Fragment,useEffect,useState} from 'react';
import {usePathname,useRouter} from 'next/navigation';
import {api,Event,getToken} from '@/lib/api';
import PkrGlyph from '@/components/PkrGlyph';

/* Primary actions stay visible. Less-frequent tools live in the More drawer.
   This is navigation only: it never changes game data or financial records. */
const mobileNavigation=[
 {name:'Home',icon:'home',href:'/dashboard'},
 {name:'Rooms',icon:'games',href:'room'},
 {name:'Members',icon:'members',href:'members'},
 {name:'Insights',icon:'insights',href:'/insights'},
 {name:'More',icon:'install',href:'#more'},
] as const;

const navigation=[
 {name:'Home',icon:'home',href:'/dashboard',group:'OVERVIEW'},
 {name:'Rooms & games',icon:'games',href:'room',group:'POKER NIGHT'},
 {name:'Standings',icon:'players',href:'leaderboard',group:'POKER NIGHT'},
 {name:'Schedule',icon:'schedule',href:'/schedule',group:'POKER NIGHT'},
 {name:'Members',icon:'members',href:'members',group:'CLUB MANAGEMENT'},
 {name:'Insights',icon:'insights',href:'/insights',group:'CLUB MANAGEMENT'},
 {name:'Settlements',icon:'settle',href:'/insights#pkr-settlement',group:'CLUB MANAGEMENT'},
 {name:'Install PKR',icon:'install',href:'/install',group:'YOUR ACCOUNT'},
] as const;

const moreNavigation=[
 {name:'Standings',icon:'players',href:'leaderboard'},
 {name:'Schedule',icon:'schedule',href:'/schedule'},
 {name:'Settlements',icon:'settle',href:'/insights#pkr-settlement'},
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
   if(['games','leaderboard','history','members'].includes(tab))setRoomTab(tab);
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

 const preferredRoom=rooms.find(r=>r.id===preferredRoomId);
 const eventId=pathname.match(/^\/events\/([^/]+)/)?.[1]
  ||gameEventId||preferredRoom?.id||rooms.find(r=>r.status!=='ended')?.id||rooms[0]?.id;
 const roomPath=eventId?'/events/'+encodeURIComponent(eventId):'/dashboard';
 const roomChoices=rooms.filter(r=>r.status!=='ended'||r.id===eventId);
 const inRoom=pathname.startsWith('/events/');
 const inGame=pathname.startsWith('/games/');
 const isSettlement=pathname==='/insights'&&insightsHash==='#pkr-settlement';

 function selected(name:string,mobile=false){
  switch(name){
   case 'Home':return pathname==='/dashboard';
   case 'Games':case 'Rooms':case 'Rooms & games':
    return inGame||(inRoom&&(mobile?roomTab!=='members':roomTab==='games'||roomTab==='history'));
   case 'Standings':case 'Players':return inRoom&&roomTab==='leaderboard';
   case 'Members':return inRoom&&roomTab==='members';
   case 'Insights':return pathname==='/insights'&&(mobile||!isSettlement);
   case 'Settlements':case 'Settle':return isSettlement;
   case 'Schedule':return pathname==='/schedule';
   case 'Install':case 'Install PKR':return pathname==='/install';
   case 'More':return pathname==='/schedule'||pathname==='/install'||isSettlement||(inRoom&&roomTab==='leaderboard');
   default:return false;
  }
 }
 function visit(destination:string){
  setMoreOpen(false);
  if(destination==='room'||destination==='members'||destination==='leaderboard'){
   if(!eventId){router.push('/dashboard');return}
   if(pathname==='/events/'+eventId){
    const next=destination==='room'?'games':destination;
    setRoomTab(next);
    window.dispatchEvent(new CustomEvent('pkr:select-room-tab',{detail:next}));
   }else{
    router.push(roomPath+(destination==='room'?'':'?tab='+encodeURIComponent(destination)));
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
  <aside className="pkr-persistent-nav" aria-label="PKR navigation">
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
    {navigation.map((item,index)=><Fragment key={item.name}>
     {(index===0||navigation[index-1].group!==item.group)&&<p className="pkr-nav-group-label">{item.group}</p>}
     <button type="button" onClick={()=>visit(item.href)} aria-current={selected(item.name)?'page':undefined}
      className={selected(item.name)?'active':''}>
      <PkrGlyph name={item.icon}/>{item.name}
     </button>
    </Fragment>)}
   </nav>
   <div className="pkr-persistent-footer">PRIVATE POKER · YOUR GAME</div>
  </aside>
  <nav className="pkr-universal-bottom-nav" aria-label="Mobile navigation">
   {mobileNavigation.map(item=><button key={item.name} type="button"
    className={selected(item.name,true)||item.name==='More'&&moreOpen?'active':''}
    aria-current={selected(item.name,true)?'page':undefined}
    aria-expanded={item.name==='More'?moreOpen:undefined}
    onClick={()=>item.name==='More'?setMoreOpen(v=>!v):visit(item.href)}>
    {item.name==='More'?<span aria-hidden="true" className="pkr-more-icon">•••</span>:<PkrGlyph name={item.icon}/>}
    <small>{item.name}</small>
   </button>)}
  </nav>
  {moreOpen&&<>
   <button type="button" aria-label="Close additional navigation" className="pkr-mobile-more-overlay" onClick={()=>setMoreOpen(false)}/>
   <div className="pkr-mobile-more-panel" role="dialog" aria-modal="true" aria-label="More PKR navigation">
    <div className="pkr-mobile-more-title"><strong>More from PKR</strong><button type="button" aria-label="Close menu" onClick={()=>setMoreOpen(false)}>×</button></div>
    <div className="pkr-mobile-more-grid">
     {moreNavigation.map(item=><button key={item.name} type="button" aria-current={selected(item.name)?'page':undefined}
      onClick={()=>visit(item.href)}><PkrGlyph name={item.icon}/>{item.name}</button>)}
    </div>
   </div>
  </>}
 </>;
}
