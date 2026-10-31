'use client';
import {useEffect,useState} from 'react';
import {api,type RoomDashboardLayout} from '@/lib/api';

export default function RoomExperienceChoice({roomId,canChange}:{roomId:string;canChange:boolean}){
 const [layout,setLayout]=useState<RoomDashboardLayout>('command');
 const [loading,setLoading]=useState(true);
 const [saving,setSaving]=useState(false);
 const [error,setError]=useState('');
 useEffect(()=>{
  let alive=true;
  setLoading(true);setError('');
  if(!roomId){setLoading(false);return}
  void api.events.dashboardLayout(roomId).then(record=>{
   if(alive&&record.event_id===roomId)setLayout(record.layout==='live'?'live':'command');
  }).catch(()=>{if(alive)setError('The saved room appearance could not be loaded.')})
    .finally(()=>{if(alive)setLoading(false)});
  return()=>{alive=false};
 },[roomId]);
 async function choose(next:RoomDashboardLayout){
  if(!canChange||loading||saving||!roomId||next===layout)return;
  setSaving(true);setError('');
  try{
   const record=await api.events.saveDashboardLayout(roomId,next);
   if(record.event_id!==roomId||record.layout!==next)throw Error('The room appearance was not saved.');
   setLayout(record.layout);
   window.dispatchEvent(new CustomEvent('pkr:room-experience-saved',{
    detail:{roomId,layout:record.layout}
   }));
  }catch(e){setError(e instanceof Error?e.message:'Unable to save room appearance.')}
  finally{setSaving(false)}
 }
 return <div className="pkr-experience-choice" data-testid="pkr-room-appearance" data-room-id={roomId}
   data-layout={layout}>
   <p>Choose between the original <strong>Command Centre</strong> and <strong>Live Poker</strong> designs.
    The choice follows this poker club across every tab and is shared with its members.</p>
   <div className="pkr-experience-choice-options" role="group" aria-label="Poker room appearance choices">
    <button type="button" onClick={()=>void choose('command')}
      disabled={!canChange||loading||saving}
      aria-pressed={!loading&&layout==='command'} className={layout==='command'?'is-active':''}>
      <span aria-hidden="true">▦</span><strong>Command Centre</strong>
      <small>Premium club dashboard · emerald and champagne gold</small>
    </button>
    <button type="button" onClick={()=>void choose('live')}
      disabled={!canChange||loading||saving}
      aria-pressed={!loading&&layout==='live'} className={layout==='live'?'is-active':''}>
      <span aria-hidden="true">♠</span><strong>Live Poker</strong>
      <small>Casino felt · live table styling throughout</small>
    </button>
   </div>
   <p className="pkr-experience-choice-note">{loading?'Loading your club’s saved choice…':
      canChange?'Host setting · applies to all club members':'Your host controls the appearance for this club'}</p>
   {error&&<p role="alert">{error}</p>}
 </div>;
}
