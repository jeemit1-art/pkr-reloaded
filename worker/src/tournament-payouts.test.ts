import {describe,expect,it} from 'vitest';
import {calculateTournamentPayouts,TournamentPayoutError} from './tournament-payouts';
const tiers=[{place:1,pct:50},{place:2,pct:30},{place:3,pct:20}];
describe('server-authoritative tournament prizes',()=>{
  it('includes rebuy and add-on receipts, not guessed rebuy counts',()=>{
    const result=calculateTournamentPayouts(3,2000,[2000,500],tiers);
    expect(result.prize_pool_cents).toBe(8500);
    expect(result.payouts.map(x=>x.amount)).toEqual([4250,2550,1700]);
  });
  it('distributes odd cents without losing or inventing prize money',()=>{
    const result=calculateTournamentPayouts(3,1,[],tiers);
    expect(result.payouts.map(x=>x.amount)).toEqual([1,1,1]);
    expect(result.payouts.reduce((s,x)=>s+x.amount,0)).toBe(3);
  });
  it('rejects invalid payout structures or too few entrants',()=>{
    expect(()=>calculateTournamentPayouts(2,100,[],tiers))
      .toThrow(/more paid places/);
    expect(()=>calculateTournamentPayouts(3,100,[],[
      {place:1,pct:50},{place:2,pct:50},{place:3,pct:10},
    ])).toThrow(/exactly 100/);
    expect(()=>calculateTournamentPayouts(3,100,[],[
      {place:1,pct:60},{place:3,pct:40},
    ])).toThrow(/sequential/);
  });
  it('conserves every cent across many deterministic small prize pools',()=>{
    for(let pool=0;pool<=500;pool++){
      const result=calculateTournamentPayouts(3,pool,[],tiers);
      expect(result.payouts.reduce((s,p)=>s+p.amount,0)).toBe(pool*3);
      result.payouts.forEach(x=>expect(Number.isSafeInteger(x.amount)).toBe(true));
    }
  });
  it('rejects non-integer or overflowed payments',()=>{
    expect(()=>calculateTournamentPayouts(3,20,[0.5],tiers)).toThrow(TournamentPayoutError);
    expect(()=>calculateTournamentPayouts(3,Number.MAX_SAFE_INTEGER,[],tiers))
      .toThrow(/exceeds/);
  });
});
