'use client';
import {useEffect,useState} from 'react';
import {usePathname,useRouter} from 'next/navigation';
import {api,Event} from '@/lib/api';
import {getToken} from '@/lib/api';

const navigation=[
 {name:'Home',icon:'⌂',href:'/dashboard'},
 {name:'Games',icon:'♧',href:'room'},
 {name:'Players',icon:'♟',href:'members'},
 {name:'Insights',icon:'▥',href:'/insights'},
 {name:'Settle',icon:'＄',href:'/insights#pkr-settlement'},
 {name:'Schedule',icon:'▦',href:'/schedule'},
 {name:'Members',icon:'♙',href:'members'},
 {name:'Install PKR',icon:'↗',href:'/install'},
] as const;

export default function PersistentNavigation(){
 const pathname=usePathname()||'';
 const router=useRouter();
 const [rooms,setRooms]=useState<Event[]>([]);
 const [hasSession,setHasSession]=useState(false);
 const [gameEventId,setGameEventId]=useState<string|null>(null);
 const allowed=/^\/(dashboard|insights|schedule|events\/[^/]+|games\/[^/]+|install)(\/|$)/.test(pathname) && !/^\/games\/live\//.test(pathname);
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
 function visit(destination:string){
  if(destination==='room'||destination==='members'){
   if(!eventId){router.push('/dashboard');return;}
   if(destination==='members'&&pathname==='/events/'+eventId){
    window.dispatchEvent(new CustomEvent('pkr:select-room-tab',{detail:'members'}));
   }else{
    router.push('/events/'+encodeURIComponent(eventId)+(destination==='members'?'?tab=members':''));
   }
  } else router.push(destination);
 }
 return <><aside className="pkr-persistent-nav" aria-label="PKR navigation">
  <div className="pkr-persistent-brand"><span>♠</span> PKR</div>
  <div className="pkr-persistent-room"><span>YOUR POKER CLUB</span><strong>{rooms.find(r=>r.id===eventId)?.name||'Poker rooms'}</strong></div>
  <nav>{navigation.map(item=><button key={item.name} type="button" onClick={()=>visit(item.href)} aria-current={item.href.startsWith('/')&&pathname.startsWith(item.href)?'page':undefined} className={item.href.startsWith('/')&&pathname.startsWith(item.href)?'active':''}><span aria-hidden="true">{item.icon}</span>{item.name}</button>)}</nav>
  <div className="pkr-persistent-footer">PRIVATE POKER · YOUR GAME</div>
 </aside><nav className="pkr-universal-bottom-nav" aria-label="Mobile navigation">{[{name:'Home',icon:'⌂',href:'/dashboard'},{name:'Games',icon:'♧',href:'room'},{name:'Members',icon:'♟',href:'members'},{name:'Insights',icon:'▥',href:'/insights'},{name:'Install',icon:'↗',href:'/install'}].map(item=><button key={item.name} type="button" className={item.href.startsWith('/')&&pathname.startsWith(item.href)?'active':''} onClick={()=>visit(item.href)}><span aria-hidden="true">{item.icon}</span><small>{item.name}</small></button>)}</nav></>;
}
