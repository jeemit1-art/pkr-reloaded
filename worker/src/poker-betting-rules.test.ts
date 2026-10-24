import {describe,it,expect} from 'vitest';
import {validateBettingAction,clockwiseSeats,type BettingAction} from './poker-betting-rules';
const players=[
  {display_name:'Dealer',seat_number:1},
  {display_name:'Small',seat_number:4},
  {display_name:'Big',seat_number:3},
  {display_name:'UTG',seat_number:2},
];
const hand={dealer_seat:1,sb_seat:4,bb_seat:3,straddle:0};
const posts:BettingAction[]=[
  {display_name:'Small',street:'pre',action:'post',chips:1},
  {display_name:'Big',street:'pre',action:'post',chips:2},
];
const action=(display_name:string,action:string,chips=0,street='pre'):BettingAction=>
  ({display_name,action,chips,street});
function assess(previous:BettingAction[],next:BettingAction,opts:any={}){
  return validateBettingAction({seats:4,players,hand,actions:previous,proposed:next,...opts});
}
function assertAllowed(previous:BettingAction[],next:BettingAction){
  const result=assess(previous,next);
  expect(result).toMatchObject({ok:true});
}
function assertDenied(previous:BettingAction[],next:BettingAction,code:string){
  const result=assess(previous,next);
  expect(result).toMatchObject({ok:false,code});
}
describe('server no-limit betting rules',()=>{
  it('matches the physical clockwise seat arrangement',()=>{
    expect(clockwiseSeats(4)).toEqual([1,4,3,2]);
    expect(clockwiseSeats(9)).toEqual([1,7,8,9,6,5,4,3,2]);
  });
  it('accepts initial blind posts but prevents duplicate blinds and later straddles',()=>{
    assertAllowed([],posts[0]);
    assertAllowed(posts.slice(0,1),posts[1]);
    assertDenied(posts,posts[1],'INVALID_BLIND');
    assertDenied([...posts,action('UTG','call',2)],action('Dealer','straddle',4),'INVALID_BLIND');
  });
  it('treats a live straddle as the opening blind for minimum raises',()=>{
    const withStraddle=[...posts,action('UTG','straddle',4)];
    const opts={hand:{...hand,straddle:1}};
    expect(assess(withStraddle,action('Dealer','raise',7),opts))
      .toMatchObject({ok:false,code:'RAISE_TOO_SMALL',minimumRaise:4});
    expect(assess(withStraddle,action('Dealer','raise',8),opts))
      .toMatchObject({ok:true,minimumRaise:4});
  });
  it('enforces the first preflop actor and exact calls',()=>{
    assertDenied(posts,action('Dealer','call',2),'OUT_OF_TURN');
    assertDenied(posts,action('UTG','check'),'CHECK_NOT_ALLOWED');
    assertDenied(posts,action('UTG','call',1),'INVALID_CALL');
    assertAllowed(posts,action('UTG','call',2));
  });
  it('requires a full minimum raise instead of accepting a small raise',()=>{
    const prior=[...posts,action('UTG','call',2)];
    assertDenied(prior,action('Dealer','raise',3),'RAISE_TOO_SMALL');
    assertAllowed(prior,action('Dealer','raise',4));
  });
  it('allows a big-blind option, then finishes the street after checking',()=>{
    const prior=[...posts,action('UTG','call',2),action('Dealer','call',2),
      action('Small','call',1)];
    assertAllowed(prior,action('Big','check'));
    assertAllowed(prior,action('Big','bet',2)); // Legacy UI calls its option Bet.
    assertDenied([...prior,action('Big','check')],action('UTG','call',2),'OUT_OF_TURN');
  });
  it('does not reopen a prior aggressor to raise after a short all-in',()=>{
    const prior=[...posts,action('UTG','call',2),action('Dealer','raise',6),
      action('Small','call',5),action('Big','call',4),action('UTG','allin',6)];
    assertDenied(prior,action('Dealer','raise',6),'ACTION_NOT_REOPENED');
    assertAllowed(prior,action('Dealer','call',2));
    const finished=[...prior,action('Dealer','call',2),action('Small','call',2),
      action('Big','call',2)];
    assertAllowed(finished,action('Small','check',0,'flop'));
  });
  it('reopens an earlier bettor only when cumulative short all-ins equal a full raise',()=>{
    // 2026 TDA Rule 49: A bets 100, B all-in 125, C calls 125,
    // D all-in 200; A is now facing a full 100-chip increase.
    const seeded=[
      ...posts,action('UTG','call',2),action('Dealer','call',2),
      action('Small','call',1),action('Big','check'),
      action('Small','bet',100,'flop'),
      action('Big','allin',125,'flop'),
      action('UTG','call',125,'flop'),
    ];
    assertDenied(seeded,action('Dealer','raise',200,'flop'),'OUT_OF_TURN');
    const preThreshold=[...seeded,action('Dealer','call',125,'flop')];
    assertDenied(preThreshold,action('Small','raise',200,'flop'),'ACTION_NOT_REOPENED');
    const full=[...seeded,action('Dealer','allin',200,'flop')];
    assertAllowed(full,action('Small','raise',300,'flop'));
    assertDenied(full,action('Small','raise',299,'flop'),'RAISE_TOO_SMALL');
  });
  it('prohibits acting after folding or committing all-in',()=>{
    const prior=[...posts,action('UTG','fold')];
    assertDenied(prior,action('UTG','call',2),'OUT_OF_TURN');
    const runout=[...posts,action('UTG','allin',4)];
    assertDenied(runout,action('UTG','call',1),'OUT_OF_TURN');
  });
  it('requires completion of earlier streets and forbids going backwards',()=>{
    assertDenied(posts,action('Small','check',0,'flop'),'BETTING_ROUND_INCOMPLETE');
    const pre=[...posts,action('UTG','call',2),action('Dealer','call',2),
      action('Small','call',1),action('Big','check')];
    assertDenied(pre,action('Small','check',0,'river'),'STREET_OUT_OF_ORDER');
    assertAllowed(pre,action('Small','check',0,'flop'));
    assertDenied([...pre,action('Small','check',0,'flop')],
      action('UTG','call',2,'pre'),'STREET_OUT_OF_ORDER');
  });
  it('handles heads-up preflop small blind and postflop big blind',()=>{
    const duos=[{display_name:'Small',seat_number:1},{display_name:'Big',seat_number:2}];
    const board={dealer_seat:1,sb_seat:1,bb_seat:2};
    const po=[action('Small','post',1),action('Big','post',2)];
    const params=(hist:BettingAction[],next:BettingAction)=>validateBettingAction({
      seats:4,players:duos,hand:board,actions:hist,proposed:next});
    expect(params(po,action('Small','call',1))).toMatchObject({ok:true});
    const complete=[...po,action('Small','call',1),action('Big','check')];
    expect(params(complete,action('Big','check',0,'flop'))).toMatchObject({ok:true});
  });
  it('does not allow actions from unknown seats or mismatched players',()=>{
    assertDenied(posts,action('Nobody','raise',20),'INVALID_BETTING_ACTION');
    assertDenied([...posts,{...action('Ghost','call',2)}],
      action('UTG','call',2),'HAND_HISTORY_INVALID');
  });
});
