'use strict';
// Release gate for PKR personal premium themes; no player or settlement data required.
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const postcss=require('postcss');
const app=path.resolve(__dirname,'../src/app');
const css=postcss.parse(fs.readFileSync(path.join(app,'pkr-premium-styles.css'),'utf8'));
const appearances={};
css.walkRules(rule=>{
 const match=rule.selector.match(/^html\[data-pkr-personal-style="(noir|clubhouse|studio)"\]\[data-pkr-personal-theme="(light|dark)"\]:not\(:has\(#gameScreen\)\)$/);
 if(!match)return;
 const key=match[1]+':'+match[2],roles={};
 rule.walkDecls(decl=>{
  if(decl.prop.startsWith('--pkr-personal-'))roles[decl.prop.slice('--pkr-personal-'.length)]=decl.value;
 });
 assert(!appearances[key],'Duplicate colour palette '+key);
 appearances[key]=roles;
});
const styles=['noir','clubhouse','studio'],modes=['light','dark'];
assert.equal(Object.keys(appearances).length,6,'All premium styles must have two colour modes');
const toLuma=value=>{
 assert(/^#[0-9A-Fa-f]{6}$/.test(value),'A contrast role must be a hex colour: '+value);
 const rgb=[1,3,5].map(i=>parseInt(value.slice(i,i+2),16)/255);
 return rgb.map(x=>x<=0.04045?x/12.92:((x+0.055)/1.055)**2.4)
  .reduce((sum,x,i)=>sum+x*[0.2126,0.7152,0.0722][i],0);
};
const contrast=(a,b)=>{
 const values=[toLuma(a),toLuma(b)].sort((a,b)=>a-b);
 return (values[1]+0.05)/(values[0]+0.05);
};
for(const style of styles)for(const mode of modes){
 const p=appearances[style+':'+mode];
 assert(p,'Missing '+style+'/'+mode+' palette');
 assert(Object.keys(p).length>=30,'Incomplete '+style+'/'+mode+' palette');
 for(const [fg,bg] of [['ink','canvas'],['ink','surface'],['ink','raised'],['muted','surface'],
 ['accent','accent-surface'],['gain','surface'],['loss','surface'],['on-gold','gold-fill']]){
  const ratio=contrast(p[fg],p[bg]);
  assert(ratio>=4.5,style+'/'+mode+' '+fg+' on '+bg+' WCAG AA text contrast '+ratio.toFixed(2));
 }
 assert(contrast('#FFFFFF',p['primary'])>=4.5,style+'/'+mode+' primary button text contrast');
 assert(p['scheme']===mode,style+'/'+mode+' colour scheme');
}
const root=path.resolve(__dirname,'../');
const settings=fs.readFileSync(path.join(root,'src/components/PersonalAppearance.tsx'),'utf8');
const bootstrap=fs.readFileSync(path.join(root,'public/pkr-appearance-init.js'),'utf8');
const lib=fs.readFileSync(path.join(root,'src/lib/personal-appearance.ts'),'utf8');
const layout=fs.readFileSync(path.join(root,'src/app/layout.tsx'),'utf8');
for(const style of ['standard','noir','clubhouse','studio'])assert(settings.includes("id:'"+style+"'"),'Theme missing from settings: '+style);
for(const mode of modes)assert(settings.includes("'"+mode+"'"),'Colour mode missing: '+mode);
assert(settings.includes("'system'"),'Follow-device colour mode must be available');
assert(settings.includes('chooseStyle(option.id)'),'Theme option must be interactive');
assert(lib.includes("DEFAULT_VISUAL_STYLE:VisualStyle='noir'"),'PKR Noir should be the default for users without a saved style');
assert(settings.includes('useRef<VisualStyle>(DEFAULT_VISUAL_STYLE)'),'Provider must honour default premium style');
assert(bootstrap.includes("?style:'noir'"),'Early appearance script must apply premium default before hydration');
assert(bootstrap.includes("style==='standard'"),'Previously selected Classic must remain supported');
assert(bootstrap.includes('pkr_personal_visual_style_v1'),'Reload must restore personal style');
assert(lib.includes('!/^\\/games\\/[^/]+\\/(play|tv)'),'Live poker table must be excluded from personal themes');
assert(layout.includes("import './pkr-premium-styles.css';"),'Premium palette CSS must be bundled');
const home=fs.readFileSync(path.join(root,'src/components/GameNightHostHome.tsx'),'utf8');
assert(home.includes('aria-labelledby="pkr-home-quick-heading"'),'Home must include an accessible compact action hub');
assert(home.includes('Quick actions'),'Home should expose essential actions without being a directory');
assert.equal((home.match(/pkr-gn-quick-arrow/g)||[]).length,4,'Home should contain four focused quick action cards');
assert(!home.includes('pkr-gn-tool-group')&&!home.includes('pkr-gn-tool-grid')&&!home.includes('pkr-gn-club-links'),
 'The oversized tool directory and duplicate club links must not return');
for(const action of ['p.onSchedule','p.onSharing','p.onInvite','p.onRoom']){
 assert(home.includes(action),'Home must preserve its existing working navigation action: '+action);
}
const premiumCss=fs.readFileSync(path.join(app,'pkr-premium-styles.css'),'utf8');
assert(premiumCss.includes('.pkr-gn-quick-heading h2'),'Home section heading must have an explicit typography rule');
assert(premiumCss.includes('.pkr-gn-quick-grid>button'),'Home must use compact card styling');
assert(premiumCss.includes('repeat(2,minmax(0,1fr))'),'Mobile Home grid must use two columns');
assert(premiumCss.includes('margin-bottom:15px!important'),'Mobile heading must be clearly separated from cards');
const dashboard=fs.readFileSync(path.join(root,'src/components/RoomDashboardDual.tsx'),'utf8');
assert.equal(dashboard.split('{featureHub}').length-1,2,'Each dashboard view should include exactly one shortcuts hub');
console.log('PASS premium themes: six contrasting palettes, personal settings, reload restore, gameplay exclusion and organised navigation');
