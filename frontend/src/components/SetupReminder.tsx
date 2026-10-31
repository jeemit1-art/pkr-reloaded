'use client';

import {useEffect,useState} from 'react';
import {usePathname,useRouter} from 'next/navigation';
import {api,getToken} from '@/lib/api';
import {canUsePush,ensurePushForRoom,isIOS,isPWAInstalled} from '@/lib/push';
import './SetupReminder.css';

const SESSION_KEY='pkr_setup_compact_v1';

function currentRoom(pathname:string):string {
  const match=pathname.match(/^\/events\/([^/?]+)/);
  if(match)return decodeURIComponent(match[1]);
  if(typeof window==='undefined')return '';
  const params=new URLSearchParams(window.location.search);
  const queryRoom=params.get('room')||params.get('group');
  if(queryRoom)return queryRoom;
  try{return localStorage.getItem('pkr_preferred_room')||'';}catch{return '';}
}

/**
 * Small persistent setup status for browser-based, approved PKR members.
 * Never hides the underlying app, never asks OS permission without a tap,
 * and never overrides explicit per-room notification opt-outs.
 */
export default function SetupReminder(){
  const pathname=usePathname()||'';
  const router=useRouter();
  const [mobile,setMobile]=useState(false);
  const [authorised,setAuthorised]=useState(false);
  const [roomId,setRoomId]=useState('');
  const [installed,setInstalled]=useState(false);
  const [permission,setPermission]=useState<NotificationPermission|'unsupported'>('unsupported');
  const [subscribed,setSubscribed]=useState(false);
  const [optedOut,setOptedOut]=useState(false);
  const [expanded,setExpanded]=useState(true);

  const relevant=/^\/(instant|dashboard|events\/[^/]+|results|payments|account)(\/|$)/.test(pathname);
  const inGameplay=/^\/games\/[^/]+\/(play|tv)\/?$/.test(pathname);

  useEffect(()=>{
    try{setExpanded(sessionStorage.getItem(SESSION_KEY)!=='1');}catch{}
    const checkDevice=()=>{
      setMobile(/iphone|ipad|ipod|android/i.test(navigator.userAgent));
      setInstalled(isPWAInstalled());
      setPermission('Notification' in window?Notification.permission:'unsupported');
    };
    checkDevice();
    const onResume=()=>{if(document.visibilityState==='visible')checkDevice();};
    window.addEventListener('focus',checkDevice);
    document.addEventListener('visibilitychange',onResume);
    window.addEventListener('appinstalled',checkDevice);
    return()=>{
      window.removeEventListener('focus',checkDevice);
      document.removeEventListener('visibilitychange',onResume);
      window.removeEventListener('appinstalled',checkDevice);
    };
  },[]);

  useEffect(()=>{
    if(!relevant||!getToken()){setAuthorised(false);setRoomId('');return;}
    let live=true;
    api.events.list().then(rooms=>{
      if(!live)return;
      const candidate=currentRoom(pathname);
      const room=rooms.find(r=>r.id===candidate)||
        rooms.find(r=>r.status!=='ended')||rooms[0];
      setRoomId(room?.id||'');
      setAuthorised(Boolean(room));
    }).catch(()=>{if(live){setAuthorised(false);setRoomId('');}});
    return()=>{live=false;};
  },[pathname,relevant]);

  useEffect(()=>{
    if(!roomId||!authorised)return;
    let live=true;
    const check=()=>{
      if(!live||document.visibilityState!=='visible')return;
      let disabled=false;
      try{disabled=localStorage.getItem('pkr_push_desired_'+roomId)==='off';}catch{}
      setOptedOut(disabled);
      if(disabled||!canUsePush()||Notification.permission!=='granted'){
        setSubscribed(false);
        return;
      }
      void ensurePushForRoom(roomId).then(registered=>{
        if(live)setSubscribed(registered);
      }).catch(()=>{if(live)setSubscribed(false);});
    };
    check();
    document.addEventListener('visibilitychange',check);
    window.addEventListener('focus',check);
    window.addEventListener('pkr:push-changed',check);
    return()=>{
      live=false;
      document.removeEventListener('visibilitychange',check);
      window.removeEventListener('focus',check);
      window.removeEventListener('pkr:push-changed',check);
    };
  },[roomId,authorised,installed,permission]);

  const complete=installed&&(subscribed||optedOut);
  if(!relevant||inGameplay||!authorised||!mobile||!roomId||complete)return null;

  const needInstall=!installed;
  const blocked=installed&&permission==='denied';
  const progress=needInstall?'1 of 2':'2 of 2';
  const headline=needInstall?'Add PKR to your Home Screen':
    blocked?'Notifications blocked on this phone':'Get your poker-night alerts';
  const description=needInstall
    ?isIOS()
      ?'Keep your full PKR account, games and payments on your phone. Install to enable iPhone alerts.'
      :'Open your poker club from your Home Screen. PKR still works in your browser.'
    :blocked
      ?'Enable PKR notifications in your phone settings to get game and payment updates.'
      :'Turn on game and settlement alerts once, then send yourself a real test.';

  function guide(){
    const group=encodeURIComponent(roomId);
    router.push('/install?group='+group);
  }
  function collapse(){
    setExpanded(false);
    try{sessionStorage.setItem(SESSION_KEY,'1');}catch{}
  }
  function expand(){
    setExpanded(true);
    try{sessionStorage.removeItem(SESSION_KEY);}catch{}
  }

  return <aside className={'pkr-setup-reminder'+(!expanded?' is-compact':'')}
    aria-label="PKR phone and notification setup" data-testid="pkr-setup-reminder">
    {expanded?<div className="pkr-setup-reminder-inner">
      <span className="pkr-setup-reminder-icon" aria-hidden="true">♠</span>
      <div className="pkr-setup-reminder-copy">
        <span className="pkr-setup-reminder-progress">PHONE SETUP · STEP {progress}</span>
        <strong>{headline}</strong>
        <p>{description}</p>
      </div>
      <div className="pkr-setup-reminder-actions">
        <button type="button" className="pkr-setup-reminder-primary" onClick={guide}>
          {needInstall?'Show me how →':blocked?'Fix notifications →':'Enable alerts →'}
        </button>
        <button type="button" className="pkr-setup-reminder-later" onClick={collapse}
          aria-label="Minimise phone setup reminder">Later</button>
      </div>
    </div>:
    <div className="pkr-setup-reminder-compact">
      <span><span aria-hidden="true">♠</span> {needInstall?'Home Screen setup needed':'Notification setup needed'}</span>
      <button type="button" onClick={guide}>Finish setup →</button>
      <button type="button" onClick={expand} aria-label="Expand setup reminder">Details</button>
    </div>}
  </aside>;
}
