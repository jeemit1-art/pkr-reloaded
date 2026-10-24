import {describe,expect,it,vi} from 'vitest';
vi.mock('../middleware',async(importOriginal)=>{
  const old=await importOriginal<typeof import('../middleware')>();
  return {...old,authMiddleware:async(c:any,next:any)=>{
    c.set('userId','test-host');await next();
  },requireEventRole:async()=>true};
});
vi.mock('../push',()=>({
  sendPushToEvent:vi.fn(async()=>{}),
  sendPushToPlayer:vi.fn(async()=>{}),
}));
import games from './games';

const buy='https://fixture.invalid/games/g/buyin/alex';
const cash='https://fixture.invalid/games/g/cashout/alex';
const put=(value:any):RequestInit=>({
  method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify(value),
});
const exec:any={waitUntil:(_p:Promise<unknown>)=>{}};
function fixture(enabled=true){
  const game={id:'g',event_id:'e',status:'active'};
  const player={user_id:'alex',display_name:'Alex',seat_number:1,
    buy_ins:1,buy_in_total:2000,cashout:null as null|number};
  let revision=0,writes=0;
  const sqls:string[]=[];
  const db={prepare(sql:string){
    sqls.push(sql);
    return {bind(...args:any[]){
      return {
        async first():Promise<any>{
          if(sql.includes('SELECT revision FROM game_player_revisions'))
            return {revision};
          if(sql.includes('FROM games WHERE id=?'))return {...game};
          if(sql.includes('FROM game_players WHERE game_id=? AND user_id=?'))
            return {...player};
          if(sql.includes('FROM events WHERE id=?'))return {name:'Synthetic game'};
          return null;
        },
        async all():Promise<any>{
          if(sql.includes('FROM game_players gp')){
            return {results:[{...player,revision}]};
          }
          if(sql.includes('FROM game_players WHERE game_id=? ORDER BY'))
            return {results:[{...player}]};
          return {results:[]};
        },
        async run():Promise<any>{
          const stmt=sql.trimStart();
          const isBuy=stmt.startsWith('UPDATE game_players SET buy_ins=');
          const isCash=stmt.startsWith('UPDATE game_players SET cashout=');
          if(!isBuy&&!isCash)throw Error('Unexpected financial mutation');
          const guarded=sql.includes('game_player_revisions');
          if(enabled&&!guarded)throw Error('Revision mode bypassed audit guard');
          if(!enabled&&guarded)throw Error('Disabled mode queried migration tables');
          if(isBuy){
            const [count,total,gameId,userId,oldCount,oldTotal]=args;
            if(gameId!=='g'||userId!=='alex'||player.buy_ins!==oldCount||
               player.buy_in_total!==oldTotal ||
               (guarded&&args[args.length-1]!==revision))
              return {meta:{changes:0}};
            const changed=player.buy_ins!==count||player.buy_in_total!==total;
            player.buy_ins=count;player.buy_in_total=total;
            if(changed){revision++;writes++;}
            return {meta:{changes:1}};
          }
          const [amount,gameId,userId,original]=args;
          if(gameId!=='g'||userId!=='alex'||player.cashout!==original||
             (guarded&&args[args.length-1]!==revision))
            return {meta:{changes:0}};
          const changed=player.cashout!==amount;
          player.cashout=amount;
          if(changed){revision++;writes++;}
          return {meta:{changes:1}};
        },
      };
    }};
  }};
  return {env:{DB:db,JWT_SECRET:'test',PKR_ENV:'staging',
    ...(enabled?{PKR_INTEGRITY_REVISIONS:'1'}:{})} as any,
    player,game,sqls,getRevision:()=>revision,getWrites:()=>writes};
}
const original={expected_count:1,expected_total:2000};
describe('optional player revision CAS',()=>{
  it('rejects missing revision when the guarded mode is on',async()=>{
    const f=fixture();
    const res=await games.request(buy,put({count:2,total:4000,...original}),f.env,exec);
    expect(res.status).toBe(428);
    expect(f.getWrites()).toBe(0);
  });
  it('rejects ABA even after another host restores the exact original amounts',async()=>{
    const f=fixture();
    const first=await games.request(buy,put({
      count:2,total:4000,...original,expected_revision:0,
    }),f.env,exec);
    expect(first.status).toBe(200);
    expect(await first.json()).toMatchObject({revision:1});
    const revert=await games.request(buy,put({
      count:1,total:2000,expected_count:2,expected_total:4000,
      expected_revision:1,
    }),f.env,exec);
    expect(revert.status).toBe(200);
    expect(await revert.json()).toMatchObject({revision:2});
    const stale=await games.request(buy,put({
      count:2,total:4000,...original,expected_revision:0,
    }),f.env,exec);
    expect(stale.status).toBe(409);
    expect(await stale.json()).toMatchObject({
      code:'EDIT_CONFLICT',current:{buy_ins:1,buy_in_total:2000,revision:2},
    });
    expect(f.getRevision()).toBe(2);
    expect(f.getWrites()).toBe(2);
  });
  it('requires the latest revision for cash-outs even when the recorded value is null',async()=>{
    const f=fixture();
    expect((await games.request(cash,put({
      cashout:3500,expected_cashout:null,expected_revision:0,
    }),f.env,exec)).status).toBe(200);
    const stale=await games.request(cash,put({
      cashout:3500,expected_cashout:null,expected_revision:0,
    }),f.env,exec);
    expect(stale.status).toBe(409);
    expect(await stale.json()).toMatchObject({
      code:'EDIT_CONFLICT',current:{cashout:3500,revision:1},
    });
    expect(f.getWrites()).toBe(1);
  });
  it('does not silently ignore a revision supplied to an unmigrated environment',async()=>{
    const f=fixture(false);
    const r=await games.request(buy,put({
      count:2,total:4000,...original,expected_revision:0,
    }),f.env,exec);
    expect(r.status).toBe(503);
    expect(await r.json()).toMatchObject({code:'REVISION_UNAVAILABLE'});
    expect(f.getWrites()).toBe(0);
    expect(f.sqls.every(s=>!s.includes('game_player_revisions'))).toBe(true);
  });
});
