'use client';

import {Suspense,useLayoutEffect,useRef} from 'react';
import {usePathname,useSearchParams} from 'next/navigation';
import {CONTAINED_SCROLL_CLASS,getPageScroll,markPageScrollRestoration,readPageScrollEntry,
  withPageScrollEntry,loadPageScrollPositions,savePageScrollPositions,PAGE_SCROLL_POSITION_LIMIT,
  consumePreservedPageScroll,clearPreservedPageScroll,
  type PageScrollEntry,type PageScrollPosition} from '@/lib/page-scroll';

type ScrollTarget={href:string;position:PageScrollPosition;hash:string;expires:number};

/** Body scrolling keeps installed iPhone content out of the native status-bar canvas.
 * It preserves native APIs and stores only per-tab scroll offsets by entry ID. */
export function installPageScrollController(initialPathname:string){
  const root=document.documentElement,body=document.body;
  const mobile=window.matchMedia('(max-width: 1099px)');
  const positions=loadPageScrollPositions();
  let entry:PageScrollEntry|null=null;
  let active=false;
  let renderedPathname=initialPathname;
  let lastPosition:PageScrollPosition={left:window.scrollX,top:window.scrollY};
  let previousRestoration:ScrollRestoration=window.history.scrollRestoration;
  let traversalHref:string|null=null;
  let pending:ScrollTarget|null=null;
  let frame=0,settleTimer=0,expiryTimer=0;
  let disposed=false;
  let observedHeader:HTMLElement|null=null;
  const href=()=>window.location.href;
  const nativePosition=():PageScrollPosition=>({left:window.scrollX,top:window.scrollY});
  const bodyPosition=():PageScrollPosition=>({left:body.scrollLeft,top:body.scrollTop});
  const saveMemory=()=>{
    if(!entry)return;
    positions.delete(entry.id);positions.set(entry.id,lastPosition);
    if(positions.size>PAGE_SCROLL_POSITION_LIMIT)positions.delete(positions.keys().next().value!);
  };
  const stamp=(next:PageScrollEntry)=>{
    try{window.history.replaceState(withPageScrollEntry(window.history.state,next),'');}catch{}
  };
  const remember=()=>{
    if(entry&&entry.href===href()){
      lastPosition=active?bodyPosition():nativePosition();
      saveMemory();
    }
  };
  const clearPending=()=>{
    pending=null;window.clearTimeout(settleTimer);window.clearTimeout(expiryTimer);
    settleTimer=0;expiryTimer=0;
  };
  const queueTarget=(position:PageScrollPosition,hash='')=>{
    clearPending();pending={href:href(),position,hash,expires:Date.now()+8000};
    expiryTimer=window.setTimeout(()=>{clearPending();remember();},8000);
  };
  const newEntry=(position:PageScrollPosition):PageScrollEntry=>({version:1,
    id:window.crypto?.randomUUID?.()||Date.now().toString(36)+Math.random().toString(36).slice(2),href:href(),...position});

  function syncEntry(){
    const currentHref=href();
    if(entry?.href===currentHref&&!traversalHref){
      // A legacy view may replace its URL state. Reattach only our own field.
      if(readPageScrollEntry(window.history.state)?.id!==entry.id)stamp(entry);
      return;
    }
    saveMemory();
    const saved=readPageScrollEntry(window.history.state);
    const previous=entry;
    const preserved=consumePreservedPageScroll(previous?.href||null,currentHref);
    const traversing=traversalHref===currentHref;
    traversalHref=null;
    // Existing tab/filter controls replace the current entry. Keep its identity
    // and position rather than adding another history entry or resetting a list.
    if(previous&&saved?.id===previous.id&&!traversing){
      entry={...previous,href:currentHref};stamp(entry);
      if(new URL(previous.href).hash!==window.location.hash){
        markPageScrollRestoration(null);queueTarget({left:0,top:0},window.location.hash);
      }
      return;
    }
    const restoring=Boolean(saved?.href===currentHref&&(traversing||!previous));
    const position=restoring&&saved?(positions.get(saved.id)||{left:saved.left,top:saved.top}):
      preserved||(previous?{left:0,top:0}:nativePosition());
    entry=restoring&&saved?{...saved,...position}:newEntry(position);
    stamp(entry);lastPosition=position;saveMemory();
    markPageScrollRestoration(restoring?currentHref:null);
    // Traversals restore where the person left the entry, even if it has a hash.
    queueTarget(position,restoring||preserved?'':window.location.hash);
  }

  function applyTarget(){
    const target=pending;
    if(!active||!target||target.href!==href()||renderedPathname!==window.location.pathname)return;
    if(Date.now()>target.expires){clearPending();return;}
    let reached=false;
    if(target.hash&&target.hash!=='#top'){
      let id=target.hash.slice(1);try{id=decodeURIComponent(id);}catch{}
      const anchor=document.getElementById(id)||document.getElementsByName(id)[0];
      if(!anchor)return;
      anchor.scrollIntoView({block:'start',behavior:'instant'});reached=true;
    }else{
      const position=target.hash==='#top'?{left:0,top:0}:target.position;
      body.scrollTo({...position,behavior:'instant'});
      reached=Math.abs(body.scrollTop-position.top)<2&&Math.abs(body.scrollLeft-position.left)<2;
    }
    // A focused anchor can also try to move an overflow-hidden root in WebKit.
    if(window.scrollX||window.scrollY)window.scrollTo({left:0,top:0,behavior:'instant'});
    lastPosition=bodyPosition();
    window.clearTimeout(settleTimer);
    if(reached)settleTimer=window.setTimeout(()=>{clearPending();remember();},350);
  }

  function sync(){
    if(disposed)return;
    const header=document.querySelector<HTMLElement>('.pkr-primary-mobile-utility');
    if(header!==observedHeader){
      headerResize?.disconnect();observedHeader=header;if(header)headerResize?.observe(header);
    }
    const headerVisible=Boolean(header&&header.getBoundingClientRect().height>0&&
      header.getBoundingClientRect().width>0&&window.getComputedStyle(header).visibility!=='hidden');
    const enabled=root.classList.contains('pkr-installed')&&mobile.matches&&headerVisible;
    if(!active&&!enabled)return;
    syncEntry();
    if(enabled&&!active){
      // Capture before changing the CSS scroll surface. Do not infer a device inset.
      const position=pending?.href===href()?pending.position:nativePosition();
      previousRestoration=window.history.scrollRestoration;
      window.history.scrollRestoration='manual';
      active=true;root.classList.add(CONTAINED_SCROLL_CLASS);
      window.scrollTo({left:0,top:0,behavior:'instant'});
      body.scrollTo({...position,behavior:'instant'});lastPosition=bodyPosition();
    }else if(!enabled&&active){
      // A media-query change may already have reset body.scrollTop. Its last
      // scroll event gives us the offset from before CSS switched surfaces.
      const position=pending?.href===href()?pending.position:lastPosition;
      active=false;root.classList.remove(CONTAINED_SCROLL_CLASS);
      window.history.scrollRestoration=previousRestoration;
      window.scrollTo({...position,behavior:'instant'});lastPosition=nativePosition();
      clearPending();saveMemory();
    }
    applyTarget();
  }

  function schedule(){
    if(disposed||frame)return;
    frame=window.requestAnimationFrame(()=>{frame=0;sync();});
  }
  const onBodyScroll=()=>{
    // Ignore CSS-clamped offsets while leaving the mobile breakpoint.
    if(!active||!mobile.matches||!root.classList.contains('pkr-installed'))return;
    if(entry?.href!==href()){schedule();return;}
    lastPosition=bodyPosition();if(!pending)saveMemory();
  };
  const onWindowScroll=()=>{
    if(active){
      if(mobile.matches&&(window.scrollX||window.scrollY))window.scrollTo({left:0,top:0,behavior:'instant'});
    }else remember();
  };
  const onInput=()=>{clearPending();clearPreservedPageScroll();markPageScrollRestoration(null);remember();};
  const onPopState=()=>{
    saveMemory();traversalHref=href();markPageScrollRestoration(traversalHref);schedule();
  };
  const onHashChange=()=>{schedule();};
  const onPageHide=()=>{
    remember();if(entry?.href===href())stamp({...entry,...lastPosition});
    if(entry)savePageScrollPositions(positions);
  };
  const onVisibilityChange=()=>{
    if(document.visibilityState==='hidden'&&entry){remember();savePageScrollPositions(positions);}
  };
  const onPageShow=()=>{schedule();};
  const headerResize=typeof ResizeObserver==='undefined'?null:new ResizeObserver(schedule);
  const mutations=new MutationObserver(schedule);
  mutations.observe(root,{attributes:true,attributeFilter:['class']});
  mutations.observe(body,{childList:true,subtree:true});
  body.addEventListener('scroll',onBodyScroll,{passive:true});
  window.addEventListener('scroll',onWindowScroll,{passive:true});
  window.addEventListener('resize',schedule,{passive:true});
  mobile.addEventListener('change',schedule);
  window.addEventListener('popstate',onPopState);
  window.addEventListener('hashchange',onHashChange);
  window.addEventListener('pagehide',onPageHide);
  window.addEventListener('pageshow',onPageShow);
  document.addEventListener('visibilitychange',onVisibilityChange);
  const inputs=['pointerdown','wheel','touchmove','keydown'] as const;
  inputs.forEach(type=>window.addEventListener(type,onInput,{capture:true,passive:true}));
  sync();
  return {
    routeCommitted(pathname:string){renderedPathname=pathname;sync();schedule();},
    dispose(){
      disposed=true;window.cancelAnimationFrame(frame);clearPending();
      mutations.disconnect();headerResize?.disconnect();
      body.removeEventListener('scroll',onBodyScroll);
      window.removeEventListener('scroll',onWindowScroll);
      window.removeEventListener('resize',schedule);mobile.removeEventListener('change',schedule);
      window.removeEventListener('popstate',onPopState);window.removeEventListener('hashchange',onHashChange);
      window.removeEventListener('pagehide',onPageHide);window.removeEventListener('pageshow',onPageShow);
      document.removeEventListener('visibilitychange',onVisibilityChange);
      inputs.forEach(type=>window.removeEventListener(type,onInput,true));
      if(active){
        const position=getPageScroll();root.classList.remove(CONTAINED_SCROLL_CLASS);
        window.history.scrollRestoration=previousRestoration;
        window.scrollTo({...position,behavior:'instant'});
      }
      markPageScrollRestoration(null);
      clearPreservedPageScroll();
    },
  };
}

function InstalledPageScrollController(){
  const pathname=usePathname()||'';
  const search=useSearchParams().toString();
  const controller=useRef<ReturnType<typeof installPageScrollController>|null>(null);
  useLayoutEffect(()=>{
    controller.current=installPageScrollController(window.location.pathname);
    return()=>{controller.current?.dispose();controller.current=null;};
  },[]);
  useLayoutEffect(()=>{controller.current?.routeCommitted(pathname);},[pathname,search]);
  return null;
}

export default function InstalledPageScroll(){
  return <Suspense fallback={null}><InstalledPageScrollController/></Suspense>;
}
