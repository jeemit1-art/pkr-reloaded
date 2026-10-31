'use client';

import {useCallback,useEffect,useMemo,useState} from 'react';
import {useRouter} from 'next/navigation';
import {api,getToken,type Event,type Game,type RsvpBoardData,type User} from '@/lib/api';
import './instant.css';

const activeGame=(g:Game)=>['scheduled','lobby','active'].includes(g.status);
const upcoming=(g:Game)=>['scheduled','lobby'].includes(g.status);
const formatDate=(seconds:number)=>new Intl.DateTimeFormat('en-AU',{
  weekday:'long',day:'numeric',month:'long',hour:'numeric',minute:'2-digit'
}).format(new Date(seconds*1000));
const rsvpKey=(id:string)=>'pkr:instant:rsvp:'+id;
const icsEscape=(s:string)=>s.replace(/\\/g,'\\\\').replace(/[,;]/g,m=>'\\'+m).replace(/\r?\n/g,'\\n');
function downloadCalendar(game:Game,roomName:string){
  const start=new Date(game.scheduled_at*1000);
  const end=new Date(start.getTime()+4*3600*1000);
  const utc=(d:Date)=>d.toISOString().replace(/[-:]/g,'').replace(/\.\d{3}/,'');
  const body=[
    'BEGIN:VCALENDAR','VERSION:2.0','PRODID:-//PKR//Game Night//EN','CALSCALE:GREGORIAN',
    'BEGIN:VEVENT','UID:'+icsEscape(game.id)+'@mypkr.app','DTSTAMP:'+utc(new Date()),
    'DTSTART:'+utc(start),'DTEND:'+utc(end),'SUMMARY:'+icsEscape(roomName+' — poker night'),
    'DESCRIPTION:'+icsEscape('View your private room in PKR: https://mypkr.app/instant?room='+encodeURIComponent(game.event_id)),
    ...(game.location?['LOCATION:'+icsEscape(game.location)]:[]),
    'END:VEVENT','END:VCALENDAR'
  ].join('\r\n')+'\r\n';
  const url=URL.createObjectURL(new Blob([body],{type:'text/calendar;charset=utf-8'}));
  const a=document.createElement('a');a.href=url;a.download='PKR-poker-night.ics';a.click();
  window.setTimeout(()=>URL.revokeObjectURL(url),1000);
}

