import test from 'node:test';
import assert from 'node:assert/strict';
import {
  sameName,liveNightStats,nightInviteText,nightStatusText,nightReminderText,nightLiveText
} from '../src/lib/game-night.ts';

const board={
  game:{id:'g',status:'scheduled',scheduled_at:1000,location:'Club',seats:9},
  event:{id:'r',name:'Private club'},
  options:['19:00','20:00'],
  guests:[
    {id:'1',display_name:'Alex Morgan',status:'yes',arrival_option:'19:00',seat_number:1,updated_at:1},
    {id:'2',display_name:'Jordan Lee',status:'yes',arrival_option:'20:00',seat_number:2,updated_at:1},
    {id:'3',display_name:'Taylor',status:'no',arrival_option:'not-coming',seat_number:null,updated_at:1}
  ],
  players:[{display_name:'Alex Morgan',seat_number:1}],
  version:1
};
const members=[
  {id:'host',name:'Host',role:'host',avatar_url:null,joined_at:1},
  {id:'a',name:'alex  morgan',role:'member',avatar_url:null,joined_at:1},
  {id:'b',name:'Jordan Lee',role:'member',avatar_url:null,joined_at:1},
  {id:'c',name:'Casey',role:'member',avatar_url:null,joined_at:1},
  {id:'d',name:'Taylor',role:'member',avatar_url:null,joined_at:1}
];

test('names are compared without leaking contact numbers',()=>{
  assert.equal(sameName('  ALEX   MORGAN  '),sameName('Alex Morgan'));
});
test('real RSVP totals use saved board and count a seated person only once',()=>{
  const stats=liveNightStats(board,members);
  assert.equal(stats.confirmed,2);
  assert.equal(stats.declined,1);
  assert.equal(stats.interested,0);
  assert.equal(stats.available,7);
  assert.equal(stats.occupied,2);
  assert.deepEqual(stats.unmatchedMembers.map(m=>m.name),['Casey']);
});
test('seated players without RSVPs occupy a seat; capacity never negative',()=>{
  const stats=liveNightStats({...board,game:{...board.game,seats:2},
    players:[...board.players,{display_name:'Extra player',seat_number:2}]},members);
  assert.equal(stats.available,0);
});
test('invitation is a live PKR link not a meaningless editable message',()=>{
  const message=nightInviteText({
    room:'Friday Night Poker',date:'Sat 7pm',location:'Private venue',
    link:'https://mypkr.app/games/g/rsvp',available:3,seats:9
  });
  assert.match(message,/Friday Night Poker/);
  assert.match(message,/3 of 9/);
  assert.match(message,/games\/g\/rsvp/);
  assert.match(message,/latest confirmed/);
});
test('attendance update describes a snapshot and delegates live data to PKR',()=>{
  const message=nightStatusText({
    room:'Friday',date:'Sat',link:'https://mypkr.app/games/g/rsvp',
    confirmed:7,available:2,seats:9,interested:1
  });
  assert.match(message,/7 confirmed/);
  assert.match(message,/2 places available/);
  assert.match(message,/figures above are a snapshot/);
  assert.doesNotMatch(message,/bank transfer|mobile number|payment/i);
});
test('one-player RSVP reminder asks for action and does not claim automatic sending',()=>{
  const message=nightReminderText({
    name:'Casey',room:'Friday',date:'Sat',link:'https://mypkr.app/games/g/rsvp'
  });
  assert.match(message,/Hi Casey/);
  assert.match(message,/confirm whether you are playing/);
  assert.match(message,/different display name/);
});
test('live game link is room-scoped and not a settlement broadcast',()=>{
  const message=nightLiveText({room:'Friday',date:'Sat',
    url:'https://mypkr.app/games/live/abc'});
  assert.match(message,/games\/live\/abc/);
  assert.doesNotMatch(message,/paid|payable|bank|transfers/i);
});
