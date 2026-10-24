export interface PayoutTier {place:number;pct:number}
export interface PayoutAward extends PayoutTier {amount:number}
export class TournamentPayoutError extends Error {
  constructor(message:string){super(message);this.name='TournamentPayoutError';}
}
function validCents(n:number):boolean {
  return Number.isSafeInteger(n)&&n>=0;
}
export function calculateTournamentPayouts(
  entrants:number,
  entryFeeCents:number,
  additionalPaymentsCents:number[],
  tiers:PayoutTier[],
):{prize_pool_cents:number;payouts:PayoutAward[]} {
  if(!Number.isSafeInteger(entrants)||entrants<0||entrants>100000||
     !validCents(entryFeeCents)||!Array.isArray(additionalPaymentsCents)||
     additionalPaymentsCents.length>100000||
     additionalPaymentsCents.some(x=>!validCents(x)))
    throw new TournamentPayoutError('Entrants and payments must be valid whole cents');
  const entryPool=entrants*entryFeeCents;
  const pool=additionalPaymentsCents.reduce((s,c)=>s+c,entryPool);
  if(!validCents(pool))
    throw new TournamentPayoutError('Prize pool exceeds safe integer cents');
  if(!Array.isArray(tiers)||tiers.length<1||tiers.length>20)
    throw new TournamentPayoutError('Define at least one and at most 20 payout positions');
  const bases=tiers.map((tier,i)=>{
    if(!tier||tier.place!==i+1||!Number.isFinite(tier.pct)||
       tier.pct<=0||tier.pct>100)
      throw new TournamentPayoutError('Payout positions must be sequential with positive percentages');
    const basis=Math.round(tier.pct*100);
    if(Math.abs(tier.pct*100-basis)>1e-7)
      throw new TournamentPayoutError('Payout percentages may use at most two decimals');
    return basis;
  });
  if(bases.reduce((s,v)=>s+v,0)!==10000)
    throw new TournamentPayoutError('Payout percentages must total exactly 100%');
  if(entrants>0&&tiers.length>entrants)
    throw new TournamentPayoutError('There are more paid places than tournament entrants');
  const provisional=bases.map((basis,i)=>{
    // BigInt prevents floating-point cent loss for large prizes.
    const exact=BigInt(pool)*BigInt(basis);
    return {place:i+1,pct:tiers[i].pct,amount:Number(exact/10000n),
      remainder:Number(exact%10000n)};
  });
  const floorSum=provisional.reduce((s,p)=>s+p.amount,0);
  let centsLeft=pool-floorSum;
  if(!validCents(centsLeft)||centsLeft>=tiers.length)
    throw new TournamentPayoutError('Cannot reconcile prize pool rounding');
  const remainderOrder=provisional.map((p,i)=>({i,remainder:p.remainder}))
    .sort((a,b)=>b.remainder-a.remainder||a.i-b.i);
  for(let i=0;i<centsLeft;i++)provisional[remainderOrder[i].i].amount++;
  const payouts=provisional.map(({place,pct,amount})=>({place,pct,amount}));
  if(payouts.reduce((s,p)=>s+p.amount,0)!==pool)
    throw new TournamentPayoutError('Payouts do not reconcile to the prize pool');
  return {prize_pool_cents:pool,payouts};
}
