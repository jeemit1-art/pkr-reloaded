import {describe,expect,it,vi} from 'vitest';
vi.mock('../middleware',async(importOriginal)=>{
  const original=await importOriginal<typeof import('../middleware')>();
  return {...original,
    authMiddleware:async(c:any,next:any)=>{c.set('userId','synthetic-host');await next();},
    requireEventRole:async()=>true};
});
import hands from './hands';
import {serializeHandCards} from '../hand-result-pots';

const stacks=[
  {display_name:'Alex',seat_number:1,opening_chips:100},
  {display_name:'Ben',seat_number:2,opening_chips:60},
];
function fixture(opts?:{winner?:boolean;voided?:number;pot?:number}){
  const game={id:'g',event_id:'e',status:'active',seats:4};
  const hand={id:'h',game_id:'g',dealer_seat:1,
    pot_chips:opts?.pot??160,voided:opts?.voided??0};
  const actions=[
    {display_name:'Alex',action:'allin',chips:100},
    {display_name:'Ben',action:'allin',chips:60},
  ];
  const stored=serializeHandCards({},[
    {potIdx:0,winnerName:'Ben',chips:120,label:'Main Pot'},
  ],160,[{display_name:'Alex',chips:40}]);
  const result=opts?.winner?{
    hand_id:'h',game_id:'g',winner_name:'Ben',pot_chips:160,hole_cards:stored,
  }:null;
  let writes=0;
  const db={prepare(sql:string){return {bind(...args:any[]){
    return {
      async first():Promise<any>{
        if(sql.includes('FROM games WHERE id=?'))return {...game};
        if(sql.includes('FROM hands WHERE id=? AND game_id=?'))return {...hand};
        if(sql.includes('FROM hand_results WHERE hand_id=?'))return result;
        return null;
      },
      async all():Promise<any>{
        if(sql.includes('FROM hand_actions WHERE hand_id=?'))
          return {results:actions};
        return {results:[]};
      },
      async run():Promise<any>{writes++;throw Error('Audit must never write to D1');},
    };
  }};}};
  return {env:{DB:db,PKR_ENV:'staging',JWT_SECRET:'synthetic'} as any,
    getWrites:()=>writes,actions,hand};
}
const url='https://fixture.invalid/games/g/hands/h/audit-stacks';
const post=(body:any):RequestInit=>({
  method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body),
});
const ex:any={waitUntil:(_:Promise<unknown>)=>{}};
describe('read-only host-supplied stack reconciliation',()=>{
  it('shows open pot separately from player balances while a hand is unfinished',async()=>{
    const f=fixture();
    const res=await hands.request(url,post({opening_stacks:stacks}),f.env,ex);
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      ok:true,verified_input_only:true,audit:{
        opening_total:160,recorded_pot_chips:160,
        unsettled_pot_chips:160,closing_total:0,
      },
    });
    expect(f.getWrites()).toBe(0);
  });
  it('reconciles all starting chips after payout and unmatched return',async()=>{
    const f=fixture({winner:true});
    const res=await hands.request(url,post({opening_stacks:stacks}),f.env,ex);
    expect(res.status).toBe(200);
    const body=await res.json() as any;
    expect(body.audit.stacks.map((row:any)=>row.closing_chips)).toEqual([40,120]);
    expect(body.audit.unsettled_pot_chips).toBe(0);
    expect(f.getWrites()).toBe(0);
  });
  it('rejects invented opening stacks that cannot cover the declared all-ins',async()=>{
    const f=fixture();
    const res=await hands.request(url,post({
      opening_stacks:[{...stacks[0],opening_chips:99},stacks[1]],
    }),f.env,ex);
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({code:'STACK_AUDIT_FAILED'});
  });
  it('never uses a voided or inconsistent hand as a verified baseline',async()=>{
    const f=fixture({voided:1});
    expect((await hands.request(url,post({opening_stacks:stacks}),f.env,ex)).status).toBe(409);
    const mismatch=fixture({pot:161});
    expect((await hands.request(url,post({opening_stacks:stacks}),mismatch.env,ex)).status).toBe(409);
    expect(f.getWrites()).toBe(0);
  });
});
