import {describe,it,expect} from 'vitest';
import {validDateOptions,validLeaguePoints,scoreSeasonRows} from './club-planning-utils';

describe('private club planning input validation',()=>{
 const base=1800000000;
 it('accepts only 2–5 distinct future date options and sorts without changing time',()=>{
   expect(validDateOptions([base+86400*2,base+86400],base))
     .toEqual([base+86400,base+86400*2]);
   for(const x of [[base+86400],[base+86400,base+86400],
      [base+1,base+86400],[base+86400,'next Friday'],
      Array.from({length:6},(_,i)=>base+86400*(i+1))]){
     expect(validDateOptions(x,base)).toBeNull();
   }
 });
 it('rejects negative, non-integer or illogical league points',()=>{
   expect(validLeaguePoints({first:10,second:7,third:5,other:1}))
     .toEqual({first:10,second:7,third:5,other:1});
   for(const x of [{first:3,second:8,third:1,other:1},
      {first:10,second:7,third:5,other:-1},
      {first:10.5,second:7,third:5,other:1},
      {first:10,second:7,third:5,other:'1'}])expect(validLeaguePoints(x)).toBeNull();
 });
});

describe('league points derive only from settled source rows',()=>{
 const scale={first:10,second:7,third:5,other:1};
 const rows=[
   {game_id:'a',user_id:'one',net:1000},
   {game_id:'a',user_id:'two',net:300},
   {game_id:'a',user_id:'three',net:300},
   {game_id:'a',user_id:'four',net:-1600},
   {game_id:'b',user_id:'one',net:-200},
   {game_id:'b',user_id:'two',net:200},
 ];
 it('shares second place for a tie and does not award third place to fourth',()=>{
   const source=JSON.stringify(rows);
   const result=scoreSeasonRows(rows,scale);
   expect(result.countedGames).toBe(2);
   expect(result.scoreOf('a','one')).toEqual({score:10,place:1});
   expect(result.scoreOf('a','two')).toEqual({score:7,place:2});
   expect(result.scoreOf('a','three')).toEqual({score:7,place:2});
   expect(result.scoreOf('a','four')).toEqual({score:1,place:4});
   expect(result.scoreOf('b','two')).toEqual({score:10,place:1});
   expect(result.scoreOf('b','one')).toEqual({score:7,place:2});
   expect(JSON.stringify(rows)).toEqual(source);
 });
 it('rejects duplicate source results instead of double-awarding points',()=>{
   expect(()=>scoreSeasonRows([rows[0],rows[0]],scale)).toThrow('Duplicate');
   expect(()=>scoreSeasonRows([{game_id:'a',user_id:'x',net:NaN}],scale))
     .toThrow('Invalid');
 });
 it('returns no ranking or money for a missing record',()=>{
   const result=scoreSeasonRows([],scale);
   expect(result.scoreOf('x','unknown')).toBeNull();
   expect(result.countedGames).toBe(0);
 });
});
