/**
 * Server-side no-limit hold'em betting validation for complete, seated full hands.
 * Amounts are INCREMENTAL chips contributed by each action, matching hand_actions.
 *
 * This deliberately does not infer remaining player stacks. A persisted chip-stack
 * ledger is required before maximum-stack / true all-in verification is possible.
 */
export interface BettingSeat { display_name:string; seat_number:number }
export interface BettingHand {
  dealer_seat:number; sb_seat:number|null; bb_seat:number; straddle?:number|boolean|null
}
export interface BettingAction {
  display_name:string; street:string; action:string; chips:number
}
export interface BettingRequest {
  seats:number; players:BettingSeat[]; hand:BettingHand;
  actions:BettingAction[]; proposed:BettingAction;
}
export type BettingDecision =
  | {ok:true; nextActor:string|null; toCall:number; minimumRaise:number; lastFullRaise:number}
  | {ok:false; code:string; error:string; nextActor?:string|null; toCall?:number; minimumRaise?:number};

const STREETS=['pre','flop','turn','river'] as const;
const AGGRESSIVE=new Set(['bet','raise','allin']);
const VOLUNTARY=new Set(['fold','check','call','bet','raise','allin']);
const MAX_PLAYERS=50;
function invalid(code:string,error:string, extra:Record<string,unknown>={}):BettingDecision{
  return {ok:false,code,error,...extra};
}

export function clockwiseSeats(count:number):number[]{
  if(!Number.isSafeInteger(count)||count<2||count>MAX_PLAYERS)throw Error('Invalid table size');
  const left=Math.ceil((count-2)/2),right=Math.floor((count-2)/2);
  const order=[1];
  for(let i=0;i<right;i++)order.push(left+3+i);
  order.push(left+2);
  for(let i=left-1;i>=0;i--)order.push(2+i);
  return order;
}

