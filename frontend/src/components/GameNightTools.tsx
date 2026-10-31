'use client';

import {useCallback,useEffect,useMemo,useRef,useState,type ReactNode} from 'react';
import {useRouter} from 'next/navigation';
import {
  api,fmtDate,type EventDetail,type EventMember,type Game,type GameDetail,
  type RsvpBoardData,type ResultsData,type PrivateGroupContact,type Transfer
} from '@/lib/api';
import {liveNightStats,nightInviteText,nightStatusText,nightReminderText,nightLiveText} from '@/lib/game-night';
import {buildResultsShare,buildPrivatePayment,normaliseWhatsappPhone,whatsappUrl} from '@/lib/whatsapp-sharing';
import {createPkrResultsImage} from '@/lib/pkr-results-image';
import './GameNightTools.css';

type Props={event:EventDetail;games:Game[];isHost:boolean;onMembers:()=>void;onSchedule:()=>void;notificationTools?:ReactNode};
type Data={game:GameDetail;board:RsvpBoardData|null;results:ResultsData|null;boardError:string;resultsError:string};
type ShareKind='invitation'|'update'|'live'|'results';
const money=(cents:number)=>new Intl.NumberFormat('en-AU',{style:'currency',currency:'AUD'}).format(cents/100);
const errorMessage=(error:unknown)=>error instanceof Error?error.message:'Unable to load this information.';
const validTransfer=(value:Transfer)=>!!value.id&&value.amount>0&&Number.isSafeInteger(value.amount)&&
  ['owed','not_received','payer_claimed'].includes(value.status||'');

