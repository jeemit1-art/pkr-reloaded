/**
 * PKR host-controlled sharing templates.
 * Only public-to-the-room information is used in group messages.
 * Payment instructions are constructed separately, one transfer at a time.
 */
export type ShareScore={display_name:string;net:number|null|undefined};
export type PaymentStatus='owed'|'not_received'|'payer_claimed'|'paid'|'legacy'|string|undefined;
export type ShareTransfer={from_name:string;to_name:string;amount:number;status?:PaymentStatus};

const clean=(value:unknown)=>String(value??'').replace(/\s+/g,' ').trim().slice(0,140);
const money=(cents:number)=>new Intl.NumberFormat('en-AU',{style:'currency',currency:'AUD'}).format(cents/100);

/** Only return a directed WhatsApp number when a recognised international dialling format is present. */
export function normaliseWhatsappPhone(input:string|null|undefined):string {
  const original=(input||'').trim();
  const digits=original.replace(/\D/g,'');
  if(/^04\d{8}$/.test(digits))return '61'+digits.slice(1);
  if(/^614\d{8}$/.test(digits))return digits;
  if(original.startsWith('+')&&/^\d{9,15}$/.test(digits)&&!digits.startsWith('0'))return digits;
  return '';
}
export function whatsappUrl(text:string,phone?:string|null):string {
  const number=normaliseWhatsappPhone(phone);
  return 'https://wa.me/'+number+'?text='+encodeURIComponent(text);
}
export function buildGameInvite(input:{
  room:string;date:string;location?:string|null;rsvpUrl:string;seats?:number|null;
}):string {
  return [
    '♠ PKR · '+clean(input.room),
    'You are invited to poker night!',
    '🗓 '+clean(input.date),
    input.location?'📍 '+clean(input.location):null,
    Number.isInteger(input.seats)&&Number(input.seats)>0?'♟ '+input.seats+' seats':null,
    '',
    'RSVP and choose your arrival time in PKR:',
    input.rsvpUrl,
    '',
    'Private group event · PKR membership is required.'
  ].filter(x=>x!==null).join('\n');
}
export function buildAnnouncement(input:{room:string;date:string;location?:string|null;rsvpUrl:string}):string {
  return [
    '♠ PKR · '+clean(input.room),
    'GAME NIGHT UPDATE',
    '🗓 '+clean(input.date),
    input.location?'📍 '+clean(input.location):null,
    '',
    'Please check the latest game details and RSVP:',
    input.rsvpUrl,
    '',
    'Message from your host:'
  ].filter(x=>x!==null).join('\n');
}
export function buildRsvpUpdate(input:{
  room:string;date:string;confirmed:string[];maybe:string[];seats:number;rsvpUrl:string;
}):string {
  const yes=input.confirmed.map(clean).filter(Boolean);
  const maybe=input.maybe.map(clean).filter(Boolean);
  const list=(names:string[])=>names.slice(0,20).join(', ')+(names.length>20?' +'+(names.length-20)+' more':'');
  return [
    '♠ '+clean(input.room)+' · RSVP update',
    '🗓 '+clean(input.date),
    '✅ Confirmed: '+yes.length+(input.seats>0?' / '+input.seats+' seats':''),
    yes.length?list(yes):'No confirmed replies yet',
    '❔ Maybe: '+maybe.length,
    maybe.length?list(maybe):null,
    '',
    'Update your RSVP in PKR:',
    input.rsvpUrl
  ].filter(x=>x!==null).join('\n');
}
/**
 * Deliberately exclude transfers and personal settlement status, even when
 * the caller supplies result objects containing those fields.
 */
export function buildResultsShare(input:{
  room:string;date:string;players:ShareScore[];includeAmounts?:boolean;
}):string {
  const ordered=[...input.players].sort((a,b)=>(b.net??0)-(a.net??0));
  const rank=ordered.slice(0,20).map((p,i)=>{
    const amount=input.includeAmounts&&Number.isSafeInteger(p.net)
      ?' · '+((p.net??0)>0?'+':'')+money(p.net??0):'';
    return (i+1)+'. '+clean(p.display_name)+amount;
  });
  return [
    '🏆 PKR · '+clean(input.room),
    'GAME RESULTS',
    '🗓 '+clean(input.date),
    '',
    ...rank,
    ordered.length>20?'… and '+(ordered.length-20)+' more':null,
    '',
    'Final game results recorded in PKR.'
  ].filter(x=>x!==null).join('\n');
}
export function isShareablePayment(status:PaymentStatus):boolean {
  return status==='owed'||status==='not_received'||status==='payer_claimed'||status===undefined;
}
/** A payment message always addresses a single person; never place it in a group broadcast. */
export function buildPrivatePayment(input:{
  room:string;date:string;transfer:ShareTransfer;gameUrl:string;
}):string {
  const {transfer:t}=input;
  if(!Number.isSafeInteger(t.amount)||t.amount<=0)throw new Error('Invalid transfer amount');
  if(!isShareablePayment(t.status))throw new Error('This payment is no longer outstanding');
  if(t.status==='payer_claimed')return [
    'Hi '+clean(t.to_name)+',',
    clean(t.from_name)+' has marked '+money(t.amount)+' as sent for '+clean(input.room)+' ('+clean(input.date)+').',
    'Please check your account and confirm receipt in PKR:',
    input.gameUrl,
    '',
    'Private payment reminder · PKR does not handle transfers.'
  ].join('\n');
  return [
    'Hi '+clean(t.from_name)+',',
    'Your recorded outstanding payment for '+clean(input.room)+' ('+clean(input.date)+') is '+money(t.amount)+' to '+clean(t.to_name)+'.',
    'Once paid, please mark the payment as sent in PKR:',
    input.gameUrl,
    '',
    'Private payment reminder · Please check the details with the recipient.'
  ].join('\n');
}
