'use client';

import {useEffect,useId,useRef,useState,type HTMLAttributes} from 'react';
import {createPortal} from 'react-dom';
import {lockPageScroll} from '@/lib/overlay-scroll';

/** Top-layer dialog: never trapped by a page's z-index, transform or bottom nav. */
export default function AppDialog({children,className='',onDismiss,...props}:
  HTMLAttributes<HTMLDialogElement>&{onDismiss?:()=>void}){
  const [mounted,setMounted]=useState(false);
  const ref=useRef<HTMLDialogElement>(null);
  const headingId=useId();
  useEffect(()=>{setMounted(true);},[]);
  useEffect(()=>{
    const dialog=ref.current;
    if(!mounted||!dialog)return;
    const heading=dialog.querySelector<HTMLElement>('h1,h2,h3,.display');
    if(!props['aria-label']&&!props['aria-labelledby']){
      if(heading){if(!heading.id)heading.id=headingId;dialog.setAttribute('aria-labelledby',heading.id);}
      else dialog.setAttribute('aria-label','PKR action');
    }
    const focused=document.activeElement instanceof HTMLElement?document.activeElement:null;
    const unlock=lockPageScroll();
    if(!dialog.open)dialog.showModal();
    return()=>{
      dialog.close();
      unlock();
      if(focused?.isConnected)focused.focus();
    };
  },[mounted,headingId]);
  if(!mounted)return null;
  return createPortal(<div className="pkr-app pkr-dialog-root">
    <dialog {...props} ref={ref} className={'modal-overlay pkr-native-dialog '+className}
      onCancel={event=>{event.preventDefault();if(onDismiss)onDismiss();else ref.current?.click();}}>
      {children}
    </dialog>
  </div>,document.body);
}
