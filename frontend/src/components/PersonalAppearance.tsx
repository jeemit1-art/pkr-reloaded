'use client';
import {createContext,useContext,useLayoutEffect,useRef,useState,type ReactNode} from 'react';
import {usePathname} from 'next/navigation';
import {APPEARANCE_KEY,VISUAL_STYLE_KEY,DEFAULT_VISUAL_STYLE,isAppearance,isVisualStyle,isAppearanceRoute,resolvedAppearance,type AppearancePreference,type VisualStyle} from '@/lib/personal-appearance';

type AppearanceContext={
 preference:AppearancePreference;choose:(value:AppearancePreference)=>void;
 visualStyle:VisualStyle;chooseStyle:(value:VisualStyle)=>void;ready:boolean;
};
const Context=createContext<AppearanceContext>({preference:'dark',choose:()=>{},visualStyle:DEFAULT_VISUAL_STYLE,chooseStyle:()=>{},ready:false});

export function PersonalAppearanceProvider({children}:{children:ReactNode}){
 const pathname=usePathname()||'';
 const [preference,setPreference]=useState<AppearancePreference>('dark');
 const [visualStyle,setVisualStyle]=useState<VisualStyle>(DEFAULT_VISUAL_STYLE);
 const [ready,setReady]=useState(false);
 const current=useRef<AppearancePreference>('dark');
 const currentStyle=useRef<VisualStyle>(DEFAULT_VISUAL_STYLE);
 const apply=useRef<()=>void>(()=>{});
 useLayoutEffect(()=>{
  try{
   const saved=localStorage.getItem(APPEARANCE_KEY);
   if(isAppearance(saved))current.current=saved;
   const style=localStorage.getItem(VISUAL_STYLE_KEY);
   if(isVisualStyle(style))currentStyle.current=style;
  }catch{}
  const media=window.matchMedia('(prefers-color-scheme: dark)');
  const root=document.documentElement;
  const sync=()=>{
   if(isAppearanceRoute(window.location.pathname)){
    root.setAttribute('data-pkr-personal-theme','dark');
    root.setAttribute('data-pkr-personal-style','private-club');
   }else{
    root.removeAttribute('data-pkr-personal-theme');
    root.removeAttribute('data-pkr-personal-style');
   }
   setPreference(current.current);
   setVisualStyle(currentStyle.current);
   setReady(true);
  };
  apply.current=sync;sync();
  const storage=(event:StorageEvent)=>{
   if(event.key!==APPEARANCE_KEY&&event.key!==VISUAL_STYLE_KEY&&event.key!==null)return;
   if(event.key===APPEARANCE_KEY||event.key===null){
    const next=event.key===null?null:event.newValue;
    current.current=isAppearance(next)?next:'light';
   }
   if(event.key===VISUAL_STYLE_KEY||event.key===null){
    const next=event.key===null?null:event.newValue;
    currentStyle.current=isVisualStyle(next)?next:DEFAULT_VISUAL_STYLE;
   }
   sync();
  };
  media.addEventListener('change',sync);
  window.addEventListener('storage',storage);
  return()=>{media.removeEventListener('change',sync);window.removeEventListener('storage',storage);apply.current=()=>{};};
 },[pathname]);
 const choose=(value:AppearancePreference)=>{
  current.current=value;try{localStorage.setItem(APPEARANCE_KEY,value)}catch{}
  setPreference(value);apply.current();
 };
 const chooseStyle=(value:VisualStyle)=>{
  currentStyle.current=value;try{localStorage.setItem(VISUAL_STYLE_KEY,value)}catch{}
  setVisualStyle(value);apply.current();
 };
 return <Context.Provider value={{preference,choose,visualStyle,chooseStyle,ready}}>{children}</Context.Provider>;
}

const modes:AppearancePreference[]=['light','dark','system'];
const styles:Array<{id:VisualStyle;name:string;description:string}>=[
 {id:'standard',name:'PKR Classic',description:'The familiar forest green'},
 {id:'noir',name:'PKR Noir',description:'Charcoal and champagne gold'},
 {id:'clubhouse',name:'Clubhouse',description:'Traditional poker-club warmth'},
 {id:'studio',name:'PKR Studio',description:'Clean, modern and minimal'},
 {id:'luxe',name:'Luxe Casino',description:'Emerald felt, golden chips and an elegant casino floor'},
 {id:'neon',name:'Neon Casino',description:'Glowing violet, electric cyan and vivid pink casino lights'},
 {id:'vip',name:'VIP Lounge',description:'Burgundy velvet, bronze details and champagne gold'},
 {id:'tournament',name:'Playful Tournament',description:'Bright red, teal, trophies and colourful game-night energy'},
 {id:'private-club',name:'Private Casino Club',description:'Vegas poker floor, club lobby and cashier, with light, dark or device colours'},
];
export function PersonalAppearanceSettings(){
 return <section className="pkr-primary-panel pkr-personal-appearance pkr-no-appearance" data-testid="personal-appearance">
  <h2>PKR identity</h2>
  <div className="pkr-no-brand-identity">
   <img src="/brand/pkr-night-logo.svg" alt="PKR — Your Private Game Club" width={260} height={89}/>
   <span>THE NIGHT IS ON.</span>
  </div>
  <p>Every club now uses PKR's approved identity: ink, electric blue, coral and citron. The appearance is consistent across Home, Games, Players, Results and Payments.</p>
  <p>Previous theme choices are preserved in your device settings for rollback, but no longer change the official PKR app design. Your game records, notifications and payment history remain unchanged.</p>
 </section>;
}
