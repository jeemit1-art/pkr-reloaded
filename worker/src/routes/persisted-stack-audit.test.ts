import {describe,it,expect,vi} from 'vitest';
vi.mock('../middleware',async(importOriginal)=>{
 const old=await importOriginal<typeof import('../middleware')>();
 return {...old,authMiddleware:async(c:any,next:any)=>{
  c.set('userId','synthetic-host');await next();
 },requireEventRole:async()=>true};
});
import hands from './hands';
const url='https://fixture.invalid/games/g/hands/h/audit-stacks';
const body=(value:any):RequestInit=>({
 method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(value),
});
const exec:any={waitUntil:(_:Promise<unknown>)=>{}};
function fixture(stacksExist=true){
 const game={id:'g',event_id:'e',status:'active',seats:4};
 const hand={id:'h',game_id:'g',dealer_seat:1,pot_chips:160,voided:0};
 const saved=stacksExist?[
  {display_name:'Alex',seat_number:1,opening_chips:100},
  {display_name:'Ben',seat_number:2,opening_chips:60},
 ]:[];
 let writes=0;
 const db={prepare(sql:string){return {bind(...args:any[]){return {
  async first():Promise<any>{
   if(sql.includes('FROM games WHERE id=?'))return {...game};
   if(sql.includes('SELECT * FROM hands WHERE id=?'))return {...hand};
   if(sql.includes('FROM hand_results WHERE hand_id=?'))return null;
   return null;
  },
  async all():Promise<any>{
   if(sql.includes('FROM hand_stack_baselines'))return {results:saved};
   if(sql.includes('FROM hand_actions'))return {results:[
    {display_name:'Alex',action:'allin',chips:100},
    {display_name:'Ben',action:'allin',chips:60},
   ]};
   return {results:[]};
  },
  async run():Promise<any>{writes++;throw Error('Auditing must be read only');},
 };}};}};
 return {env:{DB:db,PKR_ENV:'staging',PKR_INTEGRITY_STACKS:'1',
   JWT_SECRET:'synthetic'} as any,writes:()=>writes};
}
describe('read-only audit from immutable persisted stacks',()=>{
 it('ignores untrusted caller-submitted chips in integrity mode',async()=>{
  const f=fixture();
  const res=await hands.request(url,body({opening_stacks:[
   {display_name:'Alex',seat_number:1,opening_chips:1000000},
   {display_name:'Ben',seat_number:2,opening_chips:1000000},
  ]}),f.env,exec);
  expect(res.status).toBe(200);
  expect(await res.json()).toMatchObject({
   persisted_baseline:true,verified_input_only:false,
   audit:{opening_total:160,recorded_pot_chips:160,
    unsettled_pot_chips:160,closing_total:0},
  });
  expect(f.writes()).toBe(0);
 });
 it('rejects an audit that has no host-confirmed baseline',async()=>{
  const f=fixture(false);
  const res=await hands.request(url,body({opening_stacks:[
   {display_name:'Alex',seat_number:1,opening_chips:100},
   {display_name:'Ben',seat_number:2,opening_chips:60},
  ]}),f.env,exec);
  expect(res.status).toBe(428);
  expect(await res.json()).toMatchObject({code:'STACK_BASELINE_REQUIRED'});
  expect(f.writes()).toBe(0);
 });
});
