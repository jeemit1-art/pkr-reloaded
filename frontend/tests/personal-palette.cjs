'use strict';
const assert=require('node:assert/strict');
const {palette}=require('../scripts/compile-personal-theme.cjs');
const lum=hex=>hex.slice(1).match(/../g).slice(0,3).map(x=>{const n=parseInt(x,16)/255;return n<=.04045?n/12.92:((n+.055)/1.055)**2.4;}).reduce((a,x,i)=>a+x*[.2126,.7152,.0722][i],0);
const contrast=(a,b)=>{const x=lum(a),y=lum(b);return (Math.max(x,y)+.05)/(Math.min(x,y)+.05)};
for(const [mode,p] of Object.entries(palette)){
 for(const [fg,bg] of [['ink','canvas'],['ink','surface'],['ink','raised'],['muted','canvas'],['muted','surface'],['muted','raised'],['accent','accentSurface'],['gain','surface'],['gain','gainSurface'],['loss','surface'],['loss','lossSurface'],['warning','warningSurface'],['onDark','primary'],['onDark','hero'],['onDark','heroLiveGlow'],['onDark','dangerFill'],['onGold','goldFill']]){
  assert(contrast(p[fg],p[bg])>=4.5,mode+' '+fg+'/'+bg+' ratio '+contrast(p[fg],p[bg]).toFixed(2));
 }
 assert(contrast(p.control,p.surface)>=3,mode+' input control boundary');
}
console.log('PASS both personal palettes: text, status, controls, primary action and hero contrast');
