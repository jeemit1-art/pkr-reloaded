'use client';
import { api } from './api';

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
  return /safari/i.test(navigator.userAgent) && !/chrome|crios|fxios/i.test(navigator.userAgent);
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
  if(!canUsePush()) return false;
  try {
    const reg = await getSwReg();
    if(!reg) return false;
    const sub = await reg.pushManager.getSubscription();
    if (!sub) return false;
    const result=await api.events.pushStatus(eventId,sub.endpoint);
    if(result.subscribed)localStorage.setItem(`pkr_push_${eventId}`,sub.endpoint);
    else localStorage.removeItem(`pkr_push_${eventId}`);
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
  if(!canUsePush()) return false;
  try {
    const reg = await getSwReg();
    if(!reg) return false;
    const {key} = await api.vapidKey();
    const sub = (await reg.pushManager.getSubscription()) ||
      await reg.pushManager.subscribe({userVisibleOnly:true, applicationServerKey:urlB64ToUint8(key).buffer as ArrayBuffer});
    await api.events.subscribe(eventId, sub.toJSON() as any, userId, displayName);
    localStorage.setItem(`pkr_push_${eventId}`, sub.endpoint);
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
    localStorage.removeItem(`pkr_push_${eventId}`);
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
