'use client';
import {useEffect,useState} from 'react';
import {useParams,useRouter} from 'next/navigation';
import {api,fmtDate,type GameDetail,type EventDetail,type ResultsData,type RsvpBoardData,type PrivateGroupContact,type Transfer} from '@/lib/api';
import {buildGameInvite,buildAnnouncement,buildRsvpUpdate,buildResultsShare,buildPrivatePayment,normaliseWhatsappPhone,whatsappUrl} from '@/lib/whatsapp-sharing';
import {createPkrResultsImage} from '@/lib/pkr-results-image';
import './sharing-centre.css';

type Mode='invite'|'members'|'announcement'|'rsvp'|'results'|'payment';
type Snapshot={game:GameDetail;room:EventDetail;results:ResultsData|null;board:RsvpBoardData|null;contacts:PrivateGroupContact[]};
const options:Array<{id:Mode;name:string;detail:string}>=[
  {id:'invite',name:'Game invitation',detail:'Date, location and RSVP'},
  {id:'members',name:'Invite new members',detail:'One-time, host-approved links'},
  {id:'announcement',name:'Host announcement',detail:'Game night changes'},
  {id:'rsvp',name:'RSVP update',detail:'Confirmed players and seats'},
  {id:'results',name:'Results and leaderboard',detail:'Group message or image'},
  {id:'payment',name:'Private payment reminder',detail:'One player at a time'}
];
const outstanding=(t:Transfer)=>['owed','not_received','payer_claimed'].includes(t.status||'');
const explain=(e:unknown)=>e instanceof Error?e.message:'Something went wrong.';

