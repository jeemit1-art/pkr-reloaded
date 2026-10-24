import {describe,expect,it} from 'vitest';
import {calculateHandPots,distributeTiedPot,PokerPotError} from './poker-pot-accounting';
const names=(...list:string[])=>list.map((display_name,i)=>({display_name,seat_number:i+1}));
const a=(display_name:string,action:string,chips:number)=>({display_name,action,chips});
describe('integer-chip pot accounting and uncalled-bet refunds',()=>{
  it('computes an ordinary matched pot without a spurious refund',()=>{
    expect(calculateHandPots([a('A','bet',100),a('B','call',100)],names('A','B')))
      .toMatchObject({grossChips:200,contestableChips:200,uncalledReturns:[],
        pots:[{potIdx:0,chips:200,eligible:['A','B'],label:'Main Pot'}]});
  });
  it('returns an unmatched all-in tail before calculating the main pot',()=>{
    const result=calculateHandPots([
      a('A','allin',100),a('B','allin',60),
    ],names('A','B'));
    expect(result).toMatchObject({
      grossChips:160,contestableChips:120,
      uncalledReturns:[{display_name:'A',chips:40}],
      pots:[{potIdx:0,chips:120,eligible:['A','B']}],
    });
  });
  it('keeps folded dead money but excludes folders from winner eligibility',()=>{
    const result=calculateHandPots([
      a('A','allin',50),a('B','call',100),
      a('C','call',100),a('D','call',100),a('D','fold',0),
    ],names('A','B','C','D'));
    expect(result.uncalledReturns).toEqual([]);
    expect(result.pots.map(p=>[p.chips,p.eligible]))
      .toEqual([[200,['A','B','C']],[150,['B','C']]]);
    expect(result.grossChips).toBe(350);
  });
  it('returns the one excess wager rather than awarding it as a fictitious side pot',()=>{
    const result=calculateHandPots([
      a('A','allin',50),a('B','allin',100),a('C','call',150),
    ],names('A','B','C'));
    expect(result.grossChips).toBe(300);
    expect(result.uncalledReturns).toEqual([{display_name:'C',chips:50}]);
    expect(result.pots.map(p=>p.chips)).toEqual([150,100]);
  });
  it('returns the uncalled part of a winning final bet after all opponents fold',()=>{
    const result=calculateHandPots([
      a('A','post',1),a('B','post',2),
      a('A','raise',9),a('B','fold',0),
    ],names('A','B'));
    expect(result.uncalledReturns).toEqual([{display_name:'A',chips:8}]);
    expect(result.contestableChips).toBe(4);
    expect(result.pots[0].eligible).toEqual(['A']);
  });
  it('assigns odd chips clockwise from button and checks conservation',()=>{
    const seated=[
      {display_name:'Dealer',seat_number:1},
      {display_name:'Left',seat_number:4},
      {display_name:'Right',seat_number:2},
    ];
    const pot={potIdx:0,chips:5,eligible:['Left','Right','Dealer'],label:'Main Pot',level:5};
    expect(distributeTiedPot(pot,['Right','Left'],seated,1,4)).toEqual([
      {display_name:'Left',chips:3},{display_name:'Right',chips:2},
    ]);
  });
  it('distributes separate odd chips independently across side pots',()=>{
    const seated=names('A','B','C');
    const first={potIdx:0,chips:5,eligible:['A','B'],label:'Main Pot',level:5};
    const second={potIdx:1,chips:7,eligible:['B','C'],label:'Side Pot 1',level:7};
    const x=distributeTiedPot(first,['A','B'],seated,1,4);
    const y=distributeTiedPot(second,['B','C'],seated,1,4);
    expect(x.reduce((s,v)=>s+v.chips,0)).toBe(5);
    expect(y.reduce((s,v)=>s+v.chips,0)).toBe(7);
    expect(x.concat(y).reduce((s,v)=>s+v.chips,0)).toBe(12);
  });
  it('rejects duplicate winners, unseated winners and negative chip contributions',()=>{
    const seated=names('A','B');
    const pot={potIdx:0,chips:10,eligible:['A','B'],label:'Main Pot',level:10};
    expect(()=>distributeTiedPot(pot,['A','A'],seated,1,4)).toThrow(PokerPotError);
    expect(()=>distributeTiedPot(pot,['A','C'],seated,1,4)).toThrow(PokerPotError);
    expect(()=>calculateHandPots([a('A','bet',-1)],seated)).toThrow(PokerPotError);
  });
  it('conserves all chips across deterministic random all-in histories',()=>{
    let seed=20261024;
    const rnd=()=>((seed=(Math.imul(seed,1664525)+1013904223)>>>0)/2**32);
    for(let i=0;i<300;i++){
      const players=names('A','B','C','D','E');
      const acts=players.map(p=>a(p.display_name,'allin',1+Math.floor(rnd()*200)));
      // Generate a legal-looking showdown: a contributor at the maximum
      // committed level remains live to claim every possible side-pot tier.
      const top=Math.max(...acts.map(x=>x.chips));
      players.forEach((p,j)=>{if(acts[j].chips<top&&rnd()>.75)
        acts.push(a(p.display_name,'fold',0));});
      const r=calculateHandPots(acts,players);
      expect(r.contestableChips+r.uncalledReturns.reduce((s,v)=>s+v.chips,0)).toBe(r.grossChips);
      r.pots.forEach(p=>expect(p.eligible.length).toBeGreaterThan(0));
    }
  });
});
