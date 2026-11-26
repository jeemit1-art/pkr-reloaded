'use client';

import {useCallback,useEffect,useMemo,useRef,useState} from 'react';
import {useRouter} from 'next/navigation';
import {api,type Game,type RsvpBoardData} from '@/lib/api';
import {rsvpChoices,rsvpChoiceLabel,rsvpChoiceStatus} from '@/lib/rsvp-choices';
import AppDialog from './AppDialog';

type SavedGuest={id:string;token:string;name:string};
type EditAccess={id?:string;token?:string};
type MemoryReceipt=EditAccess&{gameId:string;name:string};
type Guest=RsvpBoardData['guests'][number];
const normalise=(name:string)=>name.trim().toLocaleLowerCase();

function readEditAccess(gameId:string,memberName:string):EditAccess{
  if(typeof window==='undefined'||!memberName.trim())return {};
  try{
    const raw=localStorage.getItem('pkr:rsvp:v2:'+gameId);
    if(raw){
      const guest=JSON.parse(raw) as SavedGuest;
      if(normalise(guest.name||'')===normalise(memberName)&&/^[a-f0-9]{64}$/.test(guest.token||''))
        return {id:guest.id,token:guest.token};
    }
  }catch{}
  try{
    // Existing PKR Instant receipts remain valid; no new identity is inferred.
    const legacy=localStorage.getItem('pkr:instant:rsvp:'+gameId);
    if(legacy&&/^[a-f0-9]{64}$/.test(legacy))return {token:legacy};
  }catch{}
  return {};
}

