import {describe,it,expect,vi} from 'vitest';
vi.mock('../middleware',async(importOriginal)=>{
 const base=await importOriginal<typeof import('../middleware')>();
 return {...base,authMiddleware:async(c:any,next:any)=>{
  c.set('userId','synthetic-host');await next();
 },requireEventRole:async()=>true};
});
import hands from './hands';
const u='https://fixture.invalid/games/g/hands/h';
const execution:any={waitUntil:(_:Promise<unknown>)=>{}};
const expected=[
 {user_id:'a',display_name:'Alex',seat_number:1},
 {user_id:'b',display_name:'Ben',seat_number:2},
];
function fixture(enabled=true){
 const game={id:'g',event_id:'e',status:'active',seats:4};
 const hand={id:'h',game_id:'g',mode:'full',voided:0};
 let rows:Array<{user_id:string;display_name:string;seat_number:number;opening_chips:number}>=[];
 let actions=false,writes=0,roster=expected.map(x=>({...x})),forceRace=false;
 const db={prepare(sql:string){return {bind(...args:any[]){
  return {
   async first():Promise<any>{
    if(sql.includes('FROM games WHERE id=?'))return {...game};
    if(sql.includes('FROM hands WHERE id=? AND game_id=?'))return {...hand};
    if(sql.includes('FROM hand_actions WHERE hand_id=?'))return actions?{id:'already'}:null;
    return null;
   },
   async all():Promise<any>{
    if(sql.includes('FROM hand_stack_baselines'))return {results:rows.map(x=>({...x}))};
    if(sql.includes('FROM game_players'))return {results:roster.map(x=>({...x}))};
    return {results:[]};
   },
   async run():Promise<any>{
    if(!sql.trimStart().startsWith('INSERT INTO hand_stack_baselines'))
     throw Error('Unexpected SQL write');
    if(!sql.includes('NOT EXISTS(SELECT 1 FROM hand_actions')||
       !sql.includes("status='active'")||
       !sql.includes('NOT EXISTS(SELECT 1 FROM hand_stack_baselines'))
     throw Error('Baseline must use guarded all-roster insert');
    const [handId,gameId,actor,json,rosterGame,size]=args;
    const submitted=JSON.parse(json);
    if(forceRace||actions||rows.length||hand.voided||handId!=='h'||
       gameId!=='g'||actor!=='synthetic-host'||rosterGame!=='g'||
       roster.length!==size||submitted.some((s:any)=>!roster.some(r=>
         r.user_id===s.user_id&&r.display_name===s.display_name&&
         r.seat_number===s.seat_number)))
      return {meta:{changes:0}};
    rows=submitted;writes+=submitted.length;
    return {meta:{changes:submitted.length}};
   },
  };
 }};}};
 return {env:{DB:db,JWT_SECRET:'synthetic',PKR_ENV:'staging',
   ...(enabled?{PKR_INTEGRITY_STACKS:'1'}:{})} as any,
  game,hand,getRows:()=>rows,setActions:(v:boolean)=>{actions=v;},
  changeRoster:()=>{roster=[{...expected[0]}];},race:()=>{forceRace=true;},writes:()=>writes};
}
const request=(json:any):RequestInit=>({method:'POST',
 headers:{'Content-Type':'application/json'},body:JSON.stringify(json)});
const chosen=expected.map((p,i)=>({...p,opening_chips:i?60:100}));
describe('host-confirmed opening chip baselines',()=>{
 it('does not query optional tables when stack migration is disabled',async()=>{
  const f=fixture(false);
  const response=await hands.request(u+'/stack-baseline',{},f.env,execution);
  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({enabled:false,confirmed:false,players:[]});
  const denied=await hands.request(u+'/confirm-stacks',request({
   verified:true,opening_stacks:chosen,
  }),f.env,execution);
  expect(denied.status).toBe(503);
  expect(f.writes()).toBe(0);
 });
 it('returns current seats without inventing any opening chip values',async()=>{
  const f=fixture();
  const response=await hands.request(u+'/stack-baseline',{},f.env,execution);
  expect(response.status).toBe(200);
  const body=await response.json() as any;
  expect(body).toMatchObject({enabled:true,confirmed:false,players:expected});
  expect(body.players.every((x:any)=>x.opening_chips===undefined)).toBe(true);
 });
 it('persists every manually confirmed starting stack only once',async()=>{
  const f=fixture();
  const body={verified:true,opening_stacks:chosen};
  const first=await hands.request(u+'/confirm-stacks',request(body),f.env,execution);
  expect(first.status).toBe(200);
  expect(f.getRows()).toEqual(chosen);
  const read=await hands.request(u+'/stack-baseline',{},f.env,execution);
  expect(await read.json()).toMatchObject({
   enabled:true,confirmed:true,players:chosen,
  });
  expect((await hands.request(u+'/confirm-stacks',request(body),f.env,execution)).status).toBe(409);
  expect(f.writes()).toBe(2);
 });
 it('rejects unverified, incomplete and invalid stack counts',async()=>{
  const f=fixture();
  for(const body of [
    {opening_stacks:chosen},
    {verified:true,opening_stacks:chosen.slice(0,1)},
    {verified:true,opening_stacks:[{...chosen[0],opening_chips:0},chosen[1]]},
    {verified:true,opening_stacks:[{...chosen[0],seat_number:3},chosen[1]]},
  ]){
    const r=await hands.request(u+'/confirm-stacks',request(body),f.env,execution);
    expect(r.status).toBe(400);
  }
  expect(f.writes()).toBe(0);
 });
 it('cannot record a starting stack after another host started betting',async()=>{
  const f=fixture();f.setActions(true);
  const read=await hands.request(u+'/stack-baseline',{},f.env,execution);
  expect(read.status).toBe(409);
  const write=await hands.request(u+'/confirm-stacks',request({
   verified:true,opening_stacks:chosen,
  }),f.env,execution);
  expect(write.status).toBe(409);
  expect(f.writes()).toBe(0);
 });
 it('rejects a concurrent player-roster change at write time',async()=>{
  const f=fixture();f.race();
  const response=await hands.request(u+'/confirm-stacks',request({
   verified:true,opening_stacks:chosen,
  }),f.env,execution);
  expect(response.status).toBe(409);
  expect(await response.json()).toMatchObject({code:'STACK_BASELINE_CONFLICT'});
  expect(f.getRows()).toEqual([]);
 });
});
