'use client';
import {useEffect,useState} from 'react';
import {useRouter} from 'next/navigation';
import {api,clearToken,getToken,type Event,type User} from '@/lib/api';
import {canUsePush,ensurePushForRoom,isPWAInstalled,subscribePush,unsubscribePush,sendRealTestNotification} from '@/lib/push';
import ForegroundSoundToggle from '@/components/ForegroundSoundToggle';
import './account.css';

type Registration={user_id:string;device_count:number};
export default function AccountSettings(){
 const router=useRouter();
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
   <section className="pkr-primary-panel">
    <h2>Notifications for this club</h2>
    <label className="pkr-account-label">Poker club
     <select aria-label="Settings poker club" value={selected} onChange={e=>{setSelected(e.target.value);setNotice('')}}>
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