export function validateBettingAction(req:BettingRequest):BettingDecision{
  const {seats,players,hand,actions,proposed}=req;
  if(!Array.isArray(players)||players.length<2||players.length>MAX_PLAYERS||
    !Array.isArray(actions)||actions.length>4000)
    return invalid('BETTING_STATE_UNAVAILABLE','A complete active player roster is required.');
  let order:number[];
  try {order=clockwiseSeats(seats);} catch {
    return invalid('BETTING_STATE_UNAVAILABLE','Invalid table capacity.');
  }
  const seatsSeen=new Set<number>(),names=new Set<string>();
  for(const player of players){
    const normalized=player.display_name?.toLowerCase().trim();
    if(!normalized||!Number.isSafeInteger(player.seat_number)||
      !order.includes(player.seat_number)||seatsSeen.has(player.seat_number)||names.has(normalized))
      return invalid('BETTING_STATE_UNAVAILABLE','Player seats or names are ambiguous.');
    seatsSeen.add(player.seat_number);names.add(normalized);
  }
  const playerMap=new Map(players.map(p=>[p.display_name,p]));
  const ring=order.filter(seat=>seatsSeen.has(seat));
  const occupied=(seat:number|null|undefined)=>Number.isSafeInteger(seat)&&
    ring.includes(seat as number);
  if(!occupied(hand.dealer_seat)||!occupied(hand.bb_seat))
    return invalid('BETTING_STATE_UNAVAILABLE','Dealer and big blind must be seated.');
  const incomingIndex=STREETS.indexOf(proposed.street as typeof STREETS[number]);
  if(incomingIndex<0||!VOLUNTARY.has(proposed.action)&&
    proposed.action!=='post'&&proposed.action!=='straddle')
    return invalid('INVALID_BETTING_ACTION','Invalid street or action.');
  if(!Number.isSafeInteger(proposed.chips)||proposed.chips<0||
    !playerMap.has(proposed.display_name))
    return invalid('INVALID_BETTING_ACTION','Player or chip amount is invalid.');

  let previousIndex=0;
  for(const action of actions){
    const index=STREETS.indexOf(action.street as typeof STREETS[number]);
    if(index<0||index<previousIndex||!playerMap.has(action.display_name)||
       !Number.isSafeInteger(action.chips)||action.chips<0)
      return invalid('HAND_HISTORY_INVALID','Recorded action order or player identity is inconsistent.');
    previousIndex=index;
  }
  if(incomingIndex<previousIndex)
    return invalid('STREET_OUT_OF_ORDER','Cannot record an action on an earlier street.');
  if(incomingIndex>previousIndex+1)
    return invalid('STREET_OUT_OF_ORDER','Complete the streets in sequence.');
  const lastStreet=STREETS[previousIndex];

  const bigBlindName=players.find(p=>p.seat_number===hand.bb_seat)?.display_name;
  const bbPost=actions.find(a=>a.street==='pre'&&a.action==='post'&&a.display_name===bigBlindName);
  const bigBlind=bbPost?.chips||0;
  const currentPost=actions.filter(a=>a.street==='pre'&&(a.action==='post'||a.action==='straddle'));
  const baseRaise=Math.max(1,bigBlind);
  const status=(street:string)=>{
    const contrib=new Map(players.map(p=>[p.display_name,0]));
    const folded=new Set<string>(),allIn=new Set<string>(),acted=new Set<string>();
    let bet=0,lastFullRaise=baseRaise,lastActor:string|null=null;
    const streetActions=actions.filter(a=>a.street===street);
    for(const action of actions){
      if(STREETS.indexOf(action.street as typeof STREETS[number])>STREETS.indexOf(street as typeof STREETS[number]))break;
      if(action.action==='fold')folded.add(action.display_name);
      if(action.action==='allin')allIn.add(action.display_name);
    }
    for(const action of streetActions){
      const name=action.display_name;
      const previous=contrib.get(name)||0;
      const raisedTo=previous+action.chips;
      if(!Number.isSafeInteger(raisedTo))
        return {invalid:true,next:null,contrib,folded,allIn,acted,bet,lastFullRaise,lastActor};
      contrib.set(name,raisedTo);
      if(!VOLUNTARY.has(action.action)){
        bet=Math.max(bet,raisedTo);
        continue;
      }
      lastActor=name;
      const increase=raisedTo-bet;
      const fullRaise=increase>0&&
        (action.action==='bet'||action.action==='raise'||
         (action.action==='allin'&&increase>=lastFullRaise));
      if(fullRaise){
        lastFullRaise=increase;
        acted.clear();
      }
      acted.add(name);
      bet=Math.max(bet,raisedTo);
    }
    const live=players.filter(p=>!folded.has(p.display_name));
    const able=live.filter(p=>!allIn.has(p.display_name));
    let next:string|null=null;
    if(live.length>1&&able.length){
      const start=lastActor?playerMap.get(lastActor)?.seat_number:
        street==='pre'?
          (currentPost.filter(a=>a.action==='straddle').slice(-1)[0] &&
           playerMap.get(currentPost.filter(a=>a.action==='straddle').slice(-1)[0].display_name)?.seat_number || hand.bb_seat):
          hand.dealer_seat;
      const index=ring.indexOf(start||hand.bb_seat);
      for(let step=1;step<=ring.length;step++){
        const seat=ring[(index+step)%ring.length];
        const player=able.find(p=>p.seat_number===seat);
        if(player&&(!acted.has(player.display_name)|| (contrib.get(player.display_name)||0)<bet)){
          next=player.display_name;break;
        }
      }
    }
    return {invalid:false,next,contrib,folded,allIn,acted,bet,lastFullRaise,lastActor};
  };

  if(proposed.action==='post'||proposed.action==='straddle'){
    if(proposed.street!=='pre'||previousIndex>0||actions.some(a=>VOLUNTARY.has(a.action)))
      return invalid('INVALID_BLIND','Blinds and straddles must be posted before betting.');
    const seat=playerMap.get(proposed.display_name)!.seat_number;
    if(proposed.action==='post'&&seat!==hand.sb_seat&&seat!==hand.bb_seat)
      return invalid('INVALID_BLIND','Only the designated small or big blind may post.');
    if(proposed.action==='straddle'&&(!hand.straddle||seat===hand.bb_seat||seat===hand.sb_seat))
      return invalid('INVALID_BLIND','This hand has no eligible straddler.');
    if(actions.some(a=>a.street==='pre'&&a.display_name===proposed.display_name&&
      (a.action==='post'||a.action==='straddle')))
      return invalid('INVALID_BLIND','The blind or straddle is already recorded.');
    if(proposed.chips<=0)
      return invalid('INVALID_BLIND','Posted chips must be positive.');
    return {ok:true,nextActor:null,toCall:0,minimumRaise:baseRaise,lastFullRaise:baseRaise};
  }

  if(!bbPost)
    return invalid('HAND_BLINDS_INCOMPLETE','Post the big blind before recording betting actions.');
  if(incomingIndex>previousIndex){
    const prior=status(lastStreet);
    if(prior.invalid)return invalid('HAND_HISTORY_INVALID','Recorded chip totals exceed safe integer precision.');
    if(prior.next)
      return invalid('BETTING_ROUND_INCOMPLETE','The previous betting round is not complete.',
        {nextActor:prior.next});
  }

  const current=status(proposed.street);
  if(current.invalid)return invalid('HAND_HISTORY_INVALID','Recorded chip totals exceed safe integer precision.');
  const name=proposed.display_name;
  const currentContribution=current.contrib.get(name)||0;
  const toCall=Math.max(0,current.bet-currentContribution);
  if(current.next!==name)
    return invalid('OUT_OF_TURN',current.next?
      'It is '+current.next+"'s turn to act.":'This betting round is complete.',
      {nextActor:current.next,toCall});
  const total=currentContribution+proposed.chips;
  if(!Number.isSafeInteger(total))
    return invalid('INVALID_BETTING_ACTION','Chip total is too large.');
  if(proposed.action==='check'&&toCall!==0)
    return invalid('CHECK_NOT_ALLOWED','Cannot check when chips are owed.',{toCall});
  if(proposed.action==='call'&&toCall!==proposed.chips)
    return invalid('INVALID_CALL','A call must match the exact amount owed; use All-in for a short call.',
      {toCall});
  if(proposed.action==='bet'&&current.bet>0&&
    !(toCall===0&&
      (playerMap.get(name)?.seat_number===hand.bb_seat||
       (hand.straddle&&currentPost.some(a=>a.action==='straddle'&&a.display_name===name)))))
    return invalid('BET_NOT_ALLOWED','Use Raise when there is already a wager.');
  if(proposed.action==='raise'&&total<=current.bet)
    return invalid('RAISE_NOT_ALLOWED','A raise must increase the amount to call.');
  const increases=AGGRESSIVE.has(proposed.action)&&total>current.bet;
  if(increases&&current.acted.has(name))
    return invalid('ACTION_NOT_REOPENED','A short all-in has not reopened raising for this player.');
  const minimumRaise=Math.max(baseRaise,current.lastFullRaise);
  if((proposed.action==='raise'||proposed.action==='bet') &&
     total-current.bet<minimumRaise)
    return invalid('RAISE_TOO_SMALL','Minimum full raise is '+minimumRaise+' chips.',
      {minimumRaise,toCall});
  if(proposed.action==='allin'&&proposed.chips===0)
    return invalid('INVALID_BETTING_ACTION','All-in chips must be positive.');
  return {ok:true,nextActor:current.next,toCall,minimumRaise,
    lastFullRaise:current.lastFullRaise};
}
