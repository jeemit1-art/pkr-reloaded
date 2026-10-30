import {describe,it,expect,vi} from 'vitest';
vi.mock('../middleware',async original=>{
 const real=await original<typeof import('../middleware')>();
 return {...real,
  authMiddleware:async(c:any,next:any)=>{c.set('userId','authorised');await next();},
  requireEventRole:async(_c:any,_room:string,role:string)=>role!=='host'||_c.env.asHost!==false,
 };
});
import visibility from './historical-visibility';
import events from './events';

function fixture(){
 let stored:string|null=null;
 const writes:string[]=[];
 const kv={
  get:vi.fn(async (_key:string)=>stored),
  put:vi.fn(async (key:string,value:string)=>{stored=value;writes.push(key);}),
 };
 const db={
  prepare:(sql:string)=>({bind:(room:string,name:string)=>({
   all:async()=>({results:[
    {display_name:'Test',games_played:1},
    {display_name:'Test1',games_played:1},
    {display_name:'Jaimin',games_played:2},
   ]}),
   first:async()=>{
    if(room!=='test-room')return {n:0};
    if(sql.includes('FROM game_players gp'))
      return {n:['test','test1','jigsr'].includes(name)?1:0};
    if(sql.includes('FROM event_members em'))
      return {n:name==='jigsr'?1:0};
    throw Error('Unexpected read');
   },
  })}),
 };
 const env:any={KV:kv,DB:db,asHost:true};
 return {kv,env,writes,get:()=>stored};
}
const send=(room:string,body:unknown,env:unknown)=>visibility.request(
 'https://example.invalid/'+room+'/historical-player-visibility',
 {method:'PUT',headers:{'content-type':'application/json'},body:JSON.stringify(body)},env as any);

describe('historical roster visibility - nonfinancial',()=>{
 it('archives only recorded guest names and can restore them without database writes',async()=>{
  const f=fixture();
  const a=await send('test-room',{name:'  Test  ',hidden:true},f.env);
  expect(a.status).toBe(200);
  expect(await a.json()).toEqual({hidden_names:['test']});
  const b=await send('test-room',{name:'Test1',hidden:true},f.env);
  expect(b.status).toBe(200);
  expect(await b.json()).toEqual({hidden_names:['test','test1']});
  const get=await visibility.request('https://example.invalid/test-room/historical-player-visibility',{},f.env);
  expect(get.status).toBe(200);
  expect(await get.json()).toEqual({hidden_names:['test','test1']});
  expect(f.writes).toEqual(['room-historical-hidden:v1:test-room','room-historical-hidden:v1:test-room']);
  const restored=await send('test-room',{name:'Test',hidden:false},f.env);
  expect(restored.status).toBe(200);
  expect(await restored.json()).toEqual({hidden_names:['test1']});
 });
 it('excludes archived Test and Test1 from new game seat suggestions',async()=>{
  const f=fixture();
  await send('test-room',{name:'Test',hidden:true},f.env);
  await send('test-room',{name:'Test1',hidden:true},f.env);
  const response=await events.request('https://example.invalid/test-room/players',{},f.env);
  expect(response.status).toBe(200);
  const rows=await response.json() as Array<{display_name:string}>;
  expect(rows.map(p=>p.display_name)).toEqual(['Jaimin']);
 });
 it('refuses changes by non-host members',async()=>{
  const f=fixture();f.env.asHost=false;
  const r=await send('test-room',{name:'Test',hidden:true},f.env);
  expect(r.status).toBe(403);expect(f.writes).toHaveLength(0);
 });
 it('will not archive actual members, unknown players or people in another room',async()=>{
  const f=fixture();
  expect((await send('test-room',{name:'Jigsr',hidden:true},f.env)).status).toBe(409);
  expect((await send('test-room',{name:'Nobody',hidden:true},f.env)).status).toBe(404);
  expect((await send('another-room',{name:'Test',hidden:true},f.env)).status).toBe(404);
  expect(f.writes).toHaveLength(0);
 });
 it('rejects malformed input without archiving',async()=>{
  const f=fixture();
  for(const body of [{name:'Test'}, {name:'Test',hidden:'yes'},
    {name:'Test',hidden:true,role:'host'},{name:'',hidden:true},
    {name:'../Test',hidden:true}]){
    const r=await send('test-room',body,f.env);expect(r.status).toBe(400);
  }
  expect(f.writes).toHaveLength(0);
 });
 it('preserves prior archived names and rejects malformed stored KV rather than overwriting',async()=>{
  const f=fixture();
  await send('test-room',{name:'Test1',hidden:true},f.env);
  await send('test-room',{name:'Test',hidden:true},f.env);
  expect(JSON.parse(f.get()!).names).toEqual(['test','test1']);
  f.kv.get.mockResolvedValueOnce('not-json');
  const get=await visibility.request('https://example.invalid/test-room/historical-player-visibility',{},f.env);
  expect(get.status).toBe(503);
  expect(f.writes).toHaveLength(2);
 });
});

