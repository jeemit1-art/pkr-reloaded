'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),postcss=require('postcss');
const root=path.resolve(__dirname,'..');
const read=p=>fs.readFileSync(path.join(root,p),'utf8');

/* Legacy palettes remain reviewable, but the user approved only one new brand. */
const legacy=read('src/app/pkr-casino-themes.css');
postcss.parse(legacy);
for(const style of ['luxe','neon','vip','tournament'])
 assert(legacy.includes('data-pkr-personal-style="'+style+'"'),'Retain previous look for rollback: '+style);
const app=read('src/components/PersonalAppearance.tsx');
const boot=read('public/pkr-appearance-init.js');
const css=read('src/app/pkr-night-is-on.css');
assert(app.includes('PKR identity')&&!app.includes('data-style-option='),'No new theme variant selector');
assert(boot.includes("'private-club'"),'Canonical HTML composition must be applied pre-hydration');
for(const label of ['Home','Games','Players','Results','Payments'])assert(read('src/components/PersistentNavigation.tsx').includes("name:'"+label+"'"),'Navigation missing '+label);
assert(css.includes('--pkr-no-ink:#0B0D14'),'The design must have one ink');
assert(css.includes(':not(:has(#gameScreen))'),'Protected gameplay must be excluded');
assert(read('src/lib/personal-appearance.ts').includes("!/^\\/games\\/[^/]+\\/(play|tv)"),'Live poker remains separate');
console.log('PASS PKR identity consistency: one approved brand, five destinations, archived theme data intact');