export default function WhatsappSharingCentre(){
  const {id}=useParams<{id:string}>();
  const router=useRouter();
  const [snapshot,setSnapshot]=useState<Snapshot|null>(null);
  const [loading,setLoading]=useState(true);
  const [error,setError]=useState('');
  const [denied,setDenied]=useState(false);
  const [revision,setRevision]=useState(0);
  const [mode,setMode]=useState<Mode>('invite');
  const [contactId,setContactId]=useState('');
  const [transferId,setTransferId]=useState('');
  const [includeAmounts,setIncludeAmounts]=useState(false);
  const [message,setMessage]=useState('');
  const [notice,setNotice]=useState('');
  const [imageBusy,setImageBusy]=useState(false);
  const [paymentBusy,setPaymentBusy]=useState(false);
  const origin=typeof window==='undefined'?'https://mypkr.app':window.location.origin;

  useEffect(()=>{
    const type=new URLSearchParams(window.location.search).get('type');
    if(options.some(x=>x.id===type))setMode(type as Mode);
  },[]);
  useEffect(()=>{
    let active=true;setLoading(true);setError('');setDenied(false);
    (async()=>{
      try{
        const [game,user]=await Promise.all([api.games.get(id),api.auth.me()]);
        const room=await api.events.get(game.event_id);
        const role=room.members?.find(m=>m.id===user.id)?.role || (room.host_id===user.id?'host':'member');
        if(role!=='host'&&role!=='cohost'){
          if(active){setDenied(true);setSnapshot(null)}
          return;
        }
        const [resultResponse,contactsResponse,boardResponse]=await Promise.allSettled([
          game.status==='settled'&&game.results_token?api.games.results(game.results_token):Promise.resolve(null),
          api.events.phoneContacts(game.event_id),
          ['scheduled','lobby'].includes(game.status)?api.games.rsvpBoard(id):Promise.resolve(null)
        ]);
        if(active)setSnapshot({
          game,room,
          results:resultResponse.status==='fulfilled'?resultResponse.value:null,
          contacts:contactsResponse.status==='fulfilled'?contactsResponse.value.contacts:[],
          board:boardResponse.status==='fulfilled'?boardResponse.value:null
        });
      }catch(e){if(active){setError(explain(e));setSnapshot(null)}}
      finally{if(active)setLoading(false)}
    })();
    return()=>{active=false};
  },[id,revision]);
  const game=snapshot?.game;
  const results=snapshot?.results;
  const date=game?fmtDate(game.scheduled_at):'';
  const gameUrl=origin+'/games/'+encodeURIComponent(id);
  const rsvpUrl=gameUrl+'/rsvp';
  const canPublish=game?.status==='settled'&&game.variance===0&&!!results;
  const guests=(snapshot?.board?.guests?.length?snapshot.board.guests:game?.rsvps)||[];
  const confirmed=guests.filter(r=>r.status==='yes').map(r=>r.display_name);
  const maybe=guests.filter(r=>r.status==='maybe').map(r=>r.display_name);
  const contacts=snapshot?.contacts.filter(c=>c.status==='joined')||[];
  const contact=contacts.find(c=>c.id===contactId);
  const transfers=results?.transfers.filter(t=>!!t.id&&outstanding(t)&&Number.isSafeInteger(t.amount)&&t.amount>0)||[];
  const transfer=transfers.find(t=>t.id===transferId)||transfers[0];
  const recipientId=transfer?(transfer.status==='payer_claimed'?transfer.to:transfer.from):'';
  const recipientName=transfer?(transfer.status==='payer_claimed'?transfer.to_name:transfer.from_name):'';
  const recipientPhone=normaliseWhatsappPhone(results?.players.find(p=>p.user_id===recipientId)?.whatsapp)||
    normaliseWhatsappPhone(contacts.find(c=>c.user_id===recipientId)?.phone);
  const groupAllowed=mode!=='members'&&mode!=='payment';
  let prepared='';
  if(snapshot){
    const base={room:snapshot.room.name,date,location:game?.location,rsvpUrl};
    if(mode==='invite'&&['scheduled','lobby'].includes(game?.status||''))prepared=buildGameInvite({...base,seats:game?.seats});
    if(mode==='announcement')prepared=buildAnnouncement(base);
    if(mode==='rsvp'&&['scheduled','lobby'].includes(game?.status||''))
      prepared=buildRsvpUpdate({room:snapshot.room.name,date,confirmed,maybe,seats:game?.seats||0,rsvpUrl});
    if(mode==='results'&&canPublish&&results?.players.length)
      prepared=buildResultsShare({room:snapshot.room.name,date,players:results.players,includeAmounts});
    if(mode==='payment'&&canPublish&&transfer)
      prepared=buildPrivatePayment({room:snapshot.room.name,date,transfer,gameUrl});
  }
  useEffect(()=>{setMessage(prepared);setNotice('');},[prepared]);
  function inviteMembers(){
    if(game)router.push('/events/'+encodeURIComponent(game.event_id)+'?tab=members&inviteGame='+encodeURIComponent(id)+'#pkr-members-invite');
  }
  function openWhatsapp(){
    if(mode==='payment'){void privateReminder('open');return}
    if(!groupAllowed||!message.trim())return;
    window.open(whatsappUrl(message,contact?.phone),'_blank','noopener,noreferrer');
    setNotice('WhatsApp opened. Choose the chat and tap Send. PKR has not sent a message.');
  }
  async function sharePhone(){
    if(!groupAllowed||!message.trim())return;
    if(!navigator.share){openWhatsapp();return}
    try{await navigator.share({title:'PKR · '+snapshot?.room.name,text:message});setNotice('Share sheet closed. PKR cannot confirm delivery.')}
    catch(e){if((e as Error)?.name!=='AbortError')setNotice('Phone sharing failed. Use WhatsApp or Copy instead.')}
  }
  async function copy(){
    if(mode==='payment'){await privateReminder('copy');return}
    if(!groupAllowed||!message.trim())return;
    try{await navigator.clipboard.writeText(message);setNotice('Message copied.')}
    catch{setNotice('Copy unavailable. Select the message text and copy it.')}
  }
  async function privateReminder(action:'open'|'copy'){
    if(!game?.results_token||!canPublish||!transfer?.id||paymentBusy)return;
    const windowRef=action==='open'?window.open('about:blank','_blank'):null;
    if(action==='open'&&!windowRef){setNotice('Allow pop-ups for PKR or use Copy message.');return}
    setPaymentBusy(true);setNotice('');
    try{
      const latest=await api.games.results(game.results_token);
      const saved=latest.transfers.find(t=>t.id===transfer.id);
      if(!saved||!outstanding(saved)||saved.amount!==transfer.amount||saved.status!==transfer.status||latest.game.variance!==0){
        windowRef?.close();setNotice('This payment changed. Refresh before sending.');setRevision(n=>n+1);return;
      }
      const who=saved.status==='payer_claimed'?saved.to:saved.from;
      const fresh=buildPrivatePayment({room:snapshot!.room.name,date,transfer:saved,gameUrl});
      const phone=normaliseWhatsappPhone(latest.players.find(p=>p.user_id===who)?.whatsapp)||recipientPhone;
      if(action==='open'&&windowRef){
        windowRef.location.replace(whatsappUrl(fresh,phone));
        setNotice('Private draft prepared for '+recipientName+'. Check the recipient before tapping Send.');
      }else{
        await navigator.clipboard.writeText(fresh);
        setNotice('Latest private payment reminder copied. Send only to '+recipientName+'.');
      }
    }catch(e){windowRef?.close();setNotice('Nothing was shared. '+explain(e))}
    finally{setPaymentBusy(false)}
  }
  async function shareImage(){
    if(!canPublish||!results?.players.length||!snapshot||imageBusy)return;
    setImageBusy(true);setNotice('');
    try{
      const blob=await createPkrResultsImage({room:snapshot.room.name,date,players:results.players,includeAmounts});
      const file=new File([blob],'PKR-results.png',{type:'image/png'});
      if(navigator.share&&navigator.canShare?.({files:[file]})){
        try{await navigator.share({files:[file],title:'PKR game results'});setNotice('Image share sheet closed. Delivery not confirmed.');return}
        catch(e){if((e as Error)?.name==='AbortError')return}
      }
      const url=URL.createObjectURL(blob);const link=document.createElement('a');
      link.href=url;link.download='PKR-results.png';link.click();
      window.setTimeout(()=>URL.revokeObjectURL(url),4000);
      setNotice('Results image saved. Attach it to your WhatsApp chat.');
    }catch(e){setNotice('Unable to create results image: '+explain(e))}
    finally{setImageBusy(false)}
  }
  if(loading)return <main className="pkr-share-page"><p role="status">Loading PKR sharing options…</p></main>;
  if(denied)return <main className="pkr-share-page"><h1>Host access required</h1><p>Only this room's host or co-host can prepare its sharing messages.</p><button className="btn btn-primary" onClick={()=>router.push('/dashboard')}>Back to dashboard</button></main>;
  if(!snapshot)return <main className="pkr-share-page"><h1>Sharing unavailable</h1><p role="alert">{error||'Could not load game details.'}</p><button className="btn btn-primary" onClick={()=>setRevision(n=>n+1)}>Try again</button></main>;
  return <div className="pkr-share-page"><main className="pkr-share-shell">
    <div className="pkr-share-toolbar">
      <button type="button" onClick={()=>router.push(gameUrl)}>← Game</button><strong>♠ PKR / HOST SHARING</strong>
      <button type="button" onClick={()=>setRevision(n=>n+1)}>↻ Refresh</button>
    </div>
    <header className="pkr-share-heading">
      <div><span>HOST TOOLS · PRIVATE ROOM</span><h1>WhatsApp Sharing Centre</h1>
        <p>Preview and share invitations, updates, results and private payment reminders.</p></div>
      <aside><strong>{snapshot.room.name}</strong><small>{date}</small><small>{game?.location||'No venue entered'}</small></aside>
    </header>
    <div className="pkr-share-columns">
      <nav className="pkr-share-menu" aria-label="Sharing options">
        {options.map(opt=><button key={opt.id} type="button" aria-pressed={mode===opt.id} className={mode===opt.id?'active':''}
          onClick={()=>{setMode(opt.id);setContactId('');setTransferId('')}}>
          <strong>{opt.name}</strong><small>{opt.detail}</small><span aria-hidden="true">›</span>
        </button>)}
      </nav>
      <section className="pkr-share-editor" aria-label="Sharing message editor">
        {mode==='members'?<>
          <h2>Secure member invitations</h2>
          <p>PKR creates an individual one-time invitation, and the host approves each new member. Send the invitation to the intended person, not an entire WhatsApp group.</p>
          <button type="button" className="pkr-share-action" onClick={inviteMembers}>Open private member invitations →</button>
        </>:<>
          <div className="pkr-share-editor-head"><div><span>MESSAGE PREVIEW</span><h2>{options.find(o=>o.id===mode)?.name}</h2></div>
            <button type="button" disabled={!prepared} onClick={()=>setMessage(prepared)}>Reset</button></div>
          {mode==='payment'?<>
            <p className="pkr-share-warning">🔒 Payment reminders are private. Group sharing is disabled.</p>
            {!canPublish?<p role="alert" className="pkr-share-warning">A settled and reconciled game is required. Saved results could not be verified.</p>:
             transfers.length===0?<p className="pkr-share-note">There are no outstanding, verified payments. Paid and unreviewed legacy transfers are excluded.</p>:
             <label>Outstanding transfer<select value={transfer?.id||''} onChange={e=>setTransferId(e.target.value)}>
               {transfers.map(t=><option key={t.id} value={t.id}>{t.from_name+' → '+t.to_name+' · $'+(t.amount/100).toFixed(2)+' · '+t.status}</option>)}
             </select></label>}
            {canPublish&&transfer&&<p className="pkr-share-note">Private recipient: <strong>{recipientName}</strong>{recipientPhone?' · Phone saved':' · Choose contact manually'}</p>}
          </>:<>
            <label>Share with<select value={contactId} onChange={e=>setContactId(e.target.value)}>
              <option value="">Choose group or chat in WhatsApp</option>
              {contacts.map(c=><option key={c.id} value={c.id}>Individual: {c.display_name}</option>)}
            </select></label>
            {contact&&!normaliseWhatsappPhone(contact.phone)&&<p className="pkr-share-note">No valid WhatsApp number saved. Choose the recipient in WhatsApp.</p>}
          </>}
          {mode==='results'&&<label className="pkr-share-checkbox"><input type="checkbox" checked={includeAmounts} onChange={e=>setIncludeAmounts(e.target.checked)}/> Include player net amounts (off by default)</label>}
          {mode==='results'&&!canPublish&&<p role="alert" className="pkr-share-warning">Final, reconciled results could not be verified.</p>}
          {(mode==='invite'||mode==='rsvp')&&!['scheduled','lobby'].includes(game?.status||'')&&<p className="pkr-share-warning">This game is no longer accepting RSVPs.</p>}
          {mode==='announcement'&&<p className="pkr-share-note">Add your specific announcement below the host message heading before sending.</p>}
          <label htmlFor="pkr-share-text">Prepared message</label>
          <textarea id="pkr-share-text" rows={12} value={message} readOnly={mode==='payment'}
            onChange={e=>setMessage(e.target.value)} placeholder="No shareable information available for this game."/>
          <div className="pkr-share-buttons">
            <button type="button" className="pkr-share-action" disabled={!message.trim()||paymentBusy} onClick={openWhatsapp}>{paymentBusy?'Checking payment…':'Open WhatsApp ↗'}</button>
            <button type="button" disabled={!message.trim()||paymentBusy} onClick={()=>void copy()}>Copy message</button>
            {groupAllowed&&<button type="button" disabled={!message.trim()} onClick={()=>void sharePhone()}>Phone share</button>}
            {mode==='results'&&<button type="button" disabled={!canPublish||!results?.players.length||imageBusy} onClick={()=>void shareImage()}>{imageBusy?'Creating image…':'Share results image'}</button>}
          </div>
          {notice&&<p className="pkr-share-notice" role="status">{notice}</p>}
          <p className="pkr-share-hint">{mode==='payment'
            ?'PKR verifies the latest recorded amount and status before preparing each private payment reminder.'
            :'PKR prepares the message but cannot send it automatically. Check your WhatsApp recipient and tap Send.'}</p>
        </>}
      </section>
    </div><footer>Private group information · No automated WhatsApp messaging · PKR does not handle money</footer>
  </main></div>;
}
