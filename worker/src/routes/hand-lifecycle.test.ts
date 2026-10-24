import {describe,expect,it,vi} from 'vitest';
vi.mock('../middleware',async(importOriginal)=>{
  const original=await importOriginal<typeof import('../middleware')>();
  return {...original,
    authMiddleware:async(c:any,next:any)=>{c.set('userId','synthetic-host');await next();},
    requireEventRole:async()=>true};
});
import hands from './hands';
const base='https://fixture.invalid/games/g/hands';
const post=(body:unknown):RequestInit=>({
  method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body),
});
const del=(body?:unknown):RequestInit=>({
  method:'DELETE',...(body===undefined?{}:{
    headers:{'Content-Type':'application/json'},body:JSON.stringify(body),
  }),
});
const exec:any={waitUntil:(_:Promise<unknown>)=>{}};
function fixture(){
  const game={id:'g',event_id:'e',status:'active',seats:4,
    current_hand_no:0,current_dealer_seat:null as null|number};
  const roster=[
    {user_id:'d',display_name:'Dealer',seat_number:1,buy_ins:1},
    {user_id:'s',display_name:'Small',seat_number:4,buy_ins:1},
    {user_id:'b',display_name:'Big',seat_number:3,buy_ins:1},
    {user_id:'u',display_name:'UTG',seat_number:2,buy_ins:1},
  ];
  let swapSeatsDuringInsert=false;
  const records:Array<{id:string;game_id:string;hand_no:number;voided:number;
    dealer_seat:number;sb_seat:number;bb_seat:number;straddle:number;
    board:string;pot_chips:number;mode:string}>=[];
  let finalResult:{id:string;hand_id:string;game_id:string}|null=null;
  const actions:Array<{id:string;hand_id:string;game_id:string;display_name:string;
    chips:number;action:string;created_at:number}>=[];
  let inserts=0;
  function latestUnfinished(){
    return records.some(h=>!h.voided && !finalResult && h.id);
  }
  const db={prepare(sql:string){return {bind(...args:any[]){
    return {sql,args,
      async first():Promise<any>{
        if(sql.includes('FROM games WHERE id=?'))return {...game};
        if(sql.includes('SELECT id FROM hands WHERE id=? AND game_id=?'))
          return records.find(h=>h.id===args[0])??null;
        if(sql.includes('SELECT * FROM hands WHERE id=?'))
          return records.find(h=>h.id===args[0])??null;
        if(sql.includes('SELECT voided FROM hands WHERE id=?'))
          return records.find(h=>h.id===args[0])??null;
        if(sql.includes('FROM hand_results WHERE hand_id=?'))
          return finalResult&&finalResult.hand_id===args[0]?{...finalResult}:null;
        if(sql.includes('SELECT pot_chips FROM hands WHERE id=?'))
          return records.find(h=>h.id===args[0])??null;
        return null;
      },
      async all():Promise<any>{
        if(sql.includes('FROM game_players WHERE game_id=? AND seat_number IS NOT NULL'))
          return {results:roster.map(p=>({...p}))};
        if(sql.includes('FROM hands WHERE game_id=? ORDER BY hand_no DESC'))
          return {results:records.slice().reverse().map(h=>({...h}))};
        if(sql.includes('FROM hand_actions WHERE hand_id=?'))
          return {results:actions.filter(a=>a.hand_id===args[0])};
        return {results:[]};
      },
      async run():Promise<any>{
        const compact=sql.trim();
        if(compact.startsWith('UPDATE hands SET voided=1')){
          const hand=records.find(h=>h.id===args[0]);
          if(!hand||hand.voided)return {meta:{changes:0}};
          hand.voided=1;return {meta:{changes:1}};
        }
        if(compact.startsWith('DELETE FROM hand_results')){
          const [handId,gameId,expected]=args;
          const hand=records.find(h=>h.id===handId);
          if(!finalResult||finalResult.id!==expected||
            finalResult.hand_id!==handId||gameId!=='g'||hand?.voided)
            return {meta:{changes:0}};
          finalResult=null;return {meta:{changes:1}};
        }
        throw Error('Unexpected standalone write: '+compact.slice(0,80));
      },
    };
  }};},
    async batch(statements:any[]):Promise<any[]>{
      let didInsert=0;
      const results:any[]=[];
      for(const q of statements){
        const sql=q.sql.trim(),args=q.args;
        if(sql.startsWith('INSERT INTO hands')){
          const [id,gameId,no,dealer,sb,bb,straddle,board,pot,mode,checkGame,
            expected,checkMode,unfinishedGame,rosterMode,rosterGame,rosterSize,
            rosterJson,identityGame]=args;
          expect(sql).toContain('json_each(?)');
          expect(sql).toContain("status='active'");
          if(swapSeatsDuringInsert){
            const previous=roster[1].seat_number;
            roster[1].seat_number=roster[3].seat_number;
            roster[3].seat_number=previous;
            swapSeatsDuringInsert=false;
          }
          const recorded=JSON.parse(rosterJson);
          const currentRoster=roster.filter(p=>p.seat_number!==null&&p.buy_ins>0);
          const matches=mode==='manual'||(
            rosterMode==='full'&&rosterGame==='g'&&identityGame==='g'&&
            currentRoster.length===rosterSize&&
            recorded.length===rosterSize&&
            recorded.every((seat:any)=>currentRoster.some(p=>
              p.user_id===seat.user_id&&p.display_name===seat.display_name&&
              p.seat_number===seat.seat_number)));
          didInsert=Number(game.status==='active'&&gameId==='g'&&checkGame==='g'&&
            checkMode===mode&&unfinishedGame==='g'&&
            game.current_hand_no===expected&&matches&&
            !latestUnfinished()&&!records.some(h=>h.hand_no===no));
          if(didInsert){
            records.push({id,game_id:gameId,hand_no:no,dealer_seat:dealer,
              sb_seat:sb,bb_seat:bb,straddle,board,pot_chips:pot,mode,voided:0});
            inserts++;
          }
          results.push({meta:{changes:didInsert}});
        } else if(sql.startsWith('UPDATE games SET current_hand_no=')){
          if(didInsert&&game.current_hand_no===args[3]){
            game.current_hand_no=args[0];game.current_dealer_seat=args[1];
            results.push({meta:{changes:1}});
          }else results.push({meta:{changes:0}});
        } else throw Error('Unexpected batch write: '+sql.slice(0,80));
      }
      return results;
    },
  };
  return {env:{DB:db,JWT_SECRET:'fixture',PKR_ENV:'staging'} as any,
    records,actions,game,roster,getInserts:()=>inserts,
    swapSeatsBeforeInsert:()=>{swapSeatsDuringInsert=true;},
    addResult:(handId:string,id:string)=>{finalResult={id,hand_id:handId,game_id:'g'};},
    getResult:()=>finalResult};
}
const newHand={dealer_seat:1,sb_seat:4,bb_seat:3,straddle:0,mode:'full'};
describe('replay-safe hands and history preserving void',()=>{
  it('starts one hand when two hosts submit simultaneously',async()=>{
    const f=fixture();
    const [a,b]=await Promise.all([
      hands.request(base,post(newHand),f.env,exec),
      hands.request(base,post(newHand),f.env,exec),
    ]);
    expect([a.status,b.status].sort()).toEqual([201,409]);
    expect(f.records).toHaveLength(1);
    expect(f.game.current_hand_no).toBe(1);
    expect(f.getInserts()).toBe(1);
  });
  it('does not start another hand until its predecessor has a winner or is voided',async()=>{
    const f=fixture();
    const first=await hands.request(base,post(newHand),f.env,exec);
    expect(first.status).toBe(201);
    expect((await hands.request(base,post(newHand),f.env,exec)).status).toBe(409);
    f.addResult(f.records[0].id,'winner-1');
    expect((await hands.request(base,post(newHand),f.env,exec)).status).toBe(201);
    expect(f.game.current_hand_no).toBe(2);
  });
  it('soft-voids without deleting actions or winners and never recycles hand numbers',async()=>{
    const f=fixture();
    await hands.request(base,post(newHand),f.env,exec);
    const id=f.records[0].id;
    f.actions.push({id:'action-1',hand_id:id,game_id:'g',display_name:'Alex',
      action:'post',chips:100,created_at:1});
    f.addResult(id,'winner-1');
    const voided=await hands.request(base+'/'+id,del(),f.env,exec);
    expect(voided.status).toBe(200);
    expect(f.records[0].voided).toBe(1);
    expect(f.actions).toHaveLength(1);
    expect(f.getResult()).toEqual({id:'winner-1',hand_id:id,game_id:'g'});
    expect((await hands.request(base+'/'+id,del(),f.env,exec)).status).toBe(200);
    const next=await hands.request(base,post(newHand),f.env,exec);
    expect(next.status).toBe(201);
    expect(f.records.map(h=>h.hand_no)).toEqual([1,2]);
  });
  it('will not undo a winner that has been replaced by another host',async()=>{
    const f=fixture();
    await hands.request(base,post(newHand),f.env,exec);
    const id=f.records[0].id;
    f.addResult(id,'newer-result');
    const stale=await hands.request(base+'/'+id+'/result',del({
      expected_result_id:'older-result',
    }),f.env,exec);
    expect(stale.status).toBe(409);
    expect(await stale.json()).toMatchObject({code:'HAND_RESULT_CONFLICT'});
    expect(f.getResult()?.id).toBe('newer-result');
    const valid=await hands.request(base+'/'+id+'/result',del({
      expected_result_id:'newer-result',
    }),f.env,exec);
    expect(valid.status).toBe(200);
    expect(f.getResult()).toBeNull();
  });
  it('refuses three-way dealer/small blind overlap and reversed blinds',async()=>{
    const f=fixture();
    for(const positions of [
      {...newHand,sb_seat:1},
      {...newHand,sb_seat:3,bb_seat:4},
      {...newHand,dealer_seat:2},
    ]){
      const res=await hands.request(base,post(positions),f.env,exec);
      expect(res.status).toBe(400);
      expect(await res.json()).toMatchObject({code:'HAND_SEATING_INVALID'});
    }
    expect(f.getInserts()).toBe(0);
  });
  it('supports valid heads-up dealer-as-SB and rejects heads-up straddles',async()=>{
    const f=fixture();
    f.roster.splice(2,2);
    const positions={dealer_seat:1,sb_seat:1,bb_seat:4,straddle:0,mode:'full'};
    const bad=await hands.request(base,post({...positions,straddle:1}),f.env,exec);
    expect(bad.status).toBe(400);
    expect(await bad.json()).toMatchObject({code:'INVALID_BLIND'});
    const good=await hands.request(base,post(positions),f.env,exec);
    expect(good.status).toBe(201);
    expect(f.getInserts()).toBe(1);
  });
  it('requires the game and registered seating to be ready',async()=>{
    const f=fixture();
    f.game.status='scheduled';
    const early=await hands.request(base,post(newHand),f.env,exec);
    expect(early.status).toBe(409);
    expect(await early.json()).toMatchObject({code:'GAME_NOT_ACTIVE'});
    f.game.status='active';
    f.roster.splice(1);
    const sparse=await hands.request(base,post(newHand),f.env,exec);
    expect(sparse.status).toBe(409);
    expect(await sparse.json()).toMatchObject({code:'HAND_ROSTER_UNSYNCED'});
    expect(f.getInserts()).toBe(0);
  });
  it('rejects a same-count seat swap between validation and atomic insertion',async()=>{
    const f=fixture();
    f.swapSeatsBeforeInsert();
    const response=await hands.request(base,post(newHand),f.env,exec);
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({code:'HAND_START_CONFLICT'});
    expect(f.records).toHaveLength(0);
    expect(f.getInserts()).toBe(0);
  });
  it('rejects invalid hand seating without entering the write transaction',async()=>{
    const f=fixture();
    const invalid=await hands.request(base,post({...newHand,dealer_seat:0}),f.env,exec);
    expect(invalid.status).toBe(400);
    expect(f.getInserts()).toBe(0);
  });
});
