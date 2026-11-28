'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),postcss=require('postcss');
const root=path.resolve(__dirname,'..');
const read=p=>fs.readFileSync(path.join(root,p),'utf8');

/* Supersedes legacy Vegas visuals: actual PKR is no longer a separate casino theme. */
const css=read('src/app/pkr-night-is-on.css');
postcss.parse(css);
const page=read('src/components/PrivateClubGamesLobby.tsx');
assert(css.includes('font-family:var(--font-body)'), 'Use sharp, locally bundled font');
assert(css.includes('text-shadow:none!important'),'Remove fuzzy text treatments');
assert(css.includes("background:#1046F8"),'Use exact PKR blue');
assert(css.includes("background:#C7FF3A"),'Use exact citron buttons');
assert(css.includes("border:1px solid #C7FF3A"),'Primary buttons need visible edges');
assert(css.includes('pkr-no-hero-cut'),'Ticket corners must be branded graphic elements');
assert(!page.includes('real-casino-props.webp'),'No stock casino hero in app');
assert(!page.includes('pkr-cf-hero-photo'),'Hero must not use abstract pictures');
assert(css.includes('@media(max-width:430px)'),'Mobile contrast and spacing rules required');
assert(css.includes(':not(:has(#gameScreen))'),'Gameplay excluded');
assert(page.includes('onQuickSeat')&&page.includes('onRsvpSettings')&&page.includes('onCancel')&&page.includes('onDelete'),'Host tools preserved');
console.log('PASS PKR typography, identity components, mobile controls and no stock scenery');
