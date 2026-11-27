'use client';

import {useEffect,useMemo,useState} from 'react';
import {useRouter} from 'next/navigation';
import {api,fmt,fmtDate,fmtSign,type Event,type Game,type LeaderboardEntry} from '@/lib/api';
import {isCurrentGame,isLiveGame} from '@/lib/game-status';
import {loadRoomTransfers,outstandingRoomTransfers,type RoomTransferLoad} from '@/lib/room-payment-schedule';
import PlayerGameNightAccess from './PlayerGameNightAccess';
import ClubEngagementPanel from './ClubEngagementPanel';
import ClubExtrasPanel from './ClubExtrasPanel';
import RecordMetric from './RecordMetric';

type LedgerSnapshot={key:string;data:RoomTransferLoad|null;error:string;loading:boolean;updatedAt:Date|null};
type GameSnapshot={roomId:string;data:Game[]|null;error:string;loading:boolean;updatedAt:Date|null};
const dateOptions={timeZone:'Australia/Brisbane'};
const emptyGames:Game[]=[];
const emptyLeaders:LeaderboardEntry[]=[];

type Props={
  room:Event;games:Game[];history?:Game[];leaders?:LeaderboardEntry[];
  memberId?:string|null;memberName?:string|null;
  onMyProfile?:()=>void;showAllPayments?:boolean;paymentsOnly?:boolean;
};

function downloadCalendar(game:Game,room:Event){
  const utc=(date:Date)=>date.toISOString().replace(/[-:]/g,'').replace(/\.\d{3}/,'');
  const escape=(value:string)=>value.replace(/\\/g,'\\\\').replace(/[,;]/g,(part)=>'\\'+part).replace(/\r?\n/g,'\\n');
  const start=new Date(game.scheduled_at*1000);
  const end=new Date(start.getTime()+4*60*60*1000);
  const body=[
    'BEGIN:VCALENDAR','VERSION:2.0','PRODID:-//PKR//Unified Player Dashboard//EN',
    'BEGIN:VEVENT','UID:'+escape(game.id)+'@mypkr.app','DTSTAMP:'+utc(new Date()),
    'DTSTART:'+utc(start),'DTEND:'+utc(end),'SUMMARY:'+escape(room.name+' — poker night'),
    'DESCRIPTION:'+escape('Open your authorised PKR account: '+window.location.origin+'/dashboard?room='+encodeURIComponent(room.id)),
    ...(game.location?['LOCATION:'+escape(game.location)]:[]),
    'END:VEVENT','END:VCALENDAR'
  ].join('\r\n')+'\r\n';
  const url=URL.createObjectURL(new Blob([body],{type:'text/calendar;charset=utf-8'}));
  const link=document.createElement('a');link.href=url;link.download='PKR-poker-night.ics';link.click();
  window.setTimeout(()=>URL.revokeObjectURL(url),1000);
}

function statusText(status:string|undefined,isPayer:boolean){
  if(status==='paid')return 'Recorded paid';
  if(status==='payer_claimed')return isPayer?'Sent · awaiting confirmation':'Confirm receipt';
  if(status==='not_received')return isPayer?'Recipient reported not received':'Not received';
  if(status==='legacy')return 'Host review required';
  return isPayer?'Payment due':'Awaiting payment';
}

