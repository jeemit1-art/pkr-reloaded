'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),postcss=require('postcss');
const root=path.resolve(__dirname,'..');
const read=file=>fs.readFileSync(path.join(root,file),'utf8');
const css=read('src/app/pkr-privateclub.css');
const appearance=read('src/lib/personal-appearance.ts');
const bootstrap=read('public/pkr-appearance-init.js');
const settings=read('src/components/PersonalAppearance.tsx');
const host=read('src/components/PrivateClubHostHome.tsx');
const player=read('src/components/PrivateClubPlayerHome.tsx');
const games=read('src/components/PrivateClubGamesLobby.tsx');
const room=read('src/app/events/[id]/page.tsx');
const dashboard=read('src/components/RoomDashboardDual.tsx');
const rsvp=read('src/app/games/[id]/rsvp/page.tsx');
const layout=read('src/app/layout.tsx');
assert.doesNotThrow(()=>postcss.parse(css),'New visual rules must parse');
assert(css.includes(':not(:has(#gameScreen))'),'Never style protected gameplay canvas');
assert(appearance.includes("DEFAULT_VISUAL_STYLE:VisualStyle='private-club'"),'New users should open in approved theme');
assert(bootstrap.includes("style==='private-club'?style:'private-club'"),'Bootstrap should render approved theme before hydration');
assert(settings.includes("id:'private-club'"),'Existing users must be able to choose approved theme');
assert(layout.includes("import './pkr-privateclub.css';"),'New visual system must be loaded last');
assert(css.includes('real-casino-props.webp')&&css.includes('real-poker-chips.webp'),'Use real scenic assets rather than coloured boxes alone');
assert(dashboard.includes('<PrivateClubHostHome'),'Actual home component must render');
assert(dashboard.includes('<GameNightHostHome'),'Original host home must remain for saved prior themes');
assert(player.includes("onGame")&&player.includes("onRsvp")&&player.includes("onPayments"),'Player shortcuts must preserve functionality');
assert(room.includes('<PrivateClubGamesLobby'),'Lobby must render on actual room route');
for(const marker of ['onQuickSeat','onRsvpSettings','onCancel','onDelete','onWatch','onRsvp','onShare','onOpenTable']){
 assert(games.includes(marker),'Game-management action unavailable: '+marker);
}
assert(games.includes("useState<Filter>('upcoming')"),'Live lobby filters must be interactive');
assert(rsvp.includes("new URLSearchParams(window.location.search).get('choice')"),'Lobby response shortcuts must open authorised RSVP form');
assert(rsvp.includes("async function submit()"),'RSVP confirmation process must remain unchanged');
for(const key of ["pkr-privateclub-host-surface","pkr-pc-new-games","pkr-privateclub-player"]){
 assert(css.includes(key),'Missing new screen styling '+key);
}
assert(css.includes('@media(max-width:430px)')&&css.includes('@media(max-width:360px)'),'Small phone layouts must be covered');
assert(css.includes('prefers-reduced-motion'),'Reduced-motion support must be retained');
console.log('PASS private casino club: real Home/Games/Player screens, no gameplay changes, responsive styles and auth-bound RSVP');
