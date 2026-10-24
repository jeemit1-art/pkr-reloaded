import {describe,expect,it,vi} from 'vitest';
vi.mock('../middleware',async(importOriginal)=>{
  const original=await importOriginal<typeof import('../middleware')>();
  return {...original,
    authMiddleware:async(c:any,next:any)=>{c.set('userId','synthetic-host');await next();},
    requireEventRole:async()=>true};
});
import hands from './hands';

function fixture(opts?:{winner?:boolean;voided?:boolean;closed?:boolean}){
  const game={id:'g',event_id:'e',status:opts?.closed?'settled':'active'};
  const hand={id:'h',game_id:'g',board:'[]',voided:opts?.voided?1:0};
  let winner=!!opts?.winner,writes=0;
  const db={prepare(sql:string){return {bind(...args:any[]){
    return {
      async first():Promise<any>{
        if(sql.includes('FROM games WHERE id=?'))return {...game};
        if(sql.includes('SELECT id FROM hands WHERE id=? AND game_id=?'))return {id:'h'};
        if(sql.includes('FROM hand_results WHERE hand_id=?'))return winner?{id:'winner'}:null;
        if(sql.includes('SELECT board,voided FROM hands WHERE id=?'))return {...hand};
        return null;
      },
      async run():Promise<any>{
        if(!sql.trimStart().startsWith('UPDATE hands SET board='))throw Error('Unexpected write');
        if(!sql.includes('AND board=?')||!sql.includes('voided=0')||
           !sql.includes('NOT EXISTS (SELECT 1 FROM hand_results')||
           !sql.includes("status NOT IN ('settled','cancelled')"))
          throw Error('Board update missing atomic conflict checks');
        const [wanted,handId,gameId,expected]=args;
        if(handId==='h'&&gameId==='g'&&hand.board===expected&&
           !hand.voided&&!winner&&game.status==='active'){
          hand.board=wanted;writes++;return {meta:{changes:1}};
        }
        return {meta:{changes:0}};
      },
    };
  }};}};
  return {env:{DB:db,PKR_ENV:'staging',JWT_SECRET:'synthetic'} as any,
    hand,game,getWrites:()=>writes,declareWinner:()=>{winner=true;}};
}
const url='https://fixture.invalid/games/g/hands/h/board';
const post=(board:string[],expected_board?:string[]):RequestInit=>({
  method:'PUT',headers:{'Content-Type':'application/json'},
  body:JSON.stringify(expected_board===undefined?{board}:{board,expected_board}),
});
const ex:any={waitUntil:(_:Promise<unknown>)=>{}};
const ace='A♠',king='K♠',queen='Q♠',jack='J♠';
describe('board-card stale-write safety',()=>{
  it('requires the original board rather than blindly replacing other hosts',async()=>{
    const f=fixture();
    const r=await hands.request(url,post([ace]),f.env,ex);
    expect(r.status).toBe(428);
    expect(await r.json()).toMatchObject({code:'PRECONDITION_REQUIRED'});
    expect(f.getWrites()).toBe(0);
  });
  it('accepts one board update and blocks a second host with an old board',async()=>{
    const f=fixture();
    expect((await hands.request(url,post([ace],[]),f.env,ex)).status).toBe(200);
    const stale=await hands.request(url,post([king],[]),f.env,ex);
    expect(stale.status).toBe(409);
    expect(await stale.json()).toMatchObject({code:'BOARD_CONFLICT',current_board:[ace]});
    expect(JSON.parse(f.hand.board)).toEqual([ace]);
    expect(f.getWrites()).toBe(1);
  });
  it('never writes after winner declaration, hand void or game closure',async()=>{
    for(const opts of [{winner:true},{voided:true},{closed:true}]){
      const f=fixture(opts);
      const r=await hands.request(url,post([ace],[]),f.env,ex);
      expect(r.status).toBe(409);
      expect(f.getWrites()).toBe(0);
    }
  });
  it('rejects duplicate board cards and allows sequential confirmed cards',async()=>{
    const f=fixture();
    expect((await hands.request(url,post([ace,king,queen],[]),f.env,ex)).status).toBe(200);
    expect((await hands.request(url,post([ace,king,queen,jack],[ace,king,queen]),f.env,ex)).status).toBe(200);
    expect((await hands.request(url,post([ace,ace],[ace,king,queen,jack]),f.env,ex)).status).toBe(400);
    expect(JSON.parse(f.hand.board)).toEqual([ace,king,queen,jack]);
    expect(f.getWrites()).toBe(2);
  });
});
