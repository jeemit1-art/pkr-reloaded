import {describe,expect,it,vi} from 'vitest';

vi.mock('../middleware',async(importOriginal)=>{
  const original=await importOriginal<typeof import('../middleware')>();
  return {...original,
    authMiddleware:async(c:any,next:any)=>{c.set('userId','synthetic-host');await next();},
    requireEventRole:async()=>true};
});
vi.mock('../push',()=>({sendPushToEvent:vi.fn(async()=>{}),sendPushToPlayer:vi.fn(async()=>{})}));
import games from './games';

type Player={user_id:string;display_name:string;seat_number:number|null;buy_ins:number;
  buy_in_total:number;cashout:number|null;net:number|null;settled_at:number|null;whatsapp:string|null};
function fixture(status='active'){
  const game={id:'g',event_id:'e',status,seats:9};
  const players:Player[]=[];
  const handHistory=new Set<string>();
  let eventWrites=0;
  const db={prepare(sql:string){
    return {bind(...args:any[]){
      return {
        async first():Promise<any>{
          if(sql.includes('FROM games WHERE id=?'))return {...game};
          if(sql.includes('FROM event_players WHERE event_id=?'))return null;
          if(sql.includes('FROM game_players WHERE game_id=? AND display_name=?'))
            return players.find(p=>p.display_name===args[1])??null;
          if(sql.includes('FROM game_players WHERE game_id=? AND user_id=?'))
            return players.find(p=>p.user_id===args[1])??null;
          return null;
        },
        async all():Promise<any>{
          if(sql.includes('FROM game_players WHERE game_id=? ORDER BY'))
            return {results:players.map(p=>({...p}))};
          return {results:[]};
        },
        async run():Promise<any>{
          if(sql.trimStart().startsWith('INSERT INTO game_players')){
            const [gameId,userId,name,whatsapp,seat,checkGame,checkSeatGame,checkSeat]=args;
            if(game.status==='settled'||game.status==='cancelled'||gameId!=='g'||
              checkGame!=='g'||checkSeatGame!=='g'||seat!==checkSeat||
              players.some(p=>(seat!==null&&p.seat_number===seat)||p.display_name===name||p.user_id===userId))
              return {meta:{changes:0}};
            players.push({user_id:userId,display_name:name,whatsapp,seat_number:seat,
              buy_ins:0,buy_in_total:0,cashout:null,net:null,settled_at:null});
            return {meta:{changes:1}};
          }
          if(sql.trimStart().startsWith('UPDATE game_players SET seat_number=')){
            const [seat,whatsapp,gameId,userId,expected,openGame,checkGame,checkSeat,checkUser]=args;
            const p=players.find(p=>p.user_id===userId);
            if(!p||game.status==='settled'||game.status==='cancelled'||
              gameId!=='g'||openGame!=='g'||checkGame!=='g'||seat!==checkSeat||checkUser!==userId||
              p.seat_number!==expected||players.some(p=>p.user_id!==userId&&p.seat_number===seat))
              return {meta:{changes:0}};
            p.seat_number=seat;if(whatsapp)p.whatsapp=whatsapp;
            return {meta:{changes:1}};
          }
          if(sql.trimStart().startsWith('DELETE FROM game_players')){
            const [gameId,userId,expected,openGame,actionGame,actionUser,resultGame,resultUser]=args;
            const index=players.findIndex(p=>p.user_id===userId);
            const p=players[index];
            if(!p||game.status==='settled'||game.status==='cancelled'||gameId!=='g'||
              openGame!=='g'||actionGame!=='g'||resultGame!=='g'||actionUser!==userId||
              resultUser!==userId||p.seat_number!==expected||p.buy_ins!==0||
              p.buy_in_total!==0||p.cashout!==null||p.net!==null||p.settled_at!==null||
              handHistory.has(userId))return {meta:{changes:0}};
            players.splice(index,1);return {meta:{changes:1}};
          }
          if(sql.trimStart().startsWith('INSERT INTO event_players')){eventWrites++;return {meta:{changes:1}};}
          return {meta:{changes:0}};
        },
      };
    }};
  }};
  const env:any={DB:db,KV:{get:async()=>null,put:async()=>{}},JWT_SECRET:'fixture',PKR_ENV:'staging'};
  return {env,players,game,handHistory,eventWrites:()=>eventWrites};
}
function req(method:'POST'|'DELETE',body:unknown):RequestInit{
  return {method,headers:{'Content-Type':'application/json'},body:JSON.stringify(body)};
}
const url='https://fixture.invalid/games/g/seat';
const remove=(id:string)=>url+'/'+id;
const execution:any={waitUntil:(_:Promise<unknown>)=>{}};

