import test from 'node:test';
import assert from 'node:assert/strict';
import {
  normaliseWhatsappPhone,whatsappUrl,buildGameInvite,buildAnnouncement,
  buildRsvpUpdate,buildResultsShare,buildPrivatePayment,isShareablePayment
} from '../src/lib/whatsapp-sharing.ts';

test('Australian mobile numbers use the international WhatsApp format',()=>{
  assert.equal(normaliseWhatsappPhone('0412 345 678'),'61412345678');
  assert.equal(normaliseWhatsappPhone('+61 412 345 678'),'61412345678');
  assert.equal(normaliseWhatsappPhone('garbage'),'');
  assert.equal(normaliseWhatsappPhone('1234'),'');
});
test('WhatsApp opens a draft and does not auto-send or embed arbitrary phone',()=>{
  const link=whatsappUrl('Hello poker night\nRSVP','0412 345 678');
  assert.ok(link.startsWith('https://wa.me/61412345678?text='));
  assert.ok(link.includes('Hello%20poker%20night'));
  assert.ok(whatsappUrl('Hello').startsWith('https://wa.me/?text='));
});
test('Game invite contains RSVP and event details, never payment data',()=>{
  const text=buildGameInvite({room:'Friday Night',date:'Sat 7pm',location:'Private venue',seats:9,rsvpUrl:'https://mypkr.app/games/abc/rsvp'});
  assert.match(text,/Friday Night/);assert.match(text,/9 seats/);
  assert.match(text,/games\/abc\/rsvp/);assert.doesNotMatch(text,/Transfer|pays/);
});
test('RSVP summary uses confirmed replies and seats only',()=>{
  const text=buildRsvpUpdate({room:'Friday',date:'Sat',confirmed:['Alex','Taylor'],maybe:['Jordan'],seats:9,rsvpUrl:'https://mypkr.app/games/abc/rsvp'});
  assert.match(text,/Confirmed: 2 \/ 9/);
  assert.match(text,/Alex, Taylor/);
  assert.match(text,/Maybe: 1/);
});
test('Group results hide player net figures unless explicitly enabled',()=>{
  const data={room:'Friday',date:'Sat',players:[{display_name:'Alex',net:4500},{display_name:'Taylor',net:-4500}]};
  const hidden=buildResultsShare(data);
  assert.match(hidden,/Alex/);assert.doesNotMatch(hidden,/\$45/);assert.doesNotMatch(hidden,/Transfers:/);
  const shown=buildResultsShare({...data,includeAmounts:true});
  assert.match(shown,/\$45/);
});
test('A host announcement requires an editable message',()=>{
  const text=buildAnnouncement({room:'Friday',date:'Sat',rsvpUrl:'https://mypkr.app/games/abc/rsvp'});
  assert.match(text,/Message from your host:/);
});
test('Paid or legacy transfers are never shareable as private reminders',()=>{
  assert.equal(isShareablePayment('paid'),false);
  assert.equal(isShareablePayment('legacy'),false);
  assert.equal(isShareablePayment('owed'),true);
  assert.throws(()=>buildPrivatePayment({room:'Friday',date:'Sat',gameUrl:'https://mypkr.app/games/abc',transfer:{from_name:'Alex',to_name:'Taylor',amount:5000,status:'paid'}}));
});
test('Payer reminder and claimed-payment receipt are correctly addressed',()=>{
  const base={room:'Friday',date:'Sat',gameUrl:'https://mypkr.app/games/abc'};
  const owed=buildPrivatePayment({...base,transfer:{from_name:'Alex',to_name:'Taylor',amount:5000,status:'owed'}});
  assert.match(owed,/Hi Alex/);assert.match(owed,/\$50/);assert.match(owed,/to Taylor/);
  const claimed=buildPrivatePayment({...base,transfer:{from_name:'Alex',to_name:'Taylor',amount:5000,status:'payer_claimed'}});
  assert.match(claimed,/Hi Taylor/);assert.match(claimed,/Alex has marked/);
});