export default function PlayerRoomDashboard({
  room,games,history=emptyGames,leaders=emptyLeaders,memberId,memberName,onMyProfile,showAllPayments=false,paymentsOnly=false,
}:Props){
  const router=useRouter();
  const [ledgerSnapshot,setLedgerSnapshot]=useState<LedgerSnapshot|null>(null);
  const [gameSnapshot,setGameSnapshot]=useState<GameSnapshot|null>(null);
  const [paymentRefresh,setPaymentRefresh]=useState(0);
  const [gameRefresh,setGameRefresh]=useState(0);
  const [shareNotice,setShareNotice]=useState('');
  const ledgerKey=room.id+':'+(memberId||'');
  const currentLedger=ledgerSnapshot?.key===ledgerKey?ledgerSnapshot:null;
  const ledger=currentLedger?.data||null;
  const ledgerError=currentLedger?.error||'';
  const loadingPayments=!!memberId&&(!currentLedger||currentLedger.loading);
  const currentGameData=gameSnapshot?.roomId===room.id?gameSnapshot:null;
  const loadingGames=!paymentsOnly&&(!currentGameData||currentGameData.loading);
  const gameError=currentGameData?.error||'';
  const currentGames=useMemo(()=>gameError?[]:(currentGameData?.data||games).filter(game=>game.event_id===room.id),[gameError,currentGameData?.data,games,room.id]);
  useEffect(()=>{
    if(window.location.hash!=='#pkr-my-payments')return;
    // Payment panel is rendered after the selected player's room loads.
    const target=document.getElementById('pkr-my-payments');
    target?.scrollIntoView({block:'start'});
  },[room.id]);
  useEffect(()=>{
    const controller=new AbortController();
    const key=room.id+':'+(memberId||'');
    setLedgerSnapshot({key,data:null,error:'',loading:!!memberId,updatedAt:null});
    if(memberId)loadRoomTransfers(room.id,undefined,controller.signal)
      .then(data=>{if(!controller.signal.aborted)setLedgerSnapshot({key,data,error:'',loading:false,updatedAt:new Date()});})
      .catch(error=>{if(!controller.signal.aborted)setLedgerSnapshot({key,data:null,loading:false,updatedAt:null,
        error:error instanceof Error?error.message:'Payment records could not be loaded.'});});
    return()=>controller.abort();
  },[room.id,memberId,paymentRefresh]);
  useEffect(()=>{
    if(paymentsOnly)return;
    let active=true;
    setGameSnapshot(previous=>({roomId:room.id,data:previous?.roomId===room.id?previous.data:null,error:'',loading:true,updatedAt:null}));
    api.games.list(room.id).then(data=>{
      if(active)setGameSnapshot({roomId:room.id,data:data.filter(game=>game.event_id===room.id),error:'',loading:false,updatedAt:new Date()});
    }).catch(error=>{
      if(active)setGameSnapshot({roomId:room.id,data:null,loading:false,updatedAt:null,
        error:error instanceof Error?error.message:'Your games could not be loaded.'});
    });
    return()=>{active=false;};
  },[room.id,memberId,games,gameRefresh,paymentsOnly]);

  const upcoming=useMemo(()=>currentGames.filter(game=>isCurrentGame(game)).sort((a,b)=>{
    if(isLiveGame(a)!==isLiveGame(b))return isLiveGame(a)?-1:1;
    return a.scheduled_at-b.scheduled_at;
  }),[currentGames]);
  const next=upcoming[0]||null;
  const live=!!next&&isLiveGame(next);
  const settled=useMemo(()=>[...new Map([...history,...currentGames].filter(game=>game.event_id===room.id)
    .map(game=>[game.id,game])).values()].filter(game=>game.status==='settled')
    .sort((a,b)=>b.scheduled_at-a.scheduled_at),[history,currentGames,room.id]);
  // Use authenticated IDs, not names that may match unrelated historical guests.
  const mine=useMemo(()=>memberId?(ledger?.records||[]).filter(item=>
    item.transfer.from===memberId||item.transfer.to===memberId):[],[ledger,memberId]);
  const pending=useMemo(()=>outstandingRoomTransfers(mine),[mine]);
  const owed=pending.filter(item=>item.transfer.from===memberId);
  const receiving=pending.filter(item=>item.transfer.to===memberId);
  const owedCents=owed.reduce((sum,item)=>sum+item.transfer.amount,0);
  const receivingCents=receiving.reduce((sum,item)=>sum+item.transfer.amount,0);
  const visible=showAllPayments?mine.slice().sort((a,b)=>b.game.scheduled_at-a.game.scheduled_at):pending.slice(0,4);
  const legacyPayments=mine.filter(item=>item.transfer.status==='legacy').length;
  const paymentsIncomplete=!!ledger?.unavailable.length||legacyPayments>0;
  const receiptsToConfirm=receiving.filter(item=>item.transfer.status==='payer_claimed').length;
  const outstandingAmount=(cents:number)=>paymentsIncomplete?(cents>0?'≥ '+fmt(cents):'—'):fmt(cents);
  const ownResult=memberId?leaders.find(item=>item.user_id===memberId):undefined;
  const roomUrl='/events/'+encodeURIComponent(room.id);
  const goTab=(tab:string)=>router.push(roomUrl+'?tab='+tab);
  const goProfile=()=>onMyProfile?onMyProfile():router.push(roomUrl+'?tab=members&mine=profile');
  const goResults=()=>router.push('/results?room='+encodeURIComponent(room.id));
  const goPayments=()=>router.push('/payments?room='+encodeURIComponent(room.id)+'&paymentsScope=mine');
  const goPaymentGroup=(group:'pay'|'receive',status?:'payer_claimed')=>router.push('/payments?room='+encodeURIComponent(room.id)+'&paymentsScope=mine&payments=outstanding&paymentGroup='+group+(status?'&paymentStatus='+status:''));
  const goPaymentHistory=()=>router.push('/payments?room='+encodeURIComponent(room.id)+'&payments=all&paymentsScope=mine');
  const openGame=(game:Game)=>router.push('/games/'+encodeURIComponent(game.id));
  const openResults=(game:Game)=>router.push(game.results_token
    ?'/games/results/'+encodeURIComponent(game.results_token)
    :'/games/'+encodeURIComponent(game.id));
  const goRsvp=()=>{if(next)router.push('/games/'+encodeURIComponent(next.id)+'/rsvp');};
  const shareRoom=async()=>{
    setShareNotice('');
    const url=window.location.origin+'/dashboard?room='+encodeURIComponent(room.id);
    try{
      if(navigator.share){
        await navigator.share({title:'PKR — '+room.name,text:'Open your private poker club',url});
      }else{
        await navigator.clipboard.writeText(url);
        setShareNotice('Member link copied. Only approved members can open this club.');
      }
    }catch(error:unknown){
      if(!(error instanceof Error)||error.name!=='AbortError')
        setShareNotice('Could not share the link from this device.');
    }
  };
  const goLive=()=>{if(next)router.push(live&&next.live_token
    ?'/games/live/'+encodeURIComponent(next.live_token)
    :'/games/'+encodeURIComponent(next.id));};

  const date=next?new Date(next.scheduled_at*1000):null;
  return <section className={'pkr-player-home pkr-game-night-player'+(paymentsOnly?' payments-only':'')}
    data-testid="player-dashboard" aria-label={paymentsOnly?'My payments':'Player dashboard'}>
    {!paymentsOnly&&<section className="gn-player-next" aria-label={live?'Your live game':'Your next game'} aria-busy={loadingGames}>
      <div className="gn-player-next-top">
        <span className="gn-player-label">{live?'Your game is live':next?'Your next game':'Your game night'}</span>
        <div className="gn-player-next-controls">
          {next&&<span className={'gn-player-state'+(live?' is-live':'')}>{live?'Live now':next.status==='lobby'?'Lobby open':'Scheduled'}</span>}
          <button type="button" className="gn-player-text-button gn-player-refresh-game" disabled={loadingGames}
            aria-label={loadingGames?'Refreshing game':'Refresh game'} aria-busy={loadingGames}
            onClick={()=>setGameRefresh(value=>value+1)}>{loadingGames?'Updating…':'Refresh'}</button>
        </div>
      </div>
      {next&&date?<>
        <div className="gn-player-game-identity">
          <div className="gn-player-date" aria-hidden="true">
            <span>{date.toLocaleDateString('en-AU',{...dateOptions,month:'short'})}</span>
            <strong>{date.toLocaleDateString('en-AU',{...dateOptions,day:'numeric'})}</strong>
          </div>
          <div><h2>{room.name}</h2>
            <p><time dateTime={date.toISOString()}>{date.toLocaleDateString('en-AU',{...dateOptions,weekday:'short',day:'numeric',month:'short'})} · {date.toLocaleTimeString('en-AU',{...dateOptions,hour:'numeric',minute:date.getUTCMinutes()?'2-digit':undefined})}</time></p>
          </div>
        </div>
        <div className="gn-player-game-footer">
          <p className="gn-player-location">{next.location||room.name}<span> · {next.seats} seats</span></p>
          <button type="button" className="gn-player-text-button" onClick={()=>openGame(next)}>Game details <span aria-hidden="true">›</span></button>
        </div>
        {live&&<div className="gn-player-live-actions">
          <button type="button" className="gn-player-primary" onClick={goLive}>Watch live table</button>
          <button type="button" className="gn-player-text-button" onClick={goRsvp}>My RSVP &amp; attendance</button>
        </div>}
        {upcoming.length>1&&<button type="button" className="gn-player-text-button gn-player-more-games" onClick={()=>goTab('games')}>View all {upcoming.length} upcoming and live games</button>}
      </>:gameError?<div className="gn-player-game-empty">
        <h2>Game details unavailable</h2><p className="gn-player-warning" role="alert">{gameError}</p>
        <button type="button" className="gn-player-secondary" onClick={()=>setGameRefresh(value=>value+1)}>Try again</button>
        <button type="button" className="gn-player-text-button" onClick={()=>goTab('games')}>View games</button>
      </div>:loadingGames?<p className="gn-player-muted" role="status">Checking your club&apos;s games…</p>:<div className="gn-player-game-empty">
        <h2>No game scheduled yet</h2><p>Your next poker night will appear here when your host adds it.</p>
        <button type="button" className="gn-player-secondary" onClick={()=>goTab('games')}>View games</button>
      </div>}
    </section>}

    {!paymentsOnly&&next&&['scheduled','lobby'].includes(next.status)&&<div id="pkr-player-rsvp">
      <PlayerGameNightAccess key={room.id+':'+next.id+':'+(memberId||'')} game={next} memberName={memberName||''}/>
    </div>}

    <section className="gn-player-payments gn-player-card" id="pkr-my-payments" aria-label="My settlement payments" aria-busy={loadingPayments}>
      <header className="gn-player-section-heading"><h3>My payments</h3>
        <button type="button" className="gn-player-text-button" onClick={goPayments}>View payments <span aria-hidden="true">›</span></button>
      </header>
      {!memberId?<p className="gn-player-muted">Sign in with your approved room account to see your payments.</p>:
        loadingPayments?<p className="gn-player-muted" role="status">Checking your recorded payments…</p>:
        ledgerError?<><p className="gn-player-warning" role="alert">{ledgerError}</p>
          <button type="button" className="gn-player-secondary" onClick={()=>setPaymentRefresh(value=>value+1)}>Retry payments</button></>:
        ledger?<>
          {paymentsIncomplete&&<p className="gn-player-warning" role="status">
            {!!ledger.unavailable.length&&'Some older game payments could not be checked. '}
            {legacyPayments>0&&legacyPayments+' historical '+(legacyPayments===1?'payment record needs':'payment records need')+' host review. '}
            Totals may be incomplete.
          </p>}
          <div className="gn-player-balances">
            <button type="button" className="pkr-record-action" aria-label="View underlying records: To pay" onClick={()=>goPaymentGroup('pay')}><span>To pay</span><strong className={owedCents>0?'gn-player-loss':'gn-player-neutral'}>{outstandingAmount(owedCents)}</strong></button>
            <button type="button" className="pkr-record-action" aria-label="View underlying records: To receive" onClick={()=>goPaymentGroup('receive')}><span>To receive</span><strong className={receivingCents>0?'gn-player-gain':'gn-player-neutral'}>{outstandingAmount(receivingCents)}</strong></button>
          </div>
          {receiptsToConfirm>0&&<button type="button" className="gn-player-attention" onClick={()=>goPaymentGroup('receive','payer_claimed')}>
            <span>{receiptsToConfirm===1?'1 receipt needs your confirmation':receiptsToConfirm+' receipts need your confirmation'}</span><span aria-hidden="true">›</span>
          </button>}
          {visible.length?<div className="gn-player-payment-list">{visible.map(({game,transfer})=><button type="button"
            key={game.id+':'+transfer.id} onClick={()=>openResults(game)}>
            <span><strong>{transfer.from===memberId?'Pay '+transfer.to_name:'Receive from '+transfer.from_name}</strong>
              <small>{statusText(transfer.status,transfer.from===memberId)}</small>
              <small>{fmtDate(game.scheduled_at)}</small></span>
            <b className={transfer.amount===0||transfer.status==='paid'||transfer.status==='legacy'?'gn-player-neutral':transfer.from===memberId?'gn-player-loss':'gn-player-gain'}>{fmt(transfer.amount)}</b><span aria-hidden="true">›</span>
          </button>)}</div>:<p className="gn-player-muted">{paymentsIncomplete?'No outstanding payments found in the records checked.':
            showAllPayments?'No recorded payments are linked to your account.':'You have no outstanding payments.'}</p>}
          <div className="gn-player-payment-links">
            <button type="button" className="gn-player-text-button" onClick={goPaymentHistory}>My payment history</button>
            <button type="button" className="gn-player-text-button" disabled={loadingPayments} onClick={()=>setPaymentRefresh(value=>value+1)}>Refresh payments</button>
          </div>
          <p className="gn-player-payment-note">{!showAllPayments&&pending.length>visible.length?pending.length+' outstanding payments. ':''}
            Open a payment to mark it sent or confirm receipt when you are the verified payer or recipient. PKR does not transfer money.
          </p>
          {currentLedger?.updatedAt&&<p className="gn-player-updated">Updated {currentLedger.updatedAt.toLocaleTimeString('en-AU',{hour:'numeric',minute:'2-digit'})}</p>}
        </>:null}
    </section>

    {!paymentsOnly&&<section className="gn-player-results gn-player-card" aria-label="My results">
      <header className="gn-player-section-heading"><h3>My results</h3>
        <button type="button" className="gn-player-text-button" onClick={goResults}>Standings <span aria-hidden="true">›</span></button>
      </header>
      {ownResult?<div className="gn-player-result-summary">
        <RecordMetric bare className="gn-player-result-record"
          request={{kind:'player',title:'My game history',roomId:room.id,playerId:memberId||undefined,playerName:ownResult.display_name}}>
          <strong className={ownResult.total_net>0?'gn-player-gain':ownResult.total_net<0?'gn-player-loss':'gn-player-neutral'}>{fmtSign(ownResult.total_net)}</strong>
          <span>Net across {ownResult.games_played} linked games</span>
        </RecordMetric>
        <RecordMetric bare className="gn-player-result-record gn-player-profitable-record"
          request={{kind:'player',title:'My profitable games',roomId:room.id,playerId:memberId||undefined,playerName:ownResult.display_name,filter:'profitable'}}>
          {ownResult.games_won} profitable games
        </RecordMetric>
      </div>:<p className="gn-player-muted">Your settled results will appear here once linked to your approved account.</p>}
      <div className="gn-player-recent">
        <h4>Recent completed games</h4>
        {settled.length?settled.slice(0,3).map(game=><button type="button" key={game.id} onClick={()=>openGame(game)}>
          <span>{fmtDate(game.scheduled_at)}</span><span>View results <span aria-hidden="true">›</span></span>
        </button>):<p className="gn-player-muted">Completed games will appear here.</p>}
        <button type="button" className="gn-player-text-button" onClick={()=>router.push('/results?room='+encodeURIComponent(room.id)+'&view=history')}>Game history</button>
      </div>
    </section>}

    {!paymentsOnly&&<section className="gn-player-more" aria-label="Player tools and preferences">
      <h3>Quick links</h3>
      <div className="gn-player-more-list">
        {next&&!live&&<button type="button" onClick={()=>downloadCalendar(next,room)}><span>Add to calendar</span><span aria-hidden="true">›</span></button>}
        {next&&<button type="button" onClick={goRsvp}><span>Full RSVP board &amp; alert settings</span><span aria-hidden="true">›</span></button>}
        <button type="button" onClick={goProfile}><span>My profile</span><span aria-hidden="true">›</span></button>
        <button type="button" onClick={()=>void shareRoom()}><span>Share member link</span><span aria-hidden="true">›</span></button>
      </div>
      {shareNotice&&<p role="status" className="gn-player-muted">{shareNotice}</p>}
    </section>}
    {!paymentsOnly&&<ClubEngagementPanel eventId={room.id} game={next} isHost={false}/>}
    {!paymentsOnly&&<ClubExtrasPanel eventId={room.id} games={currentGames} isManager={false} isOwner={false} userId={memberId}/>}
  </section>;
}
