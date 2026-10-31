'use client';
import {useEffect,useState} from 'react';
import {useRouter} from 'next/navigation';
import {canUsePush,isIOS,isSafari,isPWAInstalled,isInAppBrowser,ensurePushForRoom,isPushSubscribedToEvent,subscribePush,sendRealTestNotification} from '@/lib/push';
import ForegroundSoundToggle from '@/components/ForegroundSoundToggle';
import {api,getToken} from '@/lib/api';

type Platform='ios'|'android'|'desktop';
type InstallPromptEvent=Event&{prompt:()=>Promise<void>;userChoice:Promise<{outcome:'accepted'|'dismissed'}>};
export default function InstallGuide(){
 const router=useRouter();
 const [group,setGroup]=useState('');
 const [rooms,setRooms]=useState<Array<{id:string;name:string}>>([]);
 const [installed,setInstalled]=useState(false);
 const [permission,setPermission]=useState('default');
 const [subscribed,setSubscribed]=useState(false);
 const [prompt,setPrompt]=useState<InstallPromptEvent|null>(null);
 const [notice,setNotice]=useState('');
 const [copied,setCopied]=useState(false);
 const [platform,setPlatform]=useState<Platform>('desktop');
 const [url,setUrl]=useState('');
 const [busy,setBusy]=useState(false);
 const [sessionPresent,setSessionPresent]=useState(false);
 const [transferCode,setTransferCode]=useState('');
 const [transferBusy,setTransferBusy]=useState(false);
 useEffect(()=>{
  const query=new URLSearchParams(window.location.search);
  const roomId=query.get('group')||'';
  setGroup(roomId);
  if(getToken())api.events.list().then(list=>{
    setRooms(list.map(room=>({id:room.id,name:room.name})));
    // Installation may open a fresh standalone app at /dashboard without
    // the original WhatsApp query string. Recover a single known room.
    if(!roomId&&list.length===1)setGroup(list[0].id);
  }).catch(()=>{});
  if(roomId)ensurePushForRoom(roomId).then(setSubscribed).catch(()=>setSubscribed(false));
  setUrl(window.location.href);
  setSessionPresent(!!getToken());
  setInstalled(isPWAInstalled());
  setPlatform(isIOS()?'ios':/android/i.test(navigator.userAgent)?'android':'desktop');
  if('Notification' in window)setPermission(Notification.permission);
  const onPrompt=(e:Event)=>{e.preventDefault();setPrompt(e as InstallPromptEvent)};
  const onInstalled=()=>{setInstalled(true);setPrompt(null);setNotice('PKR is installed. Open it from your Home Screen to finish setup.')};
  const onVisibility=()=>{if(document.visibilityState==='visible'){
    setInstalled(isPWAInstalled());
    if('Notification' in window)setPermission(Notification.permission);
  }};
  window.addEventListener('beforeinstallprompt',onPrompt);
  window.addEventListener('appinstalled',onInstalled);
  document.addEventListener('visibilitychange',onVisibility);
  return()=>{window.removeEventListener('beforeinstallprompt',onPrompt);window.removeEventListener('appinstalled',onInstalled);document.removeEventListener('visibilitychange',onVisibility)};
 },[]);
 useEffect(()=>{
   if(!group)return;
   let live=true;
   void ensurePushForRoom(group).then(ok=>{if(live)setSubscribed(ok);}).catch(()=>{
     if(live)setSubscribed(false);
   });
   return()=>{live=false;};
 },[group,installed]);
 async function createTransferCode(){
   if(transferBusy)return;
   setTransferBusy(true);setNotice('');
   try{
     const result=await api.auth.transferStart();
     setTransferCode(result.code);
     setNotice('Transfer code created. Keep it private. It expires in five minutes.');
   }catch(e:any){setNotice(e?.message||'Could not generate a transfer code.');}
   finally{setTransferBusy(false);}
 }
 async function copyTransferCode(){
   try{
     await navigator.clipboard.writeText(transferCode);
     setNotice('Code copied. Open the installed PKR app, choose Player login, and paste this code.');
   }catch{setNotice('Copy unavailable. Write the code down and enter it in the installed PKR app.');}
 }
 async function copyLink(){
  try{
   if(!url)throw new Error('Link unavailable');
   await navigator.clipboard.writeText(url);
   setCopied(true);setNotice('Link copied. Open Safari or Chrome and paste it into the address bar.');
  }catch{setNotice('Copy is unavailable in this browser. Select the link below and copy it manually.')}
 }
 async function installApp(){
  if(!prompt)return;
  try{await prompt.prompt();const choice=await prompt.userChoice;if(choice.outcome==='accepted')setNotice('Installation accepted. Open PKR from your Home Screen.');else setNotice('You can install PKR later.');setPrompt(null);}
  catch{setNotice('Use your browser menu to install PKR.')}
 }
 async function enableNotifications(){
  if(busy)return;setBusy(true);setNotice('');
  try{
   if(!group){setNotice('Open this setup page from your poker group to enable its game alerts.');return;}
   if(platform==='ios'&&!installed){setNotice('On iPhone, install PKR and open it from your Home Screen before enabling alerts.');return;}
   if(!canUsePush()){setNotice('This browser does not support push notifications. Open the installed PKR app, or use a compatible browser.');return;}
   const p=Notification.permission==='granted'
     ?'granted':await Notification.requestPermission();
   setPermission(p);
   if(p!=='granted'){setNotice('Notifications were not enabled. You can change permission in your device settings.');return;}
   const user=await api.auth.me().catch(()=>null);
   const ok=await subscribePush(group,user?.id,user?.name);
   const confirmed=ok&&await isPushSubscribedToEvent(group);
   setSubscribed(confirmed);
   setNotice(confirmed
     ?'Notifications are connected to this room. Test a real alert below.'
     :'Could not confirm the subscription. Check your membership or connection, then retry.');
  }catch{setNotice('Unable to activate notifications on this device.')}
  finally{setBusy(false)}
 }
 async function previewAlert(){
   if(!group){setNotice('Choose a poker room first.');return;}
   if(busy)return;
   setBusy(true);setNotice('');
   try{
     const accepted=await sendRealTestNotification(group);
     setNotice(accepted?'PKR sent a real test accepted by the push service. Check your phone notification centre. Your phone controls alert volume.':
       'The push service did not accept the test. Reconnect your notifications and try again.');
   }catch(e:any){
     setNotice(e?.message||'Could not send a remote test. Reconnect and try again.');
   }finally{setBusy(false);}
 }
 const doneNotifications=permission==='granted' && subscribed;
 return <main className="pkr-onboarding pkr-install-vnext">
  <header className="pkr-install-hero"><a href="/dashboard" className="pkr-install-brand">♠ PKR</a><span className="pkr-eyebrow">YOUR PRIVATE POKER CLUB</span><h1>Your poker night. One tap away.</h1><p>Join and RSVP straight from your invitation. Adding PKR to your Home Screen is optional — no app store or account transfer shortcuts required.</p></header>
  <div className="pkr-install-progress" aria-label="Installation progress">
   <span className="complete">① Join & play</span><span className={installed?'complete':''}>② Install (optional)</span><span className={doneNotifications?'complete':''}>③ Alerts</span>
  </div>
  <section className="pkr-install-card" style={{borderColor:'var(--border-hi)'}}>
    <h2 style={{marginTop:0}}>Already joined? Start playing now</h2>
    <p>You do not need to install PKR to accept an invitation or use your poker room.</p>
    <button className="pkr-install-primary"
      onClick={()=>router.push(group?'/events/'+encodeURIComponent(group):'/dashboard')}>
      Open my poker room →
    </button>
  </section>
  {!installed&&sessionPresent&&<section className="pkr-install-card">
    <h2 style={{marginTop:0}}>Keep your approved account after installation</h2>
    <p>On iPhone, PKR installed from Safari may not share your WhatsApp sign-in.
      If your new app asks you to join again, return to the browser where you joined,
      generate a private transfer code here, then paste it into the installed app's
      <strong> Player login</strong> screen. No second host approval needed.</p>
    <button className="pkr-install-secondary" disabled={transferBusy}
      onClick={()=>void createTransferCode()}>
      {transferBusy?'Creating…':'Generate a 5-minute transfer code'}
    </button>
    {transferCode&&<div style={{padding:'16px 0',textAlign:'center'}}>
      <code style={{display:'block',fontSize:21,letterSpacing:2,overflowWrap:'anywhere',marginBottom:12}}>
        {transferCode.match(/.{1,4}/g)?.join(' ')}
      </code>
      <button className="pkr-install-secondary" onClick={()=>void copyTransferCode()}>Copy transfer code</button>
      <p className="pkr-install-footnote">Never send this code to another person. It allows access to your PKR account until it expires.</p>
    </div>}
  </section>}
  {!sessionPresent&&<section className="pkr-install-card">
    <h2 style={{marginTop:0}}>Already part of a poker group?</h2>
    <p>If you joined earlier in WhatsApp, you may need to transfer your login to this installed app.</p>
    <a className="pkr-install-secondary" href="/mobile-login"
      style={{display:'inline-block',textDecoration:'none'}}>Restore my player access →</a>
  </section>}
  <section className="pkr-install-card"><div className="pkr-install-card-title"><span className={installed?'done':'step'}>{installed?'✓':'1'}</span><div><h2>Put PKR on your Home Screen (optional)</h2><p>Open PKR more easily next time. You can keep playing in your browser instead.</p></div></div>
   {installed?<div role="status" className="pkr-install-success">✓ PKR is running as an installed app on this device.</div>:
    platform==='ios'?<div className="pkr-install-instructions"><p>On iPhone, open this page in <strong>Safari</strong>:</p><ol><li>Tap the <strong>Share</strong> icon (square with arrow up).</li><li>Scroll down and tap <strong>Add to Home Screen</strong>.</li><li>Tap <strong>Add</strong>, then launch PKR from the new icon.</li></ol>{(!isSafari()||isInAppBrowser())&&<div className="pkr-install-alert"><strong>Opened from WhatsApp or another app?</strong><p>Copy this setup link and paste it into Safari to see the installation option.</p><button onClick={copyLink}>{copied?'✓ Copied':'Copy setup link'}</button><input aria-label="Setup link to copy manually" readOnly onFocus={e=>e.currentTarget.select()} value={url}/></div>}</div>:
    prompt?<button className="pkr-install-primary" onClick={installApp}>↧ Install PKR now</button>:
    <div className="pkr-install-instructions"><p>{platform==='android'
     ?(isInAppBrowser()?'WhatsApp may hide installation. Copy this link and open it in Chrome, then choose Install app from the Chrome menu.':'In Chrome, tap the ⋮ menu and choose Install app or Add to Home screen.')
     :'In Chrome or Edge, use the browser menu and choose Install app.'}</p><button onClick={copyLink} className="pkr-install-secondary">{copied?'✓ Copied':'Copy setup link'}</button></div>}
   {platform==='ios'&&!installed&&<p className="pkr-install-footnote">iPhone may keep installed-app sign-in separate from Safari. If you see a sign-in screen after installation, open your group invitation again in PKR or ask your host for an approved recovery link.</p>}
  </section>
  <section className="pkr-install-card">
    {rooms.length>1&&<div style={{marginBottom:18}}>
      <label htmlFor="pkr-install-room" style={{display:'block',marginBottom:8}}>Select the room to receive alerts for</label>
      <select id="pkr-install-room" value={group}
        onChange={e=>{setGroup(e.target.value);setSubscribed(false);}}
        style={{width:'100%',padding:12,borderRadius:8,color:'var(--ivory)',background:'var(--bg3)',border:'1px solid var(--border-hi)'}}>
        <option value="">Choose a room</option>
        {rooms.map(room=><option key={room.id} value={room.id}>{room.name}</option>)}
      </select>
    </div>}
    <div className="pkr-install-card-title"><span className={doneNotifications?'done':'step'}>{doneNotifications?'✓':'2'}</span><div><h2>Get useful game-night notifications</h2><p>Receive game times, host approvals, your buy-ins, cash-outs, results and settlement updates where supported.</p></div></div>
    <p className="pkr-install-meta">Notifications: <strong>{doneNotifications?'Enabled for this poker room':permission==='granted'?'Permission granted — subscription required':permission}</strong></p>
    {group?<button className="pkr-install-primary" onClick={enableNotifications} disabled={busy||doneNotifications||permission==='denied'||(platform==='ios'&&!installed)}>{busy?'Enabling…':doneNotifications?'✓ Alerts enabled':permission==='denied'?'Notifications blocked in browser settings':'Enable game alerts'}</button>:<p className="pkr-install-footnote">Open this guide from your poker room to subscribe to that group's notifications.</p>}
    {permission==='denied'&&<p className="pkr-install-footnote" role="status">
      Notifications are blocked on this device. On iPhone, open Settings → Notifications → PKR; otherwise check Chrome/Android app notification or site settings. Return here after allowing alerts.
    </p>}
    {doneNotifications&&<button className="pkr-install-secondary" type="button"
      onClick={()=>void previewAlert()} disabled={busy} style={{marginTop:10}}>{busy?'Sending test…':'🔔 Send a real test notification'}</button>}
    <div style={{marginTop:16,padding:'14px 12px',borderRadius:10,
      border:'1px solid var(--border-sub)',background:'rgba(0,0,0,.14)'}}>
      <ForegroundSoundToggle/>
    </div>
    <p className="pkr-install-footnote">The louder chime works when PKR is open and your device permits audio. Background push sound, volume and Do Not Disturb/Focus are controlled by the phone. Android may support vibration patterns; iPhone web apps cannot override the system alert sound.</p>
  </section>
  <section className="pkr-install-card"><div className="pkr-install-card-title"><span className="step">3</span><div><h2>Open your poker room</h2><p>See games, members, seating, results and settlement.</p></div></div><button className="pkr-install-primary" onClick={()=>router.push(group?'/events/'+encodeURIComponent(group):'/dashboard')}>Go to my poker room →</button></section>
  {notice&&<p className="pkr-install-notice" role="status">{notice}</p>}
 </main>;
}