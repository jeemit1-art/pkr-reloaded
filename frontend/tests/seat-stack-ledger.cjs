'use strict';
const assert=require('node:assert/strict');
const {compute}=require('../public/seat-stack-ledger.js');
const game={starting_chips:100,chip_value:25,bank_size:25,defaultBuyin:25,hand_tracking:1};
const p=(name,amount=25,count=1)=>({name,transactions:Array.from({length:count},()=>({type:'buyin',amount}))});
const people={seat1:p('Alex'),seat2:p('Blair')};
function hand(id,actions,winner,options={}){
  const gross=actions.reduce((s,a)=>s+a.chips,0);
  return {id,hand_no:id,mode:'full',pot_chips:gross,actions,result:winner?{
    pot_winners:[{potIdx:0,winnerName:winner,chips:gross,label:'Main Pot'}],uncalled_returns:[]
  }:null,...options};
}
const actions=[
 {display_name:'Alex',action:'post',chips:5},
 {display_name:'Blair',action:'call',chips:5},
];
let stacks=compute(game,people,[]);
assert.equal(stacks.seat1.chips,100);
assert.equal(stacks.seat1.source,'issued');
assert.equal(stacks.seat1.buyinDollars,25);
stacks=compute(game,people,[hand(1,actions,'Alex')]);
assert.equal(stacks.seat1.chips,105);
assert.equal(stacks.seat2.chips,95);
assert.equal(stacks.seat1.cashValue,26.25);
assert.equal(stacks.seat2.source,'tracked');
stacks=compute(game,people,[hand(1,actions,'Alex'),hand(2,[
 {display_name:'Alex',chips:15},{display_name:'Blair',chips:15}
],'Blair')]);
assert.equal(stacks.seat1.chips,90);
assert.equal(stacks.seat2.chips,110);
assert.equal(stacks.seat1.hands,2);
stacks=compute(game,people,[hand(1,actions,'Alex'),hand(2,[
 {display_name:'Alex',chips:8},{display_name:'Blair',chips:8}
],null)]);
assert.equal(stacks.seat1.chips,97);
assert.equal(stacks.seat2.chips,87);
assert.equal(stacks.seat2.unsettledChips,8);
stacks=compute(game,people,[hand(1,actions,'Alex'),hand(2,[
 {display_name:'Alex',chips:8},{display_name:'Blair',chips:8}
],null,{voided:1})]);
assert.equal(stacks.seat1.chips,105);
stacks=compute(game,people,[{id:3,hand_no:3,actions:[
 {display_name:'Alex',chips:10},{display_name:'Blair',chips:20}
],pot_chips:30,result:{pot_winners:[
 {potIdx:0,chips:20,label:'Main Pot',winnerName:'Alex'},
 {potIdx:1,chips:10,label:'Side Pot',winnerName:'Blair'},
],uncalled_returns:[]}}]);
assert.equal(stacks.seat1.chips,110);
assert.equal(stacks.seat2.chips,90);
stacks=compute(game,people,[{id:4,hand_no:4,actions:[
 {display_name:'Alex',chips:10},{display_name:'Blair',chips:30}
],pot_chips:40,result:{pot_winners:[
 {potIdx:0,chips:20,label:'Main Pot',winnerName:'Alex'}],
 uncalled_returns:[{display_name:'Blair',chips:20}]}}]);
assert.equal(stacks.seat1.chips,110);
assert.equal(stacks.seat2.chips,90);
stacks=compute(game,people,[{id:5,hand_no:5,actions:[
 {display_name:'Alex',chips:9},{display_name:'Blair',chips:9}
],pot_chips:18,result:{pot_winners:[{potIdx:0,chips:18,label:'Main Pot',
 winnerName:'Alex, Blair',split_winners:[
 {winnerName:'Alex',chips:9},{winnerName:'Blair',chips:9}]}],uncalled_returns:[]}}]);
assert.equal(stacks.seat1.chips,100);assert.equal(stacks.seat2.chips,100);
stacks=compute(game,people,[{...hand(1,actions,'Alex'),result:{winner_name:'Alex',pot_chips:10}}]);
assert.equal(stacks.seat1.source,'review');assert.equal(stacks.seat1.chips,null);
stacks=compute(game,{seat1:p('Alex',10),seat2:p('Blair')},[]);
assert.equal(stacks.seat1.chips,null);assert.equal(stacks.seat1.source,'money');
stacks=compute(game,{seat1:p('Alex',25,2),seat2:p('Blair')},[hand(1,actions,'Alex')]);
assert.equal(stacks.seat1.chips,205);
stacks=compute(game,{seat1:p('Alex'),seat2:p(' alex ')},[hand(1,actions,'Alex')]);
assert.equal(stacks.seat1.source,'review');assert.equal(stacks.seat2.source,'review');
stacks=compute({...game,hand_tracking:0},people,[hand(1,actions,'Alex')]);
assert.equal(stacks.seat1.source,'issued');assert.equal(stacks.seat1.chips,100);
assert.equal(compute(game,people,[]).seat2.chips,100);
console.log('PASS: 14 seat chip/bank and hand-stack assertions; side pots, tied pots, refunds, voids, rebuys, unsafe histories.');
