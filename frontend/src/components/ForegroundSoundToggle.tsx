'use client';
import {useEffect,useState} from 'react';
import {foregroundSoundsEnabled,setForegroundSoundsEnabled,playPkrSound} from '@/lib/sounds';

export default function ForegroundSoundToggle(){
 const [enabled,setEnabled]=useState(false);
 useEffect(()=>{setEnabled(foregroundSoundsEnabled());},[]);
 function toggle(){
   const next=!enabled;
   setForegroundSoundsEnabled(next);setEnabled(next);
   if(next)playPkrSound('approved',true);
 }
 return <div className="pkr-sound-control">
   <div>
     <strong>In-app sounds</strong>
     <p>Optional chime for important changes while PKR is open. Background notification sounds follow your phone settings.</p>
   </div>
   <button type="button" className="btn btn-outline" aria-pressed={enabled}
     onClick={toggle}>{enabled?'🔊 On':'🔇 Off'}</button>
   <button type="button" className="btn btn-ghost"
     onClick={()=>playPkrSound('new-request',true)} aria-label="Play test chime">▶ Test</button>
 </div>;
}
