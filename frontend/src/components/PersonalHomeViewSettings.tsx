'use client';
import {useEffect,useState} from 'react';

type HomeView='night'|'full';
const KEY='pkr_home_view:v1';
export default function PersonalHomeViewSettings(){
 const [view,setView]=useState<HomeView>('night');
 const [ready,setReady]=useState(false);
 useEffect(()=>{
   try{setView(localStorage.getItem(KEY)==='full'?'full':'night');}catch{}
   setReady(true);
 },[]);
 function choose(next:HomeView){
   setView(next);
   try{localStorage.setItem(KEY,next);}catch{}
   window.dispatchEvent(new CustomEvent('pkr:home-view-preference',{detail:next}));
 }
 return <div className="pkr-personal-home-choice">
  <p>Choose what you see when you open <strong>Home</strong>. This preference belongs to you and does not change other members’ screens.</p>
  <div className="pkr-personal-home-options" role="group" aria-label="Personal Home view">
   <button type="button" onClick={()=>choose('night')} disabled={!ready} aria-pressed={view==='night'}>
    <strong>Game night</strong><small>Next game, RSVPs and payments requiring attention</small>
   </button>
   <button type="button" onClick={()=>choose('full')} disabled={!ready} aria-pressed={view==='full'}>
    <strong>Full dashboard</strong><small>Detailed club statistics and your host-selected design</small>
   </button>
  </div>
 </div>;
}
