import {describe,expect,it,vi} from 'vitest';
vi.mock('../middleware',async(importOriginal)=>{
  const m=await importOriginal<typeof import('../middleware')>();
  return {...m,authMiddleware:async(c:any,next:any)=>{
    c.set('userId','synthetic-host');await next();
  },requireEventRole:async()=>true};
});
vi.mock('../push',()=>({
  sendPushToEvent:vi.fn(async()=>{}),sendPushToPlayer:vi.fn(async()=>{}),
}));
import games from './games';

function fixture(options:{status?:string;financial?:boolean;hands?:boolean;
  tournament?:boolean;settlement?:boolean}={}){
  const game={id:'g',event_id:'e',status:options.status||'scheduled'};
  let deleted=0;
  const db={prepare(sql:string){return {bind(...args:any[]){
    return {
      async first():Promise<any>{
        if(sql.includes('FROM games WHERE id=?'))return {...game};
        return null;
      },
      async run():Promise<any>{
        if(!sql.trimStart().startsWith('DELETE FROM games'))
          throw Error('Unexpected game deletion route write');
        for(const clause of [
          "status IN ('scheduled','lobby','cancelled')",
          'NOT EXISTS (SELECT 1 FROM hands',
          'NOT EXISTS (SELECT 1 FROM settlements',
          'NOT EXISTS (SELECT 1 FROM settlement_transfers',
          'NOT EXISTS (SELECT 1 FROM tournament_state',
          'NOT EXISTS (SELECT 1 FROM tournament_rebuys',
          'NOT EXISTS (SELECT 1 FROM tournament_eliminations',
          'buy_ins>0','buy_in_total>0','cashout IS NOT NULL',
        ])expect(sql).toContain(clause);
        expect(args).toEqual(Array(8).fill('g'));
        if(!['scheduled','lobby','cancelled'].includes(game.status)||
           options.financial||options.hands||options.tournament||options.settlement)
          return {meta:{changes:0}};
        deleted++;return {meta:{changes:1}};
      },
    };
  }};}};
  return {env:{DB:db,JWT_SECRET:'test',PKR_ENV:'staging'} as any,
    getDeletes:()=>deleted};
}
const url='https://fixture.invalid/games/g';
const req={method:'DELETE'};
const ex:any={waitUntil:(_:Promise<unknown>)=>{}};
describe('history-safe permanent game deletion',()=>{
  it('deletes an unused scheduled game',async()=>{
    const f=fixture();
    const res=await games.request(url,req,f.env,ex);
    expect(res.status).toBe(200);
    expect(f.getDeletes()).toBe(1);
  });
  it('refuses deleting active or settled games',async()=>{
    for(const status of ['active','settled']){
      const f=fixture({status});
      const res=await games.request(url,req,f.env,ex);
      expect(res.status).toBe(409);
      expect(await res.json()).toMatchObject({code:'GAME_HAS_HISTORY'});
      expect(f.getDeletes()).toBe(0);
    }
  });
  it('preserves cancelled games whenever money, hands or tournament activity exists',async()=>{
    for(const issue of [
      {financial:true},{hands:true},{tournament:true},{settlement:true},
    ]){
      const f=fixture({status:'cancelled',...issue});
      const res=await games.request(url,req,f.env,ex);
      expect(res.status).toBe(409);
      expect(f.getDeletes()).toBe(0);
    }
  });
});