export default function Instant(){
  const router=useRouter();
  const [user,setUser]=useState<User|null>(null);
  const [rooms,setRooms]=useState<Event[]>([]);
  const [roomId,setRoomId]=useState('');
  const [games,setGames]=useState<Game[]>([]);
  const [board,setBoard]=useState<RsvpBoardData|null>(null);
  const [loading,setLoading]=useState(true);
  const [refreshing,setRefreshing]=useState(false);
  const [error,setError]=useState('');
  const [notice,setNotice]=useState('');
  const [choice,setChoice]=useState('');
  const [seat,setSeat]=useState('');
  const [saving,setSaving]=useState(false);
  const [lastUpdated,setLastUpdated]=useState<Date|null>(null);
  const [notSignedIn,setNotSignedIn]=useState(false);

  const room=rooms.find(r=>r.id===roomId)||null;
  const game=useMemo(()=>games.filter(activeGame).sort((a,b)=>{
    if(a.status==='active'&&b.status!=='active')return -1;
    if(b.status==='active'&&a.status!=='active')return 1;
    return a.scheduled_at-b.scheduled_at;
  })[0]||null,[games]);
  const finished=useMemo(()=>games.filter(g=>g.status==='settled').sort((a,b)=>b.scheduled_at-a.scheduled_at)[0]||null,[games]);
  const savedToken=game&&typeof window!=='undefined'?localStorage.getItem(rsvpKey(game.id))||'':'';
  const myGuest=board?.guests.find(g=>g.display_name.toLocaleLowerCase()===(user?.name||'').toLocaleLowerCase())||null;
  const rsvpCount=board?.guests.filter(g=>g.status==='yes').length||0;
  const availableSeats=useMemo(()=>{
    if(!board)return [];
    const taken=new Set([
      ...board.guests.filter(g=>g.status==='yes' && (!savedToken||g.id!==myGuest?.id))
        .map(g=>g.seat_number).filter((n):n is number=>n!==null),
      ...board.players.map(p=>p.seat_number)
    ]);
    return Array.from({length:board.game.seats},(_,i)=>i+1).filter(n=>!taken.has(n));
  },[board,savedToken,myGuest?.id]);
  const selectedName=user?.name?.trim()||'';

  useEffect(()=>{
    let alive=true;
    if(!getToken()){setNotSignedIn(true);setLoading(false);return;}
    Promise.all([api.auth.me(),api.events.list()]).then(([me,list])=>{
      if(!alive)return;
      setUser(me);
      const eligible=list.filter(r=>r.status!=='ended');
      setRooms(eligible);
      const q=new URLSearchParams(window.location.search).get('room');
      const preferred=q&&eligible.find(r=>r.id===q)?q:eligible[0]?.id||'';
      setRoomId(preferred);
      setLoading(false);
    }).catch(e=>{
      if(!alive)return;
      setError(e?.message||'Could not open your poker rooms.');
      setNotSignedIn(true);
      setLoading(false);
    });
    return()=>{alive=false};
  },[]);

  const refresh=useCallback(async(selected:string,quiet:boolean)=>{
    if(!selected)return;
    if(!quiet)setLoading(true);else setRefreshing(true);
    try{
      const list=await api.games.list(selected);
      const ordered=list.filter(activeGame).sort((a,b)=>{
        if(a.status==='active'&&b.status!=='active')return -1;
        if(b.status==='active'&&a.status!=='active')return 1;
        return a.scheduled_at-b.scheduled_at;
      });
      const next=ordered[0]||null;
      // The RSVP board is only available to authorised members and while
      // a game has not started; a failed read must not expose private data.
      const currentBoard=next&&upcoming(next)
        ?await api.games.rsvpBoard(next.id).catch(()=>null):null;
      setGames(list);
      setBoard(currentBoard);
      setLastUpdated(new Date());
      setError('');
      if(currentBoard){
        const mine=currentBoard.guests.find(g=>g.display_name.toLocaleLowerCase()===selectedName.toLocaleLowerCase());
        if(mine&&localStorage.getItem(rsvpKey(next!.id))){
          setChoice(mine.arrival_option);
          setSeat(mine.seat_number?String(mine.seat_number):'');
        }else{setChoice('');setSeat('');}
      }else{setChoice('');setSeat('');}
    }catch(e:any){setError(e?.message||'Could not load this room.');setBoard(null);}
    finally{setLoading(false);setRefreshing(false);}
  },[selectedName]);

  useEffect(()=>{
    if(!roomId||!user)return;
    void refresh(roomId,false);
    const tick=()=>{
      if(document.visibilityState==='visible')void refresh(roomId,true);
    };
    const timer=window.setInterval(tick,30000);
    window.addEventListener('focus',tick);
    document.addEventListener('visibilitychange',tick);
    return()=>{
      window.clearInterval(timer);window.removeEventListener('focus',tick);
      document.removeEventListener('visibilitychange',tick);
    };
  },[roomId,user?.id,refresh]);

  function chooseRoom(id:string){
    const found=rooms.find(r=>r.id===id);
    if(!found)return;
    setRoomId(id);setNotice('');
    const url=new URL(window.location.href);
    url.searchParams.set('room',id);
    window.history.replaceState(window.history.state,'',url.pathname+url.search);
  }
  async function submit(){
    if(!game||!board||!user||!choice||saving||!upcoming(game))return;
    setSaving(true);setError('');setNotice('');
    try{
      const token=localStorage.getItem(rsvpKey(game.id))||undefined;
      if(myGuest&&!token)throw new Error(
        'An RSVP already exists under your name. To change it, use the original browser or ask the host for help.'
      );
      const response=await api.games.submitRsvpBoard(game.id,{
        display_name:user.name,arrival_option:choice,
        seat_number:choice==='not-coming'||!seat?null:Number(seat),
        ...(token?{edit_token:token}:{})
      });
      if(response.edit_token)localStorage.setItem(rsvpKey(game.id),response.edit_token);
      setNotice(choice==='not-coming'?'Your host can now see that you are not coming.':
        'RSVP saved. Your host can see your arrival and seat choice.');
      await refresh(roomId,true);
    }catch(e:any){setError(e?.message||'RSVP could not be saved.');}
    finally{setSaving(false);}
  }
  async function shareRoom(){
    if(!room)return;
    const url=window.location.origin+'/instant?room='+encodeURIComponent(room.id);
    try{
      if(navigator.share){await navigator.share({title:'PKR — '+room.name,text:'Open your private PKR poker room',url});return;}
      await navigator.clipboard.writeText(url);
      setNotice('Room link copied. Only approved members can view it.');
    }catch(e:any){if(e?.name!=='AbortError')setError('Could not share from this device.');}
  }

  return <main className="pkr-instant">
    <header className="pkr-instant-header">
      <a href="/" className="pkr-instant-logo" aria-label="PKR Home"><span>♠</span> PKR</a>
      <span className="pkr-instant-label">INSTANT PLAYER ACCESS</span>
      <a href="/dashboard" className="pkr-instant-header-link">Full PKR →</a>
    </header>
    <div className="pkr-instant-content">
      <div className="pkr-instant-intro">
        <p className="pkr-instant-kicker">PLAYERS FIRST · NO INSTALLATION</p>
        <h1>Poker night, made easy.</h1>
        <p>RSVP, check your seat and open your game straight from the link. Nothing to download.</p>
      </div>
      {notSignedIn?<section className="pkr-instant-card" role="status">
        <h2>Your invitation is your starting point</h2>
        <p>Open the personal WhatsApp invitation sent by your host. Once they approve you, PKR opens here automatically — no installation or App Store needed.</p>
        <a className="pkr-instant-primary" href="/mobile-login">Join or recover access →</a>
        {error&&<p role="alert" className="pkr-instant-error">{error}</p>}
      </section>:
      loading&&!room?<div className="pkr-instant-card" role="status">Loading your poker rooms…</div>:
      !rooms.length?<section className="pkr-instant-card">
        <h2>No active rooms yet</h2>
        <p>Ask your host to send a private WhatsApp invitation, or open a room you've already joined.</p>
        <a href="/dashboard" className="pkr-instant-primary">Open my rooms →</a>
      </section>:
      <>
        {rooms.length>1&&<div className="pkr-instant-room-chooser">
          <label htmlFor="pkr-instant-room">Poker room</label>
          <select id="pkr-instant-room" value={roomId} onChange={e=>chooseRoom(e.target.value)}>
            {rooms.map(r=><option value={r.id} key={r.id}>{r.name}</option>)}
          </select>
        </div>}
        <section className="pkr-instant-card pkr-instant-feature">
          <div className="pkr-instant-hero-line"><span>YOUR POKER ROOM</span>
            <button onClick={()=>void shareRoom()} type="button">Share link ↗</button></div>
          <h2>{room?.name||'Poker room'}</h2>
          <p>Welcome{user?.name?', '+user.name.split(' ')[0]:''}. Your host controls invitations and membership.</p>
          {game?<div className="pkr-instant-date">
            <span className="pkr-instant-date-icon">◷</span>
            <div><strong>{game.status==='active'?'Game in progress':'Next poker night'}</strong>
              <span>{formatDate(game.scheduled_at)}</span>
              {game.location&&<span>{game.location}</span>}</div>
          </div>:<div className="pkr-instant-empty">No upcoming game scheduled. Check back when your host announces the next night.</div>}
          {game&&<div className="pkr-instant-actions">
            <button type="button" onClick={()=>router.push('/games/'+game.id)} className="pkr-instant-primary">
              {game.status==='active'?'Open live game →':'View game →'}
            </button>
            {upcoming(game)&&<button type="button" onClick={()=>downloadCalendar(game,room?.name||'PKR')}
              className="pkr-instant-secondary">Add to calendar</button>}
          </div>}
        </section>
        {board&&game&&upcoming(game)&&<section className="pkr-instant-card">
          <div className="pkr-instant-section-heading">
            <div><span className="pkr-instant-kicker">REPLY IN SECONDS</span><h2>Your RSVP</h2></div>
            <span className="pkr-instant-count">{rsvpCount} coming</span>
          </div>
          {myGuest&&<p className="pkr-instant-current">Current response: {myGuest.status==='no'?'Not coming':myGuest.arrival_option==='late'?'Running late':myGuest.arrival_option||'Coming'}{myGuest.seat_number?' · Seat '+myGuest.seat_number:''}</p>}
          {myGuest&&!savedToken?<p className="pkr-instant-help">Your response was saved elsewhere. To edit it, return to the original browser or ask your host.</p>:
          <>
            <div className="pkr-instant-choice" role="group" aria-label="Arrival time">
              {board.options.map(option=><button key={option} type="button"
                aria-pressed={choice===option} className={choice===option?'selected':''}
                onClick={()=>{setChoice(option);}}>{option}</button>)}
              <button type="button" aria-pressed={choice==='late'} className={choice==='late'?'selected':''}
                onClick={()=>setChoice('late')}>Running late</button>
              <button type="button" aria-pressed={choice==='not-coming'} className={choice==='not-coming'?'selected danger':''}
                onClick={()=>{setChoice('not-coming');setSeat('');}}>Not coming</button>
            </div>
            {choice&&choice!=='not-coming'&&<div className="pkr-instant-seat">
              <label htmlFor="pkr-instant-seat">Choose a seat (optional)</label>
              <select id="pkr-instant-seat" value={seat} onChange={e=>setSeat(e.target.value)}>
                <option value="">Let the host decide</option>
                {availableSeats.map(n=><option value={n} key={n}>Seat {n}</option>)}
                {myGuest?.seat_number&&!availableSeats.includes(myGuest.seat_number)&&
                  <option value={myGuest.seat_number}>Seat {myGuest.seat_number} (current)</option>}
              </select>
            </div>}
            <button type="button" className="pkr-instant-primary pkr-instant-save"
              disabled={!choice||saving||!selectedName} onClick={()=>void submit()}>
              {saving?'Saving RSVP…':myGuest?'Update RSVP →':'Save my RSVP →'}
            </button>
          </>}
          <p className="pkr-instant-help">Your host sees updates immediately. Refreshing this page does not duplicate your response.</p>
        </section>}
        {board&&<section className="pkr-instant-card">
          <div className="pkr-instant-section-heading"><h2>Who's coming</h2>
            <button className="pkr-instant-text-action" disabled={refreshing}
              onClick={()=>void refresh(roomId,true)}>{refreshing?'Refreshing…':'Refresh ↻'}</button></div>
          {board.guests.length===0?<p>Be the first to RSVP.</p>:
            <div className="pkr-instant-guests">{board.guests.map(g=><div key={g.id} className="pkr-instant-person">
              <span className="pkr-instant-avatar">{g.display_name.slice(0,1).toUpperCase()}</span>
              <span className="pkr-instant-person-name">{g.display_name}</span>
              <span className="pkr-instant-person-detail">{g.status==='no'?'Not coming':(g.arrival_option==='late'?'Late':g.arrival_option)+(g.seat_number?' · Seat '+g.seat_number:'')}</span>
            </div>)}</div>}
        </section>}
        {finished&&<section className="pkr-instant-card">
          <span className="pkr-instant-kicker">AFTER THE GAME</span>
          <h2>Latest results</h2>
          <p>{formatDate(finished.scheduled_at)}. View saved game details and private settlements.</p>
          <button className="pkr-instant-secondary" onClick={()=>router.push('/games/'+finished.id)}>View results →</button>
        </section>}
        <div className="pkr-instant-footer">
          <span>{lastUpdated?'Updated '+lastUpdated.toLocaleTimeString('en-AU',{hour:'numeric',minute:'2-digit'}):'PKR private group'}</span>
          <a href={'/events/'+encodeURIComponent(roomId)+'?tab=night'}>Open full Game Night →</a>
        </div>
        {notice&&<div className="pkr-instant-message" role="status">{notice}</div>}
        {error&&<div className="pkr-instant-error" role="alert">{error}</div>}
      </>}
    </div>
  </main>;
}
