'use client';
import {useEffect,useState} from 'react';
import {useRouter} from 'next/navigation';
import {api,clearToken,getToken,type Event,type User} from '@/lib/api';
import {canUsePush,ensurePushForRoom,isPWAInstalled,subscribePush,unsubscribePush,sendRealTestNotification} from '@/lib/push';
import ForegroundSoundToggle from '@/components/ForegroundSoundToggle';
import RoomExperienceChoice from '@/components/RoomExperienceChoice';
import PersonalHomeViewSettings from '@/components/PersonalHomeViewSettings';
import {PersonalAppearanceSettings} from '@/components/PersonalAppearance';
import {useAppUpdate} from '@/components/AppUpdateContext';
import {collectDisplayDetails} from '@/lib/app-display-details';
import './account.css';

type Registration={user_id:string;device_count:number};
export default function AccountSettings(){
 const router=useRouter();
 const appUpdate=useAppUpdate();
 const [user,setUser]=useState<User|null>(null);
 const [rooms,setRooms]=useState<Event[]>([]);
 const [selected,setSelected]=useState('');
 const [subscribed,setSubscribed]=useState<boolean|null>(null);
 const [registrations,setRegistrations]=useState<Registration[]|null>(null);
 const [loading,setLoading]=useState(true);
 const [busy,setBusy]=useState(false);
 const [notice,setNotice]=useState('');
 const [installed,setInstalled]=useState<boolean|null>(null);
 const [permission,setPermission]=useState('unknown');
 const [displayDetails,setDisplayDetails]=useState('');
 const [displayNotice,setDisplayNotice]=useState('');
 useEffect(()=>{
  let alive=true;
  if(!getToken()){router.replace('/');return}
  Promise.all([api.auth.me(),api.events.list()]).then(([person,list])=>{
   if(!alive)return;
   setUser(person);setRooms(list);
   let preferred='';try{preferred=localStorage.getItem('pkr_preferred_room')||'';}catch{}
   setSelected(list.find(x=>x.id===preferred)?.id||list.find(x=>x.status!=='ended')?.id||list[0]?.id||'');
  }).catch(()=>{if(alive)setNotice('Unable to load account details. Please check your connection.')})
   .finally(()=>{if(alive)setLoading(false)});
  setInstalled(isPWAInstalled());
  setPermission('Notification' in window?Notification.permission:'unsupported');
  return()=>{alive=false};
 },[router]);
 useEffect(()=>{
  if(!selected)return;
  let live=true;
  setSubscribed(null);setRegistrations(null);
  void ensurePushForRoom(selected).then(value=>{if(live)setSubscribed(value)}).catch(()=>{if(live)setSubscribed(false)});
  if(rooms.find(x=>x.id===selected)?.role!=='member'){
   api.events.pushRegistrations(selected).then(x=>{if(live)setRegistrations(x.members)}).catch(()=>{});
  }
  return()=>{live=false};
 },[selected,rooms]);
 const room=rooms.find(x=>x.id===selected);
 const canManage=room?.role==='host'||room?.role==='cohost';
 const registeredDevices=registrations?.filter(r=>r.device_count>0).length||0;
 async function enable(){
  if(!selected||busy)return;
  setBusy(true);setNotice('');
  try{
   if(!canUsePush()){setNotice('Push notifications are unavailable in this browser. Use the installation guide for your device.');return}
   if(!('Notification' in window)){setNotice('Notifications are not supported here.');return}
   const p=Notification.permission==='granted'?'granted':await Notification.requestPermission();
   setPermission(p);
   if(p!=='granted'){setNotice('Notifications are blocked. Check your phone or browser settings.');return}
   const ok=await subscribePush(selected,user?.id,user?.name);
   const verified=ok&&await ensurePushForRoom(selected);
   setSubscribed(verified);
   setNotice(verified?'Notifications are registered for this device and poker club.':
     'PKR could not verify your registration. Please try again.');
  }catch(e){setNotice(e instanceof Error?e.message:'Could not enable notifications.')}
  finally{setBusy(false)}
 }
 async function disable(){
  if(!selected||busy)return;setBusy(true);
  try{
   const ok=await unsubscribePush(selected);
   if(ok){setSubscribed(false);setNotice('Notifications disabled for this club on this device.')}
   else setNotice('Unable to disable notifications. Check the current subscription.');
  }catch{setNotice('Unable to change notifications.')}
  finally{setBusy(false)}
 }
 async function test(){
  if(!selected||busy)return;setBusy(true);
  try{
   const ok=await sendRealTestNotification(selected);
   setNotice(ok?'A real test was accepted by the push service. Check your notification centre; your phone controls the volume.':
     'The notification service did not accept the test. Check your device settings.');
  }catch{setNotice('Unable to send a test notification.')}
  finally{setBusy(false)}
 }
 async function managePlan(){
  if(busy)return;setBusy(true);
  try{const r=await api.billing.portal();if(r.url)window.location.assign(r.url)}
  catch{setNotice('The billing portal could not be opened. Please try again.')}
  finally{setBusy(false)}
 }
 async function signOut(){clearToken();try{await api.auth.logout()}catch{}router.replace('/')}
 async function copyDisplayDetails(){
  const details=JSON.stringify(collectDisplayDetails(),null,2);
  try{
   if(!navigator.clipboard?.writeText)throw new Error('Clipboard unavailable');
   await navigator.clipboard.writeText(details);setDisplayDetails('');
   setDisplayNotice('Display details copied. They contain only the app version and screen layout information.');
  }catch{
   setDisplayDetails(details);setDisplayNotice('Select and copy the display details below.');
  }
 }
 if(loading)return <main className="pkr-primary-page pkr-account-page"><p role="status">Loading account settings…</p></main>;
 return <main className="pkr-primary-page pkr-account-page"><div className="pkr-primary-page-inner">
  <header className="pkr-primary-page-head">
   <div><span className="pkr-primary-kicker">PROFILE · DEVICES · CLUBS</span><h1>Account & settings</h1>
    <p>Personal preferences, notifications and installation — separate from managing players or games.</p></div>
  </header>
  <div className="pkr-account-layout">
   <section className="pkr-primary-panel">
    <h2>Your account</h2>
    <p><strong>{user?.name||'PKR member'}</strong>{user?.email?' · '+user.email:''}</p>
    <div className="pkr-account-actions">
     {user?.plan&&<span className="pkr-account-plan">Plan: {user.plan.toUpperCase()}</span>}
     {user?.plan&&user.plan!=='trial'&&rooms.some(r=>r.role==='host')&&
       <button type="button" className="pkr-primary-outline" disabled={busy} onClick={()=>void managePlan()}>Manage subscription ↗</button>}
     <button type="button" className="pkr-primary-outline" onClick={()=>router.push('/install'+(selected?'?group='+encodeURIComponent(selected):''))}>Install / reconnect PKR ↗</button>
     <button type="button" className="pkr-primary-outline" onClick={()=>router.push('/dashboard#pkr-rooms')}>My poker clubs ↗</button>
    </div>
   </section>
   <PersonalAppearanceSettings/>
   {canManage&&<section className="pkr-primary-panel pkr-account-appearance" data-testid="host-home-settings">
    <h2>Your Home display</h2>
    <PersonalHomeViewSettings/>
    <div className="pkr-account-actions pkr-account-preview-action">
     <button type="button" className="pkr-primary-outline" onClick={()=>router.push('/dashboard?view=player&room='+encodeURIComponent(selected))}>Preview the player experience</button>
    </div>
   </section>}
   <section className="pkr-primary-panel pkr-account-appearance">
    <h2>Club dashboard design</h2>
    {selected?<RoomExperienceChoice roomId={selected} canChange={room?.role==='host'}/>:
      <p>Join a poker club to see its selected experience.</p>}
   </section>
   <section className="pkr-primary-panel">
    <h2>Notifications for this club</h2>
    <label className="pkr-account-label">Poker club
     <select aria-label="Settings poker club" value={selected} onChange={e=>{
      const id=e.target.value;setSelected(id);setNotice('');
      try{localStorage.setItem('pkr_preferred_room',id)}catch{}
      window.dispatchEvent(new CustomEvent('pkr:room-changed',{detail:id}));
     }}>
      {rooms.map(r=><option key={r.id} value={r.id}>{r.name}</option>)}
     </select>
    </label>
    {!selected?<p>No club is connected to this account yet.</p>:<>
      <p className="pkr-account-status">Device: {installed?'PKR installed':installed===false?'Browser version':'Checking'} · Notifications: {subscribed===null?'checking':subscribed?'enabled':'not registered'} · Permission: {permission}</p>
      <p>Push notifications are free. Delivery and notification volume are controlled by your phone's operating system.</p>
      <div className="pkr-account-actions">
       {!subscribed?<button className="pkr-primary-action" type="button" disabled={busy} onClick={()=>void enable()}>{busy?'Checking…':'Enable notifications'}</button>:
        <button className="pkr-primary-outline" type="button" disabled={busy} onClick={()=>void disable()}>Disable for this club</button>}
       <button type="button" className="pkr-primary-outline" disabled={busy||!subscribed} onClick={()=>void test()}>Test notification</button>
       <button type="button" className="pkr-primary-outline" onClick={()=>router.push('/install?group='+encodeURIComponent(selected))}>Phone setup guide ↗</button>
      </div>
      {canManage&&<div className="pkr-account-notification-summary">
       <strong>Member notification setup</strong>
       {registrations?<p>{registeredDevices} of {registrations.length} members have at least one registered device. Registration does not guarantee delivery.</p>:
        <p>Device registration data is unavailable. This does not mean notifications are off.</p>}
       <button type="button" className="pkr-primary-outline" onClick={()=>router.push('/events/'+encodeURIComponent(selected)+'?tab=members&view=roster')}>View players and devices →</button>
      </div>}
    </>}
   </section>
   <section className="pkr-primary-panel">
    <h2>Sounds & accessibility</h2>
    <ForegroundSoundToggle/>
    <p>In-app sounds work while PKR is open. Background alerts follow your phone's settings; PKR cannot override Silent mode.</p>
   </section>
   <section className="pkr-primary-panel">
    <h2>App version & updates</h2>
    <div data-testid="app-version-settings">
     <p>Running version <code data-testid="running-app-version" data-version={appUpdate.runningVersion} title={appUpdate.runningVersion}>{appUpdate.runningVersion.slice(0,12)}</code></p>
     <p role="status">{appUpdate.status==='checking'?'Checking for an app update…':
       appUpdate.status==='available'?'An app update is ready.':
       appUpdate.status==='current'?'You are using the latest app version.':
       appUpdate.error||'Check whether a newer PKR version is available.'}</p>
     <div className="pkr-account-actions">
      <button type="button" className="pkr-primary-outline" disabled={appUpdate.status==='checking'} onClick={()=>void appUpdate.checkForUpdates()}>Check for updates</button>
      <button type="button" className="pkr-primary-outline" onClick={appUpdate.refresh}>Refresh app</button>
      <button type="button" className="pkr-primary-outline" onClick={()=>void copyDisplayDetails()}>Copy display details</button>
     </div>
     <p>Refreshing keeps your saved games and device sign-in. Save any unfinished form entries first.</p>
     {appUpdate.notice&&<p role="status">{appUpdate.notice}</p>}
     {displayNotice&&<p role="status">{displayNotice}</p>}
     {displayDetails&&<label className="pkr-account-label">Display details
      <textarea readOnly value={displayDetails} rows={10} onFocus={event=>event.currentTarget.select()}/>
     </label>}
    </div>
   </section>
   <section className="pkr-primary-panel">
    <h2>Account actions</h2>
    <div className="pkr-account-actions">
     <button type="button" className="pkr-primary-outline" onClick={()=>router.push('/dashboard')}>Back to Home</button>
     <button type="button" className="pkr-primary-outline" onClick={()=>void signOut()}>Sign out</button>
    </div>
   </section>
  </div>
  {notice&&<p role="status" className="pkr-account-notice">{notice}</p>}
 </div></main>;
}
