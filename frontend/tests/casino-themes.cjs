'use strict';
/* Four opt-in casino designs are theme paint, not changes to poker results or payment records. */
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const root=path.resolve(__dirname,'..');
const read=p=>fs.readFileSync(path.join(root,p),'utf8');
const style=read('src/app/pkr-casino-themes.css');
const src=read('src/lib/personal-appearance.ts');
const settings=read('src/components/PersonalAppearance.tsx');
const init=read('public/pkr-appearance-init.js');
const layout=read('src/app/layout.tsx');
const nav=read('src/components/PersistentNavigation.tsx');
const postcss=require('postcss');
postcss.parse(style);
for(const name of ['luxe','neon','vip','tournament']){
 for(const mode of ['light','dark']){
  const selector='html[data-pkr-personal-style="'+name+'"][data-pkr-personal-theme="'+mode+'"]:not(:has(#gameScreen))';
  assert(style.includes(selector),'Missing independently authored '+name+' '+mode+' palette');
 }
 assert(style.includes('/images/casino/art-'+name+'.svg'),'Casino artwork missing from theme '+name);
 assert(read('public/images/casino/art-'+name+'.svg').startsWith('<svg'),'SVG art must be real markup for '+name);
 assert(settings.includes("id:'"+name+"'"),'Interactive Account selector missing '+name);
 assert(init.includes("style==='"+name+"'"),'Anti-flash script missing '+name);
 assert(src.includes("value==='"+name+"'"),'Saved preference guard missing '+name);
}
assert.equal((settings.match(/chooseStyle\(option.id\)/g)||[]).length,2,'Both theme groups must be interactive');
for(const label of ['Home','Games','Players','Results','Payments'])assert(nav.includes("name:'"+label+"'"),'Keep the five working destinations');
assert(style.includes(':not(:has(#gameScreen))'),'Gameplay must not be restyled');
assert(src.includes("!/^\\/games\\/[^/]+\\/(play|tv)"),'Live table must retain original protection');
assert(layout.includes("import './pkr-casino-themes.css';"),'Must be loaded with root design CSS');
assert(!style.includes('background-image:none!important;\n --casino'),'Casino artwork should not be hidden');
assert(!style.includes('font-family:url'),'No font path injection');
for(const cls of ['pkr-dual-hero','pkr-dual-metrics','gn-player-next','pkr-results-command-hero','pkr-gn-payment-totals','pkr-primary-bottom-nav','pkr-visual-style-casino']){
 assert(style.includes(cls),'Missing coverage for '+cls);
}
console.log('PASS casino themes: eight palettes, source assets, saved selection, five tabs, host/player/results/payments and original gameplay boundary');
