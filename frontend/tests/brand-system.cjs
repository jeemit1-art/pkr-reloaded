'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),postcss=require('postcss');
const root=path.resolve(__dirname,'..');
const read=p=>fs.readFileSync(path.join(root,p),'utf8');

const brand='public/brand/';
for(const asset of ['pkr-night-mark.svg','pkr-night-logo.svg','pkr-night-icon.svg','pkr-night-cover.svg']){
 const svg=read(brand+asset);
 assert(svg.startsWith('<svg'),'Official SVG missing: '+asset);
 assert(svg.includes('#1046F8')&&svg.includes('#FF5A4D'),'Exact PKR identity colours missing: '+asset);
}
assert(read(brand+'pkr-night-mark.svg').includes('Open Chip K'),'Custom emblem should be named');
const layout=read('src/app/layout.tsx');
assert(layout.includes("import './pkr-night-is-on.css'"),'Official identity CSS is mandatory');
assert(layout.includes("import './pkr-night-marketing.css'"),'Brand must cover public pages');
assert(layout.includes("'/brand/pkr-night-icon.svg'"),'Browser icon must reflect brand');
const manifest=JSON.parse(read('public/manifest.json'));
assert.equal(manifest.name,'PKR — Your Private Game Club');
assert.equal(manifest.theme_color,'#0B0D14');
assert(manifest.icons.some(x=>x.src==='/brand/pkr-night-icon.svg'));
assert(read('src/app/opengraph-image.tsx').includes('pkr-night-cover.svg'),'Social image must follow the approved brand');
assert(read('src/app/icon.tsx').includes('pkr-night-icon.svg'),'Android app icon must follow the brand');
assert(read('src/app/apple-icon.tsx').includes('pkr-night-icon.svg'),'Apple icon must follow the brand');
assert(read('src/components/PkrBrandMark.tsx').includes('/brand/pkr-night-mark.svg'),'Every app logo must be approved');
assert(read('src/components/MarketingBrandHeader.tsx').includes('/brand/pkr-night-logo.svg'),'Public wordmark must be approved');
assert(read('src/app/page.tsx').includes('THE NIGHT<br/><em>IS ON.</em>'),'Main landing headline must be approved');
const share=read('src/lib/pkr-results-image.ts');
assert(share.includes('/brand/pkr-night-mark.svg'),'Result sharing must show approved emblem');
assert(share.includes("'#2ACB91'")&&share.includes("'#FF7468'"),'Profit and loss colours must remain meaningful');
for(const p of ['src/app/pricing/page.tsx','src/app/home-poker-settlement/page.tsx','src/app/home-poker-game-tracker/page.tsx','src/app/poker-tournament-manager/page.tsx']){
 assert(read(p).includes('<MarketingBrandHeader/>'),'Official logo not used on '+p);
}
assert(!read('src/app/pkr-night-is-on.css').includes('background:url('),'No scenic or abstract background images in canonical app skin');
console.log('PASS The Night Is On: logos, PWA icons, social media, public and in-app branding, money semantics');
