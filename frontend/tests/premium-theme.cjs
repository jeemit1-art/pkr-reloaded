'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),postcss=require('postcss');
const root=path.resolve(__dirname,'..');
const read=p=>fs.readFileSync(path.join(root,p),'utf8');

/* Brand parity is now canonical. Archived palettes remain in source for rollback,
   but no longer control the shipped product or replace the approved experience. */
const css=read('src/app/pkr-night-is-on.css');
assert.doesNotThrow(()=>postcss.parse(css),'The approved design must parse');
for(const token of ['--pkr-no-ink:#0B0D14','--pkr-no-blue:#1046F8','--pkr-no-coral:#FF5A4D','--pkr-no-citron:#C7FF3A']){
 assert(css.includes(token),'Approved PKR token missing: '+token);
}
const settings=read('src/components/PersonalAppearance.tsx');
const boot=read('public/pkr-appearance-init.js');
const lib=read('src/lib/personal-appearance.ts');
assert(settings.includes('PKR identity'),'Account must show one official identity');
assert(settings.includes('THE NIGHT IS ON.'),'The official identity must be identifiable');
assert(!settings.includes('chooseStyle(option.id)'),'Casino picker must not be presented as a brand');
assert(boot.includes("setAttribute('data-pkr-personal-style','private-club')"),'Before hydration use canonical composition');
assert(boot.includes("setAttribute('data-pkr-personal-theme','dark')"),'Before hydration use canonical dark colours');
assert(settings.includes("setAttribute('data-pkr-personal-style','private-club')"),'React must preserve the same brand');
assert(lib.includes("DEFAULT_VISUAL_STYLE:VisualStyle='private-club'"),'Support fallback for older installs');
assert(lib.includes("!/^\\/games\\/[^/]+\\/(play|tv)"),'Exclude protected gameplay');
assert(css.includes(':not(:has(#gameScreen))'),'Design cannot paint the live table');
for(const cls of ['pkr-no-hero','pkr-no-next-ticket','pkr-no-player-pass','pkr-no-stats','pkr-no-games-hero','pkr-no-results','pkr-no-payments-hero']){
 assert(css.includes('.'+cls),'Product design missing '+cls);
}
assert(read('src/app/layout.tsx').includes("import './pkr-night-is-on.css'"),'The approved brand must be loaded');
assert(read('src/components/RoomDashboardDual.tsx').includes('PrivateClubHostHome'),'Host view stays connected');
assert(read('src/components/PlayerRoomDashboard.tsx').includes('PrivateClubPlayerHome'),'Player view stays connected');
assert(read('src/app/account/page.tsx').includes('PersonalAppearanceSettings'),'Account settings remain available');
assert(read('src/app/account/page.tsx').includes('Preview the player experience'),'Host role preview remains available');
console.log('PASS canonical PKR brand: one identity, protected gameplay, preserved host/player features');
