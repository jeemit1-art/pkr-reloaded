'use client';
import {useEffect,useState} from 'react';
import {api} from '@/lib/api';
import {
 EMPTY_ROOM_AVATARS,resolveRoomPlayerAvatar,
 type AvatarPlayer,type RoomAvatarSources,
} from '@/lib/room-player-avatars';

/** One optional fetch per room, not a request for every leaderboard player. */
export function useRoomPlayerAvatarSources(roomId:string):RoomAvatarSources{
 const [loaded,setLoaded]=useState<{roomId:string;value:RoomAvatarSources}>({
  roomId:'',value:EMPTY_ROOM_AVATARS,
 });
 useEffect(()=>{
  if(!roomId)return;
  let live=true;
  Promise.allSettled([api.events.get(roomId),api.events.profiles(roomId)]).then(([room,profiles])=>{
   if(!live)return;
   setLoaded({
    roomId,
    value:{
     members:room.status==='fulfilled'?(room.value.members||[]):[],
     profiles:profiles.status==='fulfilled'?(profiles.value.profiles||[]):[],
    },
   });
  });
  return()=>{live=false};
 },[roomId]);
 return loaded.roomId===roomId?loaded.value:EMPTY_ROOM_AVATARS;
}

/** Saved photo > preset emoji > account photo > high-contrast initials.
 * Used by every theme; never mutates results, player IDs or profile records. */
export default function RoomPlayerAvatar({player,sources,className=''}:{
 player:AvatarPlayer;sources:RoomAvatarSources;className?:string;
}){
 const selected=resolveRoomPlayerAvatar(player,sources);
 const [failedPhoto,setFailedPhoto]=useState<string|null>(null);
 const photo=selected.photo&&selected.photo!==failedPhoto?selected.photo:null;
 const source=photo?selected.source:selected.emoji?'profile-emoji':'initials';
 return <span className={'pkr-shared-player-avatar '+className}
  data-avatar-source={source} aria-hidden="true">
  {photo?<img src={photo} alt="" loading="lazy" decoding="async"
     onError={()=>setFailedPhoto(photo)}/>:
   <span className={selected.emoji?'pkr-shared-player-emoji':'pkr-shared-player-initials'}>
    {selected.emoji||selected.initials}
   </span>}
 </span>;
}
