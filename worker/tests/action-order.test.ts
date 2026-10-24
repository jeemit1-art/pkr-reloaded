import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

// Directly exercise the shipped poker hand turn-order algorithm.
const js=readFileSync(new URL('../../frontend/public/hand-tracker.js',import.meta.url),'utf8');
const start=js.indexOf('function computeNextPlayer(street, actions, hand) {');
const end=js.indexOf('function loadCurrentHand()',start);
if(start<0||end<0)throw new Error('Shipped next-player function not found');

const seats=[
  {seat:1,name:'Alex'},
  {seat:2,name:'Ben'},
  {seat:3,name:'Charlie'},
];
const hand={dealer_seat:1,sb_seat:2,bb_seat:3};
const act=(display_name:string,action:string,chips:number,street='pre')=>
  ({display_name,action,chips,street});
const blinds=[
  act('Ben','post',1),
  act('Charlie','post',2),
];

function next(street:string,actions:any[],straddleSeat:null|number=null){
  const sandbox:any={
    getSeated:()=>seats,
    gameInfo:()=>({seats:3}),
    buildClockwiseOrder:()=>[1,2,3],
    blindsInChips:()=>({sb:1,bb:2}),
    hs:{straddleSeat},
  };
  runInNewContext(js.slice(start,end)+'\nthis.next=computeNextPlayer;',sandbox);
  return sandbox.next(street,actions,hand) as string|null;
}

describe('live action-order progression',()=>{
  it('starts pre-flop with UTG, followed by small blind and big blind',()=>{
    expect(next('pre',blinds)).toBe('Alex');
    expect(next('pre',[...blinds,act('Alex','call',2)])).toBe('Ben');
    expect(next('pre',[...blinds,act('Alex','call',2),act('Ben','call',1)])).toBe('Charlie');
  });

  it('finishes the street when big blind checks after other players call',()=>{
    const acts=[
      ...blinds,
      act('Alex','call',2),
      act('Ben','call',1),
      act('Charlie','check',0),
    ];
    expect(next('pre',acts)).toBeNull();
  });

  it('requires each player behind a raise to respond, then ends the street',()=>{
    const raised=[...blinds,act('Alex','raise',6)];
    expect(next('pre',raised)).toBe('Ben');
    expect(next('pre',[...raised,act('Ben','call',5)])).toBe('Charlie');
    expect(next('pre',[...raised,act('Ben','call',5),act('Charlie','call',4)])).toBeNull();
  });

  it('does not loop on the big blind after a raise and check sequence',()=>{
    const acts=[
      ...blinds, act('Alex','call',2), act('Ben','call',1),
      act('Charlie','check',0),
    ];
    for(let i=0;i<10;i++) expect(next('pre',acts)).toBeNull();
  });

  it('starts post-flop with the first active seat left of dealer',()=>{
    expect(next('flop',[])).toBe('Ben');
    const acts=[act('Ben','check',0,'flop'),act('Charlie','check',0,'flop')];
    expect(next('flop',acts)).toBe('Alex');
    expect(next('flop',[...acts,act('Alex','check',0,'flop')])).toBeNull();
  });

  it('ends the action when the live straddle checks their option',()=>{
    const acts=[
      ...blinds,
      act('Alex','straddle',4),
      act('Ben','call',3),
      act('Charlie','call',2),
      act('Alex','check',0),
    ];
    expect(next('pre',acts,1)).toBeNull();
  });
});
