import {
  calculateHandPots,distributeTiedPot,PokerPotError,
  type PotAction,type PotSeat,
} from './poker-pot-accounting';

export interface VerifiedOpeningStack extends PotSeat {
  opening_chips:number;
}
export interface ChipAward {
  potIdx:number;
  winnerName:string;
  chips:number;
  label:string;
  split_winners?:Array<{winnerName:string;chips:number}>;
}
export interface RecordedHandResult {
  pot_winners:ChipAward[];
  uncalled_returns?:Array<{display_name:string;chips:number}>;
}
export interface StackAudit {
  opening_total:number;
  recorded_pot_chips:number;
  unsettled_pot_chips:number;
  closing_total:number;
  stacks:Array<{
    display_name:string;seat_number:number;opening_chips:number;
    contributed_chips:number;returned_chips:number;won_chips:number;closing_chips:number;
  }>;
}
export class StackAuditError extends Error{
  constructor(message:string){super(message);this.name='StackAuditError';}
}
function add(a:number,b:number):number{
  const n=a+b;
  if(!Number.isSafeInteger(n)||n<0)throw new StackAuditError('Unsafe chip arithmetic');
  return n;
}

/**
 * Checks a hand against explicitly VERIFIED opening chip balances.
 * Without those balances a true all-in/stack-limit audit is impossible.
 * Pure and read-only: no live stack ledger or persisted roster is invented.
 */
export function auditHandStacks(
  opening:VerifiedOpeningStack[],actions:PotAction[],result:RecordedHandResult|null,
  dealerSeat:number,tableCapacity:number,
):StackAudit {
  if(!Array.isArray(opening)||opening.length<2||opening.length>50||
    !Array.isArray(actions)||actions.length>4000)
    throw new StackAuditError('A verified seated roster and bounded hand history are required');
  const seen=new Set<string>();
  const entries=opening.map(p=>{
    const name=p.display_name?.trim();
    if(!name||seen.has(name)||!Number.isSafeInteger(p.seat_number)||
       !Number.isSafeInteger(p.opening_chips)||p.opening_chips<0)
      throw new StackAuditError('Opening stacks and player names must be uniquely verified');
    seen.add(name);
    return {...p,display_name:name,contributed_chips:0,
      returned_chips:0,won_chips:0,closing_chips:p.opening_chips};
  });
  const byName=new Map(entries.map(p=>[p.display_name,p]));
  const alreadyAllin=new Set<string>();
  for(const move of actions){
    const p=byName.get(move.display_name);
    if(!p||!Number.isSafeInteger(move.chips)||move.chips<0)
      throw new StackAuditError('Recorded action has an invalid player or chip amount');
    if(alreadyAllin.has(move.display_name)&&move.chips>0)
      throw new StackAuditError('Player contributed chips after declaring all-in');
    if(move.chips>p.closing_chips)
      throw new StackAuditError('Recorded wager exceeds verified available stack for '+move.display_name);
    p.contributed_chips=add(p.contributed_chips,move.chips);
    p.closing_chips-=move.chips;
    if(move.action==='allin'){
      if(p.closing_chips!==0)
        throw new StackAuditError('All-in must contribute the entire remaining stack for '+move.display_name);
      alreadyAllin.add(move.display_name);
    }
  }
  let accounting;
  try{
    accounting=calculateHandPots(actions,opening);
  }catch(err){
    if(err instanceof PokerPotError)throw new StackAuditError(err.message);
    throw err;
  }
  const totalOpening=opening.reduce((total,p)=>add(total,p.opening_chips),0);
  let unallocated=accounting.grossChips;
  if(result){
    if(!Array.isArray(result.pot_winners)||
       result.pot_winners.length!==accounting.pots.length)
      throw new StackAuditError('Every contested main and side pot requires a winner allocation');
    const refunds=result.uncalled_returns||[];
    if(JSON.stringify(refunds)!==JSON.stringify(accounting.uncalledReturns))
      throw new StackAuditError('Recorded refunds differ from actual unmatched wagers');
    for(const r of refunds){
      const p=byName.get(r.display_name);
      if(!p)throw new StackAuditError('Returned chips target an unknown player');
      p.returned_chips=add(p.returned_chips,r.chips);
      p.closing_chips=add(p.closing_chips,r.chips);
    }
    for(let i=0;i<accounting.pots.length;i++){
      const expected=accounting.pots[i],declared=result.pot_winners[i];
      if(!declared||declared.potIdx!==i||declared.chips!==expected.chips)
        throw new StackAuditError('Recorded pot payout does not match contested chips');
      let payments:Array<{display_name:string;chips:number}>;
      if(declared.split_winners){
        const names=declared.split_winners.map(w=>w.winnerName);
        try {
          payments=distributeTiedPot(expected,names,opening,dealerSeat,tableCapacity);
        }catch(err){
          if(err instanceof PokerPotError)throw new StackAuditError(err.message);
          throw err;
        }
        const byWinner=new Map(declared.split_winners.map(w=>[w.winnerName,w.chips]));
        if(payments.some(pay=>byWinner.get(pay.display_name)!==pay.chips))
          throw new StackAuditError('The odd chip was not awarded clockwise after the button');
      }else{
        if(!expected.eligible.includes(declared.winnerName))
          throw new StackAuditError('A folded or ineligible player won a pot');
        payments=[{display_name:declared.winnerName,chips:expected.chips}];
      }
      for(const payment of payments){
        const p=byName.get(payment.display_name);
        if(!p)throw new StackAuditError('Payout references an unknown player');
        p.won_chips=add(p.won_chips,payment.chips);
        p.closing_chips=add(p.closing_chips,payment.chips);
      }
    }
    unallocated=0;
  }
  const closingTotal=entries.reduce((sum,p)=>add(sum,p.closing_chips),0);
  if(add(closingTotal,unallocated)!==totalOpening)
    throw new StackAuditError('The hand does not conserve all starting chips');
  return {
    opening_total:totalOpening,recorded_pot_chips:accounting.grossChips,
    unsettled_pot_chips:unallocated,closing_total:closingTotal,
    stacks:entries.map(p=>({
      display_name:p.display_name,seat_number:p.seat_number,
      opening_chips:p.opening_chips,contributed_chips:p.contributed_chips,
      returned_chips:p.returned_chips,won_chips:p.won_chips,
      closing_chips:p.closing_chips,
    })),
  };
}
