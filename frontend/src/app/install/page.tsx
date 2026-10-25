'use client';
import {useEffect,useState} from 'react';
import {useRouter} from 'next/navigation';
import {canUsePush,isIOS,isSafari,isPWAInstalled,isPushSubscribedToEvent,subscribePush} from '@/lib/push';
import {api} from '@/lib/api';

type Platform='ios'|'android'|'desktop';
type InstallPromptEvent=Event&{prompt:()=>Promise<void>;userChoice:Promise<{outcome:'accepted'|'dismissed'}>};
export default function InstallGuide(){
 const router=useRouter();
 const [group,setGroup]=useState('');
 const [installed,setInstalled]=useState(false);
 const [permission,setPermission]=useState('default');
 const [subscribed,setSubscribed]=useState(false);
 const [prompt,setPrompt]=useState<InstallPromptEvent|null>(null);
 const [notice,setNotice]=useState('');
 const [copied,setCopied]=useState(false);
 const [platform,setPlatform]=useState<Platform>('desktop');
 const [url,setUrl]=useState('');
 const [busy,setBusy]=useState(false);
 useEffect(()=>{
  const query=new URLSearchParams(window.location.search);
  const roomId=query.get('group')||'';
  setGroup(roomId);
  if(roomId)isPushSubscribedToEvent(roomId).then(setSubscribed).catch(()=>setSubscribed(false));
  setUrl(window.location.href);
  setInstalled(isPWAInstalled());
  setPlatform(isIOS()?'ios':/android/i.test(navigator.userAgent)?'android':'desktop');
  if('Notification' in window)setPermission(Notification.permission);
  const onPrompt=(e:Event)=>{e.preventDefault();setPrompt(e as InstallPromptEvent)};
  const onInstalled=()=>{setInstalled(true);setPrompt(null);setNotice('PKR is installed. Open it from your Home Screen to finish setup.')};
  const onVisibility=()=>{if(document.visibilityState==='visible')setInstalled(isPWAInstalled())};
  window.addEventListener('beforeinstallprompt',onPrompt);
  window.addEventListener('appinstalled',onInstalled);
  document.addEventListener('visibilitychange',onVisibility);
  return()=>{window.removeEventListener('beforeinstallprompt',onPrompt);window.removeEventListener('appinstalled',onInstalled);document.removeEventListener('visibilitychange',onVisibility)};
 },[]);
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
   const p=await Notification.requestPermission();setPermission(p);
   if(p!=='granted'){setNotice('Notifications were not enabled. You can change permission in your device settings.');return;}
   const user=await api.auth.me().catch(()=>null);
   const ok=await subscribePush(group,user?.id,user?.name);
   setSubscribed(ok);
   setNotice(ok?'Notifications enabled for this poker group.':'Could not subscribe. Make sure you have joined this group, then try again.');
  }catch{setNotice('Unable to activate notifications on this device.')}
  finally{setBusy(false)}
 }
 const doneNotifications=permission==='granted' && subscribed;
 return <main className="pkr-onboarding pkr-install-vnext">
  <header className="pkr-install-hero"><a href="/dashboard" className="pkr-install-brand">♠ PKR</a><span className="pkr-eyebrow">YOUR PRIVATE POKER CLUB</span><h1>Your poker night. One tap away.</h1><p>Keep your games, RSVP board, table and results on your phone. Install PKR without visiting an app store.</p></header>
  <div className="pkr-install-progress" aria-label="Installation progress"><span className={installed?'complete':''}>1. Install</span><span className={doneNotifications?'complete':''}>2. Alerts</span><span>3. Play</span></div>
  <section className="pkr-install-card"><div className="pkr-install-card-title"><span className={installed?'done':'step'}>{installed?'✓':'1'}</span><div><h2>Put PKR on your Home Screen</h2><p>Just once. After that, open PKR like any other app.</p></div></div>
   {installed?<div role="status" className="pkr-install-success">✓ PKR is running as an installed app on this device.</div>:
    platform==='ios'?<div className="pkr-install-instructions"><p>On iPhone, open this page in <strong>Safari</strong>:</p><ol><li>Tap the <strong>Share</strong> icon (square with arrow up).</li><li>Scroll down and tap <strong>Add to Home Screen</strong>.</li><li>Tap <strong>Add</strong>, then launch PKR from the new icon.</li></ol>{!isSafari()&&<div className="pkr-install-alert"><strong>Opened from WhatsApp or another app?</strong><p>Copy this setup link and paste it into Safari to see the installation option.</p><button onClick={copyLink}>{copied?'✓ Copied':'Copy setup link'}</button><input aria-label="Setup link to copy manually" readOnly onFocus={e=>e.currentTarget.select()} value={url}/></div>}</div>:
    prompt?<button className="pkr-install-primary" onClick={installApp}>↧ Install PKR now</button>:
    <div className="pkr-install-instructions"><p>{platform==='android'?'In Chrome, tap the ⋮ menu and choose Install app or Add to Home screen.':'In Chrome or Edge, use the browser menu and choose Install app.'}</p><button onClick={copyLink} className="pkr-install-secondary">{copied?'✓ Copied':'Copy setup link'}</button></div>}
   {platform==='ios'&&!installed&&<p className="pkr-install-footnote">iPhone may keep installed-app sign-in separate from Safari. If you see a sign-in screen after installation, open your group invitation again in PKR or ask your host for an approved recovery link.</p>}
  </section>
  <section className="pkr-install-card"><div className="pkr-install-card-title"><span className={doneNotifications?'done':'step'}>{doneNotifications?'✓':'2'}</span><div><h2>Get game-night notifications</h2><p>Know when games are scheduled and when your game records change.</p></div></div>
    <p className="pkr-install-meta">Notifications: <strong>{doneNotifications?'Enabled for this poker room':permission==='granted'?'Permission granted — subscription required':permission}</strong></p>
    {group?<button className="pkr-install-primary" onClick={enableNotifications} disabled={busy||doneNotifications||(platform==='ios'&&!installed)}>{busy?'Enabling…':doneNotifications?'✓ Alerts enabled':'Enable game alerts'}</button>:<p className="pkr-install-footnote">Open this guide from your poker room to subscribe to that group's notifications.</p>}
    <p className="pkr-install-footnote">Sounds and vibration depend on your phone settings; websites cannot force custom background alerts.</p>
  </section>
  <section className="pkr-install-card"><div className="pkr-install-card-title"><span className="step">3</span><div><h2>Open your poker room</h2><p>See games, members, seating, results and settlement.</p></div></div><button className="pkr-install-primary" onClick={()=>router.push(group?'/events/'+encodeURIComponent(group):'/dashboard')}>Go to my poker room →</button></section>
  {notice&&<p className="pkr-install-notice" role="status">{notice}</p>}
 </main>;
}