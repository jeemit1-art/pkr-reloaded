import {describe,expect,it,vi} from 'vitest';
vi.mock('../middleware',async(importOriginal)=>{
  const original=await importOriginal<typeof import('../middleware')>();
  return {...original,
    authMiddleware:async(c:any,next:any)=>{c.set('userId','synthetic-host');await next();},
    requireEventRole:async()=>true};
});
import hands from './hands';

function fixture(actions:Array<{display_name:string;action:string;chips:number}>,pot:number){
  const game={id:'g',event_id:'e',status:'active',seats:4};
  const hand={id:'h',game_id:'g',hand_no:1,mode:'full',pot_chips:pot,voided:0,dealer_seat:1};
  const players=[
    {display_name:'Alex',seat_number:1},
    {display_name:'Ben',seat_number:2},
    {display_name:'Charlie',seat_number:3},
  ];
  let saved:any=null,writes=0;
  const db={prepare(sql:string){return {bind(...args:any[]){
    return {
      async first():Promise<any>{
        if(sql.includes('FROM games WHERE id=?'))return {...game};
        if(sql.includes('SELECT id FROM hands WHERE id=? AND game_id=?'))return {id:'h'};
        if(sql.includes('SELECT * FROM hands WHERE id=? AND game_id=?'))return {...hand};
        if(sql.includes('FROM hand_results WHERE hand_id=?'))return saved?{...saved}:null;
        return null;
      },
      async all():Promise<any>{
        if(sql.includes('FROM game_players'))return {results:players.map(p=>({...p}))};
        if(sql.includes('FROM hand_actions'))return {results:actions.map(p=>({...p}))};
        return {results:[]};
      },
      async run():Promise<any>{
        if(!sql.trimStart().startsWith('INSERT INTO hand_results'))return {meta:{changes:0}};
        if(saved)return {meta:{changes:0}};
        saved={id:args[0],hand_id:args[1],game_id:args[2],
          winner_user_id:args[3],winner_name:args[4],
          pot_chips:args[5],hole_cards:args[6],split_pot:args[7]};
        writes++;return {meta:{changes:1}};
      },
    };
  }};}};
  return {env:{DB:db,PKR_ENV:'staging',JWT_SECRET:'synthetic'} as any,
    hand,players,getSaved:()=>saved,getWrites:()=>writes};
}
const url='https://fixture.invalid/games/g/hands/h/result';
const post=(payload:unknown):RequestInit=>({
  method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload),
});
describe('server-authoritative pot/refund validation',()=>{
  it('returns uncalled chips and stores only the matched portion as the winner pot',async()=>{
    const f=fixture([
      {display_name:'Alex',action:'allin',chips:100},
      {display_name:'Ben',action:'allin',chips:60},
    ],160);
    const res=await hands.request(url,post({
      winner_name:'Alex',winner_user_id:'a',hole_cards:{},split_pot:false,
    }),f.env);
    expect(res.status).toBe(200);
    const data=await res.json() as any;
    expect(data.result.pot_winners).toEqual([
      {potIdx:0,winnerName:'Alex',chips:120,label:'Main Pot'},
    ]);
    expect(data.result.uncalled_returns).toEqual([{display_name:'Alex',chips:40}]);
    expect(f.getWrites()).toBe(1);
  });
  it('rejects invented side-pot winnings or an ineligible folded winner',async()=>{
    const f=fixture([
      {display_name:'Alex',action:'allin',chips:50},
      {display_name:'Ben',action:'call',chips:100},
      {display_name:'Charlie',action:'call',chips:100},
      {display_name:'Charlie',action:'fold',chips:0},
    ],250);
    const bad=await hands.request(url,post({
      winner_name:'Charlie',hole_cards:{},split_pot:true,
      pot_winners:[
        {potIdx:0,winnerName:'Charlie',chips:150,label:'Main Pot'},
        {potIdx:1,winnerName:'Ben',chips:100,label:'Side Pot 1'},
      ],
    }),f.env);
    expect(bad.status).toBe(422);
    expect(await bad.json()).toMatchObject({code:'POT_ALLOCATION_INVALID'});
    expect(f.getWrites()).toBe(0);
    const good=await hands.request(url,post({
      winner_name:'Alex, Ben',hole_cards:{},split_pot:true,
      pot_winners:[
        {potIdx:0,winnerName:'Alex',chips:150,label:'Main Pot'},
        {potIdx:1,winnerName:'Ben',chips:100,label:'Side Pot 1'},
      ],
    }),f.env);
    expect(good.status).toBe(200);
  });
  it('refuses to save winner when stored hand pot disagrees with recorded actions',async()=>{
    const f=fixture([
      {display_name:'Alex',action:'allin',chips:100},
      {display_name:'Ben',action:'call',chips:100},
    ],201);
    const bad=await hands.request(url,post({winner_name:'Alex',hole_cards:{}}),f.env);
    expect(bad.status).toBe(409);
    expect(await bad.json()).toMatchObject({code:'POT_RECONCILIATION_REQUIRED'});
    expect(f.getWrites()).toBe(0);
  });
  it('awards the odd chip to the first tied player clockwise after the button',async()=>{
    const actions=[
      {display_name:'Alex',action:'allin',chips:50},
      {display_name:'Ben',action:'call',chips:50},
      {display_name:'Charlie',action:'post',chips:1},
      {display_name:'Charlie',action:'fold',chips:0},
    ];
    const f=fixture(actions,101);
    const wrong=await hands.request(url,post({
      winner_name:'Alex, Ben',hole_cards:{},split_pot:true,
      pot_winners:[{potIdx:0,winnerName:'Alex, Ben',chips:101,label:'Main Pot',
        split_winners:[{winnerName:'Alex',chips:51},{winnerName:'Ben',chips:50}]}],
    }),f.env);
    expect(wrong.status).toBe(422);
    expect(await wrong.json()).toMatchObject({code:'POT_ALLOCATION_INVALID'});
    const correct=await hands.request(url,post({
      winner_name:'Alex, Ben',hole_cards:{},split_pot:true,
      pot_winners:[{potIdx:0,winnerName:'Alex, Ben',chips:101,label:'Main Pot',
        split_winners:[{winnerName:'Alex',chips:50},{winnerName:'Ben',chips:51}]}],
    }),f.env);
    expect(correct.status).toBe(200);
    const data=await correct.json() as any;
    expect(data.result.pot_winners[0].split_winners)
      .toEqual([{winnerName:'Ben',chips:51},{winnerName:'Alex',chips:50}]);
    expect(f.getWrites()).toBe(1);
  });

  it('rejects client-altered allocation amount even if the total is otherwise plausible',async()=>{
    const f=fixture([
      {display_name:'Alex',action:'allin',chips:100},
      {display_name:'Ben',action:'allin',chips:60},
    ],160);
    const bad=await hands.request(url,post({
      winner_name:'Alex',hole_cards:{},split_pot:false,
      pot_winners:[{potIdx:0,winnerName:'Alex',chips:160,label:'Main Pot'}],
    }),f.env);
    expect(bad.status).toBe(422);
    expect(f.getWrites()).toBe(0);
  });
});
