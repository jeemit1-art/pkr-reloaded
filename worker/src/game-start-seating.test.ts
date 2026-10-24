import {describe,expect,it} from 'vitest';
import {planStartSeating} from './game-start-seating';
describe('Capacity-safe RSVP plan',()=>{
  it('keeps manually occupied seats and uses vacancies',()=>{
    const p=planStartSeating(4,[
      {user_id:'host',display_name:'Host',seat_number:1},
      {user_id:'regular',display_name:'Regular',seat_number:3},
    ],[{id:'a',display_name:'Alice'},{id:'b',display_name:'Ben'}]);
    expect(p.existingMoves).toEqual([]);
    expect(p.newPlayers.map(x=>x.seat_number)).toEqual([2,4]);
  });
  it('seats already registered Quick Seat guests before adding RSVPs',()=>{
    const p=planStartSeating(3,[
      {user_id:'host',display_name:'Host',seat_number:2},
      {user_id:'quick',display_name:'Quick',seat_number:null},
    ],[{id:'r',display_name:'RSVP'}]);
    expect(p.existingMoves).toEqual([{user_id:'quick',seat_number:1}]);
    expect(p.newPlayers[0]).toEqual({id:'r',display_name:'RSVP',whatsapp:null,seat_number:3});
  });
  it('never allocates more physical seats than the configured limit',()=>{
    const p=planStartSeating(2,[{user_id:'host',display_name:'Host',seat_number:1}],
      [{id:'a',display_name:'Alice'},{id:'b',display_name:'Ben'}]);
    expect(p.newPlayers.map(x=>x.seat_number)).toEqual([2,null]);
  });
  it('deduplicates names already registered and repeated RSVPs case-insensitively',()=>{
    const p=planStartSeating(3,[{user_id:'a',display_name:'Alex',seat_number:null}],[
      {id:'already',display_name:' alex '},
      {id:'ben',display_name:'Ben'},
      {id:'ben2',display_name:' BEN '},
    ]);
    expect(p.existingMoves).toEqual([{user_id:'a',seat_number:1}]);
    expect(p.newPlayers.map(x=>[x.display_name,x.seat_number])).toEqual([['Ben',2]]);
  });
  it('rejects invalid capacities rather than inventing seats',()=>{
    expect(()=>planStartSeating(0,[],[])).toThrow(/capacity/);
    expect(()=>planStartSeating(3.5,[],[])).toThrow(/capacity/);
  });
});
