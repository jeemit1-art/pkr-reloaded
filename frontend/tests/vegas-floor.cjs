'use strict';
/* Prevent the photographed iPhone defects: a soft Luxe clone and unreadable CTA. */
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),postcss=require('postcss');
const read=p=>fs.readFileSync(path.join(__dirname,'..',p),'utf8');
const jsx=read('src/components/PrivateClubGamesLobby.tsx');
const css=read('src/app/pkr-vegas-floor.css');
const layout=read('src/app/layout.tsx');
assert.doesNotThrow(()=>postcss.parse(css),'Vegas theme CSS must parse');
assert(layout.includes("import './pkr-vegas-floor.css';"),'Vegas style must load after the original themes');
assert(css.includes('data-pkr-personal-style="private-club"'),'Do not restyle other saved appearances');
assert(css.includes(':not(:has(#gameScreen))'),'Protected live table must remain untouched');
for(const part of ['pkr-cf-hero','pkr-cf-hero-metrics','pkr-cf-filters','pkr-cf-table-rim','pkr-cf-schedule','pkr-cf-explore']){
 assert(jsx.includes(part),'Missing structurally distinctive poker-floor section '+part);
 assert(css.includes(part),'No CSS for '+part);
}
assert(jsx.includes('useState<Filter>'),'Filters must remain interactive');
assert(jsx.includes('p.onSchedule')&&jsx.includes('p.onQuickSeat')&&jsx.includes('p.onCancel')&&jsx.includes('p.onDelete'),
 'Host actions and confirmation flows must remain available');
assert(jsx.includes("p.onRsvp(game.id,'yes')"),'Existing authenticated RSVP flow must be used');
assert(jsx.includes('p.unfinished.map'),'Unfinished historic sessions must remain available');
assert(jsx.includes('p.settled.slice()'),'The archive must use recorded settled games');
assert(css.includes('-webkit-font-smoothing:auto'),'Use crisp native font rasterisation, not translucent text');
assert(css.includes('filter:none!important;opacity:1!important'),'Buttons must not inherit the previous darkening/opacity trick');
assert(css.includes('background-color:#241423!important')&&css.includes('color:#ffcc9d!important;-webkit-text-fill-color:#ffcc9d!important'),
 'Primary CTA must have a solid dark backdrop behind opaque light casino text');
assert(css.includes('@media(max-width:360px)'),'Small-screen control widths must be covered');
console.log('PASS Vegas floor: distinct structure, sharp readable text, safe callbacks, archived games and gameplay exclusion');
