// PKR exclusive appearance compiler. All source styles (including route CSS)
// are processed through this single build step; the original live/public paint
// is inaccessible under either personal appearance.
'use strict';
const fs=require('node:fs'),path=require('node:path'),postcss=require('postcss');
const src=path.resolve(__dirname,'../src');
// A single canonical source for both the runtime CSS tokens and contrast tests.
const canonicalFile=path.join(src,'app/pkr-personal.css');
function readPalette(){
 const root=postcss.parse(fs.readFileSync(canonicalFile,'utf8'),{from:canonicalFile});
 const palette={light:{},dark:{}};
 root.walkRules(rule=>{
  const match=rule.selector.match(/^html\[data-pkr-personal-theme="(light|dark)"\]:not\(:has\(#gameScreen\)\)$/);
  if(!match)return;
  rule.walkDecls(/^--pkr-personal-/,d=>{
   if(d.prop==='--pkr-personal-scheme')return;
   const key=d.prop.slice('--pkr-personal-'.length).replace(/-([a-z])/g,(_,c)=>c.toUpperCase());
   palette[match[1]][key]=d.value;
  });
 });
 if(!palette.light.canvas||!palette.dark.canvas||Object.keys(palette.light).length!==Object.keys(palette.dark).length)throw Error('Incomplete canonical PKR palette');
 return palette;
}
const palette=readPalette();
const kebab=s=>s.replace(/[A-Z]/g,x=>'-'+x.toLowerCase());
const token=role=>'var(--pkr-personal-'+kebab(role)+')';
const exactSurface={
 '#F4F1EA':'canvas','#E5ECEF':'canvas','#F4F6F8':'canvas','#EDF2F4':'canvas','#D4E5E0':'canvas','#D6E0EF':'canvas',
 '#FFFFFF':'surface','#F0EDE6':'raised','#EDF1F4':'raised','#E3E9FF':'accentSurface','#E3EAF5':'raised',
 '#3E63DD':'primary','#2F4BB8':'primaryDeep','#294BB0':'primary','#59459A':'primary','#A23F51':'dangerFill','#87601C':'warningFill','#10694F':'primary',
 '#132C53':'hero','#243B79':'hero','#142B51':'heroDeep','#16243A':'heroDeep','#365B9D':'heroGlow','#624B9E':'heroGlow',
 '#0B5946':'heroLive','#0D5947':'heroLive','#19876A':'heroLiveGlow','#198769':'heroLiveGlow','#102D3C':'heroDeep','#143349':'heroDeep',
 '#126347':'primary','#FFD978':'goldFill','#FFC53D':'goldFill','#081324':'heroDeep'
};
const exactForeground={
 '#1B1F2A':'ink','#14242C':'ink','#5A6172':'muted','#64727A':'muted','#334A54':'muted',
 '#2F4BB8':'accent','#3E63DD':'accent','#0E7C4F':'gain','#147856':'gain','#C9302C':'loss','#BE3949':'loss',
 '#F0F6FF':'onDark','#F2F7FF':'onDark','#FFFFFF':'onDark','#FFE09A':'onDarkGold','#382600':'onGold','#233C61':'ink'
};
function rgb(hex){
 let s=hex.replace(/^#/,'');if(s.length===3||s.length===4)s=[...s].map(x=>x+x).join('');
 if(s.length!==6&&s.length!==8)return null;
 return {hex:'#'+s.slice(0,6).toUpperCase(),r:parseInt(s.slice(0,2),16)/255,g:parseInt(s.slice(2,4),16)/255,b:parseInt(s.slice(4,6),16)/255,alpha:s.length===8?parseInt(s.slice(6),16)/255:1};
}
function role(hex,kind){
 const c=rgb(hex);if(!c)return null;
 const {r,g,b}=c,max=Math.max(r,g,b),min=Math.min(r,g,b),delta=max-min,l=(max+min)/2;
 let hue=0;if(delta){hue=max===r?((g-b)/delta+6)%6:max===g?(b-r)/delta+2:(r-g)/delta+4;hue*=60;}
 const sat=delta<.001?0:delta/(1-Math.abs(2*l-1));
 const red=sat>.15&&(hue<18||hue>=325),amber=sat>.2&&hue>=18&&hue<67,green=sat>.13&&hue>=67&&hue<175,blue=sat>.13&&hue>=175&&hue<325;
 if(kind==='fg'){
  if(exactForeground[c.hex])return exactForeground[c.hex];
  if(l>.73){if(red)return 'onDarkLoss';if(amber)return 'onDarkGold';if(green&&sat>.3)return 'onDarkGain';return l>.90?'onDark':'onDarkMuted';}
  if(red)return 'loss';if(amber)return 'warning';if(green)return 'gain';if(blue)return 'accent';return l<.25?'ink':'muted';
 }
 if(kind==='border'){
  if(l>.70){if(red)return 'lossLine';if(amber)return 'warningLine';if(green)return 'gainLine';return 'line';}
  if(red)return 'lossLine';if(amber)return 'warningLine';if(green||blue)return 'accentLine';return 'control';
 }
 if(exactSurface[c.hex])return exactSurface[c.hex];
 if(l>.93&&sat<.16)return 'surface';
 if(l>.77){if(red)return 'lossSurface';if(amber)return 'warningSurface';if(green)return 'gainSurface';return 'raised';}
 if(l>.54&&sat>.45&&amber)return 'goldFill';
 if(l<.18)return 'heroDeep';
 if(red)return 'dangerFill';if(amber)return 'warningFill';if(green||blue)return 'primary';
 return l>.54?'raised':'hero';
}
function kindFor(prop){
 if(prop.startsWith('--')){
  if(/on[-_]?primary|on[-_]?accent/i.test(prop))return 'onPrimary';
  if(/tile-ink|\bink\b|text|muted|faint|white|ivory|positive|negative|danger|loss|gain|green|red|accent-ink|secondary/i.test(prop)&&!/(bg|surface|glow|line|border)/.test(prop))return 'fg';
  if(/line|border/i.test(prop))return 'border';
  if(/bg|surface|paper|card|raised|page|primary|accent|tile|metric|gold|night|canvas|soft/i.test(prop))return 'bg';
  return null;
 }
 if(/^(color|fill|stroke|caret-color|accent-color|text-decoration-color)$/.test(prop))return 'fg';
 if(/^(border(?:-.+)?|outline(?:-.+)?)$/.test(prop))return 'border';
 if(/^background(?:-color|-image)?$/.test(prop))return 'bg';
 return null;
}
function convert(value,kind){
 if(!kind||/url\(/i.test(value))return value;
 if(kind==='onPrimary')return token('onDark');
 // Alpha overlays preserve their opacity; black/white overlays are never
 // converted into opaque colours. The actual base surface is themed.
 const replace=hex=>{
  const x=rgb(hex);if(!x)return hex;
  if(x.alpha<.01)return hex;
  if(x.alpha<1&&(x.hex==='#000000'||x.hex==='#FFFFFF'))return hex;
  const mapped=role(hex,kind);if(!mapped)return hex;
  if(x.alpha<1)return 'color-mix(in srgb, '+token(mapped)+' '+Math.round(x.alpha*1000)/10+'%, transparent)';
  return token(mapped);
 };
 let out=value.replace(/#[0-9a-fA-F]{8}(?![0-9a-fA-F])|#[0-9a-fA-F]{6}(?![0-9a-fA-F])|#[0-9a-fA-F]{4}(?![0-9a-fA-F])|#[0-9a-fA-F]{3}(?![0-9a-fA-F])/g,replace);
 out=out.replace(/(?<![\w-])(?:white|black)(?![\w-])/gi,s=>replace(s.toLowerCase()==='white'?'#FFFFFF':'#000000'));
 out=out.replace(/rgba?\(\s*(\d+(?:\.\d+)?)\s*,\s*(\d+(?:\.\d+)?)\s*,\s*(\d+(?:\.\d+)?)(?:\s*,\s*(\d*\.?\d+))?\s*\)/gi,(full,r,g,b,a)=>{
  if([r,g,b].some(n=>Number(n)>255)||a!==undefined&&Number(a)>1)return full;
  const hex='#'+[r,g,b].map(n=>Math.round(Number(n)).toString(16).padStart(2,'0')).join('')+(a!==undefined?Math.round(Number(a)*255).toString(16).padStart(2,'0'):'');
  return replace(hex);
 });
 // The legacy "white" variable sometimes means ink. Explicit foreground
 // roles disambiguate primary accents from their deep button backgrounds.
 if(kind==='fg')out=out.replace(/var\(--(?:pkr-a-primary|blue|gold|gn-coral)\)/g,token('accent'));
 return out;
}
// Legacy colour rules and personal colour rules are mutually exclusive.
// The old cascade is not an active fallback under the new appearance.
// Split every colour-bearing rule in place, at build time, retaining its
// original layer, order and specificity (the :where guards add zero).
// Legacy paint is eligible ONLY on public / gameplay routes. All app paint
// uses the same light/dark tokens, including old route/component CSS imports.
const PERSONAL=':where(html[data-pkr-personal-theme]:not(:has(#gameScreen)))';
const LEGACY=':where(html:not([data-pkr-personal-theme]),html:has(#gameScreen))';
const splitSelectors=(selector,gate)=>{
 const list=[];
 for(let s of postcss.list.comma(selector)){
  s=s.trim();if(!s)continue;
  if(/^html(?=[.#:\s\[>+~]|$)/.test(s)){list.push(s.replace(/^html/,'html'+gate));continue;}
  if(/^:root(?=[.#:\s\[>+~]|$)/.test(s)){list.push(s.replace(/^:root/,':root'+gate));continue;}
  // A compound starting with a class, universal or functional pseudo may
  // itself select html (e.g. :is(html,body)); keep that root case as well.
  if(/^[.[:*]/.test(s))list.push(s.startsWith('*')?'*'+gate+s.slice(1):gate+s);
  list.push(gate+' '+s);
 }
 return [...new Set(list)].join(',');
};
const alias={
 '--bg':'canvas','--bg2':'surface','--bg3':'raised','--bg4':'raised',
 '--white':'ink','--ivory':'ink','--muted':'muted','--faint':'muted',
 '--gold':'accent','--gold2':'accent','--gold-pale':'accent','--gold-dim':'accent',
 '--green':'gain','--green-dim':'gain','--red':'loss','--red-dim':'loss','--amber':'warning',
 '--border':'line','--border-hi':'control','--border-sub':'line','--border2':'control',
 '--paper':'canvas','--card':'surface','--line':'line','--ink':'ink','--blue':'primary','--blue-deep':'accent',
 '--gn-paper':'canvas','--gn-ink':'ink','--gn-muted':'muted','--gn-line':'line','--gn-coral':'primary','--gn-green':'gain','--gn-red':'loss',
 '--pkr-a-bg':'canvas','--pkr-a-surface':'surface','--pkr-a-raised':'raised','--pkr-a-line':'line','--pkr-a-text':'ink','--pkr-a-muted':'muted',
 '--pkr-a-primary':'primary','--pkr-a-on-primary':'onDark','--pkr-a-money':'ink','--pkr-a-danger':'loss','--pkr-a-positive':'gain','--pkr-a-negative':'loss',
 '--pkr-ex-bg':'canvas','--pkr-ex-surface':'surface','--pkr-ex-surface-2':'raised','--pkr-ex-ink':'ink','--pkr-ex-secondary':'muted','--pkr-ex-border':'line',
 '--pkr-ex-accent':'accent','--pkr-ex-accent-light':'accent','--pkr-ex-accent-ink':'ink','--pkr-ex-focus':'accent','--pkr-ex-green':'gain',
 '--pkr-ex-page':'canvas','--pkr-ex-surface-grad':'raised','--pkr-ex-glow':'shadow',
 '--rv-border':'line','--rv-soft':'raised','--rv-accent':'accent','--rv-accent-strong':'primary','--rv-ink':'ink','--rv-muted':'muted','--rv-gain':'gain','--rv-loss':'loss',
 '--pkr-ink':'ink','--pkr-panel':'surface','--pkr-panel-raise':'raised','--pkr-gold':'accent','--pkr-gold-light':'accent',
 '--pkr-emerald':'accent','--pkr-border':'line','--pkr-copy':'ink','--pkr-dim':'muted'
};
const literal=/#(?:[a-fA-F0-9]{8}|[a-fA-F0-9]{6}|[a-fA-F0-9]{4}|[a-fA-F0-9]{3})(?![a-fA-F0-9])|rgba?\(/;
const isDarkSurface=role=>['primary','primaryDeep','dangerFill','warningFill','hero','heroLive','heroDeep','heroGlow','heroLiveGlow'].includes(role);
function recolour(d,rule,originalBackground){
 const p=d.prop.toLowerCase(),val=d.value;
 if(p.startsWith('--pkr-personal-'))return val;
 // Room layouts remain different components. They can no longer supply
 // their own colours, gradients, or theme photographs to app pages.
 if(alias[p])return token(alias[p]);
 if(p==='--pkr-ex-header-image')return 'none';
 if(p==='color-scheme')return 'var(--pkr-personal-scheme)';
 if(p==='text-shadow'&&val!=='none')return 'none';
 if(p==='box-shadow'&&val!=='none'){
  return val.replace(/#[0-9a-fA-F]{8}(?![0-9a-fA-F])|#[0-9a-fA-F]{6}(?![0-9a-fA-F])|#[0-9a-fA-F]{4}(?![0-9a-fA-F])|#[0-9a-fA-F]{3}(?![0-9a-fA-F])|rgba?\([^)]*\)/g,token('shadow'));
 }
 if(p==='scrollbar-color')return token('control')+' '+token('canvas');
 let kind=kindFor(p);
 if(!kind&&p.startsWith('--')&&literal.test(val)&&!/url\(/i.test(val)){
  // Colour-only custom properties unknown to the old mapper cannot
  // retain a separate theme. A local foreground/surface hint resolves them.
  if(/(?:ink|fg|text|copy|muted|dim|label|cream|loss|gain|accent)/i.test(p))kind='fg';
  else if(/(?:line|border|stroke|rail)/i.test(p))kind='border';
  else kind='bg';
 }
 if(!kind&&p==='-webkit-text-fill-color')kind='fg';
 if(!kind)return val;
 // Decorative photographs from retired dashboard skins are not a second
 // backdrop under the app. Actual img elements, avatars and icon URLs stay.
 if((kind==='bg'||p.startsWith('--'))&&/url\([^)]*(?:pkr-approved-hero|\/images\/casino\/|pkr-hero|pkr-banner)/i.test(val)){
  if(p.endsWith('image')||p.startsWith('--'))return 'none';
  return token('surface');
 }
 if(p==='color'){
  const bg=originalBackground??rule.nodes?.find(n=>n.type==='decl'&&/^(background|background-color)$/.test(n.prop))?.value;
  const hex=bg?.match(/#[0-9a-fA-F]{3,8}\b/)?.[0];
  const surface=hex?role(hex,'bg'):null;
  if(surface==='goldFill')return token('onGold');
  if(isDarkSurface(surface)&&/^(?:#[0-9a-fA-F]{3,8}|white|black)$/i.test(val))return token('onDark');
  // Common light-panel foregrounds explicitly become mode-aware ink.
  if(['canvas','surface','raised','accentSurface','gainSurface','lossSurface','warningSurface'].includes(surface)){
   const h=val.match(/^#[0-9a-fA-F]{3,8}$/)?.[0];
   if(h&&['onDark','onDarkMuted','onDarkGold'].includes(role(h,'fg')))return token('ink');
  }
 }
 return convert(val,kind);
}
function inKeyframes(rule){
 for(let p=rule.parent;p;p=p.parent)if(p.type==='atrule'&&/keyframes$/i.test(p.name))return true;
 return false;
}
function transform(root){
 const from=root.source?.input?.file||root.source?.input?.from||'';
 if(/(?:^|[\\/])pkr-personal\.css$/.test(from)||root.nodes.some(n=>n.type==='comment'&&n.text.includes('PKR CANONICAL PERSONAL APPEARANCE')))return;
 if(root.nodes.some(n=>n.type==='comment'&&n.text.includes('PKR EXCLUSIVE PAINT COMPILED')))return;
 // Colour animation names are local to a stylesheet. Retain the original
 // keyframes for gameplay and generate a separate tokenised version only
 // when a keyframe actually changes. Non-colour animations are untouched.
 const animated=new Map();
 const frames=[];root.walkAtRules(/keyframes$/i,at=>frames.push(at));
 for(const at of frames){
  const copy=at.clone();let changed=false;
  copy.walkDecls(d=>{const next=recolour(d,d.parent);if(next!==d.value){d.value=next;changed=true;}});
  if(changed){const name=at.params.trim(),next='pkr-personal-'+name;copy.params=next;animated.set(name,next);at.after(copy);}
 }
 const rules=[];
 root.walkRules(rule=>{if(!inKeyframes(rule)&&rule.parent?.type!=='rule')rules.push(rule);});
 let count=0;
 for(const rule of rules){
  const modern=rule.clone();let changed=false;
  modern.walkDecls(d=>{
   const originalBackground=rule.nodes?.find(n=>n.type==='decl'&&/^(background|background-color)$/.test(n.prop))?.value;
   let value=recolour(d,d.parent,originalBackground);
   if(/^(?:-webkit-)?animation(?:-name)?$/.test(d.prop)){
    for(const [old,next] of animated)value=value.replace(new RegExp('(^|[\\s,])'+old.replace(/[.*+?^$${}()|[\]\\]/g,'\\$&')+'(?=$|[\\s,])','g'),'$1'+next);
   }
   if(value!==d.value){d.value=value;changed=true;}
  });
  if(!changed)continue;
  const original=rule.selector;
  rule.selector=splitSelectors(original,LEGACY);
  modern.selector=splitSelectors(original,PERSONAL);
  rule.after(modern);count++;
 }
 if(count)root.prepend(postcss.comment({text:'PKR EXCLUSIVE PAINT COMPILED: '+count+' mutually exclusive rules'}));
}
function plugin(){return {postcssPlugin:'pkr-exclusive-appearance',Once:transform};}
plugin.postcss=true;
Object.assign(plugin,{palette,role,convert,recolour,transform,splitSelectors,PERSONAL,LEGACY});
module.exports=plugin;
