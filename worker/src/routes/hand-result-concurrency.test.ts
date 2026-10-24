import {describe,expect,it,vi} from 'vitest';

vi.mock('../middleware',async(importOriginal)=>{
  const original=await importOriginal<typeof import('../middleware')>();
  return {...original,
    authMiddleware:async(c:any,next:any)=>{c.set('userId','synthetic-host');await next();},
    requireEventRole:async()=>true};
});
import hands from './hands';

function fixture(options?:{potChange?:boolean;closeOnInsert?:boolean}){
  const game={id:'g',event_id:'e',status:'active'};
  const hand={id:'h',game_id:'g',hand_no:1,pot_chips:200,voided:0,board:'[]'};
  let saved:any=null,writes=0;
  const sqls:string[]=[];
  const db={
    prepare(sql:string){
      sqls.push(sql);
      return {bind(...args:any[]){
        return {
          async first():Promise<any>{
            if(sql.includes('FROM games WHERE id=?'))return {...game};
            if(sql.includes('SELECT id FROM hands WHERE id=? AND game_id=?'))return {id:hand.id};
            if(sql.includes('SELECT * FROM hands WHERE id=? AND game_id=?'))return {...hand};
            if(sql.includes('FROM hand_results WHERE hand_id=?'))return saved?{...saved}:null;
            return null;
          },
          async run():Promise<any>{
            if(!sql.trimStart().startsWith('INSERT INTO hand_results'))return {meta:{changes:0}};
            if(options?.potChange)hand.pot_chips++;
            if(options?.closeOnInsert)game.status='settled';
            const [id,handId,gameId,userId,winner,pot,cards,split,
              expectedHand,expectedGame,expectedPot,statusGame]=args;
            if(saved || game.status!=='active' || hand.voided ||
               handId!=='h'||gameId!=='g'||expectedHand!=='h'||
               expectedGame!=='g'||expectedPot!==hand.pot_chips||statusGame!=='g'){
              return {meta:{changes:0}};
            }
            saved={id,hand_id:handId,game_id:gameId,winner_user_id:userId,
              winner_name:winner,pot_chips:pot,hole_cards:cards,split_pot:split};
            writes++;
            return {meta:{changes:1}};
          },
        };
      }};
    },
  };
  const env:any={DB:db,PKR_ENV:'staging',JWT_SECRET:'test-only'};
  return {game,hand,env,sqls,getResult:()=>saved,getWrites:()=>writes};
}
function post(body:any):RequestInit{
  return {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)};
}
const url='https://fixture.invalid/games/g/hands/h/result';
const body={winner_user_id:'alex',winner_name:'Alex',hole_cards:{},split_pot:false};
const execution:any={waitUntil:(_:Promise<unknown>)=>{}};

describe('hand winner concurrent writes',()=>{
  it('accepts one winner and rejects a competing different winner',async()=>{
    const f=fixture();
    const [a,b]=await Promise.all([
      hands.request(url,post(body),f.env,execution),
      hands.request(url,post({...body,winner_user_id:'ben',winner_name:'Ben'}),f.env,execution),
    ]);
    expect([a.status,b.status].sort()).toEqual([200,409]);
    expect(await (a.status===409?a:b).json()).toMatchObject({code:'HAND_RESULT_CONFLICT'});
    expect(f.getWrites()).toBe(1);
    expect(f.sqls.some(x=>x.includes('ON CONFLICT(hand_id) DO NOTHING'))).toBe(true);
    expect(f.sqls.some(x=>x.includes('pot_chips=? AND voided=0'))).toBe(true);
  });
  it('allows identical HTTP replay without writing another result',async()=>{
    const f=fixture();
    expect((await hands.request(url,post(body),f.env,execution)).status).toBe(200);
    const again=await hands.request(url,post(body),f.env,execution);
    expect(again.status).toBe(200);
    expect(await again.json()).toMatchObject({ok:true,already_applied:true});
    expect(f.getWrites()).toBe(1);
  });
  it('cannot declare a winner if another action changed the pot while saving',async()=>{
    const f=fixture({potChange:true});
    const response=await hands.request(url,post(body),f.env,execution);
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({code:'HAND_STATE_CONFLICT'});
    expect(f.getWrites()).toBe(0);
  });
  it('cannot declare a winner if the game closed before the insert',async()=>{
    const f=fixture({closeOnInsert:true});
    const response=await hands.request(url,post(body),f.env,execution);
    expect(response.status).toBe(409);
    expect(f.getResult()).toBeNull();
  });
  it('rejects invalid winner names and side-pot allocations before any write',async()=>{
    const f=fixture();
    const noName=await hands.request(url,post({...body,winner_name:'   '}),f.env,execution);
    expect(noName.status).toBe(400);
    const wrongPot=await hands.request(url,post({
      ...body,pot_winners:[{potIdx:0,winnerName:'Alex',chips:199,label:'Main Pot'}],
    }),f.env,execution);
    expect(wrongPot.status).toBe(422);
    expect(f.getWrites()).toBe(0);
  });
});
