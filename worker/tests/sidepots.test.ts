import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

// Exercise the actual shipped browser functions instead of a copied algorithm.
// The extracted functions are pure, so the sandbox has no browser, network,
// permissions, or access to real games.
const js = readFileSync(new URL('../../frontend/public/hand-tracker.js', import.meta.url), 'utf8');
const mainStart = js.indexOf('function calculateSidePots(actions,seated){');
const mainEnd = js.indexOf('// --- DEALER CHIP ON FELT', mainStart);
const secondStart = js.indexOf('function computeSidePots(actions, seated) {');
const secondEnd = js.indexOf('function renderSidePots(body, actions, seated) {', secondStart);
if ([mainStart,mainEnd,secondStart,secondEnd].some(x=>x<0)) {
  throw new Error('Cannot locate the exact shipped side-pot functions');
}
const sandbox:any = {};
runInNewContext(
  js.slice(mainStart,mainEnd) + '\n' + js.slice(secondStart,secondEnd)
  + '\nthis.winnerPots=calculateSidePots;this.displayPots=computeSidePots;',
  sandbox,
);
const calc = (actions:any[],seated:any[]) =>
  JSON.parse(JSON.stringify(sandbox.winnerPots(actions,seated))) as Array<{chips:number;eligible:string[];label:string}>;
const displayed = (actions:any[],seated:any[]) =>
  JSON.parse(JSON.stringify(sandbox.displayPots(actions,seated))) as Array<{chips:number;eligible:string[];label:string}>;
const seat = (...names:string[]) => names.map(name=>({name}));
const act = (display_name:string, action:string, chips:number) => ({display_name,action,chips,street:'pre'});

describe('live hand tracking: one accurate side-pot model',()=>{
  it('shows no side-pot breakdown if no player is all-in',()=>{
    expect(calc([act('Alex','bet',40),act('Ben','call',40)],seat('Alex','Ben'))).toEqual([]);
  });

  it('counts folded player chips as dead money but excludes the folder from eligibility',()=>{
    const seated=seat('Alex','Ben','Charlie','Dylan');
    const actions=[
      act('Alex','allin',50),
      act('Ben','call',100),
      act('Charlie','call',100),
      act('Dylan','call',100),
      act('Dylan','fold',0),
    ];
    const pots=calc(actions,seated);
    expect(pots).toEqual([
      {chips:200,eligible:['Alex','Ben','Charlie'],level:50,label:'Main Pot'},
      {chips:150,eligible:['Ben','Charlie'],level:100,label:'Side Pot 1'},
    ]);
    expect(displayed(actions,seated)).toEqual(pots);
    expect(pots.reduce((s,p)=>s+p.chips,0)).toBe(350);
  });

  it('allocates multi-level all-ins exactly, including dead money',()=>{
    const seated=seat('A','B','C','D');
    const actions=[
      act('A','allin',50),
      act('B','allin',100),
      act('C','allin',150),
      act('D','call',150),
      act('D','fold',0),
    ];
    const pots=calc(actions,seated);
    expect(pots.map(p=>p.chips)).toEqual([200,150,100]);
    expect(pots.map(p=>p.eligible)).toEqual([['A','B','C'],['B','C'],['C']]);
    expect(displayed(actions,seated)).toEqual(pots);
  });

  it('conserves every contributed chip for deterministic random all-in tables',()=>{
    let seed=20261024;
    const rnd=()=>((seed=(Math.imul(seed,1664525)+1013904223)>>>0)/2**32);
    for(let i=0;i<200;i++){
      const names=['P1','P2','P3','P4','P5'];
      const seated=seat(...names);
      const amounts=names.map(()=>1+Math.floor(rnd()*100));
      const actions=names.map((name,j)=>act(name,j<2?'allin':'call',amounts[j]));
      names.forEach((name,j)=>{
        if(j>1&&rnd()>.5)actions.push(act(name,'fold',0));
      });
      const pots=calc(actions,seated);
      const sum=amounts.reduce((a,b)=>a+b,0);
      expect(pots.reduce((a,p)=>a+p.chips,0)).toBe(sum);
      expect(displayed(actions,seated)).toEqual(pots);
      pots.forEach(p=>expect(p.chips).toBeGreaterThan(0));
    }
  });
});
