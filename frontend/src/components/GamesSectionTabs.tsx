'use client';
import {useRouter} from 'next/navigation';

type View='sessions'|'rsvps'|'calendar';
export default function GamesSectionTabs({
 roomId,active,onChoose
}:{roomId:string;active:View;onChoose?:(next:View)=>void}){
 const router=useRouter();
 function go(next:View){
  if(onChoose&&next!=='calendar'){onChoose(next);return;}
  if(next==='calendar'){router.push('/schedule'+(roomId?'?room='+encodeURIComponent(roomId):''));return;}
  if(roomId)router.push('/events/'+encodeURIComponent(roomId)+'?tab='+(next==='rsvps'?'night':'games'));
  else router.push('/dashboard');
 }
 const tabs:Array<{id:View;label:string;detail:string}>=[
  {id:'sessions',label:'Sessions',detail:'Upcoming & live'},
  {id:'rsvps',label:'RSVPs & Sharing',detail:'Seats & reminders'},
  {id:'calendar',label:'Calendar',detail:'All scheduled games'}
 ];
 return <nav className="pkr-section-tabs" aria-label="Games sections">
  {tabs.map(t=><button type="button" key={t.id} onClick={()=>go(t.id)}
    aria-current={active===t.id?'page':undefined} aria-label={t.label}>
    <span>{t.label}</span>
   </button>)}
 </nav>;
}
