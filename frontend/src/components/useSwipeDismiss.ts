'use client';

import {useEffect,useRef,type RefObject} from 'react';
import {installSwipeDismiss} from '@/lib/swipe-dismiss';

/** Opt in only for read-only surfaces; dismissing must not discard a draft. */
export function useSwipeDismiss(ref:RefObject<HTMLElement|null>,onDismiss:(()=>void)|undefined,enabled=true,childSurface=false){
  const dismiss=useRef(onDismiss);
  dismiss.current=onDismiss;
  useEffect(()=>{
    const root=ref.current;
    const surface=childSurface?root?.firstElementChild:root;
    if(!enabled||!surface||!(surface instanceof HTMLElement)||!dismiss.current)return;
    return installSwipeDismiss(surface,()=>dismiss.current?.());
  },[ref,enabled,childSurface]);
}
