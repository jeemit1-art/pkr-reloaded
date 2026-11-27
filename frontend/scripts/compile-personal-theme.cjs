// Deterministically mirror legacy paint rules into the same cascade layers.
// Never modify layout or gameplay source. This lets old components share
// the explicit semantic palette instead of retaining hard-coded white cards.
'use strict';
const fs=require('node:fs'),path=require('node:path'),postcss=require('postcss');
const src=path.resolve(__dirname,'../src');
const palette={
  "light": {
    "canvas": "#F4F5F2",
    "surface": "#FFFFFF",
    "raised": "#EEF1EC",
    "line": "#D0D9D2",
    "control": "#71877A",
    "ink": "#192D27",
    "muted": "#52645C",
    "primary": "#166548",
    "primaryDeep": "#0D4933",
    "accent": "#165E42",
    "accentSurface": "#E1F0E7",
    "accentLine": "#9CBFA8",
    "gain": "#126641",
    "gainSurface": "#E2F2E8",
    "gainLine": "#9BC7AB",
    "loss": "#A52D38",
    "lossSurface": "#F9E7E7",
    "lossLine": "#D5A5A7",
    "warning": "#79521B",
    "warningSurface": "#F8ECD4",
    "warningLine": "#D5BE91",
    "hero": "#153A2D",
    "heroLive": "#194D38",
    "heroDeep": "#102E25",
    "heroGlow": "#28654D",
    "heroLiveGlow": "#32795B",
    "onDark": "#FFFFFF",
    "onDarkMuted": "#D5E7DB",
    "onDarkGold": "#F5D58C",
    "onDarkGain": "#83E3AA",
    "onDarkLoss": "#FFADAE",
    "dangerFill": "#9E3441",
    "warningFill": "#79521B",
    "goldFill": "#E8C77B",
    "onGold": "#32250D",
    "nav": "#FFFFFF",
    "shadow": "#142D2212"
  },
  "dark": {
    "canvas": "#101916",
    "surface": "#1B2924",
    "raised": "#24352E",
    "line": "#41574C",
    "control": "#77978A",
    "ink": "#F1F6F2",
    "muted": "#BECFC3",
    "primary": "#176647",
    "primaryDeep": "#0E4B37",
    "accent": "#A1E6BD",
    "accentSurface": "#244839",
    "accentLine": "#618F72",
    "gain": "#83E3AA",
    "gainSurface": "#214536",
    "gainLine": "#679878",
    "loss": "#FFADAE",
    "lossSurface": "#47282D",
    "lossLine": "#9F666D",
    "warning": "#F5D58C",
    "warningSurface": "#49391F",
    "warningLine": "#A58B5C",
    "hero": "#153A2D",
    "heroLive": "#194D38",
    "heroDeep": "#102E25",
    "heroGlow": "#28654D",
    "heroLiveGlow": "#32795B",
    "onDark": "#FFFFFF",
    "onDarkMuted": "#D5E7DB",
    "onDarkGold": "#F5D58C",
    "onDarkGain": "#83E3AA",
    "onDarkLoss": "#FFADAE",
    "dangerFill": "#9E3441",
    "warningFill": "#79521B",
    "goldFill": "#E8C77B",
    "onGold": "#32250D",
    "nav": "#101E19",
    "shadow": "#00000026"
  }
};
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
const gate=':where([data-pkr-personal-theme]:not(:has(#gameScreen)))';
function scope(s){
 s=s.trim();
 if(!s||/gameScreen|\.pkr-casino-live-table|\.pkr-approved-game-dock|\.pkr-table-stage|\.pkr-gameplay-reference|\.game-active\b/.test(s))return null;
 if(/^html(?=[.#:\s\[>+~]|$)/.test(s))return s.replace(/^html/,'html'+gate);
 if(/^:root(?=[.#:\s\[>+~]|$)/.test(s))return s.replace(/^:root/,':root'+gate);
 if(/(?:^|\W)html(?:\.|\[|:|\s)/.test(s))return null;
 return ':where(html'+gate+') '+s;
}
const names=[
 'app/pkr-lounge.css','app/pkr-theme-a.css','app/pkr-player-shell.css','app/pkr-navigation-stability.css',
 'app/room-experience-themes.css','app/real-dual-experiences.css','app/pkr-screen-compositions.css',
 'app/game-night.css','app/game-night-secondary.css','app/game-night-host.css','app/game-night-player.css',
 'app/game-night-complete.css','app/game-night-shell.css','app/chip-club.css','app/chip-club-coverage.css','app/pkr-visual-qa.css',
 'app/account/account.css','app/dashboard/command-centre.css','app/events/[id]/room-dashboard-polish.css','app/games/[id]/share/sharing-centre.css',
 'app/insights/settlement-filter.css','app/install/guided-setup.css','app/instant/instant.css','app/payments/payments.css',
 'app/results/results-unified.css','app/results/results.css','components/ClubEngagementPanel.css','components/DashboardDiscoverability.css',
 'components/GameNightTools.css','components/PlayerRoomDashboard.css','components/PrimaryNavigation.css','components/RoomDashboardDual.css','components/RoomDashboardRefit.css','components/RoomOutstandingCard.css','components/SetupReminder.css'
];
function compile(){
 const out=postcss.root();
 out.append(postcss.comment({text:'Generated by compile-personal-theme.cjs; original gameplay untouched.'}));
 for(const name of names){
  const filename=path.join(src,name),root=postcss.parse(fs.readFileSync(filename,'utf8'),{from:filename});
  // Keep only the original relative layer and media nesting of paint rules.
  root.walkAtRules(a=>{
   if(!['layer','media','supports','container'].includes(a.name)||!a.nodes)a.remove();
  });
  root.walkComments(c=>c.remove());
  root.walkRules(rule=>{
   const selectors=rule.selectors.map(scope).filter(Boolean);
   if(!selectors.length){rule.remove();return}
   rule.selectors=selectors;
   const ownBg=rule.nodes?.find(d=>d.type==='decl'&&/^(background|background-color)$/.test(d.prop)&&/#[0-9a-fA-F]{3,8}\b/.test(d.value));
   const bgHex=ownBg?.value.match(/#[0-9a-fA-F]{3,8}\b/)?.[0];
   const bgRole=bgHex?role(bgHex,'bg'):null;
   for(const d of [...(rule.nodes||[])]){
    if(d.type!=='decl'){d.remove();continue}
    const k=kindFor(d.prop);
    if(!k){d.remove();continue}
    // If an old rule paired dark ink with a now-deep accent button, use the
    // actual on-primary contrast colour; light gold uses dark ink instead.
    if(d.prop==='color'&&bgRole==='goldFill'){d.value=token('onGold');continue}
    if(d.prop==='color'&&['primary','primaryDeep','dangerFill','warningFill','hero','heroLive','heroDeep','heroGlow','heroLiveGlow'].includes(bgRole)){
      const h=d.value.match(/^#[0-9a-fA-F]{3,8}$/)?.[0];
      if(h&&['ink','muted','accent','gain','loss','warning'].includes(role(h,'fg'))){d.value=token('onDark');continue}
    }
    d.value=convert(d.value,k);
   }
   if(!rule.nodes?.length)rule.remove();
  });
  function prune(n){if(!n.nodes)return;for(const c of [...n.nodes]){prune(c);if(c.nodes&&c.nodes.length===0)c.remove();}}
  prune(root);out.append(root.nodes);
 }
 fs.writeFileSync(path.join(src,'app/pkr-personal-paint.css'),out.toString()+'\n');
 console.log('Compiled personal appearance paint ('+out.toString().length+' bytes; scoped outside gameplay)');
}
module.exports={palette,role,convert};
if(require.main===module)compile();
