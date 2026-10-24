import {describe,expect,it,vi} from 'vitest';
vi.mock('../middleware',async(importOriginal)=>{
  const original=await importOriginal<typeof import('../middleware')>();
  return {...original,
    authMiddleware:async(c:any,next:any)=>{c.set('userId','synthetic-host');await next();},
    requireEventRole:async()=>true};
});
import hands from './hands';

const roster=[
  {user_id:'dealer',display_name:'Dealer',seat_number:1,buy_ins:1},
  {user_id:'sb',display_name:'Small',seat_number:4,buy_ins:1},
  {user_id:'bb',display_name:'Big',seat_number:3,buy_ins:1},
  {user_id:'utg',display_name:'UTG',seat_number:2,buy_ins:1},
];
type Action={id:string;hand_id:string;game_id:string;user_id:string|null;
  display_name:string;street:string;action:string;chips:number;created_at:number};
const post=(who:string,type:string,chips:number,street='pre'):RequestInit=>({
  method:'POST',headers:{'Content-Type':'application/json'},
  body:JSON.stringify({display_name:who,street,action:type,chips}),
});
const url='https://fixture.invalid/games/g/hands/h/actions';
const execution:any={waitUntil:(_promise:Promise<unknown>)=>{}};
function fixture(){
  const game={id:'g',event_id:'e',status:'active',seats:4};
  const hand={id:'h',game_id:'g',mode:'full',dealer_seat:1,sb_seat:4,
    bb_seat:3,straddle:0,pot_chips:0,voided:0};
  const history:Action[]=[];
  let writes=0;
  const db={
    prepare(sql:string){return {bind(...args:any[]){
      return {sql,args,
        async first():Promise<any>{
          if(sql.includes('FROM games WHERE id=?'))return {...game};
          if(sql.includes('SELECT id FROM hands WHERE id=? AND game_id=?'))return {id:'h'};
          if(sql.includes('SELECT dealer_seat,sb_seat,bb_seat,straddle,mode'))return {...hand};
          if(sql.includes('FROM hand_results WHERE hand_id=?'))return null;
          if(sql.includes('FROM hand_actions WHERE hand_id=? ORDER BY created_at DESC'))
            return history.length?{id:history[history.length-1].id}:null;
          if(sql.includes('SELECT pot_chips FROM hands WHERE id=?'))return {pot_chips:hand.pot_chips};
          return null;
        },
        async all():Promise<any>{
          if(sql.includes('FROM game_players'))return {results:roster.map(p=>({...p}))};
          if(sql.includes('FROM hand_actions'))return {results:history.map(p=>({...p}))};
          return {results:[]};
        },
        async run():Promise<any>{throw Error('This route must use D1 batch, not independent writes');},
      };
    }};},
    async batch(stmts:any[]):Promise<any[]>{
      const result:any[]=[];
      for(const stmt of stmts){
        const sql=stmt.sql.trim();
        const args=stmt.args;
        if(sql.startsWith('INSERT INTO hand_actions')){
          const expectedLast=args[args.length-1];
          const actualLast=history.length?history[history.length-1].id:null;
          if(game.status!=='active'||hand.voided||expectedLast!==actualLast){
            result.push({meta:{changes:0}});
          }else{
            history.push({id:args[0],hand_id:args[1],game_id:args[2],
              user_id:args[3],display_name:args[4],street:args[5],action:args[6],
              chips:args[7],created_at:123});
            writes++;
            result.push({meta:{changes:1}});
          }
        }else if(sql.startsWith('UPDATE hands SET pot_chips')){
          hand.pot_chips=history.reduce((sum,a)=>sum+(a.action==='fold'?0:a.chips),0);
          result.push({meta:{changes:1}});
        }else throw Error('Unexpected statement: '+sql);
      }
      return result;
    },
  };
  return {game,hand,history,env:{DB:db,PKR_ENV:'staging',JWT_SECRET:'synthetic-only'} as any,
    getWrites:()=>writes};
}
async function move(f:ReturnType<typeof fixture>,who:string,type:string,chips:number,street='pre'){
  return hands.request(url,post(who,type,chips,street),f.env,execution);
}
async function blinds(f:ReturnType<typeof fixture>){
  expect((await move(f,'Small','post',1)).status).toBe(200);
  expect((await move(f,'Big','post',2)).status).toBe(200);
}
describe('full-hand authoritative betting API',()=>{
  it('rejects actions from the wrong player and keeps the recorded pot unchanged',async()=>{
    const f=fixture();
    await blinds(f);
    const before=f.hand.pot_chips;
    const invalid=await move(f,'Dealer','call',2);
    expect(invalid.status).toBe(409);
    expect(await invalid.json()).toMatchObject({code:'OUT_OF_TURN',next_actor:'UTG'});
    expect(f.hand.pot_chips).toBe(before);
    expect(f.getWrites()).toBe(2);
  });
  it('rejects a check when chips are owed and an under-minimum raise',async()=>{
    const f=fixture();await blinds(f);
    const check=await move(f,'UTG','check',0);
    expect(await check.json()).toMatchObject({code:'CHECK_NOT_ALLOWED',to_call:2});
    expect((await move(f,'UTG','call',2)).status).toBe(200);
    const small=await move(f,'Dealer','raise',3);
    expect(await small.json()).toMatchObject({code:'RAISE_TOO_SMALL',minimum_raise:2});
    expect((await move(f,'Dealer','raise',6)).status).toBe(200);
  });
  it('keeps a short all-in from reopening the previous raiser',async()=>{
    const f=fixture();await blinds(f);
    for(const [who,type,chips] of [
      ['UTG','call',2],['Dealer','raise',6],
      ['Small','call',5],['Big','call',4],['UTG','allin',6],
    ] as const)expect((await move(f,who,type,chips)).status).toBe(200);
    const invalid=await move(f,'Dealer','raise',6);
    expect(invalid.status).toBe(409);
    expect(await invalid.json()).toMatchObject({code:'ACTION_NOT_REOPENED'});
    expect((await move(f,'Dealer','call',2)).status).toBe(200);
  });
  it('rejects skipping a round or acting after the hand is complete',async()=>{
    const f=fixture();await blinds(f);
    const early=await move(f,'Small','check',0,'flop');
    expect(early.status).toBe(409);
    expect(await early.json()).toMatchObject({code:'BETTING_ROUND_INCOMPLETE'});
    for(const [who,type,chips] of [
      ['UTG','call',2],['Dealer','call',2],['Small','call',1],['Big','check',0],
    ] as const)expect((await move(f,who,type,chips)).status).toBe(200);
    expect((await move(f,'Small','check',0,'flop')).status).toBe(200);
    const stale=await move(f,'UTG','call',2,'pre');
    expect(await stale.json()).toMatchObject({code:'STREET_OUT_OF_ORDER'});
  });
  it('accepts only one of two simultaneous writes based on the same hand state',async()=>{
    const f=fixture();await blinds(f);
    const [a,b]=await Promise.all([
      move(f,'UTG','call',2),move(f,'UTG','fold',0),
    ]);
    expect([a.status,b.status].sort()).toEqual([200,409]);
    expect(f.history).toHaveLength(3);
    expect(f.getWrites()).toBe(3);
  });
  it('cannot record another action after the game is closed',async()=>{
    const f=fixture();await blinds(f);
    f.game.status='settled';
    const response=await move(f,'UTG','call',2);
    expect(response.status).toBe(409);
    expect(f.getWrites()).toBe(2);
  });
});
