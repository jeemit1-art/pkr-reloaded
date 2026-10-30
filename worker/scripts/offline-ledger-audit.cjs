#!/usr/bin/env node
'use strict';
// Private read-only D1 audit helper; only counts and money aggregates go to stdout.
const fs=require('node:fs');
const vm=require('node:vm');
const path=require('node:path');
const ts=require('typescript');
const code=ts.transpileModule(
 fs.readFileSync(path.resolve(__dirname,'../src/player-leaderboard.ts'),'utf8'),
 {compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}
).outputText;
const moduleObject={exports:{}};
vm.runInNewContext(code,{module:moduleObject,exports:moduleObject.exports,Set,Map,Number,Math,String,console,Error,Object,Array},{timeout:3000});
let input='';
process.stdin.setEncoding('utf8');
process.stdin.on('data',chunk=>{input+=chunk;if(input.length>2000000)throw Error('Audit input exceeds size limit');});
process.stdin.on('end',()=>{
 try{
  const data=JSON.parse(input);
  if(!Array.isArray(data.rows)||!Array.isArray(data.verified))throw Error('Invalid private audit payload');
  const {leaders,audit}=moduleObject.exports.resolvePlayerLeaderboard(data.rows,new Set(data.verified));
  const matches=leaders.filter(p=>p.aliases.some(n=>['jeemit','jeemit shah'].includes(n.trim().toLowerCase())));
  console.log(JSON.stringify({
    ...audit,
    named_example_groups:matches.length,
    named_example_sessions:matches.reduce((n,p)=>n+p.games_played,0),
    named_example_net_cents:matches.reduce((n,p)=>n+p.total_net,0),
    named_example_profitable:matches.reduce((n,p)=>n+p.games_won,0),
  }));
 }catch{
  console.error('Read-only player audit could not reconcile source records.');
  process.exitCode=1;
 }
});