export default function GameNightTools({event,games,isHost,onMembers,onSchedule,notificationTools}:Props){
  const router=useRouter();
  const availableGames=useMemo(()=>{
    const future=games.filter(g=>['scheduled','lobby','active'].includes(g.status))
      .sort((a,b)=>(a.status==='active'?-1:0)-(b.status==='active'?-1:0)||a.scheduled_at-b.scheduled_at);
    const complete=games.filter(g=>g.status==='settled').sort((a,b)=>b.scheduled_at-a.scheduled_at).slice(0,5);
    return [...future,...complete];
  },[games]);
  const [selectedId,setSelectedId]=useState('');
  const currentGameRef=useRef('');
  const latestLoad=useRef(0);
  const [state,setState]=useState<Data|null>(null);
  const [contacts,setContacts]=useState<PrivateGroupContact[]>([]);
  const [loading,setLoading]=useState(true);
  const [refreshing,setRefreshing]=useState(false);
  const [notice,setNotice]=useState('');
  const [includeAmounts,setIncludeAmounts]=useState(false);
  const [imageBusy,setImageBusy]=useState(false);
  const [paymentBusy,setPaymentBusy]=useState('');
  const [checkedAt,setCheckedAt]=useState<number|null>(null);

  const requested=typeof window==='undefined'?'':new URLSearchParams(window.location.search).get('game')||'';
  useEffect(()=>{
    if(availableGames.length===0){setSelectedId('');return}
    setSelectedId(old=>{
      if(old&&availableGames.some(g=>g.id===old))return old;
      if(requested&&availableGames.some(g=>g.id===requested))return requested;
      return availableGames[0].id;
    });
  },[availableGames,requested]);

  const fetchSelected=useCallback(async(id:string,quiet=false)=>{
    if(!id)return;
    currentGameRef.current=id;
    const loadId=++latestLoad.current;
    if(!quiet)setLoading(true);
    else setRefreshing(true);
    try{
      const next=await api.games.get(id);
      const open=['scheduled','lobby'].includes(next.status);
      const [boardResult,resultsResult]=await Promise.allSettled([
        open?api.games.rsvpBoard(id):Promise.resolve(null),
        next.status==='settled'&&next.results_token
          ?api.games.results(next.results_token):Promise.resolve(null)
      ]);
      if(currentGameRef.current!==id||latestLoad.current!==loadId)return;
      setState({
        game:next,
        board:boardResult.status==='fulfilled'?boardResult.value:null,
        boardError:open&&boardResult.status==='rejected'?errorMessage(boardResult.reason):'',
        results:resultsResult.status==='fulfilled'?resultsResult.value:null,
        resultsError:next.status==='settled'&&resultsResult.status==='rejected'?errorMessage(resultsResult.reason):''
      });
      setCheckedAt(Date.now());
      if(!quiet)setNotice('');
    }catch(e){
      if(currentGameRef.current!==id||latestLoad.current!==loadId)return;
      setState(null);setCheckedAt(null);
      if(!quiet)setNotice(errorMessage(e));
    }finally{if(currentGameRef.current===id&&latestLoad.current===loadId){setLoading(false);setRefreshing(false)}}
  },[]);
  useEffect(()=>{
    if(!selectedId){setLoading(false);setState(null);return}
    let live=true;
    void fetchSelected(selectedId);
    const poll=window.setInterval(()=>{
      if(live&&document.visibilityState==='visible')void fetchSelected(selectedId,true);
    },15000);
    const onFocus=()=>{if(live&&document.visibilityState==='visible')void fetchSelected(selectedId,true)};
    document.addEventListener('visibilitychange',onFocus);
    return()=>{live=false;window.clearInterval(poll);document.removeEventListener('visibilitychange',onFocus)};
  },[selectedId,fetchSelected]);
  useEffect(()=>{
    if(!isHost)return;
    let live=true;
    api.events.phoneContacts(event.id).then(r=>{if(live)setContacts(r.contacts)}).catch(()=>setContacts([]));
    return()=>{live=false};
  },[event.id,isHost]);

  const selectedState=state?.game.id===selectedId?state:null;
  const board=selectedState?.board;
  const current=selectedState?.game;
  const finished=selectedState?.results;
  const date=current?fmtDate(current.scheduled_at):'';
  const origin=typeof window==='undefined'?'https://mypkr.app':window.location.origin;
  const gameUrl=origin+'/games/'+encodeURIComponent(selectedId);
  const rsvpUrl=gameUrl+'/rsvp';
  const memberList=event.members||[];
  const stats=board?liveNightStats(board,memberList):null;
  const canRsvp=!!board&&!!current&&['scheduled','lobby'].includes(current.status);
  const canPublish=!!finished&&current?.status==='settled'&&current.variance===0;
  const outstanding=canPublish?finished.transfers.filter(validTransfer):[];
  const shareAvailability=canRsvp&&stats?stats.available:0;

  function setGame(id:string){
    currentGameRef.current=id;latestLoad.current++;setState(null);setLoading(true);setSelectedId(id);setNotice('');setIncludeAmounts(false);
    const url=new URL(window.location.href);
    url.searchParams.set('tab','night');url.searchParams.set('game',id);
    window.history.replaceState(window.history.state,'',url.pathname+url.search+url.hash);
  }
  function openRsvp(){if(selectedId)router.push('/games/'+encodeURIComponent(selectedId)+'/rsvp')}
  function openResults(){if(current?.results_token)router.push('/games/results/'+encodeURIComponent(current.results_token))}
  async function copied(value:string,what:string){
    try{await navigator.clipboard.writeText(value);setNotice(what+' copied. Paste it into the intended WhatsApp chat.')}
    catch{setNotice('Copy was blocked by your browser. Use Open WhatsApp on your device instead.')}
  }

  function draft(kind:ShareKind,sourceBoard:RsvpBoardData|null,sourceResults:ResultsData|null):string{
    if(!current)return '';
    if(kind==='results'){
      if(!sourceResults||sourceResults.game.variance!==0||sourceResults.game.status!=='settled')return '';
      return buildResultsShare({room:event.name,date,players:sourceResults.players,includeAmounts});
    }
    if(kind==='live'){
      if(current.status!=='active')return '';
      return nightLiveText({room:event.name,date,url:current.live_token?
        origin+'/games/live/'+encodeURIComponent(current.live_token):gameUrl});
    }
    if(!sourceBoard||!['scheduled','lobby'].includes(sourceBoard.game.status))return '';
    const counts=liveNightStats(sourceBoard,memberList);
    if(kind==='invitation')return nightInviteText({
      room:event.name,date,location:current.location,link:rsvpUrl,
      available:counts.available,seats:counts.totalSeats
    });
    return nightStatusText({
      room:event.name,date,link:rsvpUrl,confirmed:counts.confirmed,
      available:counts.available,seats:counts.totalSeats,interested:counts.interested
    });
  }

  async function refreshedDraft(kind:ShareKind):Promise<string>{
    if(!current)return '';
    if(kind==='live'){
      const latest=await api.games.get(current.id);
      if(latest.status!=='active')throw new Error('This game is no longer live. Refresh PKR.');
      return nightLiveText({room:event.name,date:fmtDate(latest.scheduled_at),
        url:latest.live_token?origin+'/games/live/'+encodeURIComponent(latest.live_token):gameUrl});
    }
    if(kind==='results'){
      if(!current.results_token)throw new Error('No saved results available.');
      const latest=await api.games.results(current.results_token);
      if(latest.game.status!=='settled'||latest.game.variance!==0)
        throw new Error('The saved result is not reconciled.');
      return buildResultsShare({room:event.name,date:fmtDate(latest.game.scheduled_at),
        players:latest.players,includeAmounts});
    }
    const latest=await api.games.rsvpBoard(current.id);
    if(!['scheduled','lobby'].includes(latest.game.status))
      throw new Error('RSVPs are closed for this game.');
    const counts=liveNightStats(latest,memberList);
    const freshDate=fmtDate(latest.game.scheduled_at);
    if(kind==='invitation')return nightInviteText({
      room:event.name,date:freshDate,location:latest.game.location,link:rsvpUrl,
      available:counts.available,seats:counts.totalSeats});
    return nightStatusText({
      room:event.name,date:freshDate,link:rsvpUrl,confirmed:counts.confirmed,
      available:counts.available,seats:counts.totalSeats,interested:counts.interested});
  }

  async function shareWhatsapp(kind:ShareKind){
    // Open a blank tab in the direct user gesture before the verified API request.
    const popup=window.open('about:blank','_blank');
    if(!popup){setNotice('Allow pop-ups in your browser, or use Copy instead.');return}
    try{
      const text=await refreshedDraft(kind);
      if(!text){popup.close();setNotice('The current game does not have shareable details.');return}
      popup.location.replace(whatsappUrl(text));
      setNotice('WhatsApp opened with the latest PKR information. Choose the correct chat and tap Send.');
    }catch(e){popup.close();setNotice(errorMessage(e))}
  }
  async function copyDraft(kind:ShareKind){
    try{const text=await refreshedDraft(kind);if(text)await copied(text,'Current game update');}
    catch(e){setNotice(errorMessage(e))}
  }
  async function nativeShare(kind:ShareKind){
    if(!navigator.share){await shareWhatsapp(kind);return}
    try{const text=await refreshedDraft(kind);
      if(!text)return;
      await navigator.share({title:'PKR · '+event.name,text});
      setNotice('Share sheet closed. PKR cannot confirm whether a message was sent.');
    }catch(e){if((e as Error)?.name!=='AbortError')setNotice(errorMessage(e))}
  }

  function targetContact(member:EventMember){
    return contacts.find(c=>c.status==='joined'&&c.user_id===member.id);
  }
  function reminderFor(member:EventMember){
    return nightReminderText({name:member.name,room:event.name,date,link:rsvpUrl});
  }
  function remind(member:EventMember){
    const phone=normaliseWhatsappPhone(targetContact(member)?.phone);
    if(!phone){setNotice('This member has no linked WhatsApp number. Copy the reminder and send it to the right person manually.');return}
    window.open(whatsappUrl(reminderFor(member),phone),'_blank','noopener,noreferrer');
    setNotice('Private WhatsApp draft opened for '+member.name+'. Check the recipient and tap Send.');
  }

  async function paymentReminder(transfer:Transfer,action:'whatsapp'|'copy'){
    if(!current?.results_token||!canPublish||!transfer.id||paymentBusy)return;
    const tab=action==='whatsapp'?window.open('about:blank','_blank'):null;
    if(action==='whatsapp'&&!tab){setNotice('Allow pop-ups or copy this reminder.');return}
    setPaymentBusy(transfer.id);
    try{
      const latest=await api.games.results(current.results_token);
      const saved=latest.transfers.find(t=>t.id===transfer.id);
      if(latest.game.status!=='settled'||latest.game.variance!==0||
         !saved||!validTransfer(saved)||saved.status!==transfer.status||saved.amount!==transfer.amount){
        tab?.close();setNotice('Payment details have changed. Refresh before sending.');void fetchSelected(selectedId,true);return;
      }
      const personId=saved.status==='payer_claimed'?saved.to:saved.from;
      const contact=contacts.find(c=>c.status==='joined'&&c.user_id===personId);
      const number=normaliseWhatsappPhone(contact?.phone);
      const message=buildPrivatePayment({
        room:event.name,date:fmtDate(latest.game.scheduled_at),transfer:saved,
        gameUrl:origin+'/games/results/'+encodeURIComponent(current.results_token)
      });
      if(action==='whatsapp'){
        if(!number){tab?.close();setNotice('No securely linked number for the intended player. Use Copy and send it only to their private chat.');return}
        tab?.location.replace(whatsappUrl(message,number));
        setNotice('Private payment draft ready. Verify the player and tap Send.');
      }else await copied(message,'Verified private reminder');
    }catch(e){tab?.close();setNotice('Nothing was shared. '+errorMessage(e))}
    finally{setPaymentBusy('')}
  }
  async function shareResultsImage(){
    if(!current?.results_token||!canPublish||imageBusy)return;
    setImageBusy(true);
    try{
      const fresh=await api.games.results(current.results_token);
      if(fresh.game.variance!==0||fresh.game.status!=='settled')
        throw new Error('Reconciled results are required before sharing.');
      const blob=await createPkrResultsImage({
        room:event.name,date:fmtDate(fresh.game.scheduled_at),players:fresh.players,includeAmounts
      });
      const file=new File([blob],'PKR-results.png',{type:'image/png'});
      if(navigator.share&&navigator.canShare?.({files:[file]})){
        try{await navigator.share({files:[file],title:'PKR game results'});setNotice('Image share sheet closed.');return}
        catch(e){if((e as Error)?.name==='AbortError')return}
      }
      const url=URL.createObjectURL(blob);const link=document.createElement('a');
      link.href=url;link.download='PKR-results.png';link.click();
      window.setTimeout(()=>URL.revokeObjectURL(url),4000);
      setNotice('Results card saved. Attach it to your WhatsApp group.');
    }catch(e){setNotice(errorMessage(e))}
    finally{setImageBusy(false)}
  }

  if(!availableGames.length)return <section className="pkr-night-hub" aria-label="Game Night">
    <header className="pkr-night-heading"><div><span>RSVPs · SEATS · SHARING</span><h1>Game Night</h1>
      <p>Once a game is scheduled, live attendance and sharing actions will appear here.</p></div></header>
    <div className="pkr-night-empty"><strong>No game night to manage</strong><p>Schedule a game to create its private RSVP board and live link.</p>
      {isHost&&<button type="button" onClick={onSchedule}>+ Schedule a game</button>}</div>
  </section>;

  return <section className="pkr-night-hub" aria-label="Game Night" data-testid="game-night-hub">
    <header className="pkr-night-heading">
      <div><span>RSVPs · SEATS · COMMUNICATION</span><h1>Game Night</h1>
        <p>Live game information and one-tap actions. No message drafting or paid WhatsApp service.</p>
      </div>
      <label>Session<select aria-label="Choose game night" value={selectedId} onChange={e=>setGame(e.target.value)}>
        {availableGames.map(g=><option key={g.id} value={g.id}>{fmtDate(g.scheduled_at)} · {g.status==='settled'?'Completed':g.status==='active'?'Live':'Upcoming'}</option>)}
      </select></label>
    </header>

    {loading?<div className="pkr-night-empty" role="status">Loading current game information…</div>:
    !selectedState?<div className="pkr-night-empty" role="alert">The game could not be loaded. <button type="button" onClick={()=>void fetchSelected(selectedId)}>Retry</button></div>:
    <>
      <div className="pkr-night-session">
        <div><small>{current?.status==='settled'?'COMPLETED GAME':current?.status==='active'?'LIVE TABLE':'UPCOMING GAME'}</small>
          <h2>{date}</h2><p>{current?.location||'Venue to be confirmed'}</p></div>
        <div className="pkr-night-session-side">
          <span className={'pkr-night-status '+(current?.status==='active'?'live':'')}>{current?.status==='active'?'● Live':current?.status==='settled'?'Settled':'● RSVP open'}</span>
          <button type="button" onClick={()=>void fetchSelected(selectedId)} disabled={refreshing}>{refreshing?'Refreshing…':'↻ Refresh'}</button>
          <small>{checkedAt?'Checked '+new Date(checkedAt).toLocaleTimeString('en-AU',{hour:'numeric',minute:'2-digit'}):'Not checked'}</small>
        </div>
      </div>

      {canRsvp&&stats&&<>
        <div className="pkr-night-stats" aria-label="Live RSVP totals">
          <div><small>Confirmed</small><strong>{stats.confirmed}</strong><span>Playing</span></div>
          <div><small>Available</small><strong>{stats.available}</strong><span>of {stats.totalSeats} places</span></div>
          <div><small>Interested</small><strong>{stats.interested}</strong><span>Maybe</span></div>
          <div><small>Not coming</small><strong>{stats.declined}</strong><span>Declined</span></div>
        </div>
        <div className="pkr-night-action-panel">
          <div><span className="pkr-night-kicker">LIVE RSVP LINK</span><h3>Share once. Always up to date.</h3>
            <p>Pin the PKR RSVP link in your WhatsApp group. Members see the current arrivals and available seats whenever they open it.</p></div>
          <div className="pkr-night-actions">
            <button type="button" className="pkr-night-primary" onClick={openRsvp}>View live RSVP board ↗</button>
            {isHost&&<button type="button" onClick={()=>void shareWhatsapp('invitation')}>♧ Share invitation in WhatsApp</button>}
            <button type="button" onClick={()=>void copied(rsvpUrl,'Live RSVP link')}>Copy live link</button>
          </div>
        </div>
        {isHost&&<div className="pkr-night-grid">
          <section className="pkr-night-panel">
            <span className="pkr-night-kicker">LATEST ATTENDANCE</span><h3>One-tap group update</h3>
            <p>Automatically includes the current confirmed count, available places and live link. No names, phone numbers or financial details.</p>
            <div className="pkr-night-actions">
              <button className="pkr-night-primary" type="button" onClick={()=>void shareWhatsapp('update')}>Share current RSVP update ↗</button>
              <button type="button" onClick={()=>void nativeShare('update')}>Phone share</button>
              <button type="button" onClick={()=>void copyDraft('update')}>Copy update</button>
            </div>
          </section>
          <section className="pkr-night-panel">
            <span className="pkr-night-kicker">SEAT AVAILABILITY</span><h3>{shareAvailability?'Places still available':'Table currently full'}</h3>
            <p>{shareAvailability
              ?'Members can reserve a free seat through the live RSVP board. Sharing the link always displays the latest seats.'
              :'No places are currently free. New players can check back through the live board.'}</p>
            {stats.unassignedConfirmed>0&&<p className="pkr-night-warning">{stats.unassignedConfirmed} confirmed players have not selected a numbered seat.</p>}
            <button type="button" onClick={openRsvp}>Review seats & arrival times →</button>
          </section>
        </div>}
        <section className="pkr-night-panel pkr-night-people">
          <div className="pkr-night-panel-heading"><div><span className="pkr-night-kicker">CURRENT RSVP BOARD</span><h3>Who's coming</h3></div>
            <span className="pkr-night-pulse">● Live · refreshes every 15 seconds</span></div>
          {board!.guests.length?<div className="pkr-night-roster">
            {board!.guests.map(p=><div key={p.id} className="pkr-night-person">
              <span className="pkr-night-avatar">{p.display_name.slice(0,1).toUpperCase()}</span>
              <strong>{p.display_name}</strong>
              <span>{p.status==='no'?'Not coming':p.status==='maybe'?'Maybe':p.arrival_option==='late'?'Running late':p.arrival_option||'Confirmed'}</span>
              <b>{p.status!=='yes'?'—':p.seat_number?'Seat '+p.seat_number:'Seat unassigned'}</b>
            </div>)}
          </div>:<p className="pkr-night-muted">No RSVPs recorded yet. Share the invitation to start collecting responses.</p>}
        </section>

        {isHost&&<section className="pkr-night-panel">
          <div className="pkr-night-panel-heading"><div><span className="pkr-night-kicker">PRIVATE FOLLOW-UPS</span><h3>Members with no matching RSVP</h3></div>
            <span className="pkr-night-count">{stats.unmatchedMembers.length}</span></div>
          <p>PKR compares RSVP display names with the room roster. Different screen names can produce an unmatched result — check before reminding a player. No bulk WhatsApp messages are sent.</p>
          {!stats.unmatchedMembers.length?<p className="pkr-night-muted">Every listed player has a matching RSVP display name.</p>:
          <div className="pkr-night-followups">
            {stats.unmatchedMembers.map(member=>{
              const linked=targetContact(member);
              const phone=normaliseWhatsappPhone(linked?.phone);
              return <div key={member.id} className="pkr-night-followup">
                <div><strong>{member.name}</strong><small>{phone?'Linked private WhatsApp number':'No linked WhatsApp number'}</small></div>
                {phone?<button type="button" onClick={()=>remind(member)}>Remind privately ↗</button>:
                  <button type="button" onClick={()=>void copied(reminderFor(member),'Private reminder for '+member.name)}>Copy reminder</button>}
              </div>
            })}
          </div>}
          <div className="pkr-night-secondary-link"><button type="button" onClick={onMembers}>Manage new members & approvals →</button></div>
        </section>}
      </>}

      {current&&['scheduled','lobby'].includes(current.status)&&!board&&
        <div className="pkr-night-warning" role="alert">
          Live RSVPs are unavailable{selectedState?.boardError?': '+selectedState.boardError:''}. Sharing attendance numbers is disabled until the board loads.
          <button type="button" onClick={()=>void fetchSelected(selectedId)}>Retry RSVP board</button>
        </div>}

      {current?.status==='active'&&<section className="pkr-night-action-panel">
        <div><span className="pkr-night-kicker">LIVE GAME</span><h3>The game is underway</h3>
          <p>Share a direct link for authorised members to view the live table. PKR push alerts remain available separately.</p></div>
        <div className="pkr-night-actions">
          <button className="pkr-night-primary" onClick={()=>router.push('/games/'+encodeURIComponent(selectedId))}>Open game ↗</button>
          {isHost&&<button onClick={()=>void shareWhatsapp('live')}>Share live game link</button>}
        </div>
      </section>}

      {current?.status==='settled'&&<section className="pkr-night-panel">
        <span className="pkr-night-kicker">AFTER THE GAME</span><h3>Results and private settlements</h3>
        {!canPublish?<p className="pkr-night-warning">Saved, reconciled results are required before sharing.
          {selectedState?.resultsError?' '+selectedState.resultsError:''}</p>:<>
          <p>Share the final results card with your group. Individual payment instructions are never included in group messages.</p>
          {isHost&&<label className="pkr-night-check"><input type="checkbox" checked={includeAmounts} onChange={e=>setIncludeAmounts(e.target.checked)}/>
            Include each player's net amount in the group results (off by default)</label>}
          <div className="pkr-night-actions">
            <button className="pkr-night-primary" type="button" onClick={openResults}>View saved results ↗</button>
            {isHost&&<button type="button" onClick={()=>void shareWhatsapp('results')}>Share group-safe results</button>}
            {isHost&&<button type="button" disabled={imageBusy} onClick={()=>void shareResultsImage()}>{imageBusy?'Creating card…':'Share results image'}</button>}
          </div>
          {isHost&&<div className="pkr-night-payments">
            <h4>Outstanding private payments ({outstanding.length})</h4>
            {outstanding.length===0?<p className="pkr-night-muted">No outstanding verified payments.</p>:
              outstanding.map(t=>{
                const to=t.status==='payer_claimed'?t.to:t.from;
                const phone=normaliseWhatsappPhone(contacts.find(c=>c.status==='joined'&&c.user_id===to)?.phone);
                return <div className="pkr-night-followup" key={t.id}>
                  <div><strong>{t.from_name} → {t.to_name} · {money(t.amount)}</strong>
                    <small>{t.status==='payer_claimed'?'Receiver needs to confirm receipt':'Payer needs to mark payment sent'}</small></div>
                  <button type="button" disabled={!!paymentBusy} onClick={()=>void paymentReminder(t,phone?'whatsapp':'copy')}>
                    {paymentBusy===t.id?'Verifying…':phone?'Private WhatsApp ↗':'Copy reminder'}
                  </button>
                </div>;
              })}
          </div>}
        </>}
      </section>}
    </>}

    {notificationTools&&<section className="pkr-night-notification-tools" aria-label="Game night alerts and notification settings">
      <div className="pkr-night-notification-title"><span className="pkr-night-kicker">FREE PKR ALERTS</span>
        <h3>Notifications & device setup</h3><p>Control free PKR push alerts and sound from here. WhatsApp messages still require a manual send.</p></div>
      {notificationTools}
    </section>}
    {notice&&<p className="pkr-night-notice" role="status">{notice}</p>}
    <footer className="pkr-night-footer">WhatsApp drafts are sent manually by the host. PKR never reads WhatsApp chats, charges messaging fees or sends financial details to the group.</footer>
  </section>;
}
