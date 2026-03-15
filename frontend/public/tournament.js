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
];
var ts = {
  view:'main', state:null, levels:[], rebuys:[], eliminations:[],
  timerInterval:null, secsRemaining:0,
  setupLevels:JSON.parse(JSON.stringify(DEFAULT_LEVELS)),
  setupConfig:{starting_chips:10000,rebuy_allowed:false,rebuy_levels:4,addon_allowed:false,addon_chips:5000,
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
  if(ts.secsRemaining===0&&ts._lastNotifiedLevel!==ts.state.current_level){
    ts._lastNotifiedLevel=ts.state.current_level;
    var next=ts.levels.find(function(l){return l.level_num===ts.state.current_level+1;});
    if(next){toast('\u23f0 Level '+ts.state.current_level+' done! Next: '+(next.is_break?'BREAK':next.small_blind+'/'+next.big_blind));}
    if('Notification'in window&&Notification.permission==='granted'&&next){
      new Notification('PKR \u2014 Level Up!',{body:next.is_break?'Time for a break!':'Blinds: '+next.small_blind+'/'+next.big_blind,icon:'/icon-192.png'});
    }
  }
}
function renderTimerDisplay(){var el=document.getElementById('tTimerDisplay');if(!el)return;el.textContent=fmtTime(ts.secsRemaining);el.style.color=ts.secsRemaining<60?'var(--red)':'var(--cream)';}
function loadTournament(){
  return tApi('/games/'+getGameId()+'/tournament').then(function(d){
    ts.state=d.state;ts.levels=d.levels||[];ts.rebuys=d.rebuys||[];ts.eliminations=d.eliminations||[];
    if(ts.state&&ts.state.status==='running')startLocalTimer();
    renderBody();
  }).catch(function(e){console.warn('loadTournament:',e.message);renderBody();});
}
window.openTournament=function(){var s=document.getElementById('tournamentSheet');if(s)s.classList.add('open');loadTournament();};
window.closeTournament=function(){var s=document.getElementById('tournamentSheet');if(s)s.classList.remove('open');stopLocalTimer();};
window.tStart=function(){
  tApi('/games/'+getGameId()+'/tournament/start',{method:'POST'}).then(function(r){
    ts.state.status='running';ts.state.current_level=1;ts.state.level_started_at=Math.floor(Date.now()/1000);ts.state.total_chips_in_play=r.total_chips_in_play;
    startLocalTimer();toast('\ud83c\udfc6 Tournament started!');renderBody();
  }).catch(function(e){toast('\u26a0\ufe0f '+e.message);});
};
window.tNextLevel=function(){
  tApi('/games/'+getGameId()+'/tournament/next-level',{method:'POST'}).then(function(r){
    ts.state.current_level=r.current_level;ts.state.level_started_at=Math.floor(Date.now()/1000);
    ts.secsRemaining=(r.level&&r.level.duration_secs)||900;ts._lastNotifiedLevel=null;
    toast('Level '+r.current_level+(r.level&&r.level.is_break?' \u2014 BREAK':(' \u2014 '+r.level.small_blind+'/'+r.level.big_blind)));renderBody();
  }).catch(function(e){toast('\u26a0\ufe0f '+e.message);});
};
window.tPause=function(){
  var lv=ts.state?ts.levels.find(function(l){return l.level_num===ts.state.current_level;}):null;
  var elapsed=lv?(lv.duration_secs-ts.secsRemaining):0;
  tApi('/games/'+getGameId()+'/tournament/pause',{method:'POST',body:JSON.stringify({paused_elapsed:elapsed})}).then(function(r){
    ts.state.status=r.status;if(r.status==='paused')stopLocalTimer();else startLocalTimer();renderBody();
  }).catch(function(e){toast('\u26a0\ufe0f '+e.message);});
};
window.tAddRebuy=function(playerName,type){
  var chips=type==='addon'?ts.state.addon_chips:ts.state.starting_chips;
  tApi('/games/'+getGameId()+'/tournament/rebuy',{method:'POST',body:JSON.stringify({player_name:playerName,type:type,chips:chips,amount_paid:ts.state.buy_in_amount||0})})
    .then(function(){toast((type==='addon'?'\ud83d\udd04 Add-on':'\u267b\ufe0f Rebuy')+' for '+playerName);loadTournament();}).catch(function(e){toast('\u26a0\ufe0f '+e.message);});
};
window.tEliminate=function(playerName){
  var pos=getActivePlayers().length;
  tApi('/games/'+getGameId()+'/tournament/eliminate',{method:'POST',body:JSON.stringify({player_name:playerName,finishing_position:pos})}).then(function(){
    ts.eliminations.push({player_name:playerName,finishing_position:pos});toast('\ud83d\udc80 '+playerName+' out in '+ordinal(pos)+' place');renderBody();
  }).catch(function(e){toast('\u26a0\ufe0f '+e.message);});
};
window.tSetup=function(){
  tApi('/games/'+getGameId()+'/tournament/setup',{method:'POST',body:JSON.stringify({
    starting_chips:ts.setupConfig.starting_chips,rebuy_allowed:ts.setupConfig.rebuy_allowed,
    rebuy_levels:ts.setupConfig.rebuy_levels,addon_allowed:ts.setupConfig.addon_allowed,
    addon_chips:ts.setupConfig.addon_chips,payout_structure:ts.setupConfig.payout_structure,levels:ts.setupLevels,
  })}).then(function(){toast('\u2705 Tournament configured');ts.view='main';loadTournament();}).catch(function(e){toast('\u26a0\ufe0f '+e.message);});
};
function calculatePayouts(){
  if(!ts.state)return[];
  var playerCount=getActivePlayers().length+(ts.eliminations||[]).length;
  var rebuyCost=ts.state.buy_in_amount||0;
  var rebuysCount=(ts.rebuys||[]).filter(function(r){return r.type==='rebuy';}).length;
  var prizePool=(playerCount*rebuyCost)+(rebuysCount*rebuyCost);
  var structure=ts.state.payout_structure?JSON.parse(typeof ts.state.payout_structure==='string'?ts.state.payout_structure:JSON.stringify(ts.state.payout_structure)):[];
  return structure.map(function(s){return{place:s.place,pct:s.pct,amount:Math.round(prizePool*s.pct/100)};});
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
  if(!state||state.status==='setup'||!state.status){
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
  } else if(state.status==='running'||state.status==='paused'){
    var cr=document.createElement('div');cr.style.cssText='display:flex;gap:6px;margin-bottom:8px';
    cr.appendChild(mkB(state.status==='paused'?'\u25b6 Resume':'\u23f8 Pause','flex:1;padding:12px;background:rgba(255,255,255,0.05);border:1px solid var(--border);color:var(--cream);border-radius:8px;cursor:pointer;font-size:0.85rem;font-family:DM Sans,sans-serif;font-weight:600',window.tPause));
    if(nextLv)cr.appendChild(mkB('\u23ed Next Level','flex:1;padding:12px;background:rgba(201,168,76,0.08);border:1px solid rgba(201,168,76,0.25);color:var(--gold);border-radius:8px;cursor:pointer;font-size:0.85rem;font-family:DM Sans,sans-serif;font-weight:600',window.tNextLevel));
    body.appendChild(cr);
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
      er.innerHTML='<span style="font-size:0.8rem;color:var(--muted)">'+e.player_name+'</span><span style="font-size:0.75rem;color:var(--muted)">'+ordinal(e.finishing_position)+'</span>';ps.appendChild(er);
    });
  }
  body.appendChild(ps);
  var nav=document.createElement('div');nav.style.cssText='display:flex;gap:6px';
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
  var reRow=document.createElement('div');reRow.style.cssText='display:flex;align-items:center;justify-content:space-between;margin-bottom:10px;padding:10px 12px;background:rgba(255,255,255,0.03);border:1px solid var(--border);border-radius:8px';
  reRow.innerHTML='<span style="font-size:0.82rem;color:var(--cream);font-weight:600">Allow Rebuys</span>';
  var rtog=document.createElement('button');rtog.style.cssText='padding:5px 12px;border-radius:20px;font-size:0.75rem;font-weight:700;cursor:pointer;font-family:DM Sans,sans-serif;border:none;'+(ts.setupConfig.rebuy_allowed?'background:var(--gold);color:#000':'background:rgba(255,255,255,0.08);color:var(--muted)');
  rtog.textContent=ts.setupConfig.rebuy_allowed?'ON':'OFF';rtog.addEventListener('click',function(){ts.setupConfig.rebuy_allowed=!ts.setupConfig.rebuy_allowed;renderBody();});reRow.appendChild(rtog);body.appendChild(reRow);
  var lvHdr=document.createElement('div');lvHdr.style.cssText='font-size:0.7rem;text-transform:uppercase;letter-spacing:1.5px;color:var(--gold);margin:14px 0 8px;font-weight:600';lvHdr.textContent='Blind Levels';body.appendChild(lvHdr);
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
  body.appendChild(mkB('\u2705 Save & Configure','width:100%;padding:14px;background:rgba(46,204,113,0.1);border:1px solid rgba(46,204,113,0.3);color:var(--green);border-radius:8px;cursor:pointer;font-size:0.9rem;font-weight:700;font-family:DM Sans,sans-serif;margin-top:12px',window.tSetup));
}
function renderPayouts(body){
  body.appendChild(mkB('\u2190 Back','background:none;border:none;color:var(--muted);cursor:pointer;font-size:0.85rem;margin-bottom:12px;padding:0;font-family:DM Sans,sans-serif',function(){ts.view='main';renderBody();}));
  var h=document.createElement('div');h.style.cssText='font-size:0.95rem;font-weight:700;color:var(--cream);margin-bottom:14px';h.textContent='\ud83d\udcb0 Payout Structure';body.appendChild(h);
  var payouts=calculatePayouts();var total=payouts.reduce(function(s,p){return s+p.amount;},0);
  var sr=document.createElement('div');sr.style.cssText='background:rgba(201,168,76,0.06);border:1px solid rgba(201,168,76,0.2);border-radius:8px;padding:10px 14px;margin-bottom:12px;display:flex;justify-content:space-between';
  sr.innerHTML='<span style="font-size:0.8rem;color:var(--muted)">Prize Pool</span><span style="font-size:0.9rem;color:var(--gold);font-weight:700">$'+(total/100).toFixed(0)+'</span>';body.appendChild(sr);
  payouts.forEach(function(p){
    var row=document.createElement('div');row.style.cssText='display:flex;align-items:center;justify-content:space-between;padding:10px 14px;margin-bottom:6px;background:rgba(255,255,255,0.02);border:1px solid var(--border);border-radius:8px';
    row.innerHTML='<span style="font-size:0.85rem;color:var(--cream);font-weight:600">'+(['1st','2nd','3rd'][p.place-1]||p.place+'th')+' Place</span><div style="text-align:right"><div style="font-size:0.9rem;color:var(--gold);font-weight:700">$'+(p.amount/100).toFixed(0)+'</div><div style="font-size:0.65rem;color:var(--muted)">'+p.pct+'%</div></div>';
    body.appendChild(row);
  });
}
})();
