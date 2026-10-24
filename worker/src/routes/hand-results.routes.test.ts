import { describe, expect, it, vi } from 'vitest';

vi.mock('../middleware',async(importOriginal)=>{
  const original=await importOriginal<typeof import('../middleware')>();
  return {
    ...original,
    authMiddleware:async(c:any,next:any)=>{
      c.set('userId','synthetic-host');
      await next();
    },
    requireEventRole:async()=>true,
  };
});

import hands from './hands';

function fixture() {
  const game={id:'g',event_id:'e',status:'active'};
  const hand={id:'h',game_id:'g',hand_no:1,board:'[]',pot_chips:350};
  let result:any=null;
  let insertCount=0;
  const env:any={
    DB:{
      prepare(sql:string){
        return {
          bind(...params:any[]){
            return {
              async first(){
                if(sql.includes('FROM games WHERE id=?'))return game;
                if(sql.includes('FROM hands WHERE id=? AND game_id=?'))return hand;
                if(sql.includes('SELECT id FROM hands WHERE id=? AND game_id=?'))return hand;
                if(sql.includes('FROM hand_results WHERE hand_id=?'))return result;
                return null;
              },
              async all(){
                if(sql.includes('FROM hand_actions'))return {results:[]};
                return {results:[]};
              },
              async run(){
                if(sql.trimStart().startsWith('INSERT INTO hand_results')){
                  insertCount++;
                  result={
                    id:params[0],hand_id:params[1],game_id:params[2],
                    winner_user_id:params[3],winner_name:params[4],
                    pot_chips:params[5],hole_cards:params[6],split_pot:params[7],
                  };
                }
                if(sql.startsWith('UPDATE hand_results')) {
                  result={
                    ...result,winner_user_id:params[0],winner_name:params[1],
                    pot_chips:params[2],hole_cards:params[3],split_pot:params[4],
                  };
                }
                return {meta:{changes:1}};
              },
            };
          },
        };
      },
    },
  };
  return {env,get insertCount(){return insertCount;},get stored(){return result;}};
}

const valid={
  winner_name:'Alex, Charlie',
  hole_cards:{Alex:['A♠','A♥']},
  split_pot:true,
  pot_winners:[
    {potIdx:0,winnerName:'Alex',label:'Main Pot',chips:200},
    {potIdx:1,winnerName:'Charlie',label:'Side Pot 1',chips:150},
  ],
};

describe('API hand side-pot history persistence',()=>{
  it('saves and reopens exact per-pot winners using existing D1 columns',async()=>{
    const f=fixture();
    const created=await hands.request('https://test.invalid/games/g/hands/h/result',{
      method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(valid),
    },f.env);
    expect(created.status).toBe(200);
    const saved=await created.json() as any;
    expect(saved.result.pot_winners).toEqual(valid.pot_winners);
    expect(JSON.parse(saved.result.hole_cards)).toEqual(valid.hole_cards);
    expect(f.insertCount).toBe(1);

    const retrieved=await hands.request('https://test.invalid/games/g/hands/h',{},f.env);
    expect(retrieved.status).toBe(200);
    const data=await retrieved.json() as any;
    expect(data.result.pot_winners).toEqual(valid.pot_winners);
    expect(data.result.pot_chips).toBe(350);
    expect(JSON.parse(data.result.hole_cards)).toEqual(valid.hole_cards);
  });

  it('rejects a side-pot winner allocation that loses a chip',async()=>{
    const f=fixture();
    const bad={...valid,pot_winners:[valid.pot_winners[0],{...valid.pot_winners[1],chips:149}]};
    const created=await hands.request('https://test.invalid/games/g/hands/h/result',{
      method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(bad),
    },f.env);
    expect(created.status).toBe(422);
    expect(f.insertCount).toBe(0);
  });
});
