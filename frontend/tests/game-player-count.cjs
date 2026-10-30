'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const ts=require('typescript');
const src=fs.readFileSync(path.resolve(__dirname,'../src/lib/game-player-count.ts'),'utf8');
const transpiled=ts.transpileModule(src,{compilerOptions:{
  target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS,
}}).outputText;
const moduleValue={exports:{}};
vm.runInNewContext(transpiled,{module:moduleValue,exports:moduleValue.exports,Number,Math},{timeout:3000});
const label=moduleValue.exports.playerCountLabel;
assert.equal(label(13),'13 players');
assert.equal(label(1),'1 player');
assert.equal(label(0),'No players recorded');
for(const value of [undefined,null,Number.NaN,Infinity,-1,2.3]){
 assert.equal(label(value),'Player count unavailable');
}
console.log('PASS: real player counts, zero, singular, unknown values and no false 0 player label');

