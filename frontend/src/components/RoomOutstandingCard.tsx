'use client';

import {useEffect,useMemo,useState} from 'react';
import {useRouter} from 'next/navigation';
import {fmt,fmtDate} from '@/lib/api';
import {loadRoomTransfers,outstandingRoomTransfers,totalTransferCents,type RoomTransferLoad} from '@/lib/room-payment-schedule';
import './RoomOutstandingCard.css';

type Props={roomId:string};
export default function RoomOutstandingCard({roomId}:Props){
  const router=useRouter();
  const [snapshot,setSnapshot]=useState<RoomTransferLoad|null>(null);
  const [loading,setLoading]=useState(true);
  const [error,setError]=useState('');
  const [revision,setRevision]=useState(0);
  useEffect(()=>{
    const controller=new AbortController();
    setLoading(true);setError('');setSnapshot(null);
    loadRoomTransfers(roomId,undefined,controller.signal)
      .then(data=>{if(!controller.signal.aborted)setSnapshot(data);})
      .catch(e=>{if(!controller.signal.aborted)setError(e instanceof Error?e.message:'Unable to load settlements');})
      .finally(()=>{if(!controller.signal.aborted)setLoading(false);});
    return()=>controller.abort();
  },[roomId,revision]);
  const outstanding=useMemo(()=>outstandingRoomTransfers(snapshot?.records||[]),[snapshot]);
  const amount=totalTransferCents(outstanding);
  const fullUrl='/insights?room='+encodeURIComponent(roomId)+'&payments=outstanding#pkr-settlement';
  return (
    <section className="pkr-room-outstanding" aria-label="Outstanding room payments" data-testid="room-outstanding">
      <header className="pkr-room-outstanding-heading">
        <div className="pkr-room-outstanding-copy">
          <span className="pkr-room-outstanding-kicker">SETTLEMENTS</span>
          <h2>Outstanding payments</h2>
          <p>Who owes whom, from settled games in this room.</p>
        </div>
        <div className="pkr-room-outstanding-total">
          <strong data-testid="room-outstanding-amount">{loading?'…':error?'—':fmt(amount)}</strong>
          <span>{loading?'Checking records':error?'Unavailable':outstanding.length+' transfer'+(outstanding.length===1?'':'s')+' pending'}</span>
        </div>
      </header>
      {error?
        <p role="alert" className="pkr-room-outstanding-notice">Could not load the payment schedule. Open the Settlement Centre to review the saved records.</p>:
      loading?
        <p role="status" className="pkr-room-outstanding-notice">Checking recorded settlement payments…</p>:
      <>
        {snapshot&&snapshot.unavailable.length>0&&
          <p role="status" className="pkr-room-outstanding-warning">
            {snapshot.unavailable.length} settled game{snapshot.unavailable.length===1?'':'s'} could not be checked. Amounts shown may be incomplete.
          </p>}
        {outstanding.length?
          <div className="pkr-room-outstanding-list" role="list" aria-label="Recent outstanding payments">
            {outstanding.slice(0,3).map(({game,transfer},index)=>(
              <button type="button" role="listitem" className="pkr-room-outstanding-row"
                key={game.id+':'+(transfer.id||index)}
                onClick={()=>router.push(game.results_token
                  ?'/games/results/'+encodeURIComponent(game.results_token)
                  :'/games/'+encodeURIComponent(game.id))}>
                <span className="pkr-room-outstanding-names">
                  <strong>{transfer.from_name}<span aria-hidden="true"> → </span>{transfer.to_name}</strong>
                  <small>{fmtDate(game.scheduled_at)} · {transfer.status==='payer_claimed'?'Sent — awaiting receipt':transfer.status==='not_received'?'Not received':transfer.status==='owed'?'Pending':'Status not recorded'}</small>
                </span>
                <span className="pkr-room-outstanding-amount">{fmt(transfer.amount)}</span>
                <span className="pkr-room-outstanding-chevron" aria-hidden="true">›</span>
              </button>
            ))}
          </div>:
          <p className="pkr-room-outstanding-empty">No outstanding payments recorded for this room.</p>}
      </>}
      <footer className="pkr-room-outstanding-footer">
        <span>Payment records only · PKR does not transfer money.</span>
        <div className="pkr-room-outstanding-controls">
          <button type="button" className="pkr-room-outstanding-refresh" aria-label="Refresh outstanding payments"
            title="Refresh outstanding payments" disabled={loading}
            onClick={()=>setRevision(n=>n+1)}>↻</button>
          <button type="button" className="pkr-room-outstanding-open" onClick={()=>router.push(fullUrl)}>
            View full payment schedule <span aria-hidden="true">→</span>
          </button>
        </div>
      </footer>
    </section>
  );
}
