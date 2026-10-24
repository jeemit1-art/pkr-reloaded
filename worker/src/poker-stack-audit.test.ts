import {describe,expect,it} from 'vitest';
import {auditHandStacks,StackAuditError} from './poker-stack-audit';
const opening=[
  {display_name:'Alex',seat_number:1,opening_chips:100},
  {display_name:'Ben',seat_number:2,opening_chips:60},
];
const move=(display_name:string,action:string,chips:number)=>
  ({display_name,action,chips});
describe('verified chip-stack audit (no inferred balances)',()=>{
  it('tracks a hand before a winner has been declared',()=>{
    const r=auditHandStacks(opening,[move('Alex','bet',20),move('Ben','call',20)],null,1,4);
    expect(r).toMatchObject({opening_total:160,recorded_pot_chips:40,
      unsettled_pot_chips:40,closing_total:120});
    expect(r.stacks.map(p=>p.closing_chips)).toEqual([80,40]);
  });
  it('correctly returns uncalled all-in chips and conserves both player stacks',()=>{
    const r=auditHandStacks(opening,[
      move('Alex','allin',100),move('Ben','allin',60),
    ],{
      pot_winners:[{potIdx:0,winnerName:'Ben',chips:120,label:'Main Pot'}],
      uncalled_returns:[{display_name:'Alex',chips:40}],
    },1,4);
    expect(r.stacks.map(p=>p.closing_chips)).toEqual([40,120]);
    expect(r.closing_total).toBe(160);
    expect(r.unsettled_pot_chips).toBe(0);
  });
  it('rejects unverified wagers exceeding a stack or a false all-in',()=>{
    expect(()=>auditHandStacks(opening,[move('Ben','bet',61)],null,1,4))
      .toThrow(/exceeds verified/);
    expect(()=>auditHandStacks(opening,[move('Alex','allin',40)],null,1,4))
      .toThrow(/entire remaining/);
  });
  it('rejects fictional winner credits and missing uncalled returns',()=>{
    const actions=[move('Alex','allin',100),move('Ben','allin',60)];
    expect(()=>auditHandStacks(opening,actions,{
      pot_winners:[{potIdx:0,winnerName:'Alex',chips:160,label:'Main Pot'}],
    },1,4)).toThrow(/refunds/);
  });
  it('validates odd-chip ties after a verified stack snapshot',()=>{
    const roster=[
      {display_name:'A',seat_number:1,opening_chips:50},
      {display_name:'B',seat_number:2,opening_chips:50},
      {display_name:'C',seat_number:3,opening_chips:1},
    ];
    const actions=[move('A','allin',50),move('B','allin',50),
      move('C','post',1),move('C','fold',0)];
    const result={pot_winners:[{potIdx:0,winnerName:'A, B',chips:101,label:'Main Pot',
      split_winners:[{winnerName:'B',chips:51},{winnerName:'A',chips:50}]}],
      uncalled_returns:[]};
    const r=auditHandStacks(roster,actions,result,1,4);
    expect(r.closing_total).toBe(101);
    expect(r.stacks.map(p=>p.closing_chips)).toEqual([50,51,0]);
    expect(()=>auditHandStacks(roster,actions,{
      ...result,pot_winners:[{...result.pot_winners[0],
        split_winners:[{winnerName:'A',chips:51},{winnerName:'B',chips:50}]}],
    },1,4)).toThrow(/odd chip/);
  });
  it('does not accept missing or ambiguous stack identities',()=>{
    expect(()=>auditHandStacks([{...opening[0]}, {...opening[0]}],[],null,1,4))
      .toThrow(StackAuditError);
  });
});
