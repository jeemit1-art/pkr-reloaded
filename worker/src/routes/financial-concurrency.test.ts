import { describe, expect, it, vi } from 'vitest';

vi.mock('../middleware', async (importOriginal) => {
  const original = await importOriginal<typeof import('../middleware')>();
  return {
    ...original,
    authMiddleware: async (c:any,next:any) => { c.set('userId','synthetic-host'); await next(); },
    requireEventRole: async () => true,
  };
});
vi.mock('../push', () => ({
  sendPushToEvent: vi.fn(async () => {}),
  sendPushToPlayer: vi.fn(async () => {}),
}));

import games from './games';

function fixture(gameStatus='active') {
  const game={id:'g',event_id:'e',status:gameStatus};
  const event={id:'e',name:'Synthetic poker',buy_in:2000};
  const player={user_id:'alex',display_name:'Alex',buy_ins:1,buy_in_total:2000,cashout:null as number|null};
  let writes=0;
  const sqls:string[]=[];
  const db={
    prepare(sql:string){
      sqls.push(sql);
      return {bind(...args:any[]){
        return {
          async first():Promise<any>{
            if(sql.includes('FROM games WHERE id=?'))return {...game};
            if(sql.includes('FROM game_players WHERE game_id=? AND user_id=?'))
              return args[1]==='alex'?{...player}:null;
            if(sql.includes('FROM events WHERE id=?'))return {...event};
            return null;
          },
          async run():Promise<any>{
            if(game.status==='settled'||game.status==='cancelled')return {meta:{changes:0}};
            if(sql.startsWith('UPDATE game_players SET buy_ins=')){
              const [count,total,gameId,userId,expectedCount,expectedTotal]=args;
              if(gameId!=='g'||userId!=='alex'||player.buy_ins!==expectedCount||
                 player.buy_in_total!==expectedTotal)return {meta:{changes:0}};
              player.buy_ins=count;player.buy_in_total=total;writes++;
              return {meta:{changes:1}};
            }
            if(sql.startsWith('UPDATE game_players SET cashout=')){
              const [cashout,gameId,userId,expectedCashout]=args;
              if(gameId!=='g'||userId!=='alex'||player.cashout!==expectedCashout)
                return {meta:{changes:0}};
              player.cashout=cashout;writes++;
              return {meta:{changes:1}};
            }
            return {meta:{changes:0}};
          },
        };
      }};
    },
  };
  const env:any={DB:db,KV:{get:async()=>null,put:async()=>{}},PKR_ENV:'staging',JWT_SECRET:'synthetic-only'};
  return {env,player,game,sqls,getWrites:()=>writes};
}
function put(body:unknown):RequestInit{
  return {method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)};
}
const execution:any={waitUntil:(_promise:Promise<unknown>)=>{}};
const buyUrl='https://fixture.invalid/games/g/buyin/alex';
const cashUrl='https://fixture.invalid/games/g/cashout/alex';

describe('atomic compare-and-swap for financial edits',()=>{
  it('allows one concurrent buy-in write and rejects the stale host',async()=>{
    const f=fixture();
    const base={expected_count:1,expected_total:2000};
    const [a,b]=await Promise.all([
      games.request(buyUrl,put({count:2,total:4000,...base}),f.env,execution),
      games.request(buyUrl,put({count:3,total:6000,...base}),f.env,execution),
    ]);
    expect([a.status,b.status].sort()).toEqual([200,409]);
    const failed=a.status===409?a:b;
    expect(await failed.json()).toMatchObject({
      code:'EDIT_CONFLICT',current:{buy_ins:f.player.buy_ins,buy_in_total:f.player.buy_in_total},
    });
    expect(f.getWrites()).toBe(1);
    expect(f.sqls.some(sql=>sql.includes('buy_ins=? AND buy_in_total=?')&&
      sql.includes('EXISTS (SELECT 1 FROM games'))).toBe(true);
  });

  it('recognises an already-applied retry without an extra write',async()=>{
    const f=fixture();
    const body={count:2,total:4000,expected_count:1,expected_total:2000};
    expect((await games.request(buyUrl,put(body),f.env,execution)).status).toBe(200);
    const retry=await games.request(buyUrl,put(body),f.env,execution);
    expect(retry.status).toBe(200);
    expect(await retry.json()).toMatchObject({ok:true,already_applied:true});
    expect(f.getWrites()).toBe(1);
  });

  it('uses null-safe cash-out guards and rejects the second editor',async()=>{
    const f=fixture();
    const a=await games.request(cashUrl,put({cashout:3000,expected_cashout:null}),f.env,execution);
    const b=await games.request(cashUrl,put({cashout:4000,expected_cashout:null}),f.env,execution);
    expect(a.status).toBe(200);
    expect(b.status).toBe(409);
    expect(await b.json()).toMatchObject({code:'EDIT_CONFLICT',current:{cashout:3000}});
    expect(f.player.cashout).toBe(3000);
    expect(f.getWrites()).toBe(1);
    expect(f.sqls.some(sql=>sql.includes('cashout IS ?'))).toBe(true);
  });

  it('supports a deliberate null cash-out correction',async()=>{
    const f=fixture();
    expect((await games.request(cashUrl,put({cashout:3000,expected_cashout:null}),f.env,execution)).status).toBe(200);
    expect((await games.request(cashUrl,put({cashout:null,expected_cashout:3000}),f.env,execution)).status).toBe(200);
    expect(f.player.cashout).toBeNull();
  });

  it('requires prior values and integer cents',async()=>{
    const f=fixture();
    expect((await games.request(buyUrl,put({count:2,total:4000}),f.env,execution)).status).toBe(428);
    expect((await games.request(cashUrl,put({cashout:3000}),f.env,execution)).status).toBe(428);
    expect((await games.request(buyUrl,put({count:2,total:1.5,expected_count:1,expected_total:2000}),f.env,execution)).status).toBe(400);
    expect(f.getWrites()).toBe(0);
  });

  it('rejects money edits after a game has settled',async()=>{
    const f=fixture('settled');
    expect((await games.request(cashUrl,put({cashout:3000,expected_cashout:null}),f.env,execution)).status).toBe(409);
    expect(f.getWrites()).toBe(0);
  });
});
