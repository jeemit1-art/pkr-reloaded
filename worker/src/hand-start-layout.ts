import {clockwiseSeats} from './poker-betting-rules';

export interface StartSeat {
  user_id:string;display_name:string;seat_number:number;
}
export interface StartPositions {
  dealer_seat:number;sb_seat:number;bb_seat:number;straddle:boolean;
}
export type StartLayoutDecision =
  | {ok:true;seats:StartSeat[]}
  | {ok:false;code:'HAND_ROSTER_UNSYNCED'|'HAND_SEATING_INVALID'|'INVALID_BLIND';
     error:string};

export function validateHandStartLayout(
  tableCapacity:number, players:StartSeat[], positions:StartPositions
):StartLayoutDecision {
  let physical:number[];
  try {physical=clockwiseSeats(tableCapacity);} catch {
    return {ok:false,code:'HAND_ROSTER_UNSYNCED',error:'Table capacity is invalid.'};
  }
  if(!Array.isArray(players)||players.length<2||players.length>tableCapacity)
    return {ok:false,code:'HAND_ROSTER_UNSYNCED',
      error:'Sync at least two seated players with recorded buy-ins before starting a hand.'};
  const occupied=new Set<number>(),identities=new Set<string>(),names=new Set<string>();
  for(const player of players){
    const name=player?.display_name?.trim().toLowerCase();
    if(!player||!player.user_id||!name||!physical.includes(player.seat_number)||
       occupied.has(player.seat_number)||identities.has(player.user_id)||
       names.has(name)){
      return {ok:false,code:'HAND_ROSTER_UNSYNCED',
        error:'Player seats or identities are ambiguous. Sync the game before starting a hand.'};
    }
    occupied.add(player.seat_number);
    identities.add(player.user_id);
    names.add(name);
  }
  const ring=physical.filter(seat=>occupied.has(seat));
  const dealerIndex=ring.indexOf(positions.dealer_seat);
  if(dealerIndex<0)
    return {ok:false,code:'HAND_SEATING_INVALID',
      error:'Dealer must be a registered seated player.'};
  const headsUp=ring.length===2;
  const expectedSmall=headsUp?ring[dealerIndex]:ring[(dealerIndex+1)%ring.length];
  const expectedBig=ring[(dealerIndex+(headsUp?1:2))%ring.length];
  if(positions.sb_seat!==expectedSmall||positions.bb_seat!==expectedBig)
    return {ok:false,code:'HAND_SEATING_INVALID',
      error:'Dealer and blind seats do not follow the active clockwise seating order.'};
  if(positions.straddle&&headsUp)
    return {ok:false,code:'INVALID_BLIND',
      error:'At least three seated players are required to straddle.'};
  return {ok:true,seats:players.map(p=>({
    user_id:p.user_id,display_name:p.display_name,seat_number:p.seat_number,
  }))};
}
