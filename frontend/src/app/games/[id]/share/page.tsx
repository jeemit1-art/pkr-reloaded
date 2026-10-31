'use client';

/** Backward-compatible redirect. The old WhatsApp message composer was removed:
 * communications now belong to the room's action-based Game Night tab. */
import {useEffect,useState} from 'react';
import {useParams,useRouter} from 'next/navigation';
import {api} from '@/lib/api';

export default function OldSharingLink(){
  const router=useRouter();
  const params=useParams();
  const id=String(Array.isArray(params.id)?params.id[0]:params.id||'');
  const [error,setError]=useState('');
  useEffect(()=>{
    let active=true;
    api.games.get(id).then(game=>{
      if(!active)return;
      const kind=new URLSearchParams(window.location.search).get('type')||'';
      if(kind==='results'||game.status==='settled')router.replace('/results?room='+encodeURIComponent(game.event_id)+'&view=history');
      else if(kind==='settlements'||kind==='payments')router.replace('/payments?room='+encodeURIComponent(game.event_id));
      else router.replace('/events/'+encodeURIComponent(game.event_id)+'?tab=night&game='+encodeURIComponent(id));
    }).catch(e=>{
      if(active)setError(e instanceof Error?e.message:'Unable to open this game.');
    });
    return()=>{active=false};
  },[id,router]);
  return <main style={{minHeight:'60vh',padding:'90px 24px 150px',maxWidth:560,margin:'auto',color:'var(--ivory)'}}>
    <h1 style={{fontSize:26,marginBottom:14}}>Game Night</h1>
    {error?<><p role="alert">{error}</p><button type="button" className="btn btn-primary"
      onClick={()=>router.push('/dashboard')}>Back to my rooms</button></>:
      <p role="status">Opening live RSVPs, seats and sharing actions…</p>}
  </main>;
}
