'use client';

import {useCallback,useEffect,useRef,useState} from 'react';
import {useParams,useRouter} from 'next/navigation';
import {api,getToken,type RsvpBoardData,type RsvpReplyChoice} from '@/lib/api';
import {canUsePush,isPWAInstalled,subscribePush} from '@/lib/push';
import {playPkrSound} from '@/lib/sounds';
import {defaultRsvpReplies,getRsvpReplies,rsvpChoices,rsvpChoiceLabel,rsvpChoiceStatus} from '@/lib/rsvp-choices';

const guestKey=(id:string)=>'pkr:rsvp:v2:'+id;
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
  const [replies,setReplies]=useState<RsvpReplyChoice[]>(defaultRsvpReplies());
  const [repliesDirty,setRepliesDirty]=useState(false);
  const scrolledSettings=useRef(false);
  const [alerts,setAlerts]=useState(false);
  const first=useRef(false),snapshot=useRef('');
  const alertsRef=useRef(false),timesDirtyRef=useRef(false),repliesDirtyRef=useRef(false);
  useEffect(()=>{
    alertsRef.current=alerts;timesDirtyRef.current=timesDirty;repliesDirtyRef.current=repliesDirty;
  },[alerts,timesDirty,repliesDirty]);
  useEffect(()=>{
    if(!isHost||!board||scrolledSettings.current)return;
    if(new URLSearchParams(window.location.search).get('settings')!=='1'&&
      window.location.hash!=='#pkr-rsvp-settings')return;
    scrolledSettings.current=true;
    const timer=window.setTimeout(()=>
      document.getElementById('pkr-rsvp-settings')?.scrollIntoView({behavior:'smooth',block:'start'}),120);
    return()=>window.clearTimeout(timer);
  },[isHost,board?.game.id]);

  const load=useCallback(async()=>{
    try {
      const data=await api.games.rsvpBoard(id);
      setBoard(data);
      if(!timesDirtyRef.current)setTimes(data.options);
      if(!repliesDirtyRef.current)setReplies(getRsvpReplies(data));
      const next=JSON.stringify(data.guests.map(r=>[r.id,r.status,r.arrival_option,r.seat_number,r.updated_at]));
      if(snapshot.current&&snapshot.current!==next&&document.visibilityState==='visible'){
        setNotice('The group RSVP board was updated.');
        if(alertsRef.current)playPkrSound('update');
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
    const kind=rsvpChoiceStatus(board,arrival);
    if(!kind){setError('Select an available RSVP response.');return;}
    setSaving(true);setError('');setNotice('');
    try{
      const result=await api.games.submitRsvpBoard(id,{
        display_name:name.trim(),arrival_option:arrival,
        seat_number:kind==='yes'?seat:null,edit_token:guest?.token,
      });
      const saved=result.id&&result.edit_token
        ?{id:result.id,token:result.edit_token,name:name.trim()}
        :guest?{...guest,name:name.trim()}:null;
      if(saved){localStorage.setItem(guestKey(id),JSON.stringify(saved));setGuest(saved);}
      setNotice(kind==='no'?'Your absence has been recorded.':kind==='maybe'?'Your maybe response was recorded without reserving a seat.':'RSVP saved. Members of this group can see the update.');
      await load();
    }catch(e:any){setError(e.message||'Could not save your RSVP.');await load();}
    finally{setSaving(false);}
  }
  function addArrivalTime(){
    const used = new Set(times);
    for (let hour = 17; hour <= 23; hour++) {
      for (const minute of ['00', '30']) {
        const candidate = String(hour).padStart(2, '0') + ':' + minute;
        if (!used.has(candidate)) {
          setTimes(previous => [...previous, candidate]);
          setTimesDirty(true);
          return;
        }
      }
    }
    setError('No additional arrival slots are available in the evening range.');
  }
  function editReply(key:string,field:'label'|'status',value:string){
    setReplies(old=>old.map(r=>r.value===key?{...r,[field]:value}:r));
    setRepliesDirty(true);
  }
  function addReply(){
    if(replies.length>=8)return;
    const bytes=crypto.getRandomValues(new Uint8Array(8));
    const key='custom-'+Array.from(bytes).map(n=>n.toString(16).padStart(2,'0')).join('');
    setReplies(old=>[...old,{value:key,label:'',status:'maybe'}]);
    setRepliesDirty(true);
  }
  async function saveTimes(){
    const normalised=replies.map(r=>({...r,label:r.label.trim().replace(/\s+/g,' ')}));
    const labels=normalised.map(r=>r.label.toLocaleLowerCase());
    if(times.length<1||times.length>8||new Set(times).size!==times.length||
      times.some(t=>!/^([01]\d|2[0-3]):[0-5]\d$/.test(t))){
      setError('Set 1–8 unique arrival times.');return;
    }
    if(normalised.length<3||normalised.length>8||
      normalised.some(r=>r.label.length<2||r.label.length>40||/[<>\u0000-\u001f]/.test(r.label))||
      new Set(labels).size!==labels.length){
      setError('Use unique response labels of 2–40 characters.');return;
    }
    setUpdatingTimes(true);setError('');setNotice('');
    try{
      const result=await api.games.setRsvpTimes(id,times,normalised);
      if(!Array.isArray(result.responses))
        throw new Error('Custom RSVP replies are not yet supported by the connected server. Arrival times may have been saved.');
      setTimes(result.options);setReplies(result.responses);
      setTimesDirty(false);setRepliesDirty(false);
      setNotice('RSVP settings saved for this game.');
      await load();
    }catch(e:any){setError(e.message||'Could not save RSVP settings.');}
    finally{setUpdatingTimes(false);}
  }
  async function allowAlerts(){
    if(typeof Notification==='undefined'){setNotice('Browser notifications are unavailable here. The live page still updates.');return;}
    const result=await Notification.requestPermission();
    setAlerts(result==='granted');
    if(result==='granted'&&canUsePush()&&board){
      const subscribed=await subscribePush(board.event.id,undefined,name.trim()||undefined);
      setNotice(subscribed
        ?'PKR push alerts enabled for this device where supported. WhatsApp group posts are not automatic.'
        :'Browser alerts enabled while this page stays open. Push registration was unavailable.');
    }else{
      setNotice(result==='granted'
        ?'Browser alerts enabled while this page is open. For alerts when the page is closed, finish phone setup in PKR.'
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
        <a className="pkr-guest-outline" href={'/mobile-login?next='+encodeURIComponent('/games/'+id+'/rsvp')}>Ask your host for an invitation</a></>}
    </div></main>
  </div>;

  const attending=board.guests.filter(r=>r.status==='yes');
  const timeLabel=(choice:string)=>rsvpChoiceLabel(board,choice);
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
      timeLabel(mySummary.arrival_option)+
      (mySummary.seat_number?' · Seat '+mySummary.seat_number:'')+'\nLive RSVP board: '+link
    :'';
  const groupSummary='♠ *'+board.event.name+'* — current RSVPs\n'+
    (board.guests.map(r=>r.display_name+': '+timeLabel(r.arrival_option)+
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
          <div><strong>{board.guests.filter(r=>r.status==='maybe').length}</strong><span>Maybe</span></div>
          <div><strong>{board.guests.filter(r=>r.status==='no').length}</strong><span>Not coming</span></div>
          <div><strong>{Math.max(0,board.game.seats-unavailable.size-(guest?.id&&mySummary?.status==='yes'&&mySummary.seat_number&&!unavailable.has(mySummary.seat_number)?1:0))}</strong><span>Seats available</span></div>
        </div>
      </section>
      <div className="pkr-guest-grid">
        <section className="pkr-guest-card">
          <div className="pkr-guest-card-head">
            <span className="pkr-guest-kicker">01 · YOUR PLAN</span>
            <h2>{guest?'Update your RSVP':'Are you coming?'}</h2>
            <p>Only approved members of this group can respond. Choose your arrival time and a seat.</p>
          </div>
          <label className="pkr-guest-label" htmlFor="pkr-rsvp-name">Your name</label>
          <input className="pkr-guest-input" id="pkr-rsvp-name" maxLength={60} autoComplete="name"
            placeholder="How your friends know you" value={name} disabled={closed}
            onChange={e=>setName(e.target.value)}/>
          <div className="pkr-guest-label">Your RSVP response</div>
          <div className="pkr-guest-options">
            {rsvpChoices(board).map(option=><button type="button" key={option.value}
              disabled={closed} aria-pressed={arrival===option.value}
              className={'pkr-guest-choice '+(arrival===option.value?'selected':'')}
              onClick={()=>{setArrival(option.value);if(option.status!=='yes')setSeat(null);}}>
              {option.status==='no'?'✕ ':option.status==='maybe'?'? ':option.value==='late'?'◷ ':'✓ '}{option.label}
            </button>)}
          </div>
          {arrival&&rsvpChoiceStatus(board,arrival)==='yes'&&<>
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
                <small>{timeLabel(r.arrival_option)}</small></div>
              <span className={'pkr-guest-seat-badge '+(r.status==='no'?'out':'')}>
                {r.status==='no'?'OUT':r.status==='maybe'?'MAYBE':r.seat_number?'SEAT '+r.seat_number:'IN'}</span>
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
          {isHost&&<section className="pkr-guest-card pkr-rsvp-settings" id="pkr-rsvp-settings" aria-label="RSVP settings">
            <div className="pkr-guest-card-head"><span className="pkr-guest-kicker">HOST CONTROLS</span>
              <h2>RSVP settings</h2><p>Configure arrival times and free-text replies. Only confirmed players can reserve a seat.</p></div>
            <button className="pkr-guest-outline full" type="button"
              onClick={()=>router.push('/events/'+board.event.id+'?tab=members&inviteGame='+id)}>
              Invite approved group members via WhatsApp
            </button>
            <h3 className="pkr-rsvp-settings-subtitle">Arrival times</h3>
            <div className="pkr-guest-times">
              {times.map((time,i)=><div className="pkr-guest-time" key={i}>
                <input type="time" aria-label={'Arrival option '+(i+1)} className="pkr-guest-input"
                  value={time} disabled={closed}
                  onChange={e=>{setTimes(v=>v.map((t,j)=>i===j?e.target.value:t));setTimesDirty(true);}}/>
                <button type="button" aria-label={'Remove time '+time} disabled={closed||times.length<=1}
                  onClick={()=>{setTimes(v=>v.filter((_,j)=>j!==i));setTimesDirty(true);}}>×</button>
              </div>)}
            </div>
            <button type="button" className="pkr-guest-outline full" disabled={closed||times.length>=8}
              onClick={addArrivalTime}>+ Add arrival time</button>
            <h3 className="pkr-rsvp-settings-subtitle">Player response options</h3>
            <p className="pkr-rsvp-settings-hint">Edit the wording or add “Maybe later”, “Out” or “Coming after work”. The attendance category determines confirmed numbers and seat reservations.</p>
            <div className="pkr-rsvp-replies">
              {replies.map(reply=><div className="pkr-rsvp-reply" key={reply.value}>
                <label>Reply shown to players
                  <input className="pkr-guest-input" maxLength={40}
                    aria-label={'RSVP response label '+reply.value}
                    disabled={closed} value={reply.label}
                    placeholder="Type your own response"
                    onChange={e=>editReply(reply.value,'label',e.target.value)}/>
                </label>
                <label>Attendance
                  <select className="pkr-guest-input" aria-label={'RSVP attendance type '+reply.value}
                    value={reply.status} disabled={closed||!reply.value.startsWith('custom-')}
                    onChange={e=>editReply(reply.value,'status',e.target.value)}>
                    <option value="yes">Coming</option><option value="maybe">Maybe</option>
                    <option value="no">Not coming</option>
                  </select>
                </label>
                {reply.value.startsWith('custom-')&&<button type="button"
                  className="pkr-rsvp-remove" disabled={closed}
                  aria-label={'Remove custom RSVP response '+reply.label}
                  onClick={()=>{setReplies(list=>list.filter(r=>r.value!==reply.value));setRepliesDirty(true);}}>Remove</button>}
              </div>)}
            </div>
            <div className="pkr-guest-host-actions">
              <button type="button" className="pkr-guest-outline" disabled={closed||replies.length>=8}
                onClick={addReply}>+ Add a custom reply</button>
              <button type="button" className="pkr-guest-button" disabled={closed||updatingTimes||(!timesDirty&&!repliesDirty)}
                onClick={saveTimes}>{updatingTimes?'Saving…':'Save RSVP settings'}</button>
            </div>
            <button className="pkr-guest-outline full" onClick={()=>router.push('/games/'+id)}>Game details →</button>
          </section>}
        </aside>
      </div>
    </main>
  </div>;
}
