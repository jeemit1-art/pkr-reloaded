import {describe,it,expect} from 'vitest';
import {validateHandStartLayout, type StartSeat} from './hand-start-layout';

const full:StartSeat[]=[
  {user_id:'d',display_name:'Dealer',seat_number:1},
  {user_id:'s',display_name:'Small',seat_number:4},
  {user_id:'b',display_name:'Big',seat_number:3},
  {user_id:'u',display_name:'UTG',seat_number:2},
];
const hand={dealer_seat:1,sb_seat:4,bb_seat:3,straddle:false};
describe('full-hand start seating authority',()=>{
  it('accepts a physically clockwise four-player layout and a real UTG straddle',()=>{
    expect(validateHandStartLayout(4,full,hand)).toMatchObject({ok:true});
    expect(validateHandStartLayout(4,full,{...hand,straddle:true})).toMatchObject({ok:true});
  });
  it('requires the dealer to be registered and rejects reversed blind seats',()=>{
    expect(validateHandStartLayout(4,full,{...hand,dealer_seat:5}))
      .toMatchObject({ok:false,code:'HAND_SEATING_INVALID'});
    expect(validateHandStartLayout(4,full,{...hand,sb_seat:3,bb_seat:4}))
      .toMatchObject({ok:false,code:'HAND_SEATING_INVALID'});
    expect(validateHandStartLayout(4,full,{...hand,sb_seat:1}))
      .toMatchObject({ok:false,code:'HAND_SEATING_INVALID'});
  });
  it('accepts a legitimate heads-up dealer/small blind but forbids straddles',()=>{
    const duo=[full[0],full[1]];
    expect(validateHandStartLayout(4,duo,{
      dealer_seat:1,sb_seat:1,bb_seat:4,straddle:false,
    })).toMatchObject({ok:true});
    expect(validateHandStartLayout(4,duo,{
      dealer_seat:1,sb_seat:1,bb_seat:4,straddle:true,
    })).toMatchObject({ok:false,code:'INVALID_BLIND'});
    expect(validateHandStartLayout(4,duo,hand))
      .toMatchObject({ok:false,code:'HAND_SEATING_INVALID'});
  });
  it('rejects unsynchronised, duplicate, ambiguous and unoccupied players',()=>{
    for(const bad of [
      [],
      [full[0]],
      [{...full[0]}, {...full[0]}],
      [{...full[0]},{...full[1],display_name:'dealer'}],
      [{...full[0]},{...full[1],seat_number:5}],
      [{...full[0],user_id:''},full[1]],
    ]){
      expect(validateHandStartLayout(4,bad,hand))
        .toMatchObject({ok:false,code:'HAND_ROSTER_UNSYNCED'});
    }
  });
  it('uses the complete physical ring for sparsely occupied nine-seat tables',()=>{
    const trio=[
      {user_id:'a',display_name:'A',seat_number:1},
      {user_id:'b',display_name:'B',seat_number:9},
      {user_id:'c',display_name:'C',seat_number:3},
    ];
    expect(validateHandStartLayout(9,trio,{
      dealer_seat:1,sb_seat:9,bb_seat:3,straddle:false,
    })).toMatchObject({ok:true});
    expect(validateHandStartLayout(9,trio,{
      dealer_seat:1,sb_seat:3,bb_seat:9,straddle:false,
    })).toMatchObject({ok:false,code:'HAND_SEATING_INVALID'});
  });
});
