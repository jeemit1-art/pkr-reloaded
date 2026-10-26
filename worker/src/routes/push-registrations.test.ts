import {describe,expect,it,vi,beforeEach} from 'vitest';

// Auth is deliberately mocked only inside synthetic route tests.
vi.mock('../middleware',async(importOriginal)=>{
  const actual=await importOriginal<typeof import('../middleware')>();
  return {
    ...actual,
    authMiddleware:async(c:any,next:any)=>{
      c.set('userId',c.req.header('x-fixture-user')||'host-test');
      await next();
    },
    requireEventRole:async(c:any,eventId:string,role:string)=>{
      if(eventId!=='room-test')return false;
      if(role==='host')return c.get('userId')==='host-test';
      return true;
    },
  };
});

import events from './events';

function fixture(enabled=true){
  const queries:string[]=[];
  const db={
    prepare(sql:string){
      queries.push(sql);
      return {
        bind(...values:unknown[]){
          return {
            async all(){
              expect(values).toEqual(['room-test']);
              return {results:[
                {user_id:'host-test',device_count:2},
                {user_id:'member-test',device_count:0},
              ]};
            }
          };
        }
      };
    }
  };
  const env:any={DB:db,PKR_PUSH_ROOMS_V2:enabled?'1':'0'};
  const request=(id:string)=>events.request('https://example.invalid/room-test/push-registrations',{
    headers:{'x-fixture-user':id}
  },env);
  return {env,queries,request};
}

beforeEach(()=>vi.clearAllMocks());

describe('room member push registration status',()=>{
  it('allows the host to see per-member device counts but never endpoints or keys',async()=>{
    const f=fixture();
    const res=await f.request('host-test');
    expect(res.status).toBe(200);
    const data=await res.json() as any;
    expect(data.definition).toBe('registered_devices_not_delivery_confirmation');
    expect(data.members).toEqual([
      {user_id:'host-test',device_count:2},
      {user_id:'member-test',device_count:0},
    ]);
    expect(JSON.stringify(data)).not.toContain('endpoint');
    expect(JSON.stringify(data)).not.toContain('p256dh');
    expect(JSON.stringify(data)).not.toContain('auth_key');
    expect(f.queries).toHaveLength(1);
    expect(f.queries[0]).toContain('push_room_subscriptions');
    expect(f.queries[0]).toContain('s.user_id=em.user_id');
    expect(f.queries[0]).toContain('em.event_id=?');
  });
  it('refuses normal members and co-hosts without ever querying subscriptions',async()=>{
    const f=fixture();
    const res=await f.request('member-test');
    expect(res.status).toBe(403);
    expect(f.queries).toEqual([]);
  });
  it('fails closed when the room-aware push mapping is unavailable',async()=>{
    const f=fixture(false);
    const res=await f.request('host-test');
    expect(res.status).toBe(503);
    expect(f.queries).toEqual([]);
  });
  it('rejects access to a different room with the same ID claim',async()=>{
    const f=fixture();
    const res=await events.request('https://example.invalid/another-room/push-registrations',{
      headers:{'x-fixture-user':'host-test'}
    },f.env);
    expect(res.status).toBe(403);
    expect(f.queries).toEqual([]);
  });
});
