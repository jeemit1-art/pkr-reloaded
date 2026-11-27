'use client';
import {createContext,useContext,useLayoutEffect,useRef,useState,type ReactNode} from 'react';
import {usePathname} from 'next/navigation';
import {APPEARANCE_KEY,isAppearance,isAppearanceRoute,resolvedAppearance,type AppearancePreference} from '@/lib/personal-appearance';

const Context=createContext<{preference:AppearancePreference;choose:(value:AppearancePreference)=>void;ready:boolean}>({preference:'light',choose:()=>{},ready:false});
export function PersonalAppearanceProvider({children}:{children:ReactNode}){
 const pathname=usePathname()||'';
 const [preference,setPreference]=useState<AppearancePreference>('light');
 const [ready,setReady]=useState(false);
 const current=useRef<AppearancePreference>('light');
 const apply=useRef<()=>void>(()=>{});
 useLayoutEffect(()=>{
  try{const saved=localStorage.getItem(APPEARANCE_KEY);if(isAppearance(saved))current.current=saved;}catch{}
  const media=window.matchMedia('(prefers-color-scheme: dark)');
  const root=document.documentElement;
  const sync=()=>{
   if(isAppearanceRoute(window.location.pathname))root.setAttribute('data-pkr-personal-theme',resolvedAppearance(current.current,media.matches));
   else root.removeAttribute('data-pkr-personal-theme');
   setPreference(current.current);setReady(true);
  };
  apply.current=sync;sync();
  const storage=(event:StorageEvent)=>{
   if(event.key!==APPEARANCE_KEY&&event.key!==null)return;
   current.current=isAppearance(event.newValue)?event.newValue:'light';sync();
  };
  media.addEventListener('change',sync);
  window.addEventListener('storage',storage);
  return()=>{media.removeEventListener('change',sync);window.removeEventListener('storage',storage);apply.current=()=>{};};
 },[pathname]);
 const choose=(value:AppearancePreference)=>{
  current.current=value;try{localStorage.setItem(APPEARANCE_KEY,value)}catch{}
  setPreference(value);apply.current();
 };
 return <Context.Provider value={{preference,choose,ready}}>{children}</Context.Provider>;
}
const options:AppearancePreference[]=['light','dark','system'];
export function PersonalAppearanceSettings(){
 const {preference,choose,ready}=useContext(Context);
 return <section className="pkr-primary-panel pkr-personal-appearance" data-testid="personal-appearance">
  <h2>App appearance</h2>
  <p>Choose your preferred colours. This affects only this device, not other players or the live poker table.</p>
  <div className="pkr-appearance-options" role="group" aria-label="App colour mode">
   {options.map(mode=><button key={mode} type="button" aria-pressed={preference===mode} disabled={!ready} onClick={()=>choose(mode)}>
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
     {mode==='light'?<><circle cx="12" cy="12" r="4"/><path d="M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1.5 1.5m11 11L19 19M5 19l1.5-1.5m11-11L19 5"/></>:mode==='dark'?<path d="M20 15.5A9 9 0 0 1 8.5 4 9 9 0 1 0 20 15.5Z"/>:<><rect x="3" y="4" width="18" height="13" rx="2"/><path d="M8 21h8m-4-4v4"/></>}
    </svg>
    <span>{mode==='light'?'Light':mode==='dark'?'Dark':'System'}</span>
   </button>)}
  </div>
  <p className="pkr-appearance-note">System follows your device. Your selection is remembered when you reopen PKR.</p>
 </section>;
}
