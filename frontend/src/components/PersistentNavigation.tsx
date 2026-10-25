'use client';
import {useEffect,useState} from 'react';
import {usePathname,useRouter} from 'next/navigation';
import {api,Event} from '@/lib/api';
import {getToken} from '@/lib/api';
import PkrGlyph from '@/components/PkrGlyph';

const mobileNavigation=[{name:'Home',icon:'home',href:'/dashboard'},{name:'Games',icon:'games',href:'room'},{name:'Members',icon:'members',href:'members'},{name:'Insights',icon:'insights',href:'/insights'},{name:'Install',icon:'install',href:'/install'}] as const;

const navigation=[
 {name:'Home',icon:'home',href:'/dashboard'},
 {name:'Games',icon:'games',href:'room'},
 {name:'Players',icon:'players',href:'members'},
 {name:'Insights',icon:'insights',href:'/insights'},
 {name:'Settle',icon:'settle',href:'/insights#pkr-settlement'},
 {name:'Schedule',icon:'schedule',href:'/schedule'},
 {name:'Members',icon:'members',href:'members'},
 {name:'Install PKR',icon:'install',href:'/install'},
] as const;

export default function PersistentNavigation(){
 const pathname=usePathname()||'';
 const router=useRouter();
 const [rooms,setRooms]=useState<Event[]>([]);
 const [hasSession,setHasSession]=useState(false);
 const [gameEventId,setGameEventId]=useState<string|null>(null);
 const [roomTab,setRoomTab]=useState('games');
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
 const isActiveGameplay=/^\/games\/[^/]+\/play\/?$/.test(pathname);
 const allowed=/^\/(dashboard|insights|schedule|events\/[^/]+|games\/[^/]+|install)(\/|$)/.test(pathname) && !/^\/games\/live\//.test(pathname) && !isActiveGameplay;
 useEffect(()=>{setHasSession(Boolean(getToken()));},[pathname]);
 useEffect(()=>{if(!allowed||!hasSession)return;let live=true;api.events.list().then(r=>{if(live)setRooms(r)}).catch(()=>{});return()=>{live=false};},[allowed,hasSession]);
 // A game belongs to its own room: never silently navigate to the first room.
 useEffect(()=>{
  const match=pathname.match(/^\/games\/([^/]+)/);
  setGameEventId(null);
  if(!hasSession||!match||match[1]==='live'||match[1]==='results')return;
  let live=true;
  api.games.get(match[1]).then(game=>{if(live)setGameEventId(game.event_id)}).catch(()=>{});
  return()=>{live=false};
 },[pathname,hasSession]);
 if(!allowed||!hasSession)return null;
 const eventId=pathname.match(/^\/events\/([^/]+)/)?.[1]||gameEventId||rooms.find(r=>r.status!=='ended')?.id||rooms[0]?.id;
 const roomPath=eventId?'/events/'+encodeURIComponent(eventId):'/dashboard';
 const selected=(href:string)=>href==='room'?(pathname.startsWith('/events/')&&roomTab!=='members')||pathname.startsWith('/games/'):href==='members'?pathname.startsWith('/events/')&&roomTab==='members':href.startsWith('/insights#')?pathname==='/insights'&&typeof window!=='undefined'&&window.location.hash==='#pkr-settlement':pathname===href||pathname.startsWith(href+'/');
 function visit(destination:string){
  if(destination==='room'||destination==='members'||destination==='leaderboard'){
   if(!eventId){router.push('/dashboard');return;}
   if((destination==='members'||destination==='leaderboard')&&pathname==='/events/'+eventId){
    setRoomTab(destination);
    window.dispatchEvent(new CustomEvent('pkr:select-room-tab',{detail:destination}));
   }else{
    router.push(roomPath+(destination==='room'?'':'?tab='+encodeURIComponent(destination)));
   }
  } else if(destination==='/install' && eventId){
   router.push('/install?group='+encodeURIComponent(eventId));
  } else router.push(destination);
 }
 return <><aside className="pkr-persistent-nav" aria-label="PKR navigation">
  <div className="pkr-persistent-brand"><span>♠</span> PKR</div>
  <div className="pkr-persistent-room"><span>YOUR POKER CLUB</span><strong>{rooms.find(r=>r.id===eventId)?.name||'Poker rooms'}</strong></div>
  <nav>{navigation.map(item=>{
   const active=item.name==='Players'?pathname.startsWith('/events/')&&roomTab==='leaderboard':item.name==='Members'?pathname.startsWith('/events/')&&roomTab==='members':selected(item.href);
   return <button key={item.name} type="button" onClick={()=>visit(item.name==='Players'?'leaderboard':item.href)} aria-current={active?'page':undefined} className={active?'active':''}><PkrGlyph name={item.icon}/>{item.name}</button>;
  })}</nav>
  <div className="pkr-persistent-footer">PRIVATE POKER · YOUR GAME</div>
 </aside><nav className="pkr-universal-bottom-nav" aria-label="Mobile navigation">{mobileNavigation.map(item=><button key={item.name} type="button" className={selected(item.href)?'active':''} aria-current={selected(item.href)?'page':undefined} onClick={()=>visit(item.href)}><PkrGlyph name={item.icon}/><small>{item.name}</small></button>)}</nav></>;
}
