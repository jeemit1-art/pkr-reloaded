import {isCurrentGame} from '@/lib/game-status';
import {api,fmt,fmtDate,fmtSign,type Game,type GamePlayer,type Transfer,type ResultsData} from '@/lib/api';

export type RecordRequest = {
  kind:'games'|'members'|'rooms'|'settings'|'transfers'|'player'|'leaders'|'sessions'|'players'|'rsvps'|'seats'|'game'|'live-money';
  title:string;
  roomId?:string;
  gameId?:string;
  playerId?:string;
  playerName?:string;
  direction?:'from'|'to';
  filter?:'all'|'settled'|'paid'|'outstanding'|'owing'|'receiving'|'bought-in'|'cashed-out'|'yes'|'profitable'|'upcoming';
  period?:'all'|'90d';
  month?:string;
  publicToken?:string;
  measure?:'buyins'|'cashouts'|'bank';
};
export type RecordRow = {id:string;label:string;detail?:string;value?:string;href?:string;next?:RecordRequest};
export type RecordDetail = {rows:RecordRow[];summary?:string;warning?:string};
type Payment = {game:Game;transfer:Transfer};

function check(signal?:AbortSignal){if(signal?.aborted)throw new DOMException('Request cancelled','AbortError');}
function roomId(request:RecordRequest){if(!request.roomId)throw new Error('Open a poker room first.');return request.roomId;}
function gameId(request:RecordRequest){if(!request.gameId)throw new Error('Open a game first.');return request.gameId;}
function gameUrl(game:Game){return '/games/'+encodeURIComponent(game.id);}
export function paymentLabel(transfer:Transfer){
  if(transfer.status==='paid')return 'Paid';
  if(transfer.status==='payer_claimed')return 'Sent - awaiting receipt';
  if(transfer.status==='not_received')return 'Not received';
  if(transfer.status==='owed')return 'Pending';
  return 'Payment status not recorded';
}
export function isOutstanding(transfer:Transfer){return transfer.status!=='paid'&&transfer.status!=='legacy';}
export function gameRows(games:Game[],roomName?:string):RecordRow[]{
  return [...games].sort((a,b)=>b.scheduled_at-a.scheduled_at).map(game=>({
    id:game.id,label:fmtDate(game.scheduled_at),
    detail:[roomName,game.location,game.status==='settled'?'Settled':game.status].filter(Boolean).join(' - '),
    value:typeof game.player_count==='number'?game.player_count+' players':undefined,href:gameUrl(game),
  }));
}
export function transferRows(payments:Payment[]):RecordRow[]{
  return payments.map(({game,transfer},i)=>({
    id:game.id+':'+(transfer.id||i),label:transfer.from_name+' to '+transfer.to_name,
    detail:fmtDate(game.scheduled_at)+' - '+paymentLabel(transfer),value:fmt(transfer.amount),href:gameUrl(game),
  }));
}
async function settledRecords(request:RecordRequest,signal?:AbortSignal){
  const games=(await api.games.list(roomId(request))).filter(game=>game.status==='settled'&&
    (request.period!=='90d'||game.scheduled_at>=Math.floor(Date.now()/1000)-90*86400));
  check(signal);
  const records:Array<{game:Game;data:ResultsData}>=[];
  let missing=0;
  // Bound requests; never turn a failed financial request into a zero balance.
  for(let i=0;i<games.length;i+=4){
    check(signal);
    const batch=await Promise.allSettled(games.slice(i,i+4).map(async game=>{
      if(!game.results_token)throw new Error('Results unavailable');
      return {game,data:await api.games.results(game.results_token)};
    }));
    check(signal);
    batch.forEach(result=>{if(result.status==='fulfilled')records.push(result.value);else missing++;});
  }
  return {records,warning:missing?missing+' game result(s) could not be loaded. This breakdown is incomplete; retry before relying on its totals.':undefined};
}
function playerRow(player:GamePlayer,game:Game):RecordRow{
  return {id:game.id+':'+player.user_id,label:player.display_name,
    detail:(player.seat_number!=null?'Seat '+player.seat_number+' - ':'')+player.buy_ins+' buy-in(s)'+
      (player.cashout!=null?' - Cash-out '+fmt(player.cashout):''),
    value:player.net!=null?fmtSign(player.net):undefined,href:gameUrl(game)};
}
export async function loadRecordDetail(request:RecordRequest,signal?:AbortSignal):Promise<RecordDetail>{
  check(signal);
  if(request.kind==='live-money'){
    if(!request.publicToken)throw new Error('The shared live table link is missing.');
    const live=await api.games.live(request.publicToken);check(signal);
    if(request.measure==='bank')return {summary:'Bank '+fmt(live.bank)+' = buy-ins minus cash-outs',rows:[
      {id:'in',label:'Recorded buy-ins',value:fmt(live.totalIn),next:{...request,measure:'buyins',title:'Recorded buy-ins'}},
      {id:'out',label:'Recorded cash-outs',value:fmt(live.totalOut),next:{...request,measure:'cashouts',title:'Recorded cash-outs'}},
    ]};
    const cashouts=request.measure==='cashouts';
    const players=live.players.filter(player=>cashouts?player.cashout!=null:player.buy_ins>0);
    let missing=false;
    const rows=players.map(player=>{
      const amount=cashouts?player.cashout:(player as GamePlayer&{buy_in_total?:number}).buy_in_total;
      if(typeof amount!=='number')missing=true;
      return {id:player.user_id,label:player.display_name,
        detail:player.buy_ins+' recorded buy-in(s)',value:typeof amount==='number'?fmt(amount):'Amount not supplied'};
    });
    return {rows,summary:(cashouts?'Cash-outs ':'Buy-ins ')+fmt(cashouts?live.totalOut:live.totalIn),
      warning:missing?'The live feed supplies buy-in counts but not every player amount. No amounts have been estimated.':undefined};
  }
  if(request.kind==='rooms'){
    const rooms=(await api.events.list()).filter(room=>room.status!=='ended');check(signal);
    return {summary:rooms.length+' active rooms',rows:rooms.map(room=>({id:room.id,label:room.name,
      detail:(room.member_count||0)+' members',value:(room.game_count||0)+' games',
      href:'/events/'+encodeURIComponent(room.id)}))};
  }
  if(request.kind==='games'){
    if(request.roomId){
      let games=await api.games.list(request.roomId);check(signal);
      if(request.filter==='settled')games=games.filter(game=>game.status==='settled');
      if(request.filter==='upcoming')games=games.filter(isCurrentGame);
      if(request.month)games=games.filter(game=>{
        const d=new Date(game.scheduled_at*1000);return d.getFullYear()+'-'+d.getMonth()===request.month;
      });
      return {rows:gameRows(games),summary:games.length+' saved games'+(request.filter==='settled'?' - settled only':' - all statuses')};
    }
    const rooms=await api.events.list();check(signal);
    const rows:RecordRow[]=[];let missing=0;
    for(let i=0;i<rooms.length;i+=4){
      check(signal);
      const batch=await Promise.allSettled(rooms.slice(i,i+4).map(async room=>gameRows(await api.games.list(room.id),room.name)));
      check(signal);batch.forEach(result=>{if(result.status==='fulfilled')rows.push(...result.value);else missing++;});
    }
    return {rows,summary:rows.length+' saved games across rooms',warning:missing?missing+' room(s) could not be loaded. This list is incomplete.':undefined};
  }
  if(request.kind==='members'||request.kind==='settings'){
    const room=await api.events.get(roomId(request));check(signal);
    if(request.kind==='settings')return {summary:'Default room setting, not a payment',rows:[{
      id:room.id,label:room.name,detail:'Default buy-in. Individual games can use a different amount.',value:fmt(room.buy_in),
      href:'/events/'+encodeURIComponent(room.id)+'?tab=games'}]};
    return {summary:room.members.length+' members',rows:room.members.map(member=>({
      id:member.id,label:member.name,detail:member.role+(member.joined_at?' - Joined '+fmtDate(member.joined_at):''),
      href:'/events/'+encodeURIComponent(room.id)+'?tab=members'}))};
  }
  if(request.kind==='leaders'||request.kind==='sessions'){
    const leaders=await api.events.leaderboard(roomId(request));check(signal);
    const sessions=leaders.reduce((sum,player)=>sum+player.games_played,0);
    return {summary:request.kind==='sessions'?sessions+' player sessions across '+leaders.length+' players':leaders.length+' ranked players',
      rows:[...leaders].sort((a,b)=>b.total_net-a.total_net).map(player=>({
        id:player.user_id,label:player.display_name,detail:player.games_played+' games - '+player.games_won+' profitable',
        value:request.kind==='sessions'?player.games_played+' sessions':fmtSign(player.total_net),
        next:{kind:'player',title:player.display_name+' - game results',roomId:request.roomId,playerId:player.user_id,playerName:player.display_name},
      }))};
  }
  if(request.kind==='transfers'||request.kind==='player'){
    const {records,warning}=await settledRecords(request,signal);
    if(request.kind==='player'){
      const rows:RecordRow[]=[];
      let net=0,profitable=0,ambiguous=0;
      // The room leaderboard groups historic results by lower-case player
      // name, but stores the user_id of only one earlier game. Prefer the
      // exact ID in each game, then fall back to ONE matching room-scoped name.
      const wantedName=(request.playerName||'').trim().toLocaleLowerCase();
      for(const {game,data} of [...records].sort((a,b)=>b.game.scheduled_at-a.game.scheduled_at)){
        const candidates=data.players||[];
        const exact=request.playerId?candidates.find(p=>p.user_id===request.playerId):undefined;
        const sameName=wantedName?candidates.filter(p=>
          p.display_name.trim().toLocaleLowerCase()===wantedName):[];
        const player=exact||(sameName.length===1?sameName[0]:undefined);
        if(!player){
          if(!exact&&sameName.length>1)ambiguous++;
          continue;
        }
        const playerNet=typeof player.net==='number'&&Number.isFinite(player.net)?player.net:null;
        if(request.filter==='profitable'&&!(playerNet!==null&&playerNet>0))continue;
        if(playerNet!==null){net+=playerNet;if(playerNet>0)profitable++;}
        const cashout=typeof player.cashout==='number'&&Number.isFinite(player.cashout)?player.cashout:null;
        const buyInTotal=(player as GamePlayer&{buy_in_total?:number}).buy_in_total;
        // Net = cash-out minus buy-ins. This yields the true total buy-in
        // when both final values exist; never estimate individual deposits.
        const totalIn=typeof buyInTotal==='number'&&Number.isFinite(buyInTotal)
          ?buyInTotal:cashout!==null&&playerNet!==null?cashout-playerNet:null;
        const details=[
          game.location||'Poker game',
          player.buy_ins+' buy-in'+(player.buy_ins===1?'':'s'),
          totalIn!==null?'Buy-ins '+fmt(totalIn):null,
          cashout!==null?'Cash-out '+fmt(cashout):null,
        ].filter(Boolean).join(' · ');
        rows.push({id:game.id+':'+player.user_id,
          label:fmtDate(game.scheduled_at),detail:details,
          value:playerNet!==null?fmtSign(playerNet):'Not recorded',
          href:game.results_token?'/games/results/'+encodeURIComponent(game.results_token):gameUrl(game)});
      }
      const incomplete=[warning,ambiguous?
        ambiguous+' game(s) have multiple players sharing this name without a matching ID. They were excluded to avoid mixing people’s results.':
        undefined].filter(Boolean).join(' ')||undefined;
      return {rows,summary:rows.length+' settled game'+(rows.length===1?'':'s')+
        ' · '+profitable+' profitable · net '+fmtSign(net),warning:incomplete};
    }
    let payments:Payment[]=records.flatMap(({game,data})=>(data.transfers||[]).map(transfer=>({game,transfer})));
    if(request.filter==='paid')payments=payments.filter(row=>row.transfer.status==='paid');
    else if(request.filter==='outstanding'||request.filter==='owing'||request.filter==='receiving')payments=payments.filter(row=>isOutstanding(row.transfer));
    if(request.playerId)payments=payments.filter(row=>request.direction?row.transfer[request.direction]===request.playerId:
      row.transfer.from===request.playerId||row.transfer.to===request.playerId);
    if(request.filter==='owing'||request.filter==='receiving'){
      const outgoing=request.filter==='owing';
      const people=new Map<string,{name:string;amount:number;count:number}>();
      for(const {transfer} of payments){
        const id=outgoing?transfer.from:transfer.to,name=outgoing?transfer.from_name:transfer.to_name;
        const row=people.get(id)||{name,amount:0,count:0};row.amount+=transfer.amount;row.count++;people.set(id,row);
      }
      return {rows:[...people].map(([id,person])=>({id,label:person.name,
        detail:person.count+' outstanding transfer(s)',value:fmt(person.amount),
        next:{...request,filter:'outstanding',playerId:id,direction:outgoing?'from':'to',title:person.name+' - outstanding transfers'}})),
        summary:people.size+' players - '+fmt(payments.reduce((sum,row)=>sum+row.transfer.amount,0)),warning};
    }
    if(request.playerId&&!request.direction){
      const outgoing=payments.filter(row=>row.transfer.from===request.playerId).reduce((sum,row)=>sum+row.transfer.amount,0);
      const incoming=payments.filter(row=>row.transfer.to===request.playerId).reduce((sum,row)=>sum+row.transfer.amount,0);
      const net=incoming-outgoing;
      return {rows:transferRows(payments),warning,summary:'Outgoing '+fmt(outgoing)+' - incoming '+fmt(incoming)+
        ' - '+(net<0?'net to pay ':net>0?'net to receive ':'net ')+fmt(Math.abs(net))};
    }
    return {rows:transferRows(payments),summary:payments.length+' transfers - '+fmt(payments.reduce((sum,row)=>sum+row.transfer.amount,0))+
      (request.period==='90d'?' - last 90 days':' - all time'),warning};
  }
  const game=await api.games.get(gameId(request));check(signal);
  if(request.kind==='game'){
    const amount=(game as Game&{buy_in?:number}).buy_in;
    return {summary:'Saved game configuration',rows:[{id:game.id,label:fmtDate(game.scheduled_at),
      detail:[game.location,game.status].filter(Boolean).join(' - '),href:gameUrl(game)},
      {id:game.id+':buy-in',label:'Configured buy-in',value:typeof amount==='number'?fmt(amount):'Not recorded',
        detail:'Individual buy-in transactions may differ.',href:gameUrl(game)},
      {id:game.id+':seats',label:'Configured seats',value:String(game.seats),href:gameUrl(game)}]};
  }
  if(request.kind==='rsvps'){
    const rsvps=(game.rsvps||[]).filter(row=>!request.filter||request.filter==='all'||row.status===request.filter);
    return {summary:rsvps.length+' RSVP records',rows:rsvps.map(row=>({id:row.id,label:row.display_name,
      detail:row.status==='yes'?'Attending':row.status,href:gameUrl(game)+'/rsvp'}))};
  }
  if(request.kind==='seats'){
    const seats=Number(game.seats);
    if(!Number.isInteger(seats)||seats<0||seats>1000)throw new Error('The saved seat count is invalid.');
    return {summary:seats+' configured seats',rows:Array.from({length:seats},(_,i)=>{
      const player=(game.players||[]).find(row=>row.seat_number===i+1);
      return {id:String(i+1),label:'Seat '+(i+1),detail:player?.display_name||'No seated player recorded',href:gameUrl(game)};
    })};
  }
  let players=game.players||[];
  if(request.filter==='bought-in')players=players.filter(player=>player.buy_ins>0);
  if(request.filter==='cashed-out')players=players.filter(player=>player.cashout!=null);
  return {rows:players.map(player=>playerRow(player,game)),summary:players.length+' player records'};
}
