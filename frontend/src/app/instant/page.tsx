import {redirect} from 'next/navigation';

// Compatibility route only: all PKR players and hosts now use one dashboard.
// Existing WhatsApp, calendar and saved /instant URLs must keep working.
// The dashboard independently checks authentication and authorised membership.
export default async function LegacyInstantRedirect({
  searchParams,
}:{
  searchParams:Promise<{room?:string|string[]}>;
}){
  const params=await searchParams;
  const room=typeof params.room==='string'&&params.room.length<=200?params.room:'';
  redirect('/dashboard'+(room?'?room='+encodeURIComponent(room):''));
}
