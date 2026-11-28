'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),postcss=require('postcss');
const root=path.resolve(__dirname,'..');
const read=p=>fs.readFileSync(path.join(root,p),'utf8');

const games=read('src/components/PrivateClubGamesLobby.tsx');
const room=read('src/app/events/[id]/page.tsx');
const css=read('src/app/pkr-night-is-on.css');
assert.doesNotThrow(()=>postcss.parse(css));
assert(room.includes('<PrivateClubGamesLobby'),'Main Games tab must render redesigned lobby');
for(const name of ['pkr-no-games-hero','pkr-cf-hero-metrics','pkr-cf-filters','pkr-cf-game-ticket','pkr-cf-schedule','pkr-cf-explore']){
 assert(games.includes(name),'Missing interactive game-night component '+name);
}
assert(games.includes("useState<Filter>('upcoming')"),'Upcoming/live/completed filters must be stateful');
for(const action of ['onQuickSeat','onRsvpSettings','onCancel','onDelete','onWatch','onRsvp','onShare','onOpenTable']){
 assert(games.includes(action),'Game-night callbacks unavailable: '+action);
}
assert(games.includes('p.settled.slice()')&&games.includes('p.unfinished.map'),'Game archive must use actual records');
assert(games.includes("p.onRsvp(game.id,'yes')"),'RSVP must use the existing authorisation path');
assert(!games.includes('/images/casino/'),'No casino stock art in the official Games composition');
assert(!games.includes('pkr-cf-hero-photo'),'No scenic hero image in active Games');
assert(css.includes('.pkr-no-ticket-index'),'Numbered ticket format missing');
assert(css.includes('@media(max-width:359px)'),'Smallest phone layout missing');
console.log('PASS PKR Games: official cards, interactive real games, host permissions and no casino imagery');
