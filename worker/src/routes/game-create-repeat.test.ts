import {describe,expect,it,vi,beforeEach} from 'vitest';
vi.mock('../middleware',async(importOriginal)=>{
  const actual=await importOriginal<typeof import('../middleware')>();
  return {...actual,
    authMiddleware:async(c:any,next:any)=>{c.set('userId','host-test');await next()},
    requireEventRole:async()=>true,
    getPlanStatus:async()=>({is_active:true,plan:'pro',max_seats:15}),
  };
});
vi.mock('../push',()=>({sendPushToEvent:vi.fn(async()=>{}),sendPushToPlayer:vi.fn(async()=>{})}));
import games from './games';
import {sendPushToEvent} from '../push';

function fixture(){
  const created:Array<{id:string;timestamp:number;seats:number}>=[];
  const DB={
    prepare(sql:string){
      return {bind(...args:any[]){
        return {
          async first(){
            if(sql.includes('SELECT name FROM events'))return {name:'Test Room'};
            if(sql.includes('SELECT * FROM games WHERE id='))return {
              id:created[0]?.id,event_id:'room-test',scheduled_at:created[0]?.timestamp,
              seats:created[0]?.seats,status:'scheduled'};
            return null;
          },
          async run(){
            if(!sql.startsWith('INSERT INTO games('))throw Error('Unexpected D1 write: '+sql);
            created.push({id:args[0],timestamp:args[2],seats:args[5]});
            return {meta:{changes:1}};
          }
        };
      }};
    },
    async batch(commands:any[]){return Promise.all(commands.map(cmd=>cmd.run()))}
  };
  const env:any={DB,KV:{},FRONTEND_URL:'https://example.invalid',PKR_ENV:'staging'};
  const ctx:any={waitUntil:(promise:Promise<unknown>)=>{void promise}};
  const post=(body:Record<string,unknown>)=>games.request('https://example.invalid/events/room-test/games',{
    method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body),
  },env,ctx);
  return {created,post};
}
beforeEach(()=>vi.clearAllMocks());

describe('bounded repeating poker-night scheduling',()=>{
  const start=1793509200;
  it('creates a single game when recurrence is not requested',async()=>{
    const f=fixture();
    const res=await f.post({scheduled_at:start,seats:8});
    expect(res.status).toBe(201);
    expect(f.created).toHaveLength(1);
    expect(f.created[0].timestamp).toBe(start);
    expect(sendPushToEvent).toHaveBeenCalledTimes(1);
  });
  it.each([['weekly',7],['fortnightly',14]] as const)(
    'creates four %s sessions atomically with one notification',async(repeat,days)=>{
      const f=fixture();
      const res=await f.post({scheduled_at:start,seats:8,repeat});
      expect(res.status).toBe(201);
      expect(f.created).toHaveLength(4);
      expect(f.created.map(s=>s.timestamp)).toEqual(
        [0,1,2,3].map(i=>start+i*days*86400));
      expect(new Set(f.created.map(s=>s.id)).size).toBe(4);
      expect(sendPushToEvent).toHaveBeenCalledTimes(1);
    }
  );
  it('rejects unknown recurrence and never creates records',async()=>{
    const f=fixture();
    const res=await f.post({scheduled_at:start,repeat:'every-day'});
    expect(res.status).toBe(400);
    expect(f.created).toHaveLength(0);
  });
});