function responseParts(board:RsvpBoardData,guest:Guest){
  const label=rsvpChoiceLabel(board,guest.arrival_option);
  const heading=guest.status==='yes'?'Going':label|| (guest.status==='maybe'?'Maybe':'Not coming');
  const detail=[
    guest.status==='yes'&&label.toLocaleLowerCase()!=='going'?label:null,
    guest.status==='yes'&&guest.seat_number?'Seat '+guest.seat_number:null,
  ].filter(Boolean).join(' · ');
  return {heading,detail,text:[heading,detail].filter(Boolean).join(' · ')};
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
  const [saveError,setSaveError]=useState('');
  const [notice,setNotice]=useState('');
  const [storageNotice,setStorageNotice]=useState('');
  const [lastUpdated,setLastUpdated]=useState<Date|null>(null);
  const [rsvpOpen,setRsvpOpen]=useState(false);
  const choiceDirty=useRef(false);
  const requestVersion=useRef(0);
  const contextVersion=useRef(0);
  const savingRef=useRef(false);
  const active=useRef(false);
  const memoryReceipt=useRef<MemoryReceipt|null>(null);

  const readAccess=useCallback(():EditAccess=>{
    const current=memoryReceipt.current;
    if(current?.gameId===game.id&&normalise(current.name)===normalise(memberName))
      return {id:current.id,token:current.token};
    return readEditAccess(game.id,memberName);
  },[game.id,memberName]);

  const refresh=useCallback(async()=>{
    const request=++requestVersion.current;
    setRefreshing(true);
    try{
      // The API checks private club membership on every refresh.
      const data=await api.games.rsvpBoard(game.id);
      if(!active.current||request!==requestVersion.current)return;
      if(data.game.id!==game.id)throw new Error('The RSVP board did not match this game.');
      const access=readAccess();
      const matching=data.guests.filter(guest=>normalise(guest.display_name)===normalise(memberName));
      const mine=access.id?matching.find(guest=>guest.id===access.id):matching.length===1?matching[0]:null;
      if(!choiceDirty.current){
        setChoice(access.token&&mine?mine.arrival_option:'');
        setSeat(access.token&&mine?.seat_number?String(mine.seat_number):'');
      }else{
        // Keep an unfinished reply, but clear a seat another player has since taken.
        setSeat(current=>{
          if(!current)return current;
          const number=Number(current);
          const occupied=data.players.some(player=>player.seat_number===number)||
            data.guests.some(guest=>guest.status==='yes'&&guest.seat_number===number&&guest.id!==mine?.id);
          return number>data.game.seats||occupied?'':current;
        });
      }
      setBoard(data);setError('');setLastUpdated(new Date());
    }catch(cause:unknown){
      if(!active.current||request!==requestVersion.current)return;
      // Never retain private attendee data after a failed or revoked read.
      setBoard(null);
      setError(cause instanceof Error?cause.message:'Could not load the private RSVP board.');
    }finally{
      if(active.current&&request===requestVersion.current)setRefreshing(false);
    }
  },[game.id,memberName,readAccess]);

  useEffect(()=>{
    contextVersion.current++;
    active.current=true;
    savingRef.current=false;setSaving(false);
    memoryReceipt.current=null;
    choiceDirty.current=false;
    setBoard(null);setChoice('');setSeat('');setError('');setSaveError('');
    setNotice('');setStorageNotice('');setLastUpdated(null);setRsvpOpen(false);
    void refresh();
    const refreshVisible=()=>{
      if(document.visibilityState==='visible'&&!savingRef.current)void refresh();
    };
    const timer=window.setInterval(refreshVisible,30000);
    window.addEventListener('focus',refreshVisible);
    return()=>{
      active.current=false;requestVersion.current++;contextVersion.current++;
      window.clearInterval(timer);window.removeEventListener('focus',refreshVisible);
    };
  },[refresh]);

  const saved=readAccess();
  const matching=useMemo(()=>board?.guests.filter(guest=>normalise(guest.display_name)===normalise(memberName))||[],[board,memberName]);
  const mine=saved.id?matching.find(guest=>guest.id===saved.id)||null:matching.length===1?matching[0]:null;
  const locked=matching.length>0&&(!saved.token||!mine);
  const editable=!!board&&['scheduled','lobby'].includes(board.game.status);
  const attending=board?.guests.filter(guest=>guest.status==='yes')||[];
  const maybe=board?.guests.filter(guest=>guest.status==='maybe').length||0;
  const notComing=board?.guests.filter(guest=>guest.status==='no').length||0;
  const firstNames=attending.slice(0,3).map(guest=>guest.display_name.trim().split(/\s+/)[0]);
  const response=mine&&board?responseParts(board,mine):null;
  const availability=useMemo(()=>{
    if(!board)return [];
    const taken=new Set<number>();
    for(const guest of board.guests){
      if(guest.status==='yes'&&guest.seat_number!=null&&!(mine&&saved.token&&guest.id===mine.id))
        taken.add(guest.seat_number);
    }
    for(const player of board.players){
      if(player.seat_number!=null)taken.add(player.seat_number);
    }
    return Array.from({length:board.game.seats},(_,index)=>index+1).filter(number=>!taken.has(number));
  },[board,mine?.id,saved.token]);

  async function submit(){
    if(!board||savingRef.current||!memberName.trim()||!choice||!editable)return;
    const context=contextVersion.current;
    const isCurrent=()=>active.current&&contextVersion.current===context;
    savingRef.current=true;
    requestVersion.current++;
    setSaving(true);setSaveError('');setNotice('');setStorageNotice('');
    try{
      if(locked)throw new Error('An RSVP is already recorded under your name. Use its original browser or ask the host to help you edit it.');
      const status=rsvpChoiceStatus(board,choice);
      if(!status)throw new Error('Choose an available RSVP response.');
      const receipt=await api.games.submitRsvpBoard(game.id,{
        display_name:memberName.trim(),arrival_option:choice,
        seat_number:status==='yes'&&seat?Number(seat):null,
        ...(saved.token?{edit_token:saved.token}:{}),
      });
      if(!receipt.ok)throw new Error('The RSVP update could not be verified. Refresh before trying again.');
      let storageFailed=false;
      if(receipt.edit_token){
        // Keep the server-issued proof for this submitted game and name even
        // if navigation unmounts the screen while the request is in flight.
        try{
          localStorage.setItem('pkr:instant:rsvp:'+game.id,receipt.edit_token);
          if(receipt.id){
            const next:SavedGuest={id:receipt.id,token:receipt.edit_token,name:memberName.trim()};
            localStorage.setItem('pkr:rsvp:v2:'+game.id,JSON.stringify(next));
          }
        }catch{storageFailed=true;}
      }
      if(!isCurrent())return;
      if(receipt.edit_token)
        memoryReceipt.current={gameId:game.id,name:memberName.trim(),id:receipt.id||saved.id,token:receipt.edit_token};
      if(storageFailed)
        setStorageNotice('Your RSVP was saved, but this browser could not keep its edit access. Keep this screen open or ask your host if you need to change it later.');
      choiceDirty.current=false;
      setNotice(receipt.status==='no'?'Your host can see that you cannot attend.':
        receipt.status==='maybe'?'Your maybe response was saved without reserving a seat.':
        'Your RSVP and seat choice have been saved.');
      await refresh();
      if(isCurrent())setRsvpOpen(false);
    }catch(cause:unknown){
      if(!isCurrent())return;
      const message=cause instanceof Error?cause.message:'RSVP could not be saved.';
      await refresh();
      if(isCurrent())setSaveError(message);
    }finally{
      if(isCurrent()){savingRef.current=false;setSaving(false);}
    }
  }

  function openSheet(){
    if(savingRef.current)return;
    choiceDirty.current=false;
    setNotice('');setRsvpOpen(true);
    void refresh();
  }
  function closeSheet(){
    if(savingRef.current)return;
    choiceDirty.current=false;setRsvpOpen(false);
  }
  const fullRsvp=()=>{if(!savingRef.current)router.push('/games/'+encodeURIComponent(game.id)+'/rsvp');};
  const heading=locked||!editable?'Your RSVP':mine?'Change RSVP':'RSVP to this game';

  return <section className="gn-player-rsvp" aria-label="Game night RSVP and attendance" data-testid="unified-player-rsvp">
    <div className="gn-player-rsvp-summary">
      <span className="gn-player-label">Your RSVP</span>
      {board?<>
        <div className={'gn-player-rsvp-answer'+(mine?.status==='yes'?' is-going':'')}>
          {mine?.status==='yes'&&<span className="gn-player-response-check" aria-hidden="true">✓</span>}
          <strong>{response?<><span className="gn-player-response-main">{response.heading}</span>
            {response.detail&&<span className="gn-player-response-meta">{response.detail}</span>}</>:
            matching.length>1?'More than one RSVP matches your name':editable?'Are you coming?':'RSVPs are closed'}</strong>
        </div>
        {!mine&&!locked&&editable&&<p>Let your host know and choose your seat.</p>}
        {locked&&<p className="gn-player-muted">Your RSVP is saved. Changes need the original browser or your host.</p>}
        <button type="button" className={mine||locked||!editable?'gn-player-secondary gn-player-edit-rsvp':'gn-player-primary gn-player-edit-rsvp'}
          data-testid="player-rsvp-open" aria-haspopup="dialog" aria-expanded={rsvpOpen} disabled={saving} onClick={openSheet}>
          {locked||!editable?'View RSVP':mine?'Change RSVP':'RSVP now'}
        </button>
      </>:<>
        <p role={error?'alert':'status'}>{error||'Checking your RSVP…'}</p>
        {error&&<button type="button" className="gn-player-secondary" disabled={refreshing} onClick={()=>void refresh()}>{refreshing?'Checking…':'Retry RSVP'}</button>}
      </>}
      {notice&&<p className="gn-player-notice" role="status">{notice}</p>}
      {storageNotice&&<p className="gn-player-warning" role="status">{storageNotice}</p>}
      {!rsvpOpen&&saveError&&<p className="gn-player-warning" role="alert">{saveError}</p>}
    </div>
    {board&&<div className="gn-player-attending">
      <div className="gn-player-attendance-line">
        {!!attending.length&&<div className="gn-player-avatars" aria-hidden="true">
          {attending.slice(0,4).map(guest=><span key={guest.id}>{guest.display_name.trim().split(/\s+/).map(part=>part[0]).slice(0,2).join('')}</span>)}
        </div>}
        <div className="gn-player-attendance-copy"><strong>{attending.length} {attending.length===1?'player':'players'} going</strong>
          <p>{firstNames.length?firstNames.join(', ')+(attending.length>3?' + '+(attending.length-3)+' more':''):'No confirmed RSVPs yet.'}</p>
        </div>
        <button type="button" className="gn-player-text-button" disabled={saving} onClick={fullRsvp}>RSVP board</button>
      </div>
    </div>}
    {rsvpOpen&&<AppDialog className="gn-player-rsvp-dialog" onDismiss={closeSheet} aria-label={heading}
      onClick={event=>{if(event.target===event.currentTarget)closeSheet();}}>
      <div className="gn-player-rsvp-sheet">
        <div className="gn-player-sheet-handle" aria-hidden="true"/>
        <header className="gn-player-sheet-heading">
          <div><span className="gn-player-label">Your game night</span><h2>{heading}</h2></div>
          <button type="button" className="gn-player-close" aria-label="Close RSVP" onClick={closeSheet} disabled={saving}>×</button>
        </header>
        <p className="gn-player-sheet-game">{board?.event.name||'Game night'} · {new Date(game.scheduled_at*1000).toLocaleDateString('en-AU',{weekday:'short',day:'numeric',month:'short',timeZone:'Australia/Brisbane'})}</p>
        {error&&<p className="gn-player-warning" role="alert">{error}</p>}
        {saveError&&<p className="gn-player-warning" role="alert">{saveError}</p>}
        {!board?<div>
          {!error&&<p className="gn-player-muted" role="status">Checking your club&apos;s private RSVP board…</p>}
          {error&&<button type="button" className="gn-player-secondary" disabled={refreshing} onClick={()=>void refresh()}>{refreshing?'Checking…':'Retry RSVP'}</button>}
        </div>:<>
          <div className="gn-player-sheet-current"><span className="gn-player-label">{memberName||'Your response'}</span>
            <strong>{response?.text|| (locked?'An existing RSVP needs your original edit access':'No RSVP saved yet')}</strong>
          </div>
          {!editable?<p className="gn-player-warning">RSVP changes are closed for this game. Your saved response and the guest list are still available.</p>:
            locked?<p className="gn-player-warning">An RSVP under your name is already saved in a different browser or could not be matched to this edit link. To avoid a duplicate, open the original RSVP link or ask your host to help.</p>:
            !memberName.trim()?<p className="gn-player-warning">Open the full RSVP board to enter your name and save a response.</p>:<>
              <div className="gn-player-sheet-field"><span className="gn-player-field-label">When can you make it?</span>
                <div className="gn-player-response-options pkr-player-rsvp-choices" role="group" aria-label="Choose an RSVP response">
                  {rsvpChoices(board).map(option=><button key={option.value} type="button"
                    aria-pressed={choice===option.value} className={choice===option.value?'selected':''} disabled={saving}
                    onClick={()=>{choiceDirty.current=true;setChoice(option.value);setSaveError('');if(option.status!=='yes')setSeat('');}}>
                    {option.label}
                  </button>)}
                </div>
              </div>
              {choice&&rsvpChoiceStatus(board,choice)==='yes'&&<label className="gn-player-sheet-field pkr-player-rsvp-seat">
                <span className="gn-player-field-label">Your seat <span className="gn-player-muted">(optional)</span></span>
                <select aria-label="Your seat" value={seat} disabled={saving} onChange={event=>{choiceDirty.current=true;setSeat(event.target.value);setSaveError('');}}>
                  <option value="">Let the host decide</option>
                  {availability.map(number=><option key={number} value={number}>Seat {number}</option>)}
                  {mine?.seat_number&&!availability.includes(mine.seat_number)&&<option value={mine.seat_number}>Seat {mine.seat_number} (current)</option>}
                </select>
              </label>}
              <button type="button" className="gn-player-primary gn-player-save-rsvp" data-testid="player-rsvp-save"
                disabled={!rsvpChoiceStatus(board,choice)||saving||refreshing} onClick={()=>void submit()}>
                {saving?'Saving RSVP…':mine?'Update my RSVP':'Save my RSVP'}
              </button>
            </>}
          <section className="gn-player-guest-list" aria-label="All RSVP responses">
            <header><h3>Who&apos;s coming</h3><button type="button" className="gn-player-text-button" disabled={refreshing||saving}
              onClick={()=>void refresh()}>{refreshing?'Refreshing…':'Refresh replies'}</button></header>
            <p className="gn-player-muted">{attending.length} going · {maybe} maybe · {notComing} not coming</p>
            {board.guests.length?<div className="gn-player-guest-rows">{board.guests.map(guest=><div key={guest.id}>
              <strong>{guest.display_name}</strong><span>{responseParts(board,guest).text}</span>
            </div>)}</div>:<p className="gn-player-muted">No RSVPs recorded yet.</p>}
            {lastUpdated&&<p className="gn-player-updated">Updated {lastUpdated.toLocaleTimeString('en-AU',{hour:'numeric',minute:'2-digit'})}</p>}
          </section>
        </>}
        <button type="button" className="gn-player-text-button gn-player-full-rsvp" disabled={saving} onClick={fullRsvp}>
          Full RSVP board &amp; alert settings <span aria-hidden="true">→</span>
        </button>
      </div>
    </AppDialog>}
  </section>;
}
