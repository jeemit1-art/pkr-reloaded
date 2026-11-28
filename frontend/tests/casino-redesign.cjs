'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const postcss=require('postcss');
const root=path.resolve(__dirname,'..');
const read=p=>fs.readFileSync(path.join(root,p),'utf8');
const css=read('src/app/pkr-casino-rebuild.css');
const stage=read('src/components/PokerClubStage.tsx');
const tabs=read('src/components/GamesSectionTabs.tsx');
const empty=read('src/components/GamesEmptyArena.tsx');
const games=read('src/app/events/[id]/page.tsx');
const layout=read('src/app/layout.tsx');
assert.doesNotThrow(()=>postcss.parse(css),'The casino rebuild CSS must parse');
assert(layout.includes("import './pkr-casino-rebuild.css';"),'Casino layout must be loaded after the original palettes');
for(const id of ['luxe','neon','vip','tournament']){
 assert(css.includes('data-pkr-personal-style="'+id+'"'),'Casino rules must include '+id);
}
assert(css.includes(':not(:has(#gameScreen))'),'Original live game screen must stay out of the redesign');
assert(stage.includes('function CasinoStageArt'),'Poker scene must be rendered as real noninteractive markup');
assert(stage.includes('aria-hidden="true"'),'Art must not interrupt screen readers');
for(const name of ['pkr-casino-art-card','pkr-casino-art-chip','pkr-casino-art-halo']){
 assert(stage.includes(name)&&css.includes(name),'Casino scene missing '+name);
}
assert(tabs.includes('PkrGlyph')&&tabs.includes('aria-current'),'Three sections need real icons and current-tab state');
assert(empty.includes('No games scheduled yet.')&&empty.includes('onClick={isHost?onSchedule:onCalendar}'),'Empty view must take real host or member action');
assert(games.includes('<GamesEmptyArena isHost={isHost}'),'Games must use the functioning empty view');
assert(games.includes('pkr-casino-original-empty'),'Original themes must retain their prior empty view');
assert(css.includes('.pkr-casino-stage-art, .pkr-casino-empty-arena { display:none!important; }'),'Casino artwork must be absent in unselected themes');
assert(css.includes('.pkr-casino-original-empty{display:none!important}'),'Original empty screen must be hidden only for opt-in casino styles');
assert(read('src/app/results/page.tsx').includes('<CasinoStageArt kind="games"/>'),'Results must include original artwork');

assert(games.includes('onSchedule={()=>setShowCreate(true)}'),'Do not replace the existing game scheduler');
assert(games.includes("onCalendar={()=>router.push('/schedule?room='+encodeURIComponent(id))}"),'Calendar must preserve club context');
assert(css.includes('@media(max-width:600px)')&&css.includes('@media(max-width:360px)'),'Narrow phone layouts must be covered');
assert(css.includes('prefers-reduced-motion'),'Decorative effects must respect reduced motion');
for(const keep of ['Manage RSVPs','RSVP settings','Completed games','Upcoming sessions','Historical unfinished']){
 assert(games.includes(keep),'Existing game action or real metric disappeared: '+keep);
}
console.log('PASS casino redesign: buildable CSS, real artwork, actions, mobile layout and protected gameplay');
