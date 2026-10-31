'use client';

import {useEffect} from 'react';
import {usePathname} from 'next/navigation';
import {api,getToken,type RoomDashboardLayout} from '@/lib/api';

/**
 * A poker club's saved Command Centre / Live Poker choice is a room-wide
 * appearance preference, not a dashboard-only switch.
 *
 * The Worker is authoritative. We never store layout preferences locally;
 * we re-read on club change, foreground resume and periodically so members
 * see the host's choice without refreshing every tab.
 */
export default function RoomExperienceTheme(){
 const pathname=usePathname()||'';
 useEffect(()=>{
  const root=document.documentElement;
  if(!getToken()){
   root.removeAttribute('data-pkr-room-experience');
   root.removeAttribute('data-pkr-theme-room');return;
  }
  let live=true;
  let request=0;
  // Keep the verified look while Next.js changes routes. Never flash the
  // Command palette over a Live Poker club on every tab transition.
  let selectedRoom=root.getAttribute('data-pkr-theme-room')||'';
  let currentLayout:RoomDashboardLayout=
   root.getAttribute('data-pkr-room-experience')==='live'?'live':'command';
  const apply=(roomId:string,layout:RoomDashboardLayout)=>{
   if(!live||roomId!==selectedRoom)return;
   currentLayout=layout;
   root.setAttribute('data-pkr-theme-room',roomId);
   root.setAttribute('data-pkr-room-experience',layout);
  };
  const preferred=()=>{
   try{return localStorage.getItem('pkr_preferred_room')||''}catch{return ''}
  };
  const locationRoom=()=>{
   const path=window.location.pathname.match(/^\/events\/([^/]+)/)?.[1];
   const param=new URLSearchParams(window.location.search).get('room')||'';
   return path||param||preferred();
  };
  const chooseRoom=async()=>{
   const url=window.location.pathname;
   const gameId=url.match(/^\/games\/([^/]+)/)?.[1];
   if(gameId&&!['live','results'].includes(gameId)){
    try{return (await api.games.get(gameId)).event_id}
    catch{ /* Continue with the last selected club. */ }
   }
   return locationRoom();
  };
  const refresh=async()=>{
   if(!getToken()){
    root.removeAttribute('data-pkr-room-experience');return;
   }
   const nonce=++request;
   try{
    const list=await api.events.list();
    if(!live||nonce!==request)return;
    const candidate=await chooseRoom();
    if(!live||nonce!==request)return;
    const room=list.find(r=>r.id===candidate)||
      list.find(r=>r.status!=='ended')||list[0];
    if(!room){selectedRoom='';root.removeAttribute('data-pkr-room-experience');return}
    if(room.id!==selectedRoom){
     selectedRoom=room.id;
     apply(room.id,'command');
    }
    try{
     const saved=await api.events.dashboardLayout(room.id);
     if(!live||nonce!==request||saved.event_id!==room.id)return;
     apply(room.id,saved.layout==='live'?'live':'command');
    }catch{
     // Do not reset a previously verified room design on network trouble.
    }
   }catch{
    // Keep the last verified room appearance if the session/network is offline.
   }
  };
  const saved=(event:Event)=>{
   const value=(event as CustomEvent<{roomId:string;layout:RoomDashboardLayout}>).detail;
   if(!value||value.roomId!==selectedRoom||!['live','command'].includes(value.layout))return;
   ++request;apply(value.roomId,value.layout);
  };
  const onFocus=()=>{if(document.visibilityState==='visible')void refresh()};
  const roomChanged=()=>{void refresh()};
  const historyChanged=()=>{void refresh()};
  void refresh();
  const interval=window.setInterval(()=>{
   if(document.visibilityState==='visible')void refresh();
  },45000);
  window.addEventListener('pkr:room-experience-saved',saved);
  window.addEventListener('pkr:room-changed',roomChanged);
  window.addEventListener('popstate',historyChanged);
  window.addEventListener('focus',onFocus);
  document.addEventListener('visibilitychange',onFocus);
  return()=>{
   live=false;++request;clearInterval(interval);
   window.removeEventListener('pkr:room-experience-saved',saved);
   window.removeEventListener('pkr:room-changed',roomChanged);
   window.removeEventListener('popstate',historyChanged);
   window.removeEventListener('focus',onFocus);
   document.removeEventListener('visibilitychange',onFocus);
  };
 },[pathname]);
 return null;
}
