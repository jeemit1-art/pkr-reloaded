'use client';

import {useEffect,useState} from 'react';
import {useRouter} from 'next/navigation';
import {api,getToken} from '@/lib/api';
import {
  canUsePush,isIOS,isSafari,isPWAInstalled,isInAppBrowser,
  ensurePushForRoom,isPushSubscribedToEvent,subscribePush,sendRealTestNotification
} from '@/lib/push';
import ForegroundSoundToggle from '@/components/ForegroundSoundToggle';
import './guided-setup.css';

type Platform='ios'|'android'|'desktop';
type InstallPromptEvent=Event&{
  prompt:()=>Promise<void>;
  userChoice:Promise<{outcome:'accepted'|'dismissed'}>;
};
const verifiedKey=(room:string)=>'pkr:test-confirmed:'+room;
const confirmedKey=(room:string)=>'pkr:setup-last-tested:'+room;

export default function InstallGuide(){
  const router=useRouter();
  const [group,setGroup]=useState('');
  const [rooms,setRooms]=useState<Array<{id:string;name:string}>>([]);
  const [platform,setPlatform]=useState<Platform>('desktop');
  const [installed,setInstalled]=useState(false);
  const [permission,setPermission]=useState<NotificationPermission|'unsupported'>('unsupported');
  const [subscribed,setSubscribed]=useState(false);
  const [checking,setChecking]=useState(true);
  const [sessionPresent,setSessionPresent]=useState(false);
  const [browserName,setBrowserName]=useState('');
  const [prompt,setPrompt]=useState<InstallPromptEvent|null>(null);
  const [busy,setBusy]=useState(false);
  const [transferBusy,setTransferBusy]=useState(false);
  const [transferCode,setTransferCode]=useState('');
  const [testAccepted,setTestAccepted]=useState(false);
  const [testConfirmed,setTestConfirmed]=useState(false);
  const [notice,setNotice]=useState('');
  const [copied,setCopied]=useState(false);

  useEffect(()=>{
    const query=new URLSearchParams(window.location.search);
    const id=query.get('group')||'';
    setGroup(id);
    const signed=!!getToken();
    setSessionPresent(signed);
    const detect=()=>{
      setPlatform(isIOS()?'ios':/android/i.test(navigator.userAgent)?'android':'desktop');
      setInstalled(isPWAInstalled());
      setPermission('Notification' in window?Notification.permission:'unsupported');
      setBrowserName(isInAppBrowser()?'in-app':isSafari()?'safari':'other');
      setSessionPresent(!!getToken());
    };
    detect();
    if(signed){
      api.events.list().then(list=>{
        const available=list.filter(room=>room.status!=='ended').map(room=>({id:room.id,name:room.name}));
        setRooms(available);
        if(!id&&available.length===1)setGroup(available[0].id);
      }).catch(()=>{});
    }
    const onPrompt=(e:Event)=>{e.preventDefault();setPrompt(e as InstallPromptEvent)};
    const onInstalled=()=>{setPrompt(null);detect()};
    const onVisible=()=>{if(document.visibilityState==='visible')detect()};
    window.addEventListener('beforeinstallprompt',onPrompt);
    window.addEventListener('appinstalled',onInstalled);
    window.addEventListener('focus',detect);
    document.addEventListener('visibilitychange',onVisible);
    return()=>{
      window.removeEventListener('beforeinstallprompt',onPrompt);
      window.removeEventListener('appinstalled',onInstalled);
      window.removeEventListener('focus',detect);
      document.removeEventListener('visibilitychange',onVisible);
    };
  },[]);

  useEffect(()=>{
    if(!group||!sessionPresent){setChecking(false);setSubscribed(false);return;}
    let alive=true;
    setChecking(true);
    setSubState();
    async function check(){
      try{
        const actual=await ensurePushForRoom(group);
        if(alive)setSubscribed(actual);
      }catch{if(alive)setSubscribed(false);}
      finally{if(alive)setChecking(false);}
    }
    function setSubState(){
      try{setTestConfirmed(localStorage.getItem(verifiedKey(group))==='yes');}
      catch{setTestConfirmed(false);}
    }
    void check();
    const refresh=()=>{if(document.visibilityState==='visible')void check()};
    window.addEventListener('focus',refresh);
    document.addEventListener('visibilitychange',refresh);
    window.addEventListener('pkr:push-changed',refresh);
    return()=>{
      alive=false;
      window.removeEventListener('focus',refresh);
      document.removeEventListener('visibilitychange',refresh);
      window.removeEventListener('pkr:push-changed',refresh);
    };
  },[group,sessionPresent,installed]);

  const complete=installed&&subscribed;
  const step=complete?3:installed?2:1;
  const installUrl=typeof window==='undefined'?'https://mypkr.app/install':
    window.location.origin+'/install'+(group?'?group='+encodeURIComponent(group):'');
  const roomUrl=group?'/instant?room='+encodeURIComponent(group):'/dashboard';

  function showNotice(message:string){setNotice(message);}
  async function copy(value:string,message:string){
    try{
      await navigator.clipboard.writeText(value);
      setCopied(true);showNotice(message);
    }catch{showNotice('Copy was blocked by this browser. Select and copy the link manually.');}
  }
  async function installAndroid(){
    if(!prompt)return;
    try{
      await prompt.prompt();
      const choice=await prompt.userChoice;
      if(choice.outcome==='accepted')
        showNotice('Installation accepted. Find the PKR icon on your Home Screen and open it to finish setting up alerts.');
      else showNotice('You can continue using PKR in your browser. The setup reminder stays available.');
      setPrompt(null);
    }catch{showNotice('Use Chrome’s browser menu to choose Install app or Add to Home Screen.');}
  }
  async function generateCode(){
    if(transferBusy)return;
    setTransferBusy(true);setNotice('');
    try{
      const result=await api.auth.transferStart();
      setTransferCode(result.code);
      showNotice('Keep this code private. Enter it on the Player login screen in the installed PKR app within five minutes.');
    }catch(e:any){showNotice(e?.message||'Could not create a transfer code. Check you are signed in to your original browser.');}
    finally{setTransferBusy(false);}
  }
  async function enable(){
    if(busy||!group||!sessionPresent)return;
    setBusy(true);setNotice('');
    try{
      if(platform==='ios'&&!installed){
        showNotice('On iPhone, first open PKR from its Home Screen icon. Then come back to this step.');return;
      }
      if(!canUsePush()||!('Notification' in window)){
        showNotice('This browser cannot receive PKR push alerts. Open the installed PKR icon or use a supported browser.');return;
      }
      if(Notification.permission==='denied'){
        showNotice('Notifications are blocked by your phone. Change the PKR notification setting, then return to this page.');return;
      }
      const response=Notification.permission==='granted'?'granted':await Notification.requestPermission();
      setPermission(response);
      if(response!=='granted'){
        showNotice('Notifications were not allowed. You can try again when your phone permits it.');return;
      }
      const me=await api.auth.me();
      const registered=await subscribePush(group,me.id,me.name);
      const verified=registered&&await isPushSubscribedToEvent(group);
      setSubscribed(verified);
      if(!verified)showNotice('PKR could not confirm this device. Check your internet connection and group membership, then retry.');
      else showNotice('Notifications are registered for your poker room. Send a real test to confirm it appears on your phone.');
    }catch(e:any){showNotice(e?.message||'Notifications could not be connected.');}
    finally{setBusy(false);}
  }
  async function test(){
    if(!group||busy)return;
    setBusy(true);setNotice('');setTestAccepted(false);
    try{
      const accepted=await sendRealTestNotification(group);
      setTestAccepted(accepted);
      setTestConfirmed(false);
      try{localStorage.removeItem(verifiedKey(group));}catch{}
      if(accepted){
        try{localStorage.setItem(confirmedKey(group),String(Date.now()));}catch{}
        showNotice('A real test was accepted by the push service. Check your phone’s notification centre, then confirm below whether it appeared.');
      }else showNotice('The notification service did not accept the test. Return to Enable alerts and reconnect this room.');
    }catch(e:any){showNotice(e?.message||'The notification test could not be sent.');}
    finally{setBusy(false);}
  }
  function confirmTest(){
    setTestConfirmed(true);setTestAccepted(false);
    try{localStorage.setItem(verifiedKey(group),'yes')}catch{}
    showNotice('You confirmed seeing the test on this device. PKR cannot override Silent Mode, Focus or your notification volume.');
  }

  return <main className="pkr-onboarding pkr-install-vnext pkr-guided-setup">
    <header className="pkr-install-hero">
      <a href="/dashboard" className="pkr-install-brand">♠ PKR</a>
      <span className="pkr-eyebrow">EASY PHONE SETUP</span>
      <h1>Get PKR ready on your phone.</h1>
      <p>Use PKR straight from WhatsApp. Add it to your Home Screen for quicker access and, on iPhone, to receive background notifications.</p>
    </header>
    <nav className="pkr-install-progress" aria-label="Phone setup progress">
      <span className="complete">✓ Already playing</span>
      <span className={installed?'complete':step===1?'current':''}>{installed?'✓':'1'} Home Screen</span>
      <span className={complete?'complete':step===2?'current':''}>{complete?'✓':'2'} Notifications</span>
    </nav>
    <div className="pkr-guided-wrap">
      {rooms.length>1&&<section className="pkr-guided-room">
        <label htmlFor="pkr-setup-room">Choose the club you want notifications from</label>
        <select id="pkr-setup-room" value={group}
          onChange={e=>{setGroup(e.target.value);setSubscribed(false);setTestConfirmed(false);}}>
          <option value="">Choose a poker room</option>
          {rooms.map(room=><option key={room.id} value={room.id}>{room.name}</option>)}
        </select>
      </section>}
      {complete&&<section className="pkr-install-card pkr-guided-success" role="status">
        <span className="pkr-guided-success-mark">✓</span>
        <h2>PKR is ready</h2>
        <p>PKR is installed on this device and its push subscription is registered for your selected club.</p>
        <p className="pkr-guided-muted">
          {testConfirmed?'You also confirmed receiving a real notification test.':'Send a real test below to check your phone actually receives an alert.'}
        </p>
        <button type="button" className="pkr-install-primary"
          onClick={()=>router.push(roomUrl)}>Open my poker club →</button>
      </section>}
      {!installed&&<section className="pkr-install-card pkr-guided-primary" aria-label="Step 1: Install PKR">
        <span className="pkr-guided-kicker">STEP 1 OF 2</span>
        <h2>Add PKR to your Home Screen</h2>
        <p>This takes about a minute. You can keep playing in the browser until you're ready.</p>
        {platform==='ios'?<div className="pkr-guided-platform">
          {browserName==='in-app'||!isSafari()?<div className="pkr-guided-action">
            <strong>First, open PKR in Safari.</strong>
            <p>You're currently in WhatsApp or another browser. Copy the setup link below, open Safari, then paste the link into its address bar.</p>
            <button type="button" className="pkr-install-primary" onClick={()=>void copy(installUrl,'Link copied. Open Safari and paste it into the address bar.')}>
              {copied?'✓ Link copied':'Copy link for Safari'}
            </button>
            <input aria-label="Setup URL to copy" value={installUrl} readOnly
              onFocus={e=>e.currentTarget.select()} />
          </div>:<div className="pkr-guided-action">
            <strong>You're in Safari. Now add the icon.</strong>
            <ol>
              <li>Tap the <b>Share</b> button <span aria-label="Share" role="img">↑</span> near the address bar.</li>
              <li>Scroll down and tap <b>Add to Home Screen</b>.</li>
              <li>Make sure <b>Open as Web App</b> is selected, if shown.</li>
              <li>Tap <b>Add</b>. Find the PKR icon on your Home Screen and open it.</li>
            </ol>
            <p className="pkr-guided-muted">The browser cannot press Apple's Add button for you or verify the installation from another browser. The next step appears when you open the installed PKR icon.</p>
          </div>}
        </div>:platform==='android'?<div className="pkr-guided-platform">
          {browserName==='in-app'&&<div className="pkr-guided-action">
            <strong>Open the link in Chrome first.</strong>
            <p>WhatsApp's browser may hide the installation option. Copy the link below, then paste it into Chrome.</p>
            <button type="button" className="pkr-install-primary" onClick={()=>void copy(installUrl,'Link copied. Open Chrome and paste it into the address bar.')}>
              {copied?'✓ Link copied':'Copy link for Chrome'}
            </button>
            <input aria-label="Setup URL to copy" value={installUrl} readOnly
              onFocus={e=>e.currentTarget.select()}/>
          </div>}
          {prompt?<button type="button" className="pkr-install-primary"
            onClick={()=>void installAndroid()}>Install PKR now</button>:
          <ol><li>Open PKR in <strong>Chrome</strong>.</li>
            <li>Tap the <strong>three-dot menu (⋮)</strong>.</li>
            <li>Choose <strong>Install app</strong> or <strong>Add to Home Screen</strong>.</li>
            <li>Open the PKR icon from your Home Screen.</li></ol>}
        </div>:<div className="pkr-guided-platform">
          <p>On desktop, use Chrome or Edge's installation option in the address bar or browser menu. The phone setup reminder is only shown on mobile devices.</p>
        </div>}
      </section>}
      {!installed&&sessionPresent&&<section className="pkr-install-card" aria-label="Keep your PKR account">
        <span className="pkr-guided-kicker">KEEP YOUR APPROVED ACCESS</span>
        <h2>No second host approval</h2>
        <p>iPhone Home Screen apps can have a separate login from WhatsApp or Safari. Before switching browsers, create a private transfer code here, then enter it in PKR's Player login screen if asked.</p>
        <button type="button" className="pkr-install-secondary"
          disabled={transferBusy} onClick={()=>void generateCode()}>
          {transferBusy?'Creating…':'Generate 5-minute transfer code'}
        </button>
        {transferCode&&<div className="pkr-guided-transfer" role="status">
          <strong>{transferCode.match(/.{1,4}/g)?.join(' ')}</strong>
          <button type="button" onClick={()=>void copy(transferCode,'Private code copied. Enter it inside the installed PKR Player login screen.')}>
            Copy code
          </button>
          <p>Keep this code private. It expires in five minutes and grants access to your PKR account.</p>
        </div>}
      </section>}
      {installed&&<section className="pkr-install-card" aria-label="Step 2: Enable notifications">
        <span className="pkr-guided-kicker">STEP 2 OF 2</span>
        <h2>Switch on your poker-night notifications</h2>
        {!sessionPresent?<div className="pkr-guided-action">
          <strong>Restore your approved account first.</strong>
          <p>When the installed PKR app opens, it may ask you to sign in again. Return to the original WhatsApp browser to generate the transfer code, then enter it on the Player login screen. Your host doesn't need to approve you again.</p>
          <button type="button" className="pkr-install-primary"
            onClick={()=>router.push('/mobile-login')}>Restore my access →</button>
        </div>:!group?<p className="pkr-guided-muted">
          Choose your poker club above, or open this setup guide from a club in PKR. Notifications are attached to your approved membership.
        </p>:<>
          <p className="pkr-guided-muted">
            {checking?'Checking this device…':subscribed?'Your device is registered for this club.':'Enable updates for new games, results and settlement requests.'}
          </p>
          <p className="pkr-guided-meta">Permission: <strong>{permission==='granted'?'Allowed':permission==='denied'?'Blocked in phone settings':permission==='default'?'Not requested yet':'Unsupported'}</strong>
            {' '} · Room: <strong>{rooms.find(r=>r.id===group)?.name||'Selected poker club'}</strong></p>
          {permission==='denied'?<div className="pkr-guided-warning" role="alert">
            Notifications are blocked in your phone settings. On iPhone, open Settings → Notifications → PKR, allow alerts, then return to this screen. On Android, check the Chrome or PKR app notification permission.
          </div>:!subscribed?<button type="button" className="pkr-install-primary"
            disabled={busy||checking} onClick={()=>void enable()}>{busy?'Connecting…':'Enable notifications'}</button>:null}
          {subscribed&&<div className="pkr-guided-test">
            <strong>Make sure notifications reach you</strong>
            <p>Send a genuine notification from the PKR server. Check your phone and confirm whether it arrived.</p>
            <button type="button" className="pkr-install-secondary" disabled={busy}
              onClick={()=>void test()}>{busy?'Sending…':'Send a real test notification'}</button>
            {testAccepted&&<button type="button" className="pkr-install-primary"
              onClick={confirmTest}>I received the notification ✓</button>}
            {testConfirmed&&<span className="pkr-guided-verified">✓ You confirmed receiving a test on this device.</span>}
          </div>}
          <div className="pkr-guided-sounds"><ForegroundSoundToggle/></div>
        </>}
        <p className="pkr-guided-muted">PKR cannot override the phone's Silent Mode, Focus, alert volume or notification settings.</p>
      </section>}
      <section className="pkr-install-card pkr-guided-continue">
        <h2>Keep playing while you set up</h2>
        <p>Installing PKR is optional. Your games, profile, results and payments remain available in the browser.</p>
        <button type="button" className="pkr-install-secondary"
          onClick={()=>router.push(roomUrl)}>Back to my PKR account →</button>
      </section>
      {notice&&<p role="status" className="pkr-install-notice">{notice}</p>}
    </div>
  </main>;
}
