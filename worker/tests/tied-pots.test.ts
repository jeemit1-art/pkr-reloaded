import {describe,expect,it} from 'vitest';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';

// Test the exact calculator shipped in the browser, not a forked copy.
const source=readFileSync(new URL('../../frontend/public/hand-tracker.js',import.meta.url),'utf8');
const begin=source.indexOf('function distributeTiedShares(');
const end=source.indexOf('// --- DEALER CHIP ON FELT ---',begin);
if(begin<0||end<=begin)throw Error('Live tied-pot function not found');
const sandbox:any={
  buildClockwiseOrder:(_seats:number)=>[1,4,3,2],
};
runInNewContext(source.slice(begin,end)+'\nthis.calc=distributeTiedShares;',sandbox);
const calc=(pot:any,winners:string[],roster:any[])=>JSON.parse(JSON.stringify(
  sandbox.calc(pot,winners,roster,1,4),
)) as any;
const seated=[
  {name:'Dealer',seat:1},{name:'Left',seat:4},
  {name:'Right',seat:2},{name:'Middle',seat:3},
];
describe('live browser tied pot allocation',()=>{
  it('returns the odd chip clockwise from the button',()=>{
    const pot={chips:101,eligible:['Dealer','Right','Left']};
    expect(calc(pot,['Dealer','Right'],seated)).toEqual([
      {winnerName:'Right',chips:51},{winnerName:'Dealer',chips:50},
    ]);
  });
  it('conserves every chip with three-way ties',()=>{
    const pot={chips:7,eligible:['Dealer','Right','Left']};
    const allocations=calc(pot,['Dealer','Left','Right'],seated);
    expect(allocations).toEqual([
      {winnerName:'Left',chips:3},{winnerName:'Right',chips:2},
      {winnerName:'Dealer',chips:2},
    ]);
    expect(allocations.reduce((total:number,row:any)=>total+row.chips,0)).toBe(7);
  });
  it('refuses a folded or duplicate declared tied winner',()=>{
    const pot={chips:20,eligible:['Dealer','Right']};
    expect(calc(pot,['Dealer','Middle'],seated)).toBeNull();
    expect(calc(pot,['Dealer','Dealer'],seated)).toBeNull();
  });
});
