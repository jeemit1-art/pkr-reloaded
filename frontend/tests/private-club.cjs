'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),postcss=require('postcss');
const root=path.resolve(__dirname,'..');
const read=p=>fs.readFileSync(path.join(root,p),'utf8');

const host=read('src/components/PrivateClubHostHome.tsx');
const player=read('src/components/PrivateClubPlayerHome.tsx');
const games=read('src/components/PrivateClubGamesLobby.tsx');
const room=read('src/app/events/[id]/page.tsx');
const dashboard=read('src/components/RoomDashboardDual.tsx');
const playerDashboard=read('src/components/PlayerRoomDashboard.tsx');
const rsvp=read('src/app/games/[id]/rsvp/page.tsx');
const css=read('src/app/pkr-night-is-on.css');
postcss.parse(css);
assert(dashboard.includes('<PrivateClubHostHome'),'Host Home must render real new experience');
assert(playerDashboard.includes('<PrivateClubPlayerHome'),'Player Home must render real new experience');
assert(room.includes('<PrivateClubGamesLobby'),'Room Games tab must use new experience');
for(const [component,markers] of [
 [host,['pkr-no-host','pkr-no-hero','pkr-no-next-ticket','pkr-no-stats','pkr-no-tools','p.room.name','p.featured','p.going.length','p.onPayments','p.onResults','p.onRsvp','p.onSchedule','p.onInvite','p.onRefresh']],
 [player,['pkr-no-player','pkr-no-player-pass','pkr-no-player-next','p.room.name','p.next','p.onRsvp','p.onCalendar','p.onPayments','p.onMembers','p.onResults']],
 [games,['pkr-no-games','pkr-cf-game-ticket','p.onQuickSeat','p.onCancel','p.onDelete','p.onRsvp','p.onShare']]]){
 for(const marker of markers)assert(component.includes(marker),'Data or action missing: '+marker);
}
for(const component of [host,player,games])assert(!component.includes('pkr-approved-hero-desktop.webp')&&!component.includes('/images/casino/'),'Active app must not show casino stock imagery');
assert(room.includes('expandedMemberId')&&room.includes('pkr-directory-extra')&&room.includes('pkr-directory-history'),'Player history and details must remain');
assert(rsvp.includes("new URLSearchParams(window.location.search).get('choice')"),'RSVP preselection still supported');
assert(rsvp.includes('async function submit()'),'No new RSVP back-end logic');
assert(css.includes(':not(:has(#gameScreen))'),'Poker table styling is excluded');
assert(css.includes('prefers-reduced-motion'),'Reduced motion preference must be honoured');
console.log('PASS private club: branded host/player screens, real records, RSVP and permissions');
