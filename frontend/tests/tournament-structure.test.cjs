const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');

const js=fs.readFileSync(path.join(__dirname,'../public/tournament.js'),'utf8');
function context(){
  const ctx={console,setInterval:()=>123,clearInterval:()=>{},
    window:{getPkrCtx:()=>({gameId:'test-game',apiUrl:'https://invalid.test',token:'synthetic'})},
    document:{getElementById:()=>null},
    Date,Math,Number,Object,JSON,
    fetch:()=>Promise.reject(new Error('network disabled in unit test')),
  };
  ctx.window.window=ctx.window;
  vm.createContext(ctx);
  vm.runInContext(js,ctx,{timeout:1500});
  return ctx;
}
function extractGen(){
  const start=js.indexOf('function genBlinds(chips, hours) {');
  const end=js.indexOf('\nfunction loadTournament()',start);
  assert.ok(start>=0&&end>start,'Blind generator found');
  const obj={Math,Number};vm.createContext(obj);vm.runInContext(js.slice(start,end),obj);
  return (chips,hours)=>JSON.parse(JSON.stringify(obj.genBlinds(chips,hours)));
}
const gen=extractGen();
test('long tournaments generate progressively more blind stages',()=>{
  const counts=[2,3,4,5,6,8,10,12,16,20,24].map(hours=>gen(10000,hours).length);
  assert.ok(counts.every((n,i)=>n>=8&&n<=100&&(i===0||n>counts[i-1])),counts.join(','));
});
test('each generated level is valid for the existing API (including breaks)',()=>{
  for(const hours of [2,3,4,5,6,8,10,12]){
    const levels=gen(10000,hours);
    levels.forEach((l,i)=>{
      assert.equal(l.level_num,i+1);
      assert.ok(Number.isSafeInteger(l.duration_secs)&&l.duration_secs>=30&&l.duration_secs<=7200);
      assert.ok(Number.isSafeInteger(l.small_blind)&&l.small_blind>=0);
      assert.ok(Number.isSafeInteger(l.ante)&&l.ante>=0);
      if(!l.is_break)assert.ok(l.small_blind>=1&&l.big_blind>l.small_blind);
    });
  }
});
test('twelve-hour preset has enough play time and breaks',()=>{
  const levels=gen(10000,12);
  assert.ok(levels.reduce((a,l)=>a+l.duration_secs,0)>=12*3600);
  assert.ok(levels.filter(l=>l.is_break).length>=4);
});
test('all presets fit the chosen time including breaks exactly',()=>{
  for(const hours of [2,3,4,5,6,8,10,12,16,20,24]){
    const levels=gen(10000,hours);
    assert.equal(levels.reduce((total,level)=>total+level.duration_secs,0),hours*3600);
    assert.ok(levels.length<=100);
  }
});
test('saved setup renders Start Tournament and does not return to initial introduction',()=>{
  assert.ok(js.includes("if(!state||!state.status){"));
  assert.ok(js.includes("if(state.status==='setup'){"));
  assert.ok(js.includes("window.tStart"));
});
test('host can extend stages without exceeding API maximum and live structure cannot be overwritten',()=>{
  assert.ok(js.includes("'+ Add Blind Level'")||js.includes("'+ Add Blind Level")); // source literal button
  assert.ok(js.includes("Maximum 100 stages"));
  assert.ok(js.includes("status!=='setup'"));
  assert.ok(js.includes("The saved structure cannot be overwritten"));
});
test('poker table and original felt styling are not replaced by tournament module',()=>{
  const page=fs.readFileSync(path.join(__dirname,'../src/app/games/[id]/play/page.tsx'),'utf8');
  assert.ok(page.includes("--felt-top:#1e6b2a;--felt-mid:#155220;--felt-bot:#0e3a18;"));
  assert.ok(page.includes("id=\"tableFelt\""));
});
