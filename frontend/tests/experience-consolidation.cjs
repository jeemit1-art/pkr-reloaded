'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const root=path.resolve(__dirname,'../src');
const source=p=>fs.readFileSync(path.join(root,p),'utf8');
const dashboard=source('app/dashboard/page.tsx');
const account=source('app/account/page.tsx');
const view=source('components/PersonalHomeViewSettings.tsx');
const host=source('components/RoomDashboardDual.tsx');
const member=source('components/PlayerRoomDashboard.tsx');
const navigation=source('components/PersistentNavigation.tsx');
const payment=source('components/GameNightPayments.tsx');
const mobileCss=source('app/pkr-experience-consolidation.css');
assert(dashboard.includes('previewPlayer&&<div className="pkr-player-preview-notice"'),
 'Player-preview banner should appear only in explicit preview mode');
assert(!dashboard.includes('ONE PKR EXPERIENCE'),
 'Everyday Home must not repeat an unnecessary player-preview panel');
assert(account.includes('<PersonalHomeViewSettings/>'),
 'Personal Home view belongs in Account settings');
assert(account.includes('Preview the player experience'),
 'Hosts should still be able to preview player screens');
assert(view.includes("'pkr_home_view:v1'"),
 'Home preference must reuse the existing saved preference key');
assert(view.includes("aria-pressed={view==='night'}")&&view.includes("aria-pressed={view==='full'}"),
 'Both Home presentation choices must be accessible');
assert(host.includes('pkr-dual-secondary-tools')&&!host.includes('pkr-dual-quick-grid'),
 'Detailed dashboard should show compact secondary tools rather than a duplicate directory');
for(const label of ['RSVP settings','Player invitations','Calendar','Notifications'])
 assert(host.includes(label),'Existing contextual host tool must be preserved: '+label);
assert(!member.includes('Your club tools')&&!member.includes('<span>All games</span>'),
 'Player Home should not duplicate primary navigation');
assert(member.includes('My profile')&&member.includes('Add to calendar')&&member.includes('Share member link'),
 'Player-specific shortcuts remain available');
assert(member.includes('CLUB_TOOLS_AVAILABLE&&<section className="gn-player-club-tools"'),
 'Optional club panels should be discoverable but absent when features are off');
assert(member.includes('aria-expanded={clubToolsOpen}')&&member.includes('clubToolsOpen&&<div'),
 'Club tools must be expandable and not fetch on Home until opened');
assert(member.includes('<ClubEngagementPanel')&&member.includes('<ClubExtrasPanel'),
 'Keep access to date polls, waitlists, leagues, shared costs and presets');
assert(mobileCss.includes('.gn-player-club-toggle')&&mobileCss.includes('.gn-player-club-expanded'),
 'Member club options must use the premium accessible theme controls');
for(const label of ['Home','Games','Players','Results','Payments'])
 assert(navigation.includes("'"+label+"'")||navigation.includes("name:'"+label+"'")||navigation.includes('>'+label+'<'),
 'Main navigation must preserve '+label);
assert(payment.includes('loadRoomTransfers(')&&payment.includes('canTakePaymentAction'),
 'Payment view must keep using the authoritative saved ledger and action controls');
assert(mobileCss.includes('@media(max-width:600px)')&&mobileCss.includes('.pkr-personal-home-options'),
 'New settings must adapt to phones');
assert(!mobileCss.includes('pkr-primary-mobile-utility')&&!mobileCss.includes('pkr-universal-bottom-nav'),
 'Consolidation must not alter fixed iOS header or footer geometry');
console.log('PASS PKR Experience Consolidation: host settings, player journeys, payment source, navigation and responsive boundaries');