describe('seat changes reject stale edits and protect history',()=>{
  it('allows one player to take a seat, never two',async()=>{
    const f=fixture();
    const [a,b]=await Promise.all([
      games.request(url,req('POST',{display_name:'Alex',seat_number:1}),f.env,execution),
      games.request(url,req('POST',{display_name:'Ben',seat_number:1}),f.env,execution),
    ]);
    expect([a.status,b.status].sort()).toEqual([200,409]);
    expect(f.players).toHaveLength(1);
    expect(f.eventWrites()).toBe(1);
  });
  it('quick-seat registration supports multiple players without seat numbers',async()=>{
    const f=fixture();
    const a=await games.request(url,req('POST',{display_name:'Alex'}),f.env,execution);
    const b=await games.request(url,req('POST',{display_name:'Ben'}),f.env,execution);
    expect(a.status).toBe(200);
    expect(b.status).toBe(200);
    expect(f.players.map(p=>p.seat_number)).toEqual([null,null]);
    const move=await games.request(url,req('POST',{
      display_name:'Alex',seat_number:1,expected_seat_number:null,
    }),f.env,execution);
    expect(move.status).toBe(200);
    expect(f.players.map(p=>p.seat_number)).toEqual([1,null]);
  });
  it('idempotent seat replay preserves buy-ins and event-player count',async()=>{
    const f=fixture();
    await games.request(url,req('POST',{display_name:'Alex',seat_number:1}),f.env,execution);
    f.players[0].buy_ins=2;f.players[0].buy_in_total=4000;
    const again=await games.request(url,req('POST',{display_name:'Alex',seat_number:1}),f.env,execution);
    expect(await again.json()).toMatchObject({ok:true,already_seated:true});
    expect(f.players[0].buy_in_total).toBe(4000);
    expect(f.eventWrites()).toBe(1);
  });
  it('requires original seat to move and rejects stale moves',async()=>{
    const f=fixture();
    await games.request(url,req('POST',{display_name:'Alex',seat_number:1}),f.env,execution);
    expect((await games.request(url,req('POST',{display_name:'Alex',seat_number:2}),f.env,execution)).status).toBe(428);
    expect((await games.request(url,req('POST',{display_name:'Alex',seat_number:2,expected_seat_number:1}),f.env,execution)).status).toBe(200);
    const stale=await games.request(url,req('POST',{display_name:'Alex',seat_number:3,expected_seat_number:1}),f.env,execution);
    expect(stale.status).toBe(409);
    expect(await stale.json()).toMatchObject({code:'SEAT_CONFLICT',current:{seat_number:2}});
  });
  it('will not move a player into someone else occupied seat',async()=>{
    const f=fixture();
    await games.request(url,req('POST',{display_name:'Alex',seat_number:1}),f.env,execution);
    await games.request(url,req('POST',{display_name:'Ben',seat_number:2}),f.env,execution);
    const result=await games.request(url,req('POST',{display_name:'Alex',seat_number:2,expected_seat_number:1}),f.env,execution);
    expect(result.status).toBe(409);
    expect(f.players.map(p=>p.seat_number)).toEqual([1,2]);
  });
  it('blocks removing a player with money or hand activity',async()=>{
    const f=fixture();
    await games.request(url,req('POST',{display_name:'Alex',seat_number:1}),f.env,execution);
    const id=f.players[0].user_id;
    f.players[0].cashout=1500;
    let response=await games.request(remove(id),req('DELETE',{expected_seat_number:1}),f.env,execution);
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({code:'PLAYER_HAS_HISTORY'});
    f.players[0].cashout=null;f.handHistory.add(id);
    response=await games.request(remove(id),req('DELETE',{expected_seat_number:1}),f.env,execution);
    expect(response.status).toBe(409);expect(f.players).toHaveLength(1);
  });
  it('requires a matching original seat before removal; retries do not delete twice',async()=>{
    const f=fixture();
    await games.request(url,req('POST',{display_name:'Alex',seat_number:1}),f.env,execution);
    const id=f.players[0].user_id;
    expect((await games.request(remove(id),req('DELETE',{}),f.env,execution)).status).toBe(428);
    expect((await games.request(remove(id),req('DELETE',{expected_seat_number:2}),f.env,execution)).status).toBe(409);
    expect((await games.request(remove(id),req('DELETE',{expected_seat_number:1}),f.env,execution)).status).toBe(200);
    const retry=await games.request(remove(id),req('DELETE',{expected_seat_number:1}),f.env,execution);
    expect(retry.status).toBe(200);
    expect(await retry.json()).toMatchObject({already_removed:true});
  });
  it('never changes seats in settled games',async()=>{
    const f=fixture('settled');
    expect((await games.request(url,req('POST',{display_name:'Alex',seat_number:1}),f.env,execution)).status).toBe(409);
    expect(f.players).toHaveLength(0);
  });
});
