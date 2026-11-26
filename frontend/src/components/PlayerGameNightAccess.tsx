'use client';

import {useCallback,useEffect,useMemo,useRef,useState} from 'react';
import {useRouter} from 'next/navigation';
import {api,type Game,type RsvpBoardData} from '@/lib/api';
import {rsvpChoices,rsvpChoiceLabel,rsvpChoiceStatus} from '@/lib/rsvp-choices';

type SavedGuest={id:string;token:string;name:string};

function readEditAccess(gameId:string,memberName:string):{id?:string;token?:string}{
  if(typeof window==='undefined'||!memberName.trim())return {};
  try{
    const raw=localStorage.getItem('pkr:rsvp:v2:'+gameId);
    if(raw){
      const guest=JSON.parse(raw) as SavedGuest;
      if(guest.name?.trim().toLocaleLowerCase()===memberName.trim().toLocaleLowerCase()&&
          /^[a-f0-9]{64}$/.test(guest.token||''))return {id:guest.id,token:guest.token};
    }
  }catch{}
  try{
    // Keep existing PKR Instant RSVPs editable from the unified dashboard.
    const legacy=localStorage.getItem('pkr:instant:rsvp:'+gameId);
    if(legacy&&/^[a-f0-9]{64}$/.test(legacy))return {token:legacy};
  }catch{}
  return {};
}

type Props={game:Game;memberName:string};

