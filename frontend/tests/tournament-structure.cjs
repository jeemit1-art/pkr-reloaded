/* Deterministic tournament structure regression: no API/D1 writes.
   Validate every offered duration and preserve engine's 100-stage bound. */
'use strict';
const fs=require('node:fs');
const vm=require('node:vm');
const assert=require('node:assert/strict');
const path=require('node:path');

const original=fs.readFileSync(path.resolve(__dirname,'../public/tournament.js'),'utf8');
assert.match(original,/function genBlinds\(chips, hours\)/);
assert.match(original,/window\.openTournament=function\(\)/);
const instrumented=original.replace('function genBlinds(chips, hours) {',
  'window.__testGenerateBlindStructure = function genBlinds(chips, hours) {');
const context={window:{},document:{getElementById:()=>null},console,fetch:()=>{throw Error('No API access allowed in unit test')},setInterval:()=>{throw Error('Timer started during load')},clearInterval:()=>{}};
context.window.window=context.window;
vm.createContext(context);
vm.runInContext(instrumented,context,{timeout:2000,filename:'tournament.js'});
assert.equal(typeof context.window.openTournament,'function');
assert.equal(typeof context.window.__testGenerateBlindStructure,'function');

for(const hours of [2,3,4,5,6,8,10,12,16,20,24]){
 const levels=context.window.__testGenerateBlindStructure(10000,hours);
 assert.ok(levels.length>=8&&levels.length<=100,'stage limit '+hours);
 assert.ok(levels.length>20 || hours<8,'longer tournaments must have extended blind stages: '+hours);
 assert.equal(levels.reduce((s,l)=>s+l.duration_secs,0),hours*3600,'exact duration '+hours);
 levels.forEach((lv,i)=>{
  assert.equal(lv.level_num,i+1,'sequential level '+hours);
  assert.ok(Number.isSafeInteger(lv.duration_secs)&&lv.duration_secs>=30&&lv.duration_secs<=7200,'duration '+hours+' level '+(i+1));
  if(lv.is_break)assert.equal(lv.small_blind+lv.big_blind,0,'break has no blinds');
  else{
   assert.ok(Number.isSafeInteger(lv.small_blind)&&lv.small_blind>0,'small blind');
   assert.ok(Number.isSafeInteger(lv.big_blind)&&lv.big_blind>lv.small_blind,'big blind');
   assert.ok(Number.isSafeInteger(lv.ante)&&lv.ante>=0,'ante');
  }
 });
 const playable=levels.filter(l=>!l.is_break);
 assert.ok(playable.every((lv,i)=>i===0||lv.small_blind>=playable[i-1].small_blind),'blinds never decrease');
}
console.log('Tournament control loads and all 2–24 hour blind structures pass');
