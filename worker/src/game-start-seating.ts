// Deterministic, side-effect-free seat planning. Actual D1 writes still need
// conditional seat checks to protect against a concurrent second host.
export interface ExistingGameSeat {
  user_id:string;
  display_name:string;
  seat_number:number|null;
}
export interface ConfirmedRsvp {
  id:string;
  display_name:string;
  whatsapp?:string|null;
  seat_number?:number|null;
}
export interface SeatPlan {
  existingMoves:{user_id:string;seat_number:number}[];
  newPlayers:{id:string;display_name:string;whatsapp:string|null;seat_number:number|null}[];
}
export function planStartSeating(
  capacity:number,existing:ExistingGameSeat[],confirmed:ConfirmedRsvp[],
):SeatPlan {
  if (!Number.isSafeInteger(capacity)||capacity<1||capacity>50)
    throw new Error('Invalid game seat capacity');
  const used=new Set<number>();
  const names=new Set<string>();
  for(const player of existing){
    names.add(player.display_name.trim().toLowerCase());
    if(typeof player.seat_number==='number' &&
       Number.isSafeInteger(player.seat_number) &&
       player.seat_number>=1 && player.seat_number<=capacity)used.add(player.seat_number);
  }
  function vacant():number|null {
    for(let n=1;n<=capacity;n++)if(!used.has(n)&&!reserved.has(n)){used.add(n);return n;}
    return null;
  }
  // Honour RSVP seat picks first. Host-assigned seats remain authoritative;
  // other unseated players use the remaining positions.
  const eligible=confirmed.filter(r=>{
    const name=typeof r.display_name==='string'?r.display_name.trim().toLowerCase():'';
    return name && !names.has(name);
  });
  const reserved=new Set<number>();
  for(const r of eligible){
    const seat=r.seat_number;
    if(typeof seat==='number'&&Number.isSafeInteger(seat)&&seat>=1&&seat<=capacity&&!used.has(seat))reserved.add(seat);
  }
  const existingMoves:SeatPlan['existingMoves']=[];
  for(const player of existing){
    if(player.seat_number!==null)continue;
    const seat=vacant();
    if(seat!==null)existingMoves.push({user_id:player.user_id,seat_number:seat});
  }
  const newPlayers:SeatPlan['newPlayers']=[];
  for(const rsvp of confirmed){
    const name=typeof rsvp.display_name==='string'?rsvp.display_name.trim():'';
    if(!name||!rsvp.id||names.has(name.toLowerCase()))continue;
    names.add(name.toLowerCase());
    let seat:number|null=null;
    if(typeof rsvp.seat_number==='number'&&reserved.has(rsvp.seat_number)&&!used.has(rsvp.seat_number)){
      seat=rsvp.seat_number;
      reserved.delete(seat);used.add(seat);
    } else seat=vacant();
    newPlayers.push({id:rsvp.id,display_name:name,
      whatsapp:rsvp.whatsapp||null,seat_number:seat});
  }
  return {existingMoves,newPlayers};
}
