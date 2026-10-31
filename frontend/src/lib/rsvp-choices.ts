import type {RsvpBoardData,RsvpReplyChoice} from './api';

/** The stable keys keep saved RSVPs and older client versions compatible. */
export function defaultRsvpReplies():RsvpReplyChoice[]{
 return [
  {value:'late',label:'Running late',status:'yes'},
  {value:'maybe',label:'Maybe',status:'maybe'},
  {value:'not-coming',label:'Not coming',status:'no'},
 ];
}
export function getRsvpReplies(board:Pick<RsvpBoardData,'responses'>):RsvpReplyChoice[]{
 return board.responses?.length?board.responses:defaultRsvpReplies();
}
export function rsvpChoiceStatus(board:RsvpBoardData,option:string):'yes'|'maybe'|'no'|null{
 if(board.options.includes(option))return 'yes';
 return getRsvpReplies(board).find(reply=>reply.value===option)?.status||null;
}
export function rsvpChoiceLabel(board:RsvpBoardData,option:string):string{
 const reply=getRsvpReplies(board).find(r=>r.value===option);
 if(reply)return reply.label;
 if(!/^([01]\d|2[0-3]):[0-5]\d$/.test(option))return option||'Not specified';
 const [hours,minutes]=option.split(':').map(Number);
 return new Date(2020,0,1,hours,minutes).toLocaleTimeString('en-AU',{
  hour:'numeric',minute:minutes?'2-digit':undefined,hour12:true
 });
}
export function rsvpChoices(board:RsvpBoardData):RsvpReplyChoice[]{
 return [
  ...board.options.map(option=>({value:option,label:rsvpChoiceLabel(board,option),status:'yes' as const})),
  ...getRsvpReplies(board)
 ];
}
