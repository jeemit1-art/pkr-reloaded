import {describe,it,expect,vi} from 'vitest';

vi.mock('../middleware',async(importOriginal)=>{
  const original=await importOriginal<typeof import('../middleware')>();
  return {...original,authMiddleware:async(c:any,next:any)=>{c.set('userId','fictional-host');await next();},
    requireEventRole:async()=>true};
});
vi.mock('../push',()=>({sendPushToEvent:vi.fn(async()=>{}),sendPushToPlayer:vi.fn(async()=>{})}));

import games from './games';
import events from './events';

const settled={
 id:'settled-1',event_id:'fictional-room',status:'settled',scheduled_at:1793000000,
 location:'Test',seats:9,game_password:'never-return-this',created_at:1792000000
};
const another={...settled,id:'settled-2',scheduled_at:1792000000};
const scheduled={...settled,id:'scheduled-1',status:'scheduled',scheduled_at:1794000000};
const players=[
 {game_id:'settled-1',user_id:'a',display_name:'Alex',net:500},
 {game_id:'settled-1',user_id:'b',display_name:'Blair',net:-500},
 {game_id:'settled-1',user_id:'c',display_name:'Casey',net:null},
 {game_id:'settled-2',user_id:'a',display_name:'Alex',net:200},
];
function fixture(){
 const sqls:Array<{sql:string;args:unknown[]}>=[],writes:string[]=[];
 const db={
  prepare:(sql:string)=>({
   bind:(...args:unknown[])=>({
    all:async()=>{
      sqls.push({sql,args});
      if(sql.includes('FROM games g WHERE g.event_id=?')){
        const all=[settled,another,scheduled].filter(g=>g.event_id===args[0]&&(!args[1]||g.status===args[1]));
        return {results:all.map(g=>({
          ...g,
          // Mimics the exact projected D1 count. Without it, the API
          // must not accidentally infer zero or silently use seats/RSVPs.
          ...(sql.includes('COUNT(*) FROM game_players gp WHERE gp.game_id=g.id')
            ? {player_count:players.filter(p=>p.game_id===g.id).length}:{}),
          format:'cash',
        }))};
      }
      if(sql.includes('FROM games g WHERE g.event_id=?')||sql.includes('FROM games g WHERE g.id=?'))
        return {results:[]};
      if(sql.includes('FROM games g WHERE g.event_id=?'))return {results:[]};
      if(sql.includes('FROM games g WHERE g.event_id='))return {results:[]};
      if(sql.includes('FROM game_players')&&sql.includes('net IS NOT NULL'))return {results:[]};
      if(sql.includes('FROM games g WHERE g.event_id'))return {results:[]};
      return {results:[]};
    },
    run:async()=>{writes.push(sql);return {meta:{changes:1}}},
    first:async()=>null
   })
  })
 };
 const env:any={DB:db,KV:{},FRONTEND_URL:'https://test.invalid',PKR_ENV:'staging'};
 return {env,sqls,writes};
}

describe('game listing saved participant counts',()=>{
 it('counts actual saved player rows per settled game, including a pending net result',async()=>{
   const f=fixture();
   const res=await games.request('https://test.invalid/events/fictional-room/games',{},f.env);
   expect(res.status).toBe(200);
   const rows=await res.json() as Array<any>;
   expect(rows.find(x=>x.id==='settled-1')?.player_count).toBe(3);
   expect(rows.find(x=>x.id==='settled-2')?.player_count).toBe(1);
   expect(rows.find(x=>x.id==='scheduled-1')?.player_count).toBe(0);
   expect(rows[0].game_password).toBeUndefined();
   expect(f.sqls[0].sql).toMatch(/SELECT COUNT\(\*\) FROM game_players gp WHERE gp\.game_id=g\.id/);
   expect(f.sqls[0].sql).toContain('g.event_id=?');
   expect(f.sqls[0].args).toEqual(['fictional-room']);
   expect(f.writes).toEqual([]);
 });
 it('keeps status filtering and room isolation with accurate counts',async()=>{
   const f=fixture();
   const res=await games.request('https://test.invalid/events/fictional-room/games?status=settled',{},f.env);
   const rows=await res.json() as Array<any>;
   expect(rows).toHaveLength(2);
   expect(rows.map(x=>x.player_count)).toEqual([3,1]);
   expect(f.sqls[0].sql).toContain('AND g.status=?');
   expect(f.sqls[0].args).toEqual(['fictional-room','settled']);
   expect(f.writes).toEqual([]);
 });
});

