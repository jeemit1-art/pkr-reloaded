'use client';

import {useEffect,useState,type ReactNode} from 'react';
import {useParams,useRouter} from 'next/navigation';
import {api} from '@/lib/api';

// The live game engine contains host controls. Players must use read-only live viewing.
// Worker APIs also verify the host/co-host role before any financial/game mutation.
export default function HostGameLayout({children}:{children:ReactNode}){
  const {id}=useParams<{id:string}>();
  const router=useRouter();
  const [allowed,setAllowed]=useState<string|null>(null);
  useEffect(()=>{
    let active=true;
    setAllowed(null);
    (async()=>{
      const [game,user]=await Promise.all([api.games.get(id),api.auth.me()]);
      const room=await api.events.get(game.event_id);
      if(!active)return;
      const role=room.members.find(member=>member.id===user.id)?.role;
      if(role==='host'||role==='cohost')setAllowed(id);
      else router.replace(game.status==='active'&&game.live_token
        ?'/games/live/'+encodeURIComponent(game.live_token)
        :'/games/'+encodeURIComponent(id));
    })().catch(()=>{if(active)router.replace('/dashboard');});
    return()=>{active=false};
  },[id,router]);
  if(allowed!==id)return <div role="status" style={{
    minHeight:'80vh',display:'grid',placeItems:'center',padding:25,
    background:'#0a1b13',color:'#edf0e5',
  }}>Opening your authorised game view…</div>;
  return <>{children}</>;
}
