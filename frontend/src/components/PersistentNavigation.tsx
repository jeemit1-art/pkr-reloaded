'use client';

import {useEffect,useState} from 'react';
import {usePathname,useRouter} from 'next/navigation';
import {api,type Event,getToken} from '@/lib/api';
import PkrGlyph from '@/components/PkrGlyph';
import './PrimaryNavigation.css';

type Area='Home'|'Games'|'Players'|'Results'|'Payments';
const destinations:Array<{name:Area;icon:'home'|'games'|'members'|'players'|'settle'}>=[
 {name:'Home',icon:'home'},
 {name:'Games',icon:'games'},
 {name:'Players',icon:'members'},
 {name:'Results',icon:'players'},
 {name:'Payments',icon:'settle'},
];

/** Single navigation architecture for hosts and players.
 * Existing room and result URLs remain supported; this only changes discovery. */
export default function PersistentNavigation(){
 const pathname=usePathname()||'';
 const router=useRouter();
 const [rooms,setRooms]=useState<Event[]>([]);
 const [hasSession,setHasSession]=useState(false);
 const [gameRoomId,setGameRoomId]=useState<string|null>(null);
 const [preferredRoom,setPreferredRoom]=useState('');
 const [roomTab,setRoomTab]=useState('games');
 const [legacyHash,setLegacyHash]=useState('');

 const inGameplay=/^\/games\/[^/]+\/(play|tv)\/?$/.test(pathname);
 const allowed=/^\/(dashboard|results|payments|account|insights|schedule|events\/[^/]+|games\/[^/]+|install)(\/|$)/.test(pathname)
   && !/^\/games\/live\//.test(pathname)&&!inGameplay;
 useEffect(()=>{setHasSession(Boolean(getToken()));},[pathname]);
 useEffect(()=>{
  const sync=()=>{try{setPreferredRoom(localStorage.getItem('pkr_preferred_room')||'')}catch{}};
  sync();window.addEventListener('pkr:room-changed',sync);
  return()=>window.removeEventListener('pkr:room-changed',sync);
 },[]);
 useEffect(()=>{
  const fromPath=pathname.match(/^\/events\/([^/]+)/)?.[1];
  if(fromPath){
   setPreferredRoom(fromPath);
   try{localStorage.setItem('pkr_preferred_room',fromPath);}catch{}
  }
 },[pathname]);
 useEffect(()=>{
  const sync=()=>{
   setRoomTab(new URLSearchParams(window.location.search).get('tab')||'games');
   setLegacyHash(window.location.hash);
  };
  sync();window.addEventListener('popstate',sync);
  const changed=(event:globalThis.Event)=>{
   const next=(event as CustomEvent<string>).detail;
   if(['games','night','leaderboard','history','members'].includes(next))setRoomTab(next);
  };
  window.addEventListener('pkr:select-room-tab',changed);
  return()=>{window.removeEventListener('popstate',sync);window.removeEventListener('pkr:select-room-tab',changed)};
 },[pathname]);
 useEffect(()=>{
  if(!allowed||!hasSession)return;
  let alive=true;
  api.events.list().then(list=>{if(alive)setRooms(list)}).catch(()=>{});
  return()=>{alive=false};
 },[allowed,hasSession,pathname]);
 useEffect(()=>{
  const match=pathname.match(/^\/games\/([^/]+)/);
  setGameRoomId(null);
  if(!hasSession||!match||['live','results'].includes(match[1]))return;
  let alive=true;
  api.games.get(match[1]).then(game=>{if(alive)setGameRoomId(game.event_id)}).catch(()=>{});
  return()=>{alive=false};
 },[pathname,hasSession]);

 if(!allowed||!hasSession)return null;
 const pathRoom=pathname.match(/^\/events\/([^/]+)/)?.[1]||'';
 const params=typeof window==='undefined'?new URLSearchParams():new URLSearchParams(window.location.search);
 const queryRoom=params.get('room')||'';
 const validRoom=(id:string)=>rooms.find(r=>r.id===id);
 const selectedRoom=validRoom(pathRoom)||validRoom(gameRoomId||'')||validRoom(queryRoom)||
  validRoom(preferredRoom)||rooms.find(r=>r.status!=='ended')||rooms[0];
 const roomId=selectedRoom?.id||'';
 const roomChoices=rooms.filter(r=>r.status!=='ended'||r.id===roomId);
 const paymentLegacy=pathname==='/insights'&&legacyHash==='#pkr-settlement';
 const currentArea:Area|''=pathname==='/account'||pathname==='/install'?'':pathname==='/dashboard'?'Home':
  pathname==='/payments'||paymentLegacy?'Payments':
  pathname==='/results'||pathname.startsWith('/results/')||pathname==='/insights'||
    (pathname.startsWith('/events/')&&['leaderboard','history'].includes(roomTab))||
    pathname.startsWith('/games/results/')?'Results':
  (pathname.startsWith('/events/')&&roomTab==='members')?'Players':'Games';

 function choose(area:Area){
  if(area==='Home'){router.push('/dashboard');return;}
  if(area==='Results'){router.push('/results'+(roomId?'?room='+encodeURIComponent(roomId):''));return;}
  if(area==='Payments'){router.push('/payments'+(roomId?'?room='+encodeURIComponent(roomId):''));return;}
  if(!roomId){router.push('/dashboard');return;}
  const tab=area==='Players'?'members':'games';
  const target='/events/'+encodeURIComponent(roomId);
  if(pathname===target){
   setRoomTab(tab);
   const u=new URL(window.location.href);u.searchParams.set('tab',tab);
   u.searchParams.delete('view');
   window.history.replaceState(window.history.state,'',u.pathname+u.search+u.hash);
   window.dispatchEvent(new CustomEvent('pkr:select-room-tab',{detail:tab}));
   window.scrollTo({top:0,behavior:'instant'});
  }else router.push(target+'?tab='+tab);
 }
 function chooseRoom(id:string){
  if(!validRoom(id))return;
  setPreferredRoom(id);
  try{localStorage.setItem('pkr_preferred_room',id);}catch{}
  window.dispatchEvent(new CustomEvent('pkr:room-changed',{detail:id}));
  if(pathname.startsWith('/results'))router.push('/results?room='+encodeURIComponent(id));
  else if(pathname==='/payments'||pathname==='/insights')router.push('/payments?room='+encodeURIComponent(id));
  else router.push('/events/'+encodeURIComponent(id)+'?tab=games');
 }
 const member=selectedRoom?.role==='member';
 const roomLabel=selectedRoom?.name||'Select your club';
 const areaLabel=member?'Player navigation':'PKR main navigation';
 return <>
  <aside className="pkr-persistent-nav pkr-primary-sidebar" aria-label={areaLabel}>
   <div className="pkr-persistent-brand"><span aria-hidden="true">♠</span> PKR</div>
   <div className="pkr-persistent-room">
    <span>YOUR POKER CLUB</span><strong title={roomLabel}>{roomLabel}</strong>
    {roomChoices.length>1&&<label htmlFor="pkr-desktop-club">Switch club</label>}
    {roomChoices.length>1&&<select id="pkr-desktop-club" className="pkr-room-switcher"
      aria-label="Switch poker club" value={roomId} onChange={e=>chooseRoom(e.target.value)}>
      {roomChoices.map(room=><option key={room.id} value={room.id}>{room.name}</option>)}
    </select>}
    <button type="button" className="pkr-primary-view-clubs" onClick={()=>router.push('/dashboard#pkr-rooms')}>
     View all clubs ↗
    </button>
   </div>
   <nav aria-label="Primary sections">
    {destinations.map(item=><button key={item.name} type="button" onClick={()=>choose(item.name)}
      className={currentArea===item.name?'active':''} aria-current={currentArea===item.name?'page':undefined}>
      <PkrGlyph name={item.icon}/><span>{item.name}</span>
     </button>)}
   </nav>
   <div className="pkr-primary-sidebar-footer">
    <button type="button" className={pathname==='/account'||pathname==='/install'?'active':''}
      onClick={()=>router.push('/account')} aria-label="Account and notification settings">
      <PkrGlyph name="install"/> Account & settings
    </button>
    <span>PRIVATE POKER · YOUR GAME</span>
   </div>
  </aside>
  <div className="pkr-primary-mobile-utility" aria-label="Poker club and account">
   <span className="pkr-primary-mobile-mark" aria-hidden="true">♠</span>
   {roomChoices.length>1?
     <select aria-label="Switch poker club" value={roomId} onChange={e=>chooseRoom(e.target.value)}>
       {roomChoices.map(room=><option key={room.id} value={room.id}>{room.name}</option>)}
     </select>:
     <button type="button" className="pkr-primary-club-name" onClick={()=>router.push('/dashboard#pkr-rooms')}
       aria-label="View poker clubs">{roomLabel} <span aria-hidden="true">⌄</span></button>}
   <button type="button" className="pkr-primary-account" onClick={()=>router.push('/account')}
     aria-label="Account, notifications and installation" aria-current={pathname==='/account'?'page':undefined}>
     <span aria-hidden="true">⚙</span> <span>Account</span>
   </button>
  </div>
  <nav className="pkr-universal-bottom-nav pkr-primary-bottom-nav" aria-label={areaLabel}>
   {destinations.map(item=><button key={item.name} type="button" onClick={()=>choose(item.name)}
     className={currentArea===item.name?'active':''} aria-current={currentArea===item.name?'page':undefined}>
     <PkrGlyph name={item.icon}/><small>{item.name}</small>
    </button>)}
  </nav>
 </>;
}
