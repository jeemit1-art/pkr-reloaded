import {describe,it,expect} from 'vitest';
import {splitCents,validatedTournamentPreset,csvCell,csvRows} from './club-extras-utils';

describe('separate optional shared expenses',()=>{
 it('splits whole cents exactly with deterministic remainder and no float pennies',()=>{
   const shares=splitCents(1001,['member-c','member-a','member-b']);
   expect(shares).toEqual([
     {user_id:'member-a',share_cents:334},
     {user_id:'member-b',share_cents:334},
     {user_id:'member-c',share_cents:333},
   ]);
   expect(shares.reduce((n,x)=>n+x.share_cents,0)).toBe(1001);
 });
 it('rejects unsafe participants, duplicate members or invalid amounts',()=>{
   for(const ids of [['same','same'],['only-one'],[],Array.from({length:16},(_,i)=>String(i))]){
     expect(()=>splitCents(1000,ids)).toThrow();
   }
   for(const value of [0,-1,1.5,NaN,Infinity,5000001])
     expect(()=>splitCents(value,['a','b'])).toThrow();
 });
});
describe('reusable tournament configurations',()=>{
 const config={
   format:'tournament',starting_chips:10000,buy_in_amount:2000,
   rebuy_allowed:false,rebuy_levels:4,addon_allowed:false,addon_chips:0,
   payout_structure:[{place:1,pct:50},{place:2,pct:30},{place:3,pct:20}],
   levels:[{level_num:1,small_blind:25,big_blind:50,ante:0,duration_secs:900,is_break:false}],
 };
 it('accepts a valid complete structure without modifying source',()=>{
   const copy=JSON.stringify(config);
   expect(validatedTournamentPreset(config)).toEqual(config);
   expect(JSON.stringify(config)).toBe(copy);
 });
 it('rejects malformed blind levels, payouts and illegal chip amounts',()=>{
   for(const changed of [
     {starting_chips:0},{format:'cash'},{rebuy_levels:0},
     {payout_structure:[{place:1,pct:55},{place:2,pct:40}]},
     {levels:[{...config.levels[0],level_num:2}]},
     {levels:[{...config.levels[0],big_blind:25}]},
     {addon_allowed:true},
   ])expect(validatedTournamentPreset({...config,...changed})).toBeNull();
 });
});
describe('private history CSV formatting',()=>{
 it('escapes spreadsheet formulas and quote/newline attacks',()=>{
   expect(csvCell('=HYPERLINK("https://invalid")')).toMatch(/^"'=/);
   expect(csvCell(' +SUM(A1:A2)')).toMatch(/^"'/);
   expect(csvCell('safe"club\nnight')).toBe('"safe""club night"');
   expect(csvRows([{name:'@malicious',amount:0}],['name','amount']))
     .toContain('"\'@malicious"');
 });
});
