'use client';
import {createContext,useContext,useLayoutEffect,useRef,useState,type ReactNode} from 'react';
import {usePathname} from 'next/navigation';
import {APPEARANCE_KEY,VISUAL_STYLE_KEY,DEFAULT_VISUAL_STYLE,isAppearance,isVisualStyle,isAppearanceRoute,resolvedAppearance,type AppearancePreference,type VisualStyle} from '@/lib/personal-appearance';

type AppearanceContext={
 preference:AppearancePreference;choose:(value:AppearancePreference)=>void;
 visualStyle:VisualStyle;chooseStyle:(value:VisualStyle)=>void;ready:boolean;
};
const Context=createContext<AppearanceContext>({preference:'light',choose:()=>{},visualStyle:DEFAULT_VISUAL_STYLE,chooseStyle:()=>{},ready:false});

export function PersonalAppearanceProvider({children}:{children:ReactNode}){
 const pathname=usePathname()||'';
 const [preference,setPreference]=useState<AppearancePreference>('light');
 const [visualStyle,setVisualStyle]=useState<VisualStyle>(DEFAULT_VISUAL_STYLE);
 const [ready,setReady]=useState(false);
 const current=useRef<AppearancePreference>('light');
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
    root.setAttribute('data-pkr-personal-theme',resolvedAppearance(current.current,media.matches));
    root.setAttribute('data-pkr-personal-style',currentStyle.current);
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
];
export function PersonalAppearanceSettings(){
 const {preference,choose,visualStyle,chooseStyle,ready}=useContext(Context);
 return <section className="pkr-primary-panel pkr-personal-appearance" data-testid="personal-appearance">
  <h2>App appearance</h2>
  <p>Select the look you prefer. Theme and colour mode are personal to this device; the host's shared club layout is a separate setting.</p>
  <h3>Theme style</h3>
  <div className="pkr-visual-style-options" role="group" aria-label="App visual theme">
   {styles.map(option=><button key={option.id} type="button" aria-pressed={visualStyle===option.id}
     disabled={!ready} onClick={()=>chooseStyle(option.id)} data-style-option={option.id}>
    <span className={'pkr-theme-style-swatch pkr-theme-style-'+option.id} aria-hidden="true">
     <i/><i/><i/>
    </span>
    <span className="pkr-theme-style-copy"><strong>{option.name}</strong><small>{option.description}</small></span>
    <span className="pkr-theme-style-check" aria-hidden="true">{visualStyle===option.id?'✓':''}</span>
   </button>)}
  </div>
  <h3>Colour mode</h3>
  <div className="pkr-appearance-options" role="group" aria-label="App colour mode">
   {modes.map(mode=><button key={mode} type="button" aria-pressed={preference===mode} disabled={!ready} onClick={()=>choose(mode)}>
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
     {mode==='light'?<><circle cx="12" cy="12" r="4"/><path d="M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1.5 1.5m11 11L19 19M5 19l1.5-1.5m11-11L19 5"/></>:mode==='dark'?<path d="M20 15.5A9 9 0 0 1 8.5 4 9 9 0 1 0 20 15.5Z"/>:<><rect x="3" y="4" width="18" height="13" rx="2"/><path d="M8 21h8m-4-4v4"/></>}
    </svg>
    <span>{mode==='light'?'Light':mode==='dark'?'Dark':'Follow device'}</span>
   </button>)}
  </div>
  <p className="pkr-appearance-note">PKR remembers your settings on this device. Game recording, payments and the live poker table are not altered by choosing a theme.</p>
 </section>;
}
