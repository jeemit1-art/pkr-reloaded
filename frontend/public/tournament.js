// tournament.js — PKR Reloaded Tournament Mode
(function() {
'use strict';
var DEFAULT_LEVELS = [
  {level_num:1, small_blind:25,  big_blind:50,  ante:0,  duration_secs:900, is_break:false},
  {level_num:2, small_blind:50,  big_blind:100, ante:0,  duration_secs:900, is_break:false},
  {level_num:3, small_blind:75,  big_blind:150, ante:25, duration_secs:900, is_break:false},
  {level_num:4, small_blind:100, big_blind:200, ante:25, duration_secs:900, is_break:false},
  {level_num:5, small_blind:0,   big_blind:0,   ante:0,  duration_secs:600, is_break:true},
  {level_num:6, small_blind:150, big_blind:300, ante:50, duration_secs:900, is_break:false},
  {level_num:7, small_blind:200, big_blind:400, ante:50, duration_secs:900, is_break:false},
  {level_num:8, small_blind:300, big_blind:600, ante:75, duration_secs:900, is_break:false},
  {level_num:9, small_blind:400, big_blind:800, ante:100,duration_secs:900, is_break:false},
  {level_num:10,small_blind:500, big_blind:1000,ante:100,duration_secs:900, is_break:false},
  {level_num:11,small_blind:600, big_blind:1200,ante:200,duration_secs:900, is_break:false},
  {level_num:12,small_blind:800, big_blind:1600,ante:200,duration_secs:900, is_break:false},
  {level_num:13,small_blind:1000,big_blind:2000,ante:300,duration_secs:900, is_break:false},
  {level_num:14,small_blind:1500,big_blind:3000,ante:300,duration_secs:900, is_break:false},
  {level_num:15,small_blind:0,   big_blind:0,   ante:0,  duration_secs:600, is_break:true},
  {level_num:16,small_blind:2000,big_blind:4000,ante:500,duration_secs:900, is_break:false},
  {level_num:17,small_blind:3000,big_blind:6000,ante:500,duration_secs:900, is_break:false},
  {level_num:18,small_blind:4000,big_blind:8000,ante:1000,duration_secs:900, is_break:false},
  {level_num:19,small_blind:5000,big_blind:10000,ante:1000,duration_secs:900, is_break:false},
  {level_num:20,small_blind:7500,big_blind:15000,ante:1500,duration_secs:900, is_break:false},
];
var ts = {
  view:'main', state:null, levels:[], rebuys:[], eliminations:[],
  payouts:[],prizePoolCents:null,payoutError:null,
  timerInterval:null, secsRemaining:0,
  autoAdvance:true,advancePending:false,nextAdvanceAttempt:0,
  voiceEnabled:true, voiceWarningDone:false, voiceWarningMinutes:2,
  setupLevels:JSON.parse(JSON.stringify(DEFAULT_LEVELS)),
  setupConfig:{starting_chips:10000,buy_in_amount:0,rebuy_allowed:false,rebuy_levels:4,addon_allowed:false,addon_chips:5000,
    payout_structure:[{place:1,pct:50},{place:2,pct:30},{place:3,pct:20}]},
};
function tApi(path,opts){
  var ctx=window.getPkrCtx?window.getPkrCtx():null;
  var apiUrl=ctx?ctx.apiUrl:''; var token=ctx?ctx.token:'';
  return fetch(apiUrl+path,Object.assign({credentials:'include',
    headers:Object.assign({'Content-Type':'application/json'},token?{'Authorization':'Bearer '+token}:{})},opts||{}))
    .then(function(r){if(!r.ok)return r.json().catch(function(){return{};}).then(function(e){throw new Error(e.error||r.status);});return r.json();});
}
function getGameId(){var c=window.getPkrCtx?window.getPkrCtx():null;return c?c.gameId:'';}
function toast(msg){window.showToast&&window.showToast(msg);}
function fmtTime(secs){var m=Math.floor(secs/60),s=secs%60;return(m<10?'0':'')+m+':'+(s<10?'0':'')+s;}
function ordinal(n){if(n===1)return'1st';if(n===2)return'2nd';if(n===3)return'3rd';return n+'th';}
function getActivePlayers(){
  var elimNames=(ts.eliminations||[]).map(function(e){return e.player_name;});
  if(!window.state||!window.state.players)return[];
  return Object.values(window.state.players).filter(function(p){return p&&p.name&&(window.pBuyin?window.pBuyin(p)>0:true)&&!elimNames.includes(p.name);});
}
function startLocalTimer(){
  stopLocalTimer();
  updateTimerCalc();
  ts.timerInterval=setInterval(function(){updateTimerCalc();renderTimerDisplay();},1000);
}
function stopLocalTimer(){if(ts.timerInterval){clearInterval(ts.timerInterval);ts.timerInterval=null;}}
function updateTimerCalc(){
  if(!ts.state||ts.state.status!=='running')return;
  var now=Math.floor(Date.now()/1000);
  var lv=ts.levels.find(function(l){return l.level_num===ts.state.current_level;});
  if(!lv)return;
  var elapsed=now-(ts.state.level_started_at||now);
  ts.secsRemaining=Math.max(0,lv.duration_secs-elapsed);
  if(ts.secsRemaining===ts.voiceWarningMinutes*60&&!ts.voiceWarningDone){
    ts.voiceWarningDone=true;
    speak('Attention players. '+ts.voiceWarningMinutes+' minutes remaining on level '+ts.state.current_level+'.');
  }
  // The host's open panel can request the next blind stage. The Worker
  // verifies that the prior stage has genuinely expired before advancing.
  if(ts.secsRemaining===0&&ts.autoAdvance&&!ts.advancePending&&
     ts.levels.some(function(l){return l.level_num===ts.state.current_level+1;})&&
     Date.now()>=ts.nextAdvanceAttempt){
    ts.advancePending=true;
    ts.nextAdvanceAttempt=Date.now()+10000;
    tApi('/games/'+getGameId()+'/tournament/advance-due',{method:'POST'})
      .then(function(result){
        if(result.advanced){
          ts._lastNotifiedLevel=null;
          ts.voiceWarningDone=false;
          return loadTournament();
        }
      })
      .catch(function(err){console.warn('Tournament auto-advance:',err.message);})
      .finally(function(){ts.advancePending=false;});
  }
  if(ts.secsRemaining===0&&ts._lastNotifiedLevel!==ts.state.current_level){
    ts._lastNotifiedLevel=ts.state.current_level;
    var next=ts.levels.find(function(l){return l.level_num===ts.state.current_level+1;});
    if(next){toast('\u23f0 Level '+ts.state.current_level+' done! Next: '+(next.is_break?'BREAK':next.small_blind+'/'+next.big_blind));speak('Level '+ts.state.current_level+' complete. '+(next.is_break?'Break time.':buildAnn(next,ts.levels.find(function(l){return l.level_num===ts.state.current_level+2;}))));}
    if('Notification'in window&&Notification.permission==='granted'&&next){
      new Notification('PKR \u2014 Level Up!',{body:next.is_break?'Time for a break!':'Blinds: '+next.small_blind+'/'+next.big_blind,icon:'/icon-192.png'});
    }
  }
}
function renderTimerDisplay(){var el=document.getElementById('tTimerDisplay');if(!el)return;el.textContent=fmtTime(ts.secsRemaining);el.style.color=ts.secsRemaining<60?'var(--red)':'var(--cream)';}

function speak(text) {
  if(!ts.voiceEnabled) return;
  if(!('speechSynthesis' in window)) return;
  window.speechSynthesis.cancel();
  var u = new SpeechSynthesisUtterance(text);
  var voices = window.speechSynthesis.getVoices();
  var pref = voices.find(function(v){return v.lang==='en-AU';}) || voices.find(function(v){return v.lang.startsWith('en');});
  if(pref) u.voice=pref; u.rate=0.92; u.pitch=1.0; u.volume=1.0;
  window.speechSynthesis.speak(u);
}
function buildAnn(lv, next) {
  if(!lv) return '';
  if(lv.is_break) return 'Attention players. Break time. '+Math.round(lv.duration_secs/60)+' minutes.';
  var msg='Attention players. Blinds are now '+lv.small_blind+' and '+lv.big_blind;
  if(lv.ante) msg+=', with an ante of '+lv.ante; msg+='.';
  if(next&&!next.is_break) msg+=' Next level: '+next.small_blind+' and '+next.big_blind+'.';
  return msg;
}

function genBlinds(chips, hours) {
  // Generate a structure that fits the requested duration, up to 24 hours.
  // Preserve consecutive level numbers and the Worker's 100-stage limit.
  var targetMinutes=Math.max(120,Math.min(1440,Math.round(Number(hours||3)*60)));
  var breakMinutes=10, breakEvery=6;
  var playable=Math.max(8,Math.min(90,Math.ceil(targetMinutes/18)));
  var breaks=Math.floor((playable-1)/breakEvery);
  var playingSeconds=Math.max(playable*30,targetMinutes*60-breaks*breakMinutes*60);
  var perLevel=Math.floor(playingSeconds/playable);
  var extraSeconds=playingSeconds%playable;
  // Distribute remaining seconds so the generated schedule matches its
  // selected duration exactly, including scheduled breaks.
  var lvs=[],s=Math.max(25,Math.round((Number(chips)||10000)/400/25)*25);
  for(var count=0;count<playable&&lvs.length<100;count++){
    if(count>0&&count%breakEvery===0&&lvs.length<99)
      lvs.push({level_num:lvs.length+1,small_blind:0,big_blind:0,ante:0,duration_secs:breakMinutes*60,is_break:true});
    var small=Math.max(25,Math.round(s/25)*25);
    lvs.push({level_num:lvs.length+1,small_blind:small,big_blind:small*2,
      ante:count>=5?Math.max(25,Math.round(small*.125/25)*25):0,
      duration_secs:perLevel+(count<extraSeconds?1:0),is_break:false});
    s=Math.max(small+25,Math.round(small*1.35/25)*25);
  }
  return lvs;
}
function loadTournament(){
  return tApi('/games/'+getGameId()+'/tournament').then(function(d){
    ts.state=d.state;ts.levels=d.levels||[];ts.rebuys=d.rebuys||[];ts.eliminations=d.eliminations||[];
    ts.payouts=d.payouts||[];ts.prizePoolCents=d.prize_pool_cents;ts.payoutError=d.payout_error;
    if(ts.state){
      ts.setupConfig.starting_chips=ts.state.starting_chips||10000;
      ts.setupConfig.buy_in_amount=ts.state.buy_in_amount||0;
      ts.setupConfig.rebuy_allowed=!!ts.state.rebuy_allowed;
      ts.setupConfig.rebuy_levels=ts.state.rebuy_levels||4;
      ts.setupConfig.addon_allowed=!!ts.state.addon_allowed;
      ts.setupConfig.addon_chips=ts.state.addon_chips||5000;
      try{ts.setupConfig.payout_structure=JSON.parse(ts.state.payout_structure||'[]');}catch(e){}
      if(ts.levels.length)ts.setupLevels=JSON.parse(JSON.stringify(ts.levels));
    }
    if(ts.state&&ts.state.status==='running')startLocalTimer();
    else stopLocalTimer();
    if(ts.state&&ts.state.status==='paused'){
      var current=ts.levels.find(function(l){return l.level_num===ts.state.current_level;});
      ts.secsRemaining=Math.max(0,(current?current.duration_secs:0)-(ts.state.paused_elapsed||0));
    }
    renderBody();
  }).catch(function(e){console.warn('loadTournament:',e.message);toast('Tournament could not load: '+e.message);renderBody();});
}
window.openTournament=function(){var s=document.getElementById('tournamentSheet');if(s)s.classList.add('open');ensureTournamentRefresh();loadTournament();};
var _tourneyRefreshTimer=null;
function ensureTournamentRefresh(){
  if(_tourneyRefreshTimer)return;
  _tourneyRefreshTimer=setInterval(function(){
    if(!document.hidden&&ts.state&&ts.state.status==='running')loadTournament();
  },30000);
}
document.addEventListener('visibilitychange',function(){
  if(!document.hidden&&ts.state&&ts.state.status==='running')loadTournament();
});
window.closeTournament=function(){var s=document.getElementById('tournamentSheet');if(s)s.classList.remove('open');/* Tournament remains running when the sheet closes. */};
window.tStart=function(){
  tApi('/games/'+getGameId()+'/tournament/start',{method:'POST'}).then(function(r){
    ts.state.status='running';ts.state.current_level=1;ts.state.level_started_at=r.level_started_at;ts.state.total_chips_in_play=r.total_chips_in_play;
    ensureTournamentRefresh();startLocalTimer();toast('\ud83c\udfc6 Tournament started!');renderBody();
  }).catch(function(e){toast('\u26a0\ufe0f '+e.message);});
};
window.tNextLevel=function(){
  tApi('/games/'+getGameId()+'/tournament/next-level',{method:'POST'}).then(function(r){
    ts.state.current_level=r.current_level;ts.state.level_started_at=r.level_started_at;
    ts.secsRemaining=(r.level&&r.level.duration_secs)||900;ts._lastNotifiedLevel=null;
    ts.voiceWarningDone=false;
    if(r.level){var nv=ts.levels.find(function(l){return l.level_num===r.current_level+1;});speak(buildAnn(r.level,nv));}
    toast('Level '+r.current_level+(r.level&&r.level.is_break?' \u2014 BREAK':(' \u2014 '+r.level.small_blind+'/'+r.level.big_blind)));renderBody();
  }).catch(function(e){toast('\u26a0\ufe0f '+e.message);});
};
window.tPause=function(){
  // The Worker decides elapsed time from its own clock, never the device.
  tApi('/games/'+getGameId()+'/tournament/pause',{method:'POST'}).then(function(r){
    ts.state.status=r.status;
    if(r.status==='paused'){
      ts.state.paused_elapsed=r.paused_elapsed;
      stopLocalTimer();
    }else{
      ts.state.level_started_at=r.level_started_at;
      ts.state.paused_elapsed=0;
      startLocalTimer();
    }
    renderBody();
  }).catch(function(e){toast('\u26a0\ufe0f '+e.message);});
};
var pendingRebuys={};
window.tAddRebuy=function(playerName,type){
  if(!ts.state)return;
  var chips=type==='addon'?ts.state.addon_chips:ts.state.starting_chips;
  var key='pkr_tournament_rebuy_'+getGameId()+'_'+encodeURIComponent(playerName)+'_'+type;
  if(pendingRebuys[key])return;
  var requestId;
  try{
    requestId=localStorage.getItem(key);
    if(!requestId){
      if(!window.crypto||typeof window.crypto.randomUUID!=='function'){
        toast('Secure transaction ID unavailable. Rebuy was not sent.');return;
      }
      requestId=window.crypto.randomUUID();
      localStorage.setItem(key,requestId);
    }
  }catch(e){toast('Browser storage unavailable. Rebuy was not sent.');return;}
  pendingRebuys[key]=true;
  tApi('/games/'+getGameId()+'/tournament/rebuy',{
    method:'POST',body:JSON.stringify({
      idempotency_key:requestId,player_name:playerName,type:type,chips:chips,
      amount_paid:ts.state.buy_in_amount||0,
    }),
  }).then(function(){
    try{if(localStorage.getItem(key)===requestId)localStorage.removeItem(key);}
    catch(e){/* Retain the same ID for a safe retry. */}
    toast((type==='addon'?'Add-on':'Rebuy')+' recorded for '+playerName);
    loadTournament();
  }).catch(function(e){
    toast('Rebuy status uncertain: '+e.message+'. Retrying will use the same reference.');
  }).finally(function(){delete pendingRebuys[key];});
};
window.tEliminate=function(playerName){
  tApi('/games/'+getGameId()+'/tournament/eliminate',{
    method:'POST',body:JSON.stringify({player_name:playerName}),
  }).then(function(r){
    toast(playerName+' placed '+ordinal(r.finishing_position));
    loadTournament(); // Refresh server records rather than guessing an elimination place.
  }).catch(function(e){toast('\u26a0\ufe0f '+e.message);});
};
window.tSetup=function(){
  tApi('/games/'+getGameId()+'/tournament/setup',{method:'POST',body:JSON.stringify({
    starting_chips:ts.setupConfig.starting_chips,buy_in_amount:ts.setupConfig.buy_in_amount,
    rebuy_allowed:ts.setupConfig.rebuy_allowed,
    rebuy_levels:ts.setupConfig.rebuy_levels,addon_allowed:ts.setupConfig.addon_allowed,
    addon_chips:ts.setupConfig.addon_chips,payout_structure:ts.setupConfig.payout_structure,levels:ts.setupLevels,
  })}).then(function(){toast('\u2705 Tournament configured');ts.view='main';loadTournament();}).catch(function(e){toast('\u26a0\ufe0f '+e.message);});
};
function calculatePayouts(){
  // Use the Worker's financially reconciled values, never a local estimate.
  return Array.isArray(ts.payouts)?ts.payouts:[];
}
function mkB(label,style,onClick){var b=document.createElement('button');b.style.cssText=style;b.textContent=label;b.addEventListener('click',onClick);return b;}
function renderBody(){
  var body=document.getElementById('tournamentBody');if(!body)return;body.innerHTML='';
  if(ts.view==='setup'){renderSetup(body);return;}
  if(ts.view==='payouts'){renderPayouts(body);return;}
  renderMain(body);
}
function renderMain(body){
  var state=ts.state;
  if(!state||!state.status){
    var intro=document.createElement('div');intro.style.cssText='text-align:center;padding:30px 0';
    intro.innerHTML='<div style="font-size:2rem;margin-bottom:12px">\ud83c\udfc6</div><div style="font-size:1rem;font-weight:700;color:var(--cream);margin-bottom:6px">Tournament Mode</div><div style="font-size:0.8rem;color:var(--muted);margin-bottom:20px;line-height:1.5">Blind timer \u00b7 levels \u00b7 eliminations \u00b7 payouts</div>';
    body.appendChild(intro);
    body.appendChild(mkB('\u2699\ufe0f Set Up Tournament','width:100%;padding:14px;background:rgba(201,168,76,0.1);border:1px solid rgba(201,168,76,0.3);color:var(--gold);border-radius:10px;cursor:pointer;font-size:0.9rem;font-weight:700;font-family:DM Sans,sans-serif',function(){ts.view='setup';renderBody();}));
    return;
  }
  var lv=ts.levels.find(function(l){return l.level_num===state.current_level;});
  var nextLv=ts.levels.find(function(l){return l.level_num===state.current_level+1;});
  var isBreak=lv&&lv.is_break;
  var active=getActivePlayers();
  // Timer block
  var tb=document.createElement('div');tb.style.cssText='background:rgba(0,0,0,0.3);border-radius:12px;padding:16px;margin-bottom:12px;text-align:center;border:1px solid rgba(201,168,76,0.15)';
  var ll=document.createElement('div');ll.style.cssText='font-size:0.65rem;text-transform:uppercase;letter-spacing:2px;color:'+(isBreak?'#6aaaee':'var(--gold)')+';margin-bottom:4px;font-weight:600';
  ll.textContent=isBreak?'\u2615 BREAK':'LEVEL '+state.current_level;tb.appendChild(ll);
  var td=document.createElement('div');td.id='tTimerDisplay';td.style.cssText='font-size:3rem;font-weight:700;color:var(--cream);letter-spacing:2px;font-family:monospace;margin:4px 0';
  td.textContent=fmtTime(ts.secsRemaining);tb.appendChild(td);
  if(!isBreak&&lv){var bl=document.createElement('div');bl.style.cssText='font-size:0.85rem;color:var(--muted);margin-top:4px';bl.textContent=lv.small_blind+' / '+lv.big_blind+(lv.ante?' (ante '+lv.ante+')':'');tb.appendChild(bl);}
  if(nextLv){var nl=document.createElement('div');nl.style.cssText='font-size:0.7rem;color:rgba(255,255,255,0.3);margin-top:6px';nl.textContent='Next: '+(nextLv.is_break?'Break':nextLv.small_blind+'/'+nextLv.big_blind);tb.appendChild(nl);}
  body.appendChild(tb);
  // Controls
  if(state.status==='setup'){
    body.appendChild(mkB('\u25b6 Start Tournament','width:100%;padding:13px;background:rgba(46,204,113,0.1);border:1px solid rgba(46,204,113,0.3);color:var(--green);border-radius:8px;cursor:pointer;font-size:0.9rem;font-weight:700;font-family:DM Sans,sans-serif;margin-bottom:8px',window.tStart));
    var requirement=document.createElement('p');
    requirement.style.cssText='font-size:12px;line-height:1.6;color:var(--muted);margin:4px 0 14px';
    requirement.textContent='To activate: the host must have an active Pro plan, at least two players must be registered with recorded buy-ins, and the blind structure must be saved.';
    body.appendChild(requirement);

  } else if(state.status==='running'||state.status==='paused'){
    var cr=document.createElement('div');cr.style.cssText='display:flex;gap:6px;margin-bottom:8px';
    cr.appendChild(mkB(state.status==='paused'?'\u25b6 Resume':'\u23f8 Pause','flex:1;padding:12px;background:rgba(255,255,255,0.05);border:1px solid var(--border);color:var(--cream);border-radius:8px;cursor:pointer;font-size:0.85rem;font-family:DM Sans,sans-serif;font-weight:600',window.tPause));
    if(nextLv)cr.appendChild(mkB('\u23ed Next Level','flex:1;padding:12px;background:rgba(201,168,76,0.08);border:1px solid rgba(201,168,76,0.25);color:var(--gold);border-radius:8px;cursor:pointer;font-size:0.85rem;font-family:DM Sans,sans-serif;font-weight:600',window.tNextLevel));
    body.appendChild(cr);
  }
  if(state.status==='running'||state.status==='paused'){
    var auto=document.createElement('div');
    auto.style.cssText='display:flex;flex-wrap:wrap;align-items:center;gap:10px;justify-content:space-between;padding:10px 12px;border:1px solid var(--border);border-radius:8px;margin-bottom:10px';
    var explanation=document.createElement('span');
    explanation.style.cssText='font-size:0.75rem;color:var(--muted);flex:1;min-width:150px';
    explanation.textContent='Advance blinds automatically while this host panel is open';
    auto.appendChild(explanation);
    auto.appendChild(mkB(ts.autoAdvance?'Auto levels ON':'Auto levels OFF',
      'padding:8px 10px;min-height:40px;background:rgba(201,168,76,.08);border:1px solid var(--gold);color:var(--gold);border-radius:7px;cursor:pointer;font-size:0.76rem',
      function(){ts.autoAdvance=!ts.autoAdvance;renderBody();}));
    body.appendChild(auto);
  }
  // Players
  var ps=document.createElement('div');ps.style.cssText='background:rgba(255,255,255,0.02);border:1px solid var(--border);border-radius:10px;overflow:hidden;margin-bottom:10px';
  var ph=document.createElement('div');ph.style.cssText='padding:8px 12px;border-bottom:1px solid var(--border);display:flex;justify-content:space-between;align-items:center';
  ph.innerHTML='<span style="font-size:0.7rem;text-transform:uppercase;letter-spacing:1.5px;color:var(--muted);font-weight:600">Players</span><span style="font-size:0.8rem;color:var(--cream);font-weight:700">'+active.length+' remaining</span>';
  ps.appendChild(ph);
  active.forEach(function(pl){
    var row=document.createElement('div');row.style.cssText='display:flex;align-items:center;justify-content:space-between;padding:8px 12px;border-bottom:1px solid rgba(255,255,255,0.03)';
    var nm=document.createElement('span');nm.style.cssText='font-size:0.85rem;color:var(--cream);font-weight:500';nm.textContent=pl.name;row.appendChild(nm);
    var acts=document.createElement('div');acts.style.cssText='display:flex;gap:4px';
    if(state.rebuy_allowed&&state.current_level<=state.rebuy_levels){
      var rb=document.createElement('button');rb.style.cssText='font-size:0.7rem;padding:3px 8px;background:rgba(255,160,30,0.1);border:1px solid rgba(255,160,30,0.3);color:#ffaa33;border-radius:4px;cursor:pointer;font-family:DM Sans,sans-serif';
      rb.textContent='\u267b\ufe0f Rebuy';rb.dataset.name=pl.name;rb.addEventListener('click',function(){window.tAddRebuy(this.dataset.name,'rebuy');});acts.appendChild(rb);
    }
    var el=document.createElement('button');el.style.cssText='font-size:0.7rem;padding:3px 8px;background:rgba(231,76,60,0.1);border:1px solid rgba(231,76,60,0.3);color:var(--red);border-radius:4px;cursor:pointer;font-family:DM Sans,sans-serif';
    el.textContent='\ud83d\udc80 Out';el.dataset.name=pl.name;el.addEventListener('click',function(){window.tEliminate(this.dataset.name);});acts.appendChild(el);
    row.appendChild(acts);ps.appendChild(row);
  });
  var elims=ts.eliminations||[];
  if(elims.length>0){
    var eh=document.createElement('div');eh.style.cssText='padding:6px 12px;font-size:0.65rem;text-transform:uppercase;letter-spacing:1.5px;color:var(--red);font-weight:600;border-top:1px solid var(--border)';eh.textContent='Eliminated';ps.appendChild(eh);
    elims.slice().reverse().forEach(function(e){
      var er=document.createElement('div');er.style.cssText='display:flex;justify-content:space-between;padding:6px 12px;border-top:1px solid rgba(255,255,255,0.02);opacity:0.5';
      var nm=document.createElement('span');nm.style.cssText='font-size:0.8rem;color:var(--muted)';nm.textContent=e.player_name;
      var pos=document.createElement('span');pos.style.cssText='font-size:0.75rem;color:var(--muted)';pos.textContent=ordinal(e.finishing_position);
      er.appendChild(nm);er.appendChild(pos);ps.appendChild(er);
    });
  }
  body.appendChild(ps);
  var vr=document.createElement('div');vr.style.cssText='display:flex;align-items:center;justify-content:space-between;padding:8px 12px;background:rgba(255,255,255,0.02);border:1px solid var(--border);border-radius:8px;margin-bottom:8px';
  var vlb=document.createElement('span');vlb.style.cssText='font-size:0.8rem;color:var(--cream)';vlb.textContent='📣 Voice Announcements';vr.appendChild(vlb);
  var vtg=document.createElement('button');vtg.style.cssText='padding:4px 12px;border-radius:20px;font-size:0.72rem;font-weight:700;cursor:pointer;font-family:DM Sans,sans-serif;border:none;'+(ts.voiceEnabled?'background:var(--gold);color:#000':'background:rgba(255,255,255,0.08);color:var(--muted)');
  vtg.textContent=ts.voiceEnabled?'ON':'OFF';
  vtg.addEventListener('click',function(){ts.voiceEnabled=!ts.voiceEnabled;this.textContent=ts.voiceEnabled?'ON':'OFF';this.style.background=ts.voiceEnabled?'var(--gold)':'rgba(255,255,255,0.08)';this.style.color=ts.voiceEnabled?'#000':'var(--muted)';if(ts.voiceEnabled)speak('Voice announcements enabled.');});
  vr.appendChild(vtg);body.appendChild(vr);
  var nav=document.createElement('div');nav.style.cssText='display:flex;gap:6px';
  var c4=window.getPkrCtx&&window.getPkrCtx();
  if(c4&&c4.gameId){nav.appendChild(mkB('\ud83d\udcfa TV','flex:1;padding:10px;background:rgba(106,170,238,0.06);border:1px solid rgba(106,170,238,0.2);color:#6aaaee;border-radius:7px;cursor:pointer;font-size:0.8rem;font-family:DM Sans,sans-serif',function(){window.open('/games/'+c4.gameId+'/tv','_blank');}));}
  nav.appendChild(mkB('\ud83d\udcb0 Payouts','flex:1;padding:10px;background:rgba(46,204,113,0.06);border:1px solid rgba(46,204,113,0.2);color:var(--green);border-radius:7px;cursor:pointer;font-size:0.8rem;font-family:DM Sans,sans-serif',function(){ts.view='payouts';renderBody();}));
  nav.appendChild(mkB('\u2699\ufe0f Edit Setup','flex:1;padding:10px;background:rgba(255,255,255,0.03);border:1px solid var(--border);color:var(--muted);border-radius:7px;cursor:pointer;font-size:0.8rem;font-family:DM Sans,sans-serif',function(){ts.view='setup';renderBody();}));
  body.appendChild(nav);
}
function renderSetup(body){
  body.appendChild(mkB('\u2190 Back','background:none;border:none;color:var(--muted);cursor:pointer;font-size:0.85rem;margin-bottom:12px;padding:0;font-family:DM Sans,sans-serif',function(){ts.view='main';renderBody();}));
  var h=document.createElement('div');h.style.cssText='font-size:0.95rem;font-weight:700;color:var(--cream);margin-bottom:14px';h.textContent='\u2699\ufe0f Tournament Setup';body.appendChild(h);
  function addField(lbl,val,onChange){
    var w=document.createElement('div');w.style.cssText='margin-bottom:10px';
    var l=document.createElement('div');l.style.cssText='font-size:0.7rem;text-transform:uppercase;letter-spacing:1px;color:var(--muted);margin-bottom:4px;font-weight:600';l.textContent=lbl;w.appendChild(l);
    var i=document.createElement('input');i.type='number';i.value=val;i.style.cssText='width:100%;background:rgba(4,12,5,0.9);border:1px solid var(--border);color:var(--cream);padding:8px 10px;font-size:0.88rem;border-radius:6px;outline:none;font-family:DM Sans,sans-serif;box-sizing:border-box';
    i.addEventListener('input',function(){onChange(this.value);});w.appendChild(i);body.appendChild(w);
  }
  addField('Starting Chips',ts.setupConfig.starting_chips,function(v){ts.setupConfig.starting_chips=parseInt(v)||10000;});
  addField('Entry fee ($)',(ts.setupConfig.buy_in_amount/100).toFixed(2),function(v){ts.setupConfig.buy_in_amount=Math.round(Math.max(0,Number(v)||0)*100);});
  var reRow=document.createElement('div');reRow.style.cssText='display:flex;align-items:center;justify-content:space-between;margin-bottom:10px;padding:10px 12px;background:rgba(255,255,255,0.03);border:1px solid var(--border);border-radius:8px';
  reRow.innerHTML='<span style="font-size:0.82rem;color:var(--cream);font-weight:600">Allow Rebuys</span>';
  var rtog=document.createElement('button');rtog.style.cssText='padding:5px 12px;border-radius:20px;font-size:0.75rem;font-weight:700;cursor:pointer;font-family:DM Sans,sans-serif;border:none;'+(ts.setupConfig.rebuy_allowed?'background:var(--gold);color:#000':'background:rgba(255,255,255,0.08);color:var(--muted)');
  rtog.textContent=ts.setupConfig.rebuy_allowed?'ON':'OFF';rtog.addEventListener('click',function(){ts.setupConfig.rebuy_allowed=!ts.setupConfig.rebuy_allowed;renderBody();});reRow.appendChild(rtog);body.appendChild(reRow);
  var ab=document.createElement('div');ab.style.cssText='background:rgba(201,168,76,0.06);border:1px solid rgba(201,168,76,0.2);border-radius:8px;padding:10px 12px;margin-bottom:12px';
  var abH=document.createElement('div');abH.style.cssText='font-size:0.7rem;text-transform:uppercase;letter-spacing:1.5px;color:var(--gold);margin-bottom:8px;font-weight:600';abH.textContent='✨ Auto-generate structure';ab.appendChild(abH);
  var abR=document.createElement('div');abR.style.cssText='display:flex;flex-wrap:wrap;gap:6px';
  ['2h','3h','4h','5h','6h','8h','10h','12h','16h','20h','24h'].forEach(function(h){
    var btn=document.createElement('button');
    btn.style.cssText='flex:1 0 20%;padding:6px;background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.1);color:var(--muted);border-radius:5px;cursor:pointer;font-size:0.75rem;font-family:DM Sans,sans-serif';
    btn.textContent=h;
    btn.addEventListener('click',function(){
      abR.querySelectorAll('button').forEach(function(b){b.style.background='rgba(255,255,255,0.04)';b.style.color='var(--muted)';b.style.borderColor='rgba(255,255,255,0.1)';});
      this.style.background='rgba(201,168,76,0.12)';this.style.color='var(--gold)';this.style.borderColor='rgba(201,168,76,0.3)';
      ts.setupLevels=genBlinds(ts.setupConfig.starting_chips,parseFloat(h));
      toast('Structure generated for '+h+' ✓');renderBody();
    });
    abR.appendChild(btn);
  });
  ab.appendChild(abR);body.appendChild(ab);
  var lvHdr=document.createElement('div');lvHdr.style.cssText='font-size:0.7rem;text-transform:uppercase;letter-spacing:1.5px;color:var(--gold);margin:14px 0 8px;font-weight:600';lvHdr.textContent='Blind Levels';body.appendChild(lvHdr);
  var totalSeconds=ts.setupLevels.reduce(function(n,l){return n+l.duration_secs;},0);
  var info=document.createElement('p');info.style.cssText='color:var(--muted);font-size:12px;line-height:1.5;margin-bottom:10px';
  info.textContent=ts.setupLevels.length+' stages · approx. '+(totalSeconds/3600).toFixed(1)+' hours · edit blinds and minutes per stage';
  body.appendChild(info);
  ts.setupLevels.forEach(function(lv,idx){
    var row=document.createElement('div');row.style.cssText='display:flex;gap:4px;align-items:center;margin-bottom:4px;padding:6px 8px;background:'+(lv.is_break?'rgba(58,106,170,0.08)':'rgba(255,255,255,0.02)')+';border-radius:6px;border:1px solid var(--border)';
    var num=document.createElement('span');num.style.cssText='font-size:0.7rem;color:var(--muted);min-width:20px;flex-shrink:0';num.textContent=lv.level_num;row.appendChild(num);
    if(lv.is_break){var bl=document.createElement('span');bl.style.cssText='flex:1;font-size:0.78rem;color:#6aaaee';bl.textContent='\u2615 Break';row.appendChild(bl);}
    else{
      function makeInp(v,i,f){var inp=document.createElement('input');inp.type='text';inp.value=v;inp.style.cssText='flex:1;background:rgba(0,0,0,0.3);border:1px solid rgba(255,255,255,0.1);color:var(--cream);padding:3px 6px;font-size:0.72rem;border-radius:4px;text-align:center;min-width:0;font-family:DM Sans,sans-serif';inp.dataset.idx=i;inp.dataset.field=f;inp.addEventListener('change',function(){ts.setupLevels[parseInt(this.dataset.idx)][this.dataset.field]=parseInt(this.value)||0;});return inp;}
      var slash=document.createElement('span');slash.style.cssText='font-size:0.7rem;color:var(--muted)';slash.textContent='/';
      row.appendChild(makeInp(String(lv.small_blind),idx,'small_blind'));row.appendChild(slash);row.appendChild(makeInp(String(lv.big_blind),idx,'big_blind'));
    }
    var dur=document.createElement('input');dur.type='text';dur.value=Math.round(lv.duration_secs/60)+'m';dur.style.cssText='width:36px;background:rgba(0,0,0,0.3);border:1px solid rgba(255,255,255,0.1);color:var(--muted);padding:3px 4px;font-size:0.7rem;border-radius:4px;text-align:center;font-family:DM Sans,sans-serif';dur.dataset.idx=idx;dur.addEventListener('change',function(){ts.setupLevels[parseInt(this.dataset.idx)].duration_secs=(parseInt(this.value)||15)*60;});row.appendChild(dur);
    body.appendChild(row);
  });
  // Manual extension for tournaments exceeding the selected duration.
  var extension=document.createElement('div');extension.style.cssText='display:flex;gap:8px;flex-wrap:wrap;margin-top:12px';
  extension.appendChild(mkB('+ Add Blind Level','flex:1;padding:11px;background:rgba(201,168,76,.08);border:1px solid var(--gold);color:var(--gold);border-radius:8px;cursor:pointer',function(){
    if(ts.setupLevels.length>=100){toast('Maximum 100 stages');return;}
    var prev=ts.setupLevels.slice().reverse().find(function(l){return !l.is_break;})||DEFAULT_LEVELS[0];
    var small=Math.max(25,Math.round(prev.big_blind*0.75/25)*25);
    ts.setupLevels.push({level_num:ts.setupLevels.length+1,small_blind:small,big_blind:small*2,ante:prev.ante||0,duration_secs:prev.duration_secs||900,is_break:false});
    renderBody();
  }));
  extension.appendChild(mkB('+ Add Break','flex:1;padding:11px;background:rgba(106,170,238,.08);border:1px solid #6aaaee;color:#6aaaee;border-radius:8px;cursor:pointer',function(){
    if(ts.setupLevels.length>=100){toast('Maximum 100 stages');return;}
    ts.setupLevels.push({level_num:ts.setupLevels.length+1,small_blind:0,big_blind:0,ante:0,duration_secs:600,is_break:true});
    renderBody();
  }));
  extension.appendChild(mkB('Remove Last','flex:1;padding:11px;background:rgba(255,255,255,.04);border:1px solid var(--border);color:var(--cream);border-radius:8px;cursor:pointer',function(){
    if(ts.setupLevels.length<=1){toast('At least one stage is required');return;}
    ts.setupLevels.pop();renderBody();
  }));
  body.appendChild(extension);
  if(ts.state&&ts.state.status!=='setup'){
    var lock=document.createElement('p');lock.style.cssText='font-size:12px;line-height:1.6;color:#f0d393;margin:14px 0 0';
    lock.textContent='This tournament has started. The saved structure cannot be overwritten. Existing levels and results are preserved.';
    body.appendChild(lock);return;
  }
  body.appendChild(mkB('\u2705 Save & Configure','width:100%;padding:14px;background:rgba(46,204,113,0.1);border:1px solid rgba(46,204,113,0.3);color:var(--green);border-radius:8px;cursor:pointer;font-size:0.9rem;font-weight:700;font-family:DM Sans,sans-serif;margin-top:12px',window.tSetup));
  var hint=document.createElement('p');
  hint.style.cssText='color:var(--muted);font-size:12px;line-height:1.6;margin-top:9px';
  hint.textContent='Choose a 2–24 hour preset, or add up to 100 consecutive blind and break stages. Saving does not start the tournament or change existing settled games.';
  body.appendChild(hint);

}
function renderPayouts(body){
  body.appendChild(mkB('\u2190 Back','background:none;border:none;color:var(--muted);cursor:pointer;font-size:0.85rem;margin-bottom:12px;padding:0;font-family:DM Sans,sans-serif',function(){ts.view='main';renderBody();}));
  var h=document.createElement('div');h.style.cssText='font-size:0.95rem;font-weight:700;color:var(--cream);margin-bottom:14px';h.textContent='\ud83d\udcb0 Payout Structure';body.appendChild(h);
  var payouts=calculatePayouts();var total=ts.prizePoolCents;
  if(ts.payoutError){var warning=document.createElement('div');warning.style.cssText='color:var(--red);margin-bottom:12px;font-size:0.8rem';warning.textContent='Payout review required: '+ts.payoutError;body.appendChild(warning);}
  var sr=document.createElement('div');sr.style.cssText='background:rgba(201,168,76,0.06);border:1px solid rgba(201,168,76,0.2);border-radius:8px;padding:10px 14px;margin-bottom:12px;display:flex;justify-content:space-between';
  sr.innerHTML='<span style="font-size:0.8rem;color:var(--muted)">Prize Pool</span><span style="font-size:0.9rem;color:var(--gold);font-weight:700">'+(total===null?'Pending':('$'+(total/100).toFixed(2)))+'</span>';body.appendChild(sr);
  payouts.forEach(function(p){
    var row=document.createElement('div');row.style.cssText='display:flex;align-items:center;justify-content:space-between;padding:10px 14px;margin-bottom:6px;background:rgba(255,255,255,0.02);border:1px solid var(--border);border-radius:8px';
    row.innerHTML='<span style="font-size:0.85rem;color:var(--cream);font-weight:600">'+(['1st','2nd','3rd'][p.place-1]||p.place+'th')+' Place</span><div style="text-align:right"><div style="font-size:0.9rem;color:var(--gold);font-weight:700">$'+(p.amount/100).toFixed(2)+'</div><div style="font-size:0.65rem;color:var(--muted)">'+p.pct+'%</div></div>';
    body.appendChild(row);
  });
}
})();
