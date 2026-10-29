'use client';

import {useEffect,useMemo,useState} from 'react';
import {useRouter} from 'next/navigation';
import {fmt,fmtDate,fmtSign,type Event,type Game,type LeaderboardEntry} from '@/lib/api';
import {isCurrentGame,isLiveGame} from '@/lib/game-status';
import {loadRoomTransfers,outstandingRoomTransfers,type RoomTransferLoad} from '@/lib/room-payment-schedule';
import './PlayerRoomDashboard.css';

type Props={
  room:Event;games:Game[];history?:Game[];leaders?:LeaderboardEntry[];
  memberId?:string|null;memberName?:string|null;
  onMyProfile?:()=>void;showAllPayments?:boolean;
};

function statusText(status:string|undefined,isPayer:boolean){
  if(status==='paid')return 'Confirmed paid';
  if(status==='payer_claimed')return isPayer?'Sent · awaiting confirmation':'Confirm receipt';
  if(status==='not_received')return isPayer?'Recipient reported not received':'Not received';
  if(status==='legacy')return 'Host review required';
  return isPayer?'Payment due':'Awaiting payment';
}

export default function PlayerRoomDashboard({
  room,games,history=[],leaders=[],memberId,memberName,onMyProfile,showAllPayments=false,
}:Props){
  const router=useRouter();
  const [ledger,setLedger]=useState<RoomTransferLoad|null>(null);
  const [ledgerError,setLedgerError]=useState(false);
  useEffect(()=>{
    const controller=new AbortController();
    setLedger(null);setLedgerError(false);
    if(memberId){
      loadRoomTransfers(room.id,undefined,controller.signal)
        .then(result=>{if(!controller.signal.aborted)setLedger(result);})
        .catch(()=>{if(!controller.signal.aborted)setLedgerError(true);});
    }
    return()=>controller.abort();
  },[room.id,memberId]);

  const upcoming=useMemo(()=>games.filter(isCurrentGame).sort((a,b)=>{
    if(isLiveGame(a)!==isLiveGame(b))return isLiveGame(a)?-1:1;
    return a.scheduled_at-b.scheduled_at;
  }),[games]);
  const next=upcoming[0]||null;
  const live=!!next&&isLiveGame(next);
  const settled=useMemo(()=>history.filter(g=>g.status==='settled')
    .sort((a,b)=>b.scheduled_at-a.scheduled_at),[history]);
  // Use authenticated IDs, not names that may match unrelated historical guests.
  const mine=useMemo(()=>memberId?(ledger?.records||[]).filter(item=>
    item.transfer.from===memberId||item.transfer.to===memberId):[],[ledger,memberId]);
  const pending=useMemo(()=>outstandingRoomTransfers(mine),[mine]);
  const owed=pending.filter(item=>item.transfer.from===memberId);
  const receiving=pending.filter(item=>item.transfer.to===memberId);
  const owedCents=owed.reduce((sum,item)=>sum+item.transfer.amount,0);
  const receivingCents=receiving.reduce((sum,item)=>sum+item.transfer.amount,0);
  const visible=showAllPayments?mine.slice().sort((a,b)=>b.game.scheduled_at-a.game.scheduled_at):pending.slice(0,4);
  const ownResult=memberId?leaders.find(item=>item.user_id===memberId):undefined;
  const roomUrl='/events/'+encodeURIComponent(room.id);
  const goTab=(tab:string)=>router.push(roomUrl+'?tab='+tab);
  const goProfile=()=>onMyProfile?onMyProfile():router.push(roomUrl+'?tab=members&mine=profile');
  const openGame=(game:Game)=>router.push('/games/'+encodeURIComponent(game.id));
  const openResults=(game:Game)=>router.push(game.results_token
    ?'/games/results/'+encodeURIComponent(game.results_token)
    :'/games/'+encodeURIComponent(game.id));
  const goRsvp=()=>{if(next)router.push('/games/'+encodeURIComponent(next.id)+'/rsvp');};
  const goLive=()=>{if(next)router.push(live&&next.live_token
    ?'/games/live/'+encodeURIComponent(next.live_token)
    :'/games/'+encodeURIComponent(next.id));};

  return <section className="pkr-player-home" data-testid="player-dashboard" aria-label="Player dashboard">
    <header className="pkr-player-home-header">
      <div><span className="pkr-player-eyebrow">♠ PLAYER VIEW</span>
        <h2>{memberName?'Welcome, '+memberName.trim().split(' ')[0]:'Your poker night'}</h2>
        <p>{room.name} · Your games, payments and results.</p>
      </div>
      <button type="button" className="pkr-player-outline" onClick={goProfile}>My profile ↗</button>
    </header>
    <div className="pkr-player-feature">
      <div className="pkr-player-feature-content">
        <span className="pkr-player-eyebrow">{live?'● LIVE NOW':next?'NEXT GAME':'NO UPCOMING GAMES'}</span>
        <h3>{next?fmtDate(next.scheduled_at):'Your next poker night'}</h3>
        <p>{next?(next.location||room.name)+' · '+next.seats+' seats':'Your host has not scheduled another game yet.'}</p>
        <div className="pkr-player-buttons">
          {next?<><button type="button" className="pkr-player-primary" onClick={goRsvp}>RSVP &amp; choose seat</button>
            <button type="button" className="pkr-player-outline" onClick={goLive}>{live?'Watch live table':'Game details'} →</button></>:
           <button type="button" className="pkr-player-outline" onClick={()=>goTab('games')}>View games →</button>}
        </div>
      </div>
      <div className="pkr-player-feature-chip" aria-hidden="true">♠</div>
    </div>
    <nav className="pkr-player-actions" aria-label="Player actions">
      <button type="button" onClick={next?goRsvp:()=>goTab('games')}><b>✋</b><strong>My RSVP</strong><small>Arrival and seat</small></button>
      <button type="button" onClick={()=>document.getElementById('pkr-my-payments')?.scrollIntoView({behavior:'smooth'})}><b>⇄</b><strong>My payments</strong><small>Pay or confirm</small></button>
      <button type="button" onClick={()=>goTab('leaderboard')}><b>🏆</b><strong>Standings</strong><small>Game results</small></button>
      <button type="button" onClick={goProfile}><b>♟</b><strong>My profile</strong><small>Avatar and details</small></button>
    </nav>
    <div className="pkr-player-columns">
      <section className="pkr-player-panel" id="pkr-my-payments" aria-label="My settlement payments">
        <div className="pkr-player-panel-head"><div><span className="pkr-player-eyebrow">MY SETTLEMENTS</span><h3>My payments</h3></div><small>{ledger?pending.length:'—'} pending</small></div>
        {!memberId?<p className="pkr-player-empty">Sign in with your approved room account to see your payments.</p>:
         ledgerError?<p className="pkr-player-empty" role="alert">Payments could not be loaded. Open your game results or try again.</p>:
         !ledger?<p className="pkr-player-empty" role="status">Checking your recorded payments…</p>:<>
          {!!ledger.unavailable.length&&<p className="pkr-player-warning" role="status">Some older game payments could not be checked. Totals may be incomplete.</p>}
          <div className="pkr-player-totals">
            <div><small>To pay</small><strong className="pkr-player-negative">{ledger.unavailable.length?'≥ ':''}{fmt(owedCents)}</strong></div>
            <div><small>To receive</small><strong className="pkr-player-positive">{ledger.unavailable.length?'≥ ':''}{fmt(receivingCents)}</strong></div>
          </div>
          {visible.length?<div className="pkr-player-payments">
            {visible.map(({game,transfer})=><button type="button" key={game.id+':'+transfer.id} onClick={()=>openResults(game)}>
              <span><strong>{transfer.from===memberId?'Pay '+transfer.to_name:'Receive from '+transfer.from_name}</strong>
                <small>{fmtDate(game.scheduled_at)} · {statusText(transfer.status,transfer.from===memberId)}</small></span>
              <b className={transfer.from===memberId?'pkr-player-negative':'pkr-player-positive'}>{fmt(transfer.amount)}</b><span aria-hidden="true">›</span>
            </button>)}
          </div>:<p className="pkr-player-empty">{showAllPayments?'No recorded payments are linked to your account.':'No outstanding payments are linked to your account.'}</p>}
          {!showAllPayments&&<button type="button" className="pkr-player-link" onClick={()=>router.push('/insights?room='+encodeURIComponent(room.id)+'&payments=all#pkr-my-payments')}>View my payment history →</button>}
          <p className="pkr-player-fineprint">Open a payment to mark it sent or confirm receipt when you are the verified payer or recipient. PKR does not transfer money.</p>
        </>}
      </section>
      <section className="pkr-player-panel">
        <div className="pkr-player-panel-head"><div><span className="pkr-player-eyebrow">YOUR PERFORMANCE</span><h3>My results</h3></div><button type="button" className="pkr-player-link" onClick={()=>goTab('leaderboard')}>Standings →</button></div>
        <div className="pkr-player-my-result">{ownResult?<><strong className={ownResult.total_net>=0?'pkr-player-positive':'pkr-player-negative'}>{fmtSign(ownResult.total_net)}</strong><span>{ownResult.games_played} linked games · {ownResult.games_won} profitable</span></>:
          <><strong>—</strong><span>No settled results linked to your approved account yet.</span></>}</div>
        <h4>Recent completed games</h4>
        {settled.length?<div className="pkr-player-recent">{settled.slice(0,3).map(game=><button type="button" key={game.id} onClick={()=>openGame(game)}><span>{fmtDate(game.scheduled_at)}</span><span>View results ›</span></button>)}</div>:
         <p className="pkr-player-empty">Completed games will appear here.</p>}
        <button type="button" className="pkr-player-link" onClick={()=>goTab('history')}>Game history →</button>
      </section>
    </div>
  </section>;
}
