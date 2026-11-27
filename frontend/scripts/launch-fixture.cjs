'use strict';
// Fictional, internally consistent records for public product screenshots.
// This helper is used only by isolated CI browser fixtures, never by the app.
const BASE='http://127.0.0.1:3000';
const API='https://pkr-reloaded-worker-staging.jeemit1.workers.dev';
const FIXED_TIME='2026-11-27T09:15:00.000Z';
const now=Date.parse(FIXED_TIME)/1000;
const user={id:'launch-host',name:'Alex Morgan',email:'alex@example.invalid',avatar_url:null,plan:'pro',is_active:true,trial_active:false,trial_days_left:0};
const names=['Alex Morgan','Jordan Lee','Sam Patel','Taylor Reed','Casey Brooks','Riley Chen','Morgan Price','Jamie Wilson','Drew Foster','Avery James','Blake Ellis','Harper Quinn','Cameron Scott'];
const members=names.map((name,i)=>({id:i?'launch-player-'+i:user.id,name,role:i===0?'host':i===1?'cohost':'member',avatar_url:null,joined_at:now-(120-i*2)*86400}));
const room={id:'launch-room',name:'River City Poker',description:'Good company. A regular Friday game.',status:'active',role:'host',host_id:user.id,member_count:13,game_count:15,buy_in:5000,created_at:now-120*86400};
const upcoming={id:'launch-upcoming',event_id:room.id,event_name:room.name,name:'Friday Night Poker',status:'scheduled',scheduled_at:now+7*86400+900,location:'The club room',notes:'Arrive from 7 pm. Cards at 7:30.',seats:9,buy_in:5000,created_at:now-3*86400,player_count:6,results_token:null,live_token:null};
const liveGame={...upcoming,id:'launch-live',name:'Friday Cash Game',status:'active',scheduled_at:now-900,location:'River City · Friday table',seats:9,player_count:9,starting_chips:200,chip_value:25,bank_size:50,defaultBuyin:50,hand_tracking:0,live_token:'launch-live-view'};
const denseGame={...liveGame,id:'launch-dense',name:'Club Championship',seats:13,player_count:13,live_token:'launch-dense-view'};
const nextGame={...upcoming,id:'launch-next',name:'Sunday Social',scheduled_at:now+9*86400-1800,location:'The club room',seats:9,player_count:3};
const baseNet=[8500,-2500,4000,-5000,1000,-6000,3500,-2000,-1500];
const settled=Array.from({length:12},(_,g)=>({...upcoming,id:'launch-settled-'+g,name:'Friday Night Poker',status:'settled',scheduled_at:now-(7*(g+1))*86400+900,created_at:now-(7*(g+1)+3)*86400,player_count:9,results_token:'launch-results-'+g,variance:0}));
const playersFor=game=>{
 const finished=game.status==='settled',g=settled.findIndex(x=>x.id===game.id);
 const count=game.id===denseGame.id?13:game.id===upcoming.id?6:game.id===nextGame.id?3:9;
 return members.slice(0,count).map((m,i)=>{
  const buyin=finished?15000:game.status==='scheduled'?0:(i%3+1)*5000;
  const net=finished?baseNet[(i+Math.max(g,0))%9]:null;
  return {game_id:game.id,user_id:m.id,display_name:m.name,seat_number:i+1,buy_ins:buyin/5000,buy_in_total:buyin,cashout:finished?buyin+net:null,net,revision:1,whatsapp:null,settled_at:finished?game.scheduled_at:null};
 });
};
const rsvpsFor=game=>members.slice(0,9).map((m,i)=>({id:game.id+'-rsvp-'+i,game_id:game.id,user_id:m.id,display_name:m.name,status:i<6?'yes':i<8?'maybe':'no',arrival_option:i<6?(i%2?'19:30':'19:00'):i<8?'maybe':'not-coming',seat_number:i<6?i+1:null,created_at:now-86400,updated_at:now-1800}));
const transfersFor=game=>{
 const g=settled.findIndex(x=>x.id===game.id);
 if(g<0)return [];
 const rows=playersFor(game),owing=rows.filter(p=>p.net<0).map(p=>({...p,left:-p.net})),receiving=rows.filter(p=>p.net>0).map(p=>({...p,left:p.net}));
 const transfers=[];let debtor=0,creditor=0;
 while(debtor<owing.length&&creditor<receiving.length){
  const from=owing[debtor],to=receiving[creditor],amount=Math.min(from.left,to.left),index=transfers.length;
  transfers.push({id:game.id+'-pay-'+index,game_id:game.id,from:from.user_id,from_name:from.display_name,to:to.user_id,to_name:to.display_name,amount,status:g>1?'paid':index%3===0?'payer_claimed':'owed',updated_at:game.scheduled_at+7200});
  from.left-=amount;to.left-=amount;if(!from.left)debtor++;if(!to.left)creditor++;
 }
 return transfers;
};
const leaders=members.slice(0,9).map(m=>{
 const records=settled.map(game=>playersFor(game).find(p=>p.user_id===m.id));
 return {user_id:m.id,display_name:m.name,games_played:records.length,games_won:records.filter(p=>p.net>0).length,total_net:records.reduce((n,p)=>n+p.net,0),biggest_win:Math.max(...records.map(p=>p.net)),biggest_loss:Math.abs(Math.min(...records.map(p=>p.net))),last_played:settled[0].scheduled_at,source_game_players:records.map(p=>({game_id:p.game_id,user_id:p.user_id}))};
});
function createFixture(){
 const state={layout:'command',role:'host',writes:[],requests:[]};
 function resolve(input,method='GET',body){
  const url=input instanceof URL?input:new URL(input,API),p=url.pathname;
  state.requests.push(method+' '+p);
  if(method==='OPTIONS')return {};
  if(method==='POST'&&p==='/auth/device-session/start')return {refresh_token:'d'.repeat(64),expires_in:45*86400};
  if(method==='PUT'&&p==='/events/'+room.id+'/dashboard-layout'){
   const data=JSON.parse(body||'{}');if(!['command','live'].includes(data.layout)||Object.keys(data).length!==1)throw Error('Unexpected layout write');
   state.writes.push({method,path:p,body:data});state.layout=data.layout;return {event_id:room.id,layout:state.layout,updated_at:now};
  }
  if(method!=='GET')throw Error('Forbidden fixture mutation: '+method+' '+p);
  if(p==='/auth/me')return user;
  if(p==='/events')return [{...room,role:state.role}];
  if(p==='/events/'+room.id)return {...room,role:state.role,members:members.map(m=>m.id===user.id?{...m,role:state.role}:m)};
  if(p==='/events/'+room.id+'/games')return [liveGame,upcoming,nextGame,...settled];
  if(p==='/events/'+room.id+'/history')return settled.map(game=>({...game,top_players:playersFor(game).filter(p=>p.net>0).sort((a,b)=>b.net-a.net)}));
  if(p==='/events/'+room.id+'/leaderboard')return leaders;
  if(p==='/events/'+room.id+'/profiles')return {profiles:[]};
  if(p==='/events/'+room.id+'/players')return [];
  if(p==='/events/'+room.id+'/historical-player-visibility')return {hidden_names:[]};
  if(p==='/events/'+room.id+'/players/merges')return {merges:[]};
  if(p==='/events/'+room.id+'/dashboard-layout')return {event_id:room.id,layout:state.layout,updated_at:now};
  if(p==='/events/'+room.id+'/join-requests')return {requests:[{id:'launch-join-request',name:'Robin West',expected_member:'Robin West',phone:'+61491570156',requested_at:now-1800}]};
  if(p==='/events/'+room.id+'/push-registrations')return {members:members.slice(0,9).map((m,i)=>({user_id:m.id,device_count:i===0?2:1})),definition:'registered_devices_not_delivery_confirmation'};
  if(p==='/events/'+room.id+'/phone-contacts')return {contacts:[]};
  if(p==='/events/'+room.id+'/settlement-ledger')return {games:settled,transfers:settled.flatMap(transfersFor)};
  if(p==='/push/vapid-key')return {key:'fixture-not-a-real-vapid-key'};
  if(p==='/events/'+room.id+'/date-polls')return {polls:[]};
  if(p==='/events/'+room.id+'/seasons')return {seasons:[]};
  if(p==='/events/'+room.id+'/shared-expenses')return {expenses:[],members:members.map(m=>({user_id:m.id,display_name:m.name}))};
  if(p==='/events/'+room.id+'/tournament-presets')return {presets:[]};
  for(const game of [liveGame,denseGame,upcoming,nextGame,...settled]){
   const players=playersFor(game),rsvps=rsvpsFor(game),transfers=transfersFor(game);
   if(p==='/games/'+game.id)return {...game,players,rsvps,transfers};
   if(p==='/games/'+game.id+'/rsvp-board')return {event:room,game,players,guests:rsvps,options:['19:00','19:30','20:00'],version:1};
   if(p==='/games/'+game.id+'/lobby')return {event:room,game,players,rsvps};
   if(p==='/games/results/'+game.results_token)return {game,event:room,players,transfers};
   if(p==='/games/'+game.id+'/settlement-control')return {game_id:game.id,enabled:true,reminders_enabled:true,last_broadcast_at:now-86400};
   if(p==='/games/'+game.id+'/analysis')return [];
   if(p==='/games/'+game.id+'/hands')return [];
   if(p==='/games/'+game.id+'/tournament')return {state:{status:'paused',current_level:4,paused_elapsed:420,starting_chips:10000,buy_in_amount:5000,rebuy_allowed:true,rebuy_levels:4,addon_allowed:false,total_chips_in_play:90000,payout_structure:'[{"position":1,"percent":60},{"position":2,"percent":30},{"position":3,"percent":10}]'},levels:[25,50,75,100,150,200,300,400,600,800,1000,1500].map((sb,i)=>({level_num:i+1,small_blind:sb,big_blind:sb*2,ante:i>3?sb:0,duration_secs:1200,is_break:false})),rebuys:[],eliminations:[],payouts:[],prize_pool_cents:45000};
  }
  throw Error('Missing launch fixture: '+method+' '+p);
 }
 return {state,resolve};
}
const initialStorage={pkr_token:'fictional-launch-fixture-only',pkr_preferred_room:room.id,pkr_approved_device_refresh_v1:'d'.repeat(64)};
for(const game of [liveGame,denseGame]){
 const players=Object.fromEntries(playersFor(game).map(p=>['seat'+p.seat_number,{name:p.display_name,userId:p.user_id,transactions:Array.from({length:p.buy_ins},()=>({type:'buyin',amount:50,ts:Date.parse(FIXED_TIME)-1800000}))}]));
 initialStorage['pokerState_'+game.id+'_'+user.id]=JSON.stringify({game:{...game,defaultBuyin:50},players});
}
module.exports={BASE,API,FIXED_TIME,room,user,members,upcoming,liveGame,denseGame,nextGame,settled,leaders,playersFor,rsvpsFor,transfersFor,createFixture,initialStorage};
