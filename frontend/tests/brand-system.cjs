'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const root=path.resolve(__dirname,'..');
const read=p=>fs.readFileSync(path.join(root,p),'utf8');
const b=read('public/brand/pkr-crest.svg');
for(const asset of ['pkr-horizontal-on-dark.svg','pkr-horizontal-on-light.svg','pkr-social-landscape.svg','pkr-social-square.svg','pkr-social-story.svg']){
 const svg=read('public/brand/'+asset);
 assert(svg.startsWith('<svg'),'SVG asset missing: '+asset);
 assert(svg.includes('PKR'),'Brand wordmark missing: '+asset);
 assert(svg.includes('pkr-gold'),'Original PKR crest not embedded: '+asset);
}
assert(b.includes('PKR poker spade crest'));
const css=read('src/app/pkr-brand-system.css');
assert(css.includes('--pkr-brand-midnight:#0D0B19'));
assert(css.includes('--pkr-brand-ruby:#C94D6C'));
assert(!css.includes('#gameScreen '),'Never target protected gameplay controls');
for(const p of ['src/app/pricing/page.tsx','src/app/home-poker-settlement/page.tsx','src/app/home-poker-game-tracker/page.tsx','src/app/poker-tournament-manager/page.tsx']){
 assert(read(p).includes('<MarketingBrandHeader/>'),'Public page brand mark missing: '+p);
}
const layout=read('src/app/layout.tsx');
assert(layout.includes("import './pkr-brand-system.css'"));
assert(layout.includes("import './pkr-brand-crest.css'"));
const home=read('src/app/page.tsx');
assert(!home.includes("import './chip-club-launch.css'"),'Retired blue brand must not overpaint PKR');
assert(home.includes('href="/brand"'));
const manifest=JSON.parse(read('public/manifest.json'));
assert.equal(manifest.theme_color,'#0D0B19');
assert.equal(manifest.name,'PKR — Your Private Poker Club');
assert(manifest.icons.some(x=>x.src==='/brand/pkr-crest.svg'));
assert(read('src/app/opengraph-image.tsx').includes('pkr-social-landscape.svg'));
const results=read('src/lib/pkr-results-image.ts');
assert(results.includes('/brand/pkr-crest.svg'));
assert(results.includes("'#69D59A'")&&results.includes("'#FE8A87'"),'Win/loss semantics must survive branding');
assert(read('src/components/PersistentNavigation.tsx').includes('PkrBrandMark'));
console.log('PASS brand system: official crest, five marketing assets, public/app metadata, shared style and financial semantics');
