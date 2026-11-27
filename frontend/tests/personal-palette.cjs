'use strict';
const assert=require('node:assert/strict');
const {palette}=require('../scripts/compile-personal-theme.cjs');
const lum=hex=>hex.slice(1).match(/../g).slice(0,3).map(x=>{const n=parseInt(x,16)/255;return n<=.04045?n/12.92:((n+.055)/1.055)**2.4;}).reduce((a,x,i)=>a+x*[.2126,.7152,.0722][i],0);
const contrast=(a,b)=>{const x=lum(a),y=lum(b);return (Math.max(x,y)+.05)/(Math.min(x,y)+.05)};
for(const [mode,p] of Object.entries(palette)){
 for(const [fg,bg] of [['ink','canvas'],['ink','surface'],['ink','raised'],['muted','canvas'],['muted','surface'],['muted','raised'],['accent','accentSurface'],['gain','surface'],['gain','gainSurface'],['loss','surface'],['loss','lossSurface'],['warning','warningSurface'],['onDark','primary'],['onDark','gainFill'],['onDark','felt'],['onDark','hero'],['onDark','heroLiveGlow'],['onDark','dangerFill'],['onGold','goldFill']]){
  assert(contrast(p[fg],p[bg])>=4.5,mode+' '+fg+'/'+bg+' ratio '+contrast(p[fg],p[bg]).toFixed(2));
 }
 assert(contrast(p.control,p.surface)>=3,mode+' input control boundary');
}
console.log('PASS both personal palettes: text, status, controls, primary action and hero contrast');

const postcss=require('postcss');
const {transform,PERSONAL,LEGACY}=require('../scripts/compile-personal-theme.cjs');
const sample=postcss.parse(`
@layer pkr-lounge {
 html.pkr-lounge .card { background:#fff!important;color:#1b1f2a!important;padding:12px; }
 html[data-pkr-room-experience="live"] {--pkr-ex-accent:#66e6a2;--pkr-ex-page:#0b2018}
 html[data-pkr-room-experience="command"] {--pkr-ex-accent:#e9bf76;--pkr-ex-page:#061410}
}
:is(html,body) {background:#fff}
button {background:#3e63dd;color:#fff}
#gameScreen .seat {color:#ffc53d}
@keyframes sampleGlow {from{background:#14242c}to{background:#fff}}
.test {animation:sampleGlow 1s linear}
`);
transform(sample);
let modernCards=0,legacyCards=0;
sample.walkRules(rule=>{
 if(rule.selector.includes('.card')){
  assert(rule.selector.includes(PERSONAL)||rule.selector.includes(LEGACY),'Old card paint must not match both modes');
  if(rule.selector.includes(PERSONAL)){
   modernCards++;
   assert(rule.toString().includes('var(--pkr-personal-surface)'));
   assert(rule.toString().includes('var(--pkr-personal-ink)'));
   assert(!rule.toString().includes('#1b1f2a'));
  }else{legacyCards++;assert(rule.toString().includes('#1b1f2a'));}
  assert(rule.toString().includes('padding:12px'));
 }
 if(rule.selector.includes(PERSONAL)&&rule.selector.includes('data-pkr-room-experience')){
  assert(rule.toString().includes('--pkr-ex-accent:var(--pkr-personal-accent)'));
  assert(rule.toString().includes('--pkr-ex-page:var(--pkr-personal-canvas)'));
 }
});
assert.equal(modernCards,1);assert.equal(legacyCards,1);
assert(sample.toString().includes('@keyframes pkr-personal-sampleGlow'));
assert(sample.toString().includes('animation:pkr-personal-sampleGlow 1s linear'));
console.log('PASS original paint is unreachable on personal routes; room layouts use one palette; shared geometry and legacy game paint preserved.');
