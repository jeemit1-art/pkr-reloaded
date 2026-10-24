import {clockwiseSeats} from './poker-betting-rules';

export interface PotAction {
  display_name:string;action:string;chips:number;
}
export interface PotSeat {
  display_name:string;seat_number:number;
}
export interface UncalledReturn {
  display_name:string;chips:number;
}
export interface ContestablePot {
  potIdx:number;chips:number;eligible:string[];label:string;level:number;
}
export interface PokerPotAccounting {
  grossChips:number;
  contestableChips:number;
  uncalledReturns:UncalledReturn[];
  pots:ContestablePot[];
}
export class PokerPotError extends Error {
  constructor(message:string){super(message);this.name='PokerPotError';}
}
function checkedSum(a:number,b:number):number {
  const total=a+b;
  if(!Number.isSafeInteger(total)||total<0)
    throw new PokerPotError('Pot contribution exceeds safe integer chip precision');
  return total;
}

/**
 * No-limit hold'em hand accounting, using only recorded incremental chips.
 * The unique top contribution is uncalled beyond the next highest amount,
 * so it is RETURNED to that bettor before any main/side pots are awarded.
 * Folded chips remain dead money in the pots, not eligible for a payout.
 *
 * This computes entitlements, not a bankroll: starting stacks are not known
 * from these actions and must be supplied by a separate audited chip ledger.
 */
export function calculateHandPots(
  actions:PotAction[],seated:PotSeat[],
):PokerPotAccounting {
  if(!Array.isArray(actions)||actions.length>4000||
     !Array.isArray(seated)||seated.length<2||seated.length>50)
    throw new PokerPotError('A complete hand roster and action history are required');
  const amounts=new Map<string,number>();
  const folded=new Set<string>();
  const allinNames=new Set<string>();
  const seatNumbers=new Set<number>();
  for(const p of seated){
    const name=p.display_name?.trim();
    if(!name||amounts.has(name)||!Number.isSafeInteger(p.seat_number)||
       p.seat_number<1||p.seat_number>50||seatNumbers.has(p.seat_number))
      throw new PokerPotError('Duplicate or invalid player name/seat');
    amounts.set(name,0);seatNumbers.add(p.seat_number);
  }
  for(const action of actions){
    if(!amounts.has(action.display_name)||!Number.isSafeInteger(action.chips)||action.chips<0)
      throw new PokerPotError('Hand contains an invalid player or chip amount');
    if(action.action==='fold'){if(action.chips!==0)throw new PokerPotError('Fold cannot contribute chips');folded.add(action.display_name);}
    if(action.action==='allin')allinNames.add(action.display_name);
    if(action.chips)amounts.set(action.display_name,
      checkedSum(amounts.get(action.display_name)!,action.chips));
  }

  const values=[...amounts.values()].sort((a,b)=>b-a);
  const grossChips=values.reduce((a,b)=>checkedSum(a,b),0);
  const top=values[0]||0,next=values[1]||0;
  const highestPlayer=[...amounts].find(([,v])=>v===top)?.[0]||'';
  const refund=top>next?top-next:0;
  const uncalledReturns=refund?[{display_name:highestPlayer,chips:refund}]:[];
  const matchedMaximum=top-refund;
  const levels=new Set<number>();
  if(matchedMaximum>0)levels.add(matchedMaximum);
  for(const name of allinNames){
    const amount=amounts.get(name)!;
    if(amount>0 && amount<matchedMaximum)levels.add(amount);
  }
  let previous=0;
  const pots:ContestablePot[]=[];
  for(const level of [...levels].sort((a,b)=>a-b)){
    if(level<=previous)continue;
    let chips=0;
    for(const amount of amounts.values())
      chips=checkedSum(chips,Math.min(level,amount)-Math.min(previous,amount));
    if(chips<=0)continue;
    const eligible=[...amounts].filter(([name,amount])=>
      !folded.has(name)&&amount>=level).map(([name])=>name);
    if(!eligible.length)
      throw new PokerPotError('No live player can claim one of the recorded side pots');
    pots.push({
      potIdx:pots.length,chips,eligible,label:pots.length?'Side Pot '+pots.length:'Main Pot',level,
    });
    previous=level;
  }
  const contestableChips=pots.reduce((sum,p)=>checkedSum(sum,p.chips),0);
  if(checkedSum(contestableChips,refund)!==grossChips)
    throw new PokerPotError('Pot and uncalled refunds do not conserve chips');
  return {grossChips,contestableChips,uncalledReturns,pots};
}

/**
 * Poker TDA 2026 Rule 20: each odd chip in a board-game tied pot goes
 * clockwise to the first tied winner left of the button. Divide each side
 * pot separately. The caller supplies the actual declared tying winners.
 */
export function distributeTiedPot(
  pot:ContestablePot,winners:string[],seated:PotSeat[],dealerSeat:number,
  capacity:number,
):Array<{display_name:string;chips:number}> {
  const winnerSet=new Set(winners);
  if(!winners.length||winnerSet.size!==winners.length ||
     winners.some(name=>!pot.eligible.includes(name)))
    throw new PokerPotError('Tied winners must be unique eligible players');
  const seatByName=new Map(seated.map(p=>[p.display_name,p.seat_number]));
  const ring=clockwiseSeats(capacity);
  const index=ring.indexOf(dealerSeat);
  if(index<0||winners.some(name=>!ring.includes(seatByName.get(name)!)))
    throw new PokerPotError('Dealer and winner seats must be valid');
  const closest=ring.slice(index+1).concat(ring.slice(0,index+1))
    .map(seat=>winners.find(name=>seatByName.get(name)===seat))
    .filter((x):x is string=>Boolean(x));
  if(closest.length!==winners.length)throw new PokerPotError('Ambiguous winner seats');
  const per=Math.floor(pot.chips/winners.length);
  const odd=pot.chips%winners.length;
  const result=closest.map((name,i)=>({display_name:name,chips:per+(i<odd?1:0)}));
  if(result.reduce((a,b)=>a+b.chips,0)!==pot.chips)
    throw new PokerPotError('Split-pot allocation failed conservation');
  return result;
}
