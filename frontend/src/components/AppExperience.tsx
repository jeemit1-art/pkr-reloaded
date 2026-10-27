'use client';

import {useEffect,useState,type ReactNode} from 'react';
import {usePathname} from 'next/navigation';
import {RecordProvider} from '@/components/RecordMetric';

export default function AppExperience({children}:{children:ReactNode}){
  const pathname=usePathname();
  const [online,setOnline]=useState(true);
  const [updateReady,setUpdateReady]=useState(false);
  const inGame=/^\/games\/[^/]+\/(play|tv)\/?$/.test(pathname);
  const appRoute=/^\/(dashboard|events|games|insights|schedule|install)(\/|$)/.test(pathname);

  useEffect(()=>{
    const root=document.documentElement;
    const viewport=window.visualViewport;
    const standalone=window.matchMedia('(display-mode: standalone)');
    const updateViewport=()=>{
      // Do not fight pinch-to-zoom or prevent browser accessibility zoom.
      if(viewport&&viewport.scale===1){
        root.style.setProperty('--pkr-visible-height',viewport.height+'px');
        root.style.setProperty('--pkr-visible-top',viewport.offsetTop+'px');
      }else{
        root.style.removeProperty('--pkr-visible-height');root.style.removeProperty('--pkr-visible-top');
      }
      const editing=document.activeElement?.matches('input,textarea,[contenteditable="true"]');
      root.classList.toggle('pkr-keyboard-open',!!editing&&!!viewport&&window.innerHeight-viewport.height>140);
    };
    const updateStandalone=()=>root.classList.toggle('pkr-installed',standalone.matches||!!(navigator as Navigator&{standalone?:boolean}).standalone);
    const updateOnline=()=>setOnline(navigator.onLine);
    updateViewport();updateStandalone();updateOnline();
    viewport?.addEventListener('resize',updateViewport);viewport?.addEventListener('scroll',updateViewport);
    window.addEventListener('resize',updateViewport);
    document.addEventListener('focusin',updateViewport);document.addEventListener('focusout',updateViewport);
    standalone.addEventListener('change',updateStandalone);
    window.addEventListener('online',updateOnline);window.addEventListener('offline',updateOnline);
    return()=>{
      viewport?.removeEventListener('resize',updateViewport);viewport?.removeEventListener('scroll',updateViewport);
      window.removeEventListener('resize',updateViewport);
      document.removeEventListener('focusin',updateViewport);document.removeEventListener('focusout',updateViewport);
      standalone.removeEventListener('change',updateStandalone);
      window.removeEventListener('online',updateOnline);window.removeEventListener('offline',updateOnline);
      root.classList.remove('pkr-keyboard-open');
    };
  },[]);

  useEffect(()=>{
    const root=document.documentElement;
    let observer:ResizeObserver|undefined;
    let nav:Element|null=null;
    const measure=()=>{
      const height=nav instanceof HTMLElement&&getComputedStyle(nav).display!=='none'?nav.getBoundingClientRect().height:0;
      root.style.setProperty('--pkr-navigation-height',height>0?height+'px':inGame?'calc(90px + env(safe-area-inset-bottom))':'0px');
    };
    const findNav=()=>{
      const next=document.querySelector(inGame?'.game-tabs':'.pkr-universal-bottom-nav');
      if(next!==nav){observer?.disconnect();nav=next;if(nav){observer=new ResizeObserver(measure);observer.observe(nav);}}
      measure();
    };
    findNav();
    // Navigation mounts after authentication; observe child changes, not styles.
    const mutations=new MutationObserver(findNav);
    mutations.observe(document.body,{childList:true,subtree:true});
    window.addEventListener('resize',measure);
    return()=>{mutations.disconnect();observer?.disconnect();window.removeEventListener('resize',measure);};
  },[pathname,inGame]);

  useEffect(()=>{
    if(!('serviceWorker' in navigator))return;
    let stopped=false;
    let registration:ServiceWorkerRegistration|undefined;
    let lastCheck=0;
    const check=()=>{
      if(document.visibilityState!=='visible'||Date.now()-lastCheck<300000)return;
      lastCheck=Date.now();void registration?.update().catch(()=>{});
    };
    const observe=()=>{
      const worker=registration?.installing;
      if(!worker)return;
      worker.addEventListener('statechange',()=>{
        if(!stopped&&worker.state==='installed'&&navigator.serviceWorker.controller)setUpdateReady(true);
      });
    };
    void navigator.serviceWorker.register('/sw.js',{updateViaCache:'none'}).then(value=>{
      if(stopped)return;registration=value;
      if(value.waiting&&navigator.serviceWorker.controller)setUpdateReady(true);
      value.addEventListener('updatefound',observe);observe();check();
    }).catch(()=>{});
    document.addEventListener('visibilitychange',check);
    return()=>{stopped=true;registration?.removeEventListener('updatefound',observe);document.removeEventListener('visibilitychange',check);};
  },[]);

  return <RecordProvider>{children}
    {appRoute&&!online&&<div className="pkr-connection-notice" role="status">You are offline. Changes are not confirmed until PKR reconnects.</div>}
    {appRoute&&online&&updateReady&&!inGame&&<div className="pkr-update-notice" role="status">
      <span>An app update is ready.</span><button type="button" onClick={()=>{
        if(window.confirm('Refresh PKR now? Unsaved form entries will be lost. Saved games and payment records are unchanged.'))window.location.reload();
      }}>Refresh app</button><button type="button" onClick={()=>setUpdateReady(false)} aria-label="Dismiss app update">Later</button>
    </div>}
  </RecordProvider>;
}
