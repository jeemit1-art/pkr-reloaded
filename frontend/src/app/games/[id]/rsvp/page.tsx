'use client';

import {useCallback,useEffect,useRef,useState} from 'react';
import {useParams,useRouter} from 'next/navigation';
import {api,getToken,type RsvpBoardData} from '@/lib/api';
import {canUsePush,isPWAInstalled,subscribePush} from '@/lib/push';

const guestKey=(id:string)=>'pkr:rsvp:v2:'+id;
function timeLabel(t:string){
  if(t==='late')return 'Running late';
  if(t==='not-coming')return 'Not coming';
  if(!/^\d\d:\d\d$/.test(t))return t||'Arrival not set';
  const [h,m]=t.split(':').map(Number);
  return new Date(2020,0,1,h,m).toLocaleTimeString('en-AU',{hour:'numeric',minute:m?'2-digit':undefined,hour12:true});
}
const gameDate=(t:number)=>new Date(t*1000).toLocaleString('en-AU',{weekday:'long',day:'numeric',month:'long',hour:'numeric',minute:'2-digit'});
type SavedGuest={id:string;token:string;name:string};

export default function RsvpPage(){
  const {id}=useParams<{id:string}>();
  const router=useRouter();
  const [board,setBoard]=useState<RsvpBoardData|null>(null);
  const [guest,setGuest]=useState<SavedGuest|null>(null);
  const [name,setName]=useState(''),[arrival,setArrival]=useState('');
  const [seat,setSeat]=useState<number|null>(null);
  const [saving,setSaving]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState('');
  const [isHost,setIsHost]=useState(false),[times,setTimes]=useState<string[]>([]);
  const [timesDirty,setTimesDirty]=useState(false),[updatingTimes,setUpdatingTimes]=useState(false);
  const [alerts,setAlerts]=useState(false);
  const first=useRef(false),snapshot=useRef('');
  const alertsRef=useRef(false),timesDirtyRef=useRef(false);
  useEffect(()=>{alertsRef.current=alerts;timesDirtyRef.current=timesDirty;},[alerts,timesDirty]);

  const load=useCallback(async()=>{
    try {
      const data=await api.games.rsvpBoard(id);
      setBoard(data);
      if(!timesDirtyRef.current)setTimes(data.options);
      const next=JSON.stringify(data.guests.map(r=>[r.id,r.status,r.arrival_option,r.seat_number,r.updated_at]));
      if(snapshot.current&&snapshot.current!==next&&document.visibilityState==='visible'){
        setNotice('The group RSVP board was updated.');
        if(alertsRef.current&&typeof Notification!=='undefined'&&Notification.permission==='granted')
          new Notification('Poker night RSVP update',{body:'Someone updated their arrival or seat.'});
      }
      snapshot.current=next;setError('');
      if(first.current)return;
      first.current=true;
      try{
        const raw=localStorage.getItem(guestKey(id));
        if(raw){
          const saved=JSON.parse(raw) as SavedGuest;
          if(/^[a-f0-9]{64}$/.test(saved.token)){
            setGuest(saved);setName(saved.name);
            const mine=data.guests.find(r=>r.id===saved.id);
            if(mine){setArrival(mine.arrival_option);setSeat(mine.seat_number);}
          }
        }
      }catch{}
      if(getToken())Promise.all([api.auth.me(),api.events.get(data.event.id)])
        .then(([user,event])=>setIsHost(event.members.some(m=>m.id===user.id&&(m.role==='host'||m.role==='cohost'))))
        .catch(()=>{});
    }catch(e:any){setError(e.message||'Could not load the RSVP board.');}
  },[id]);

  useEffect(()=>{
    first.current=false;snapshot.current='';
    void load();
    const timer=setInterval(()=>{if(document.visibilityState!=='hidden')void load();},5000);
    const refresh=()=>void load();
    window.addEventListener('focus',refresh);
    return ()=>{clearInterval(timer);window.removeEventListener('focus',refresh);};
  },[load]);

  async function submit(){
    if(!board||name.trim().length<2||!arrival){setError('Enter your name and choose an arrival option.');return;}
    setSaving(true);setError('');setNotice('');
    try{
      const result=await api.games.submitRsvpBoard(id,{
        display_name:name.trim(),arrival_option:arrival,
        seat_number:arrival==='not-coming'?null:seat,edit_token:guest?.token,
      });
      const saved=result.id&&result.edit_token
        ?{id:result.id,token:result.edit_token,name:name.trim()}
        :guest?{...guest,name:name.trim()}:null;
      if(saved){localStorage.setItem(guestKey(id),JSON.stringify(saved));setGuest(saved);}
      setNotice(arrival==='not-coming'?'Your absence has been recorded.':'RSVP saved. Members of this group can see the update.');
      await load();
    }catch(e:any){setError(e.message||'Could not save your RSVP.');await load();}
    finally{setSaving(false);}
  }
  async function saveTimes(){
    setUpdatingTimes(true);setError('');
    try{
      const result=await api.games.setRsvpTimes(id,times);
      setTimes(result.options);setTimesDirty(false);setNotice('Arrival choices saved.');
      await load();
    }catch(e:any){setError(e.message||'Could not save arrival times.');}
    finally{setUpdatingTimes(false);}
  }
  async function allowAlerts(){
    if(typeof Notification==='undefined'){setNotice('Browser notifications are unavailable here. The live page still updates.');return;}
    const result=await Notification.requestPermission();
    setAlerts(result==='granted');
    if(result==='granted'&&canUsePush()&&isPWAInstalled()&&board){
      const subscribed=await subscribePush(board.event.id,undefined,name.trim()||undefined);
      setNotice(subscribed
        ?'PKR push alerts enabled for this device where supported. WhatsApp group posts are not automatic.'
        :'Browser alerts enabled while this page stays open. Push registration was unavailable.');
    }else{
      setNotice(result==='granted'
        ?'Browser alerts enabled while this page is open. WhatsApp group posts are not automatic.'
        :'Alerts declined. The page will still update live.');
    }
  }
  if(!board)return <div className="pkr-guest">
    <header className="pkr-guest-top"><a href="/" className="pkr-guest-logo">♠ PKR</a><span>Game night RSVP</span></header>
    <main className="pkr-guest-shell"><div className="pkr-guest-card pkr-guest-empty">
      <div className="pkr-guest-symbol">♠</div>
      <h1>{error?'RSVP board unavailable':'Opening your poker night'}</h1>
      <p>{error||'Checking the latest arrivals and seats…'}</p>
      {error&&<><button className="pkr-guest-button" onClick={()=>void load()}>Try again</button>
        <a className="pkr-guest-outline" href={'/mobile-login?next='+encodeURIComponent('/games/'+id+'/rsvp')}>Verify mobile to enter</a></>}
    </div></main>
  </div>;

  const attending=board.guests.filter(r=>r.status==='yes');
  const unavailable=new Map<number,string>();
  board.players.forEach(p=>{if(p.seat_number!=null)unavailable.set(p.seat_number,p.display_name);});
  board.guests.forEach(r=>{if(r.status==='yes'&&r.seat_number!=null&&r.id!==guest?.id)unavailable.set(r.seat_number,r.display_name);});
  const link=typeof window!=='undefined'?window.location.origin+'/games/'+id+'/rsvp':'';
  const message='♠ *'+board.event.name+'*\n'+gameDate(board.game.scheduled_at)
    +(board.game.location?'\n📍 '+board.game.location:'')
    +'\n\nChoose an arrival time and seat. See live RSVPs here:\n'+link;
  const closed=!['scheduled','lobby'].includes(board.game.status);
  // WhatsApp supports user-initiated share links; never pretend PKR can
  // automatically message the group or bypass a player's consent.
  const mySummary=guest?board.guests.find(r=>r.id===guest.id):null;
  const myWhatsAppUpdate=mySummary
    ?'♠ '+board.event.name+' RSVP update\n'+mySummary.display_name+': '+
      (mySummary.status==='no'?'Not coming':timeLabel(mySummary.arrival_option))+
      (mySummary.seat_number?' · Seat '+mySummary.seat_number:'')+'\nLive RSVP board: '+link
    :'';
  const groupSummary='♠ *'+board.event.name+'* — current RSVPs\n'+
    (board.guests.map(r=>r.display_name+': '+(r.status==='no'?'Not coming':timeLabel(r.arrival_option))+
      (r.seat_number?' · Seat '+r.seat_number:'')).join('\n')||'No responses yet')+
    '\nUpdate your RSVP: '+link;
  return <div className="pkr-guest">
    <header className="pkr-guest-top">
      <a href="/" className="pkr-guest-logo">♠ PKR</a>
      <span className="pkr-guest-top-right"><span className="pkr-guest-pulse"/> Live RSVP board</span>
    </header>
    <main className="pkr-guest-shell">
      <section className="pkr-guest-hero">
        <span className="pkr-guest-kicker">♠ YOUR NEXT GAME NIGHT</span>
        <h1>{board.event.name}</h1>
        <div className="pkr-guest-subtitle"><span>◷ {gameDate(board.game.scheduled_at)}</span>
          {board.game.location&&<span>⌖ {board.game.location}</span>}</div>
        <div className="pkr-guest-stats">
          <div><strong>{attending.length}</strong><span>Coming</span></div>
          <div><strong>{board.guests.filter(r=>r.status==='no').length}</strong><span>Not coming</span></div>
          <div><strong>{Math.max(0,board.game.seats-unavailable.size-(guest?.id&&seat&&!unavailable.has(seat)?1:0))}</strong><span>Seats available</span></div>
        </div>
      </section>
      <div className="pkr-guest-grid">
        <section className="pkr-guest-card">
          <div className="pkr-guest-card-head">
            <span className="pkr-guest-kicker">01 · YOUR PLAN</span>
            <h2>{guest?'Update your RSVP':'Are you coming?'}</h2>
            <p>Only verified members of this group can respond. Choose your arrival time and a seat.</p>
          </div>
          <label className="pkr-guest-label" htmlFor="pkr-rsvp-name">Your name</label>
          <input className="pkr-guest-input" id="pkr-rsvp-name" maxLength={60} autoComplete="name"
            placeholder="How your friends know you" value={name} disabled={closed}
            onChange={e=>setName(e.target.value)}/>
          <div className="pkr-guest-label">When will you arrive?</div>
          <div className="pkr-guest-options">
            {[...board.options,'late','not-coming'].map(option=><button type="button" key={option}
              disabled={closed} aria-pressed={arrival===option}
              className={'pkr-guest-choice '+(arrival===option?'selected':'')}
              onClick={()=>{setArrival(option);if(option==='not-coming')setSeat(null);}}>
              {option==='not-coming'?'✕ ':option==='late'?'◷ ':'✓ '}{timeLabel(option)}
            </button>)}
          </div>
          {arrival&&arrival!=='not-coming'&&<>
            <div className="pkr-guest-seat-heading">
              <div><div className="pkr-guest-label">Pick a seat</div><p>Optional — decide on the night if you prefer.</p></div>
              <button className="pkr-guest-clear" disabled={closed} type="button" onClick={()=>setSeat(null)}>No preference</button>
            </div>
            <div className={'pkr-guest-seats '+(board.game.seats<=12?'pkr-guest-seat-map':'pkr-guest-seat-grid')} aria-label="Available seating">
              {board.game.seats<=12&&<div className="pkr-guest-felt" aria-hidden="true"><span>♠</span><strong>PKR</strong></div>}
              {Array.from({length:board.game.seats},(_,i)=>{
                const n=i+1,taken=unavailable.get(n),selected=seat===n;
                const a=(i/board.game.seats)*Math.PI*2-Math.PI/2;
                const position=board.game.seats<=12?{left:(50+39*Math.cos(a))+'%',top:(50+40*Math.sin(a))+'%'}:undefined;
                return <button key={n} type="button" disabled={closed||Boolean(taken)} aria-pressed={selected}
                  className={'pkr-guest-seat '+(taken?'taken':selected?'selected':'')}
                  style={position}
                  title={taken?'Reserved by '+taken:'Select seat '+n}
                  aria-label={'Seat '+n+(taken?', reserved by '+taken:selected?', selected':', available')}
                  onClick={()=>setSeat(selected?null:n)}>
                  <strong>{n}</strong>
                  <span>{taken?(taken.length>9?taken.slice(0,8)+'…':taken):selected?'Yours':'Open'}</span>
                </button>;
              })}
            </div>
          </>}
          <div aria-live="polite">
            {error&&<div className="pkr-guest-message error" role="alert">{error}</div>}
            {notice&&<div className="pkr-guest-message success">{notice}</div>}
          </div>
          {closed?<div className="pkr-guest-message">RSVPs are now closed. You can still see the live board.</div>:
            <button className="pkr-guest-button" disabled={saving||!arrival||name.trim().length<2}
              onClick={submit}>{saving?'Saving…':guest?'Save my changes':'Confirm my RSVP'} <span>→</span></button>}
          {guest&&<p className="pkr-guest-footnote">A private edit key is stored on this device. Keep this browser data to change your response later.</p>}
        </section>
        <aside className="pkr-guest-right">
          <section className="pkr-guest-card">
            <div className="pkr-guest-card-head"><span className="pkr-guest-kicker">02 · THE GROUP</span>
              <h2>Who's coming</h2><p>Updates automatically every five seconds while open.</p></div>
            {board.guests.length===0&&<p className="pkr-guest-none">No responses yet. Share the link only with members of this group.</p>}
            {board.guests.map(r=><div className="pkr-guest-person" key={r.id}>
              <span className={'pkr-guest-avatar '+(r.status==='no'?'out':'')}>{r.display_name.slice(0,1).toUpperCase()}</span>
              <div className="pkr-guest-person-info"><strong>{r.display_name}{guest?.id===r.id?' · You':''}</strong>
                <small>{r.status==='no'?'Not coming':timeLabel(r.arrival_option)}</small></div>
              <span className={'pkr-guest-seat-badge '+(r.status==='no'?'out':'')}>
                {r.status==='no'?'OUT':r.seat_number?'SEAT '+r.seat_number:'IN'}</span>
            </div>)}
            <div className="pkr-guest-tools">
              {mySummary&&<a className="pkr-guest-outline" href={'https://wa.me/?text='+encodeURIComponent(myWhatsAppUpdate)}
                target="_blank" rel="noreferrer">Share my RSVP update to WhatsApp</a>}
              {isHost&&<button className="pkr-guest-button whats-app" type="button"
                onClick={()=>router.push('/events/'+board.event.id+'?tab=members&inviteGame='+id)}>
                Invite members from private group roster
              </button>}
              <button className="pkr-guest-outline" type="button" onClick={allowAlerts}>Enable browser alerts</button>
            </div>
            <p className="pkr-guest-footnote">Only signed-in members of this group can view RSVP names and arrival choices. Forwarding the link does not grant access. Browser alerts require permission.</p>
          </section>
          {isHost&&<section className="pkr-guest-card">
            <div className="pkr-guest-card-head"><span className="pkr-guest-kicker">HOST CONTROLS</span>
              <h2>Arrival choices</h2><p>Set times for your group. Late and Not coming remain available.</p></div>
            <button className="pkr-guest-outline full" type="button"
              onClick={()=>router.push('/events/'+board.event.id+'?tab=members&inviteGame='+id)}>
              Invite verified group members via WhatsApp
            </button>
            <div className="pkr-guest-times">
              {times.map((time,i)=><div className="pkr-guest-time" key={i}>
                <input type="time" aria-label={'Arrival option '+(i+1)} className="pkr-guest-input"
                  value={time} disabled={closed}
                  onChange={e=>{setTimes(v=>v.map((t,j)=>i===j?e.target.value:t));setTimesDirty(true);}}/>
                <button type="button" aria-label={'Remove time '+time} disabled={closed||times.length<=1}
                  onClick={()=>{setTimes(v=>v.filter((_,j)=>j!==i));setTimesDirty(true);}}>×</button>
              </div>)}
            </div>
            <div className="pkr-guest-host-actions">
              <button className="pkr-guest-outline" disabled={closed||times.length>=8}
                onClick={()=>{setTimes(v=>[...v,'18:30']);setTimesDirty(true);}}>+ Add time</button>
              <button className="pkr-guest-button" disabled={closed||updatingTimes||!timesDirty}
                onClick={saveTimes}>{updatingTimes?'Saving…':'Save times'}</button>
            </div>
            <button className="pkr-guest-outline full" onClick={()=>router.push('/games/'+id)}>Game details →</button>
          </section>}
        </aside>
      </div>
    </main>
  </div>;
}
