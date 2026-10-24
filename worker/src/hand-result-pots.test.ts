import { describe, expect, it } from 'vitest';
import { HandResultError, serializeHandCards, revealHandPotAllocations } from './hand-result-pots';

const winningPots = [
  {potIdx:0, winnerName:'Alex', chips:200, label:'Main Pot'},
  {potIdx:1, winnerName:'Charlie', chips:150, label:'Side Pot 1'},
];
const cards={Alex:['A♠','A♥'],Charlie:['K♣','K♥']};

describe('hand result pot winner persistence',()=>{
  it('stores all pot winners with the hole cards without new D1 columns',()=>{
    const saved=serializeHandCards(cards,winningPots,350);
    expect(saved).toContain('Main Pot');
    const revealed=revealHandPotAllocations({id:'result',hole_cards:saved,winner_name:'Alex, Charlie'}) as {
      hole_cards:string;pot_winners?:typeof winningPots;
    };
    expect(revealed.pot_winners).toEqual(winningPots);
    expect(JSON.parse(revealed.hole_cards)).toEqual(cards);
    expect(cards).toEqual({Alex:['A♠','A♥'],Charlie:['K♣','K♥']});
  });

  it('preserves the exact legacy single-winner format',()=>{
    const saved=serializeHandCards(cards,undefined,350);
    expect(saved).toBe(JSON.stringify(cards));
    const row={id:'old-result',hole_cards:saved,winner_name:'Alex'};
    expect(revealHandPotAllocations(row)).toEqual(row);
  });

  it('cannot save missing chips, duplicate indexes or unbalanced allocations',()=>{
    const bad=[
      {pots:winningPots,total:349},
      {pots:winningPots,total:351},
      {pots:[winningPots[0],{...winningPots[1],potIdx:0}],total:350},
      {pots:[winningPots[0],{...winningPots[1],potIdx:3}],total:350},
      {pots:[winningPots[0],{...winningPots[1],chips:-1}],total:199},
      {pots:[winningPots[0],{...winningPots[1],winnerName:''}],total:350},
      {pots:[],total:0},
    ];
    bad.forEach(({pots,total})=>{
      expect(()=>serializeHandCards(cards,pots,total)).toThrow(HandResultError);
    });
  });

  it('rejects metadata overwrite attempts from client-provided hole cards',()=>{
    const raw={'__pkr_hand_pot_allocations_v1':'untrusted'};
    expect(()=>serializeHandCards(raw,winningPots,350)).toThrow(/Reserved/);
  });

  it('continues to read historical records with imperfect or null hole card data',()=>{
    expect(revealHandPotAllocations({hole_cards:'{bad json'})).toEqual({hole_cards:'{bad json'});
    expect(revealHandPotAllocations(null)).toBeNull();
    expect(serializeHandCards(null,undefined,0)).toBe('{}');
  });
});
