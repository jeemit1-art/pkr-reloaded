import type {EventMember,RsvpBoardData} from './api';

/** Names are display-only RSVP identifiers. PKR does not currently store a
 * member ID on every RSVP, so an unmatched name is NOT proof of no reply. */
export const sameName=(value:string)=>value.trim().replace(/\s+/g,' ').toLocaleLowerCase('en-AU');

export type LiveNightStats={
  confirmed:number;declined:number;interested:number;occupied:number;
  available:number;totalSeats:number;unassignedConfirmed:number;
  unmatchedMembers:EventMember[];
};

export function liveNightStats(board:RsvpBoardData,members:EventMember[]):LiveNightStats {
  const accepted=board.guests.filter(r=>r.status==='yes');
  const declined=board.guests.filter(r=>r.status==='no');
  const interested=board.guests.filter(r=>r.status==='maybe');
  const seen=new Set<string>();
  // Physical seated players also count towards capacity, without double counting RSVP names.
  for(const r of accepted)seen.add(sameName(r.display_name));
  for(const p of board.players)seen.add(sameName(p.display_name));
  const totalSeats=Math.max(0,Number(board.game.seats)||0);
  const occupied=seen.size;
  const available=Math.max(0,totalSeats-occupied);
  const reserved=new Set<number>();
  for(const p of board.players)if(p.seat_number!=null)reserved.add(p.seat_number);
  for(const r of accepted)if(r.seat_number!=null)reserved.add(r.seat_number);
  const responseNames=new Set(board.guests.map(r=>sameName(r.display_name)));
  const unmatchedMembers=members.filter(m=>m.role!=='host'&&!responseNames.has(sameName(m.name)));
  return {
    confirmed:accepted.length,declined:declined.length,interested:interested.length,
    occupied,available,totalSeats,unassignedConfirmed:accepted.filter(r=>r.seat_number==null).length,
    unmatchedMembers
  };
}

export function nightInviteText(input:{
  room:string;date:string;location?:string|null;link:string;available:number;seats:number;
}):string {
  return [
    '♠ '+input.room+' · Poker night',
    '🗓 '+input.date,
    input.location?'📍 '+input.location:null,
    input.available>0?'🪑 '+input.available+' of '+input.seats+' places still available':'🪑 Currently full',
    '',
    'Choose your arrival time and RSVP here:',
    input.link,
    'The link always shows the latest confirmed players and seat availability.',
    'Only approved PKR room members can open it.'
  ].filter(x=>x!==null).join('\n');
}

export function nightStatusText(input:{
  room:string;date:string;link:string;confirmed:number;available:number;seats:number;interested:number;
}):string {
  return [
    '♠ '+input.room+' · Live RSVP update',
    '🗓 '+input.date,
    '✅ '+input.confirmed+' confirmed',
    '🪑 '+(input.available>0?input.available+' places available':'Table currently full')+
      ' (capacity '+input.seats+')',
    input.interested>0?'❔ '+input.interested+' interested / maybe':null,
    '',
    'See live names, arrival times and seats, or update your own RSVP:',
    input.link,
    'The figures above are a snapshot. The link stays live.'
  ].filter(x=>x!==null).join('\n');
}

export function nightReminderText(input:{name:string;room:string;date:string;link:string}):string {
  return [
    'Hi '+input.name+',',
    '♠ '+input.room+' is on '+input.date+'.',
    'Could you confirm whether you are playing?',
    'RSVP, choose your arrival time and reserve an available seat:',
    input.link,
    'If you have already replied under a different display name, no action is needed.'
  ].join('\n');
}

export function nightLiveText(input:{room:string;date:string;url:string}):string {
  return [
    '♠ '+input.room+' · Game is underway',
    '🗓 '+input.date,
    'Open the live PKR game here:',
    input.url,
    'Accessible only to authorised members.'
  ].join('\n');
}
