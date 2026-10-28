import {describe,it,expect} from 'vitest';
import {nextTournamentBoundary} from './tournament-clock';

describe('scheduled tournament clock',()=>{
  const current={status:'running',start:1000,duration:900,gameStatus:'active'};
  it('advances at the exact boundary and does not consume cron drift',()=>{
    expect(nextTournamentBoundary(current,1899)).toBe(null);
    expect(nextTournamentBoundary(current,1900)).toBe(1900);
    expect(nextTournamentBoundary(current,1960)).toBe(1900);
  });
  it('never advances paused, closed, missing or invalid levels',()=>{
    expect(nextTournamentBoundary({...current,status:'paused'},2000)).toBe(null);
    expect(nextTournamentBoundary({...current,gameStatus:'settled'},2000)).toBe(null);
    expect(nextTournamentBoundary({...current,gameStatus:'cancelled'},2000)).toBe(null);
    expect(nextTournamentBoundary({...current,start:null},2000)).toBe(null);
    expect(nextTournamentBoundary({...current,duration:0},2000)).toBe(null);
  });
});
