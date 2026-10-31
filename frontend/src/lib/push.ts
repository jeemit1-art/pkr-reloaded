'use client';
import { api, getToken } from './api';

const desiredKey=(eventId:string)=>'pkr_push_desired_'+eventId;


function urlB64ToUint8(b64:string):Uint8Array {
  const pad='='.repeat((4-b64.length%4)%4);
  const raw=atob((b64+pad).replace(/-/g,'+').replace(/_/g,'/'));
  return Uint8Array.from(raw,c=>c.charCodeAt(0)) as unknown as Uint8Array<ArrayBuffer>;
}

/** Get or register the service worker — avoids .ready which hangs on iOS Safari */
async function getSwReg():Promise<ServiceWorkerRegistration|null> {
  if(typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return null;
  try {
    return (await navigator.serviceWorker.getRegistration())
      ?? await navigator.serviceWorker.register('/sw.js',{scope:'/'});
  } catch { return null; }
}

export function isPWAInstalled(): boolean {
  if (typeof window === 'undefined') return false;
  return window.matchMedia('(display-mode: standalone)').matches
    || (window.navigator as any).standalone === true;
}

export function isIOS(): boolean {
  if (typeof navigator === 'undefined') return false;
  return /iphone|ipad|ipod/i.test(navigator.userAgent);
}

export function isSafari(): boolean {
  if (typeof navigator === 'undefined') return false;
  return /safari/i.test(navigator.userAgent) &&
    !/chrome|crios|fxios|edgios|fban|fbav|instagram|whatsapp|micromessenger|line\//i.test(navigator.userAgent);
}

export function isInAppBrowser():boolean {
  if(typeof navigator==='undefined')return false;
  return /whatsapp|fban|fbav|instagram|micromessenger|line\//i.test(navigator.userAgent);
}

export function canUsePush(): boolean {
  return 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
}

export function getNotificationPermission(): NotificationPermission | 'unsupported' {
  if (typeof Notification === 'undefined') return 'unsupported';
  return Notification.permission;
}

/** Returns true if the current device has an active push subscription for this specific eventId */
export async function isPushSubscribedToEvent(eventId:string):Promise<boolean> {
  if(!canUsePush() || Notification.permission!=='granted') return false;
  try {
    const reg = await getSwReg();
    if(!reg) return false;
    const sub = await reg.pushManager.getSubscription();
    if (!sub) return false;
    const result=await api.events.pushStatus(eventId,sub.endpoint);
    if(result.subscribed){
      localStorage.setItem('pkr_push_'+eventId,sub.endpoint);
      // Migrate devices opted in before durable preference tracking was added.
      if(localStorage.getItem(desiredKey(eventId))!=='off')
        localStorage.setItem(desiredKey(eventId),'on');
    }else localStorage.removeItem('pkr_push_'+eventId);
    // Only the authenticated server can confirm a per-room subscription.
    // Local storage alone must never imply alerts are enabled.
    return result.subscribed;
  } catch { return false; }
}

/**
 * Subscribe this device to push notifications for an event.
 * Pass displayName for anonymous (non-Google) players so targeted
 * per-player notifications (buy-in, cashout) can reach them.
 */
export async function subscribePush(eventId:string, userId?:string, displayName?:string):Promise<boolean> {
  if(!canUsePush() || Notification.permission!=='granted') return false;
  if(isIOS()&&!isPWAInstalled())return false;
  try {
    const reg = await getSwReg();
    if(!reg) return false;
    const {key} = await api.vapidKey();
    const serverKey=urlB64ToUint8(key);
    let sub=await reg.pushManager.getSubscription();
    // A VAPID key change invalidates the old subscription. Only replace it
    // when the browser confirms the current key is different.
    const currentKey=sub?.options?.applicationServerKey;
    if(sub&&currentKey){
      const previous=new Uint8Array(currentKey as ArrayBuffer);
      const changed=previous.length!==serverKey.length ||
        previous.some((byte,index)=>byte!==serverKey[index]);
      if(changed){
        await sub.unsubscribe();
        sub=null;
      }
    }
    sub=sub||await reg.pushManager.subscribe({
      userVisibleOnly:true,applicationServerKey:serverKey.buffer as ArrayBuffer
    });
    await api.events.subscribe(eventId, sub.toJSON() as any, userId, displayName);
    localStorage.setItem('pkr_push_'+eventId,sub.endpoint);
    localStorage.setItem(desiredKey(eventId),'on');
    window.dispatchEvent(new CustomEvent('pkr:push-changed',{detail:{eventId,enabled:true}}));
    return true;
  } catch(e) { console.error('Push subscribe failed',e); return false; }
}

export async function unsubscribePush(eventId:string):Promise<boolean> {
  if(!canUsePush()) return false;
  try {
    const reg = await getSwReg();
    if(!reg) return false;
    const sub = await reg.pushManager.getSubscription();
    if (sub) {
      await api.events.unsubscribe(eventId, sub.endpoint);
      // Keep the browser's device subscription: it may serve other poker rooms.
      // Only the server-side association for this room is removed.
    }
    localStorage.removeItem('pkr_push_'+eventId);
    localStorage.setItem(desiredKey(eventId),'off');
    window.dispatchEvent(new CustomEvent('pkr:push-changed',{detail:{eventId,enabled:false}}));
    return true; // Request completed; caller should set this room's status to false.
  } catch(e) { console.error('Push unsubscribe failed',e); return false; }
}

/** Local device preview only: tests OS display, not server-to-device delivery. */
export async function showTestNotification():Promise<boolean> {
  if(!canUsePush() || Notification.permission!=='granted')return false;
  try{
    const reg=await getSwReg();
    if(!reg)return false;
    await reg.showNotification('♠ PKR notifications are on',{
      body:'Test alert: poker-night updates will appear here when your device receives them.',
      icon:'/icon-192.png',badge:'/icon-192.png',tag:'pkr-test-alert',
      data:{type:'test',url:'/dashboard'}
    });
    return true;
  }catch{return false;}
}

/**
 * Restore only rooms the person previously opted into. Never call
 * requestPermission here and never override a per-room opt-out.
 * Permission may be removed by the OS; that requires a human gesture.
 */
export async function ensurePushForRoom(eventId:string):Promise<boolean> {
  if(!eventId || !getToken() || !canUsePush() || Notification.permission!=='granted' ||
     (isIOS()&&!isPWAInstalled()) || !navigator.onLine)return false;
  const preference=localStorage.getItem(desiredKey(eventId));
  const legacyOptIn=!!localStorage.getItem('pkr_push_'+eventId);
  const registered=await isPushSubscribedToEvent(eventId);
  if(registered)return true;
  if(preference==='off'||(preference!=='on'&&!legacyOptIn))return false;
  return subscribePush(eventId);
}

let recovering:Promise<void>|null=null;
let lastRecovery=0;
export function restoreKnownPushSubscriptions():Promise<void> {
  if(recovering)return recovering;
  if(typeof window==='undefined'||!getToken()||!canUsePush()||
     Notification.permission!=='granted'||(isIOS()&&!isPWAInstalled())||
     !navigator.onLine||Date.now()-lastRecovery<300000)return Promise.resolve();
  lastRecovery=Date.now();
  recovering=(async()=>{
    const ids=new Set<string>();
    for(let i=0;i<localStorage.length;i++){
      const key=localStorage.key(i);
      if(!key)continue;
      if(key.startsWith('pkr_push_desired_')&&localStorage.getItem(key)==='on')
        ids.add(key.slice('pkr_push_desired_'.length));
      else if(key.startsWith('pkr_push_')&&!key.startsWith('pkr_push_desired_')&&localStorage.getItem(key))
        ids.add(key.slice('pkr_push_'.length));
    }
    for(const id of ids){
      if(!/^[a-zA-Z0-9_-]{3,128}$/.test(id))continue;
      try { await ensurePushForRoom(id); } catch { /* Retry on next visit. */ }
    }
  })().finally(()=>{recovering=null});
  return recovering;
}

/** This sends a real server-to-device test, rather than a local preview. */
export async function sendRealTestNotification(eventId:string):Promise<boolean> {
  if(!canUsePush()||Notification.permission!=='granted')return false;
  const reg=await getSwReg();
  const endpoint=(await reg?.pushManager.getSubscription())?.endpoint;
  if(!endpoint)return false;
  const result=await api.events.testPush(eventId,endpoint);
  return result.accepted===true;
}