export default function PlayerGameNightAccess({game,memberName}:Props){
  const router=useRouter();
  const [board,setBoard]=useState<RsvpBoardData|null>(null);
  const [choice,setChoice]=useState('');
  const [seat,setSeat]=useState('');
  const [saving,setSaving]=useState(false);
  const [refreshing,setRefreshing]=useState(false);
  const [error,setError]=useState('');
  const [notice,setNotice]=useState('');
  const [lastUpdated,setLastUpdated]=useState<Date|null>(null);
  const choiceDirty=useRef(false);

  const refresh=useCallback(async()=>{
    setRefreshing(true);
    try{
      // Server-side group membership checks remain authoritative.
      const data=await api.games.rsvpBoard(game.id);
      const saved=readEditAccess(game.id,memberName);
      const name=memberName.trim().toLocaleLowerCase();
      const matching=data.guests.filter(g=>g.display_name.trim().toLocaleLowerCase()===name);
      const mine=saved.id?matching.find(g=>g.id===saved.id):matching.length===1?matching[0]:null;
      if(!choiceDirty.current){
        setChoice(saved.token&&mine?mine.arrival_option:'');
        setSeat(saved.token&&mine?.seat_number?String(mine.seat_number):'');
      }
      setBoard(data);setError('');setLastUpdated(new Date());
    }catch(e:unknown){
      setError(e instanceof Error?e.message:'Could not load the private RSVP board.');
    }finally{setRefreshing(false);}
  },[game.id,memberName]);

  useEffect(()=>{
    choiceDirty.current=false;
    setBoard(null);setChoice('');setSeat('');setError('');setNotice('');
    void refresh();
    const timer=window.setInterval(()=>{
      if(document.visibilityState==='visible')void refresh();
    },30000);
    const focus=()=>{if(document.visibilityState==='visible')void refresh();};
    window.addEventListener('focus',focus);
    return()=>{window.clearInterval(timer);window.removeEventListener('focus',focus);};
  },[refresh]);

  const saved=readEditAccess(game.id,memberName);
  const matching=useMemo(()=>board?.guests.filter(g=>
    g.display_name.trim().toLocaleLowerCase()===memberName.trim().toLocaleLowerCase())||[],
  [board,memberName]);
  const mine=saved.id?matching.find(g=>g.id===saved.id)||null:matching.length===1?matching[0]:null;
  const locked=matching.length>0&&(!saved.token||(!saved.id&&matching.length>1));
  const coming=board?.guests.filter(g=>g.status==='yes').length||0;
  const availability=useMemo(()=>{
    if(!board)return [];
    const taken=new Set<number>();
    for(const guest of board.guests){
      if(guest.status==='yes'&&guest.seat_number!=null&&
         !(mine&&saved.token&&guest.id===mine.id))taken.add(guest.seat_number);
    }
    for(const player of board.players){
      if(player.seat_number!=null)taken.add(player.seat_number);
    }
    return Array.from({length:board.game.seats},(_,i)=>i+1).filter(n=>!taken.has(n));
  },[board,mine?.id,saved.token]);

  async function submit(){
    if(!board||saving||!memberName.trim()||!choice)return;
    setSaving(true);setError('');setNotice('');
    try{
      if(locked)throw new Error('An RSVP is already recorded under your name. Use its original browser or ask the host to help you edit it.');
      const status=rsvpChoiceStatus(board,choice);
      if(!status)throw new Error('Choose an available RSVP response.');
      const response=await api.games.submitRsvpBoard(game.id,{
        display_name:memberName.trim(),arrival_option:choice,
        seat_number:status==='yes'&&seat?Number(seat):null,
        ...(saved.token?{edit_token:saved.token}:{})
      });
      if(response.id&&response.edit_token){
        const next:SavedGuest={id:response.id,token:response.edit_token,name:memberName.trim()};
        localStorage.setItem('pkr:rsvp:v2:'+game.id,JSON.stringify(next));
        // Old Instant links keep their edit rights during the transition.
        localStorage.setItem('pkr:instant:rsvp:'+game.id,response.edit_token);
      }
      choiceDirty.current=false;
      setNotice(status==='no'?'Your host can see that you cannot attend.':
        status==='maybe'?'Your maybe response was saved without reserving a seat.':
        'Your RSVP and seat choice have been saved.');
      await refresh();
    }catch(e:unknown){
      setError(e instanceof Error?e.message:'RSVP could not be saved.');
      await refresh();
    }finally{setSaving(false);}
  }

  return <section className="pkr-player-panel pkr-player-rsvp" aria-label="Game night RSVP and attendance" data-testid="unified-player-rsvp">
    <div className="pkr-player-panel-head">
      <div><span className="pkr-player-eyebrow">GAME NIGHT</span><h3>RSVP and seats</h3></div>
      <small>{board?String(coming)+' coming':'Checking…'}</small>
    </div>
    {error&&<p className="pkr-player-warning" role="alert">{error}</p>}
    {!board?<p className="pkr-player-empty" role="status">Checking your room&apos;s private RSVP board…</p>:<>
      {mine&&<p className="pkr-player-rsvp-current">
        Current response: {rsvpChoiceLabel(board,mine.arrival_option)}
        {mine.seat_number?' · Seat '+mine.seat_number:''}
      </p>}
      {locked?<p className="pkr-player-warning">
        An RSVP under your name is already saved in a different browser. To avoid a duplicate,
        open the original RSVP link or ask your host to help.
      </p>:<>
        <div className="pkr-player-rsvp-choices" role="group" aria-label="Choose an RSVP response">
          {rsvpChoices(board).map(option=><button key={option.value} type="button"
            aria-pressed={choice===option.value}
            className={choice===option.value?'selected':''}
            onClick={()=>{choiceDirty.current=true;setChoice(option.value);
              if(option.status!=='yes')setSeat('');}}>{option.label}</button>)}
        </div>
        {choice&&rsvpChoiceStatus(board,choice)==='yes'&&<label className="pkr-player-rsvp-seat">
          Choose a seat (optional)
          <select value={seat} onChange={e=>{choiceDirty.current=true;setSeat(e.target.value);}}>
            <option value="">Let the host decide</option>
            {availability.map(n=><option key={n} value={n}>Seat {n}</option>)}
            {mine?.seat_number&&!availability.includes(mine.seat_number)&&
              <option value={mine.seat_number}>Seat {mine.seat_number} (current)</option>}
          </select>
        </label>}
        <button type="button" className="pkr-player-primary pkr-player-rsvp-save"
          disabled={!choice||saving||!memberName.trim()} onClick={()=>void submit()}>
          {saving?'Saving RSVP…':mine?'Update my RSVP':'Save my RSVP'}
        </button>
      </>}
      <div className="pkr-player-rsvp-people">
        <div className="pkr-player-panel-head">
          <h4>Who&apos;s coming</h4>
          <button type="button" className="pkr-player-link" disabled={refreshing}
            onClick={()=>void refresh()}>{refreshing?'Refreshing…':'Refresh'}</button>
        </div>
        {board.guests.length?<div className="pkr-player-rsvp-list">
          {board.guests.map(guest=><div key={guest.id}>
            <strong>{guest.display_name}</strong>
            <span>{rsvpChoiceLabel(board,guest.arrival_option)}
              {guest.seat_number?' · Seat '+guest.seat_number:''}</span>
          </div>)}
        </div>:<p className="pkr-player-empty">No RSVPs recorded yet.</p>}
      </div>
      {lastUpdated&&<p className="pkr-player-fineprint">Updated {lastUpdated.toLocaleTimeString('en-AU',{hour:'numeric',minute:'2-digit'})}</p>}
    </>}
    {notice&&<p className="pkr-player-rsvp-notice" role="status">{notice}</p>}
    <button type="button" className="pkr-player-link"
      onClick={()=>router.push('/games/'+encodeURIComponent(game.id)+'/rsvp')}>
      Open the full RSVP and alert settings →
    </button>
  </section>;
}
