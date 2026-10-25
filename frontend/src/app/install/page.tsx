'use client';
import {useEffect,useState} from 'react';
import {useRouter} from 'next/navigation';
import {canUsePush,isIOS,isSafari,isPWAInstalled,subscribePush} from '@/lib/push';
import {api} from '@/lib/api';
export default function InstallGuide(){
 const router=useRouter();
 const [group,setGroup]=useState('');
 const [installed,setInstalled]=useState(false),[permission,setPermission]=useState('default');
 const [prompt,setPrompt]=useState<any>(null),[notice,setNotice]=useState('');
 const [copied,setCopied]=useState(false);
 const [platform,setPlatform]=useState<'ios'|'android'|'desktop'>('desktop');
 useEffect(()=>{
  setGroup(new URLSearchParams(window.location.search).get('group')||'');
  setInstalled(isPWAInstalled());
  setPlatform(isIOS()?'ios':/android/i.test(navigator.userAgent)?'android':'desktop');
  if('Notification' in window)setPermission(Notification.permission);
  const onPrompt=(e:Event)=>{e.preventDefault();setPrompt(e);};
  const onInstalled=()=>{setInstalled(true);setPrompt(null);};
  window.addEventListener('beforeinstallprompt',onPrompt);window.addEventListener('appinstalled',onInstalled);
  return ()=>{window.removeEventListener('beforeinstallprompt',onPrompt);window.removeEventListener('appinstalled',onInstalled)};
 },[]);
 async function doInstall(){if(!prompt)return;await prompt.prompt();const result=await prompt.userChoice;if(result?.outcome==='accepted')setNotice('Installation started. Open PKR from your home screen.');else setNotice('You can install later.');setPrompt(null);}
 async function alerts(){
  if(!group){setNotice('Open this setup page from your group to activate game notifications.');return;}
  if(!canUsePush()){setNotice('Push notifications are not supported in this browser. On iPhone, add PKR to Home Screen first.');return;}
  const p=await Notification.requestPermission();setPermission(p);
  if(p!=='granted'){setNotice('Notifications not enabled. You can change this later in your phone settings.');return;}
  const user=await api.auth.me().catch(()=>null);
  const ok=await subscribePush(group,user?.id,user?.name);
  setNotice(ok?'Game notifications enabled for this group.':'Unable to subscribe. Check browser and notification permissions.');
 }
 return <main className="pkr-onboarding" style={{maxWidth:540,margin:'0 auto',padding:'28px 22px 72px',lineHeight:1.6}}>
  <a href="/dashboard" style={{color:'var(--gold)'}}>♠ PKR</a>
  <p style={{color:'var(--gold)',fontSize:12,marginTop:24}}>PLAYER SETUP · 3 SIMPLE STEPS</p>
  <h1 style={{fontSize:34,margin:'8px 0 10px'}}>Put poker night on your phone</h1>
  <p style={{opacity:.8}}>Install PKR once. Invitations, seat reservations, buy-ins, cash-outs and settlement updates will be easier to find.</p>
  <section style={{marginTop:24,padding:20,background:'var(--bg2)',border:'1px solid var(--border-hi)',borderRadius:14}}>
   <h2 style={{fontSize:20}}>1. Add PKR to your home screen</h2>
   {installed?<p style={{color:'var(--green)'}}>✓ PKR is installed on this device.</p>:
    platform==='ios'?<><p style={{fontSize:15,margin:'10px 0'}}>On iPhone: open PKR in <strong>Safari</strong> → tap the <strong>Share</strong> icon → scroll down to <strong>Add to Home Screen</strong> → tap <strong>Add</strong>.</p><div className="pkr-install-steps"><span>1  Safari</span><span>2  Share ↑</span><span>3  Add to Home Screen</span></div>{!isSafari()&&<><p style={{color:'var(--amber)'}}>WhatsApp's in-app browser cannot install PKR. Open this link in Safari first.</p><button onClick={async()=>{await navigator.clipboard.writeText(window.location.href);setCopied(true);}} style={{padding:'12px 18px',borderRadius:9,border:'1px solid var(--gold)',color:'var(--gold)',background:'transparent',marginTop:10}}>{copied?'✓ Link copied — paste in Safari':'Copy link for Safari'}</button></>}</>:
    prompt?<button onClick={doInstall} style={{padding:'12px 20px',borderRadius:8,background:'var(--gold)',color:'#17120a',fontWeight:700}}>Install PKR</button>:
    <p>{platform==='android'?'In Chrome, open the ⋮ menu and choose Install app or Add to Home screen.':'In a supported browser, open its menu and choose Install app.'}</p>}
  </section>
  <section style={{marginTop:16,padding:20,background:'var(--bg2)',border:'1px solid var(--border-hi)',borderRadius:14}}>
   <h2 style={{fontSize:20}}>2. Turn on game notifications</h2>
   <p>Get alerts for newly scheduled games, personal buy-ins, cash-outs and settlement results. Your phone may require PKR to be installed first.</p>
   <p>Current permission: <strong>{permission}</strong></p>
   {!installed&&platform==='ios'&&<p style={{color:'var(--amber)'}}>Install and open PKR from your Home Screen before enabling notifications.</p>}
   <button disabled={!installed&&platform==='ios'} onClick={alerts} style={{padding:'12px 20px',borderRadius:8,background:'var(--gold)',color:'#17120a',fontWeight:700}}>Enable game alerts</button>
   <p style={{fontSize:12,opacity:.7}}>Sound and vibration depend on your device settings. Browsers do not allow websites to force notification sounds while in the background.</p>
  </section>
  <section style={{marginTop:16,padding:20,background:'var(--bg2)',border:'1px solid var(--border-hi)',borderRadius:14}}>
   <h2 style={{fontSize:20}}>3. Open your poker group</h2>
   <p>Your membership stays private to the group you joined. No other group's member directory is visible.</p>
   <button onClick={()=>router.push(group?'/events/'+encodeURIComponent(group):'/dashboard')} style={{padding:'12px 20px',borderRadius:8,background:'var(--gold)',color:'#17120a',fontWeight:700}}>Go to my group →</button>
  </section>
  {notice&&<p role="status" style={{marginTop:18,color:'var(--gold)'}}>{notice}</p>}
 </main>;
}
