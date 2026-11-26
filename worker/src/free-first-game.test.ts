import {describe,it,expect} from 'vitest';
import {freeFirstGameEligible,getPlanStatus} from './middleware';

function mockDb(opts:{claimed?:boolean;history?:boolean;plan?:string;sub?:string|null;
  expires?:number|null}={}){
  const statements:string[]=[];
  const db={
    prepare(sql:string){
      statements.push(sql);
      return {bind(..._args:unknown[]){
        return {async first(){
          if(sql.includes('FROM users WHERE id='))return {
            plan:opts.plan||'trial',trial_started_at:1800000000,
            plan_expires_at:opts.expires||null,stripe_subscription_id:opts.sub||null
          };
          if(sql.includes('FROM host_free_first_games'))return opts.claimed?{game_id:'g1'}:null;
          if(sql.includes('FROM games g JOIN events e'))return opts.history?{id:'historic'}:null;
          return null;
        },async run(){return {meta:{changes:1}};}};
      }};
    },
  } as unknown as D1Database;
  return {db,statements};
}
describe('free first game: opt-in only, one-time and non-Stripe',()=>{
 it('never reads the optional D1 table when disabled',async()=>{
   const f=mockDb();
   expect(await freeFirstGameEligible(f.db,'member',false)).toBe(false);
   expect(f.statements).toEqual([]);
   const status=await getPlanStatus(f.db,'member',false);
   expect(status.is_active).toBe(false);
   expect(f.statements.some(sql=>sql.includes('host_free_first_games'))).toBe(false);
 });
 it('permits only a host with no game history and no prior free claim',async()=>{
   const first=mockDb();
   expect(await freeFirstGameEligible(first.db,'new-host',true)).toBe(true);
   expect((await getPlanStatus(first.db,'new-host',true)).free_game_available).toBe(true);
   expect((await getPlanStatus(first.db,'new-host',true)).max_seats).toBe(9);
   expect(await freeFirstGameEligible(mockDb({claimed:true}).db,'owner',true)).toBe(false);
   expect(await freeFirstGameEligible(mockDb({history:true}).db,'owner',true)).toBe(false);
 });
 it('never replaces a verified paid subscription with a free offer',async()=>{
   const f=mockDb({plan:'pro',sub:'sub_test',expires:Math.floor(Date.now()/1000)+99999});
   const status=await getPlanStatus(f.db,'paid',true);
   expect(status.plan).toBe('pro');
   expect(status.is_active).toBe(true);
   expect(status.free_game_available).toBe(false);
   expect(f.statements.some(sql=>sql.includes('host_free_first_games'))).toBe(false);
 });
});
