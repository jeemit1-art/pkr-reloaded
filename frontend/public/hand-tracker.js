// hand-tracker.js — PKR Reloaded Hand Tracker v5
// Straddle, correct poker logic, all-in chips display, live card submission

(function() {
'use strict';

function waitForState(cb) {
  if (window.state && window.state.game !== undefined && window.getPkrCtx) cb();
  else setTimeout(function() { waitForState(cb); }, 100);
}

function htApi(path, opts) {
  opts = opts || {};
  var ctx = window.getPkrCtx ? window.getPkrCtx() : null;
  var apiUrl = ctx ? ctx.apiUrl : '';
  var token  = ctx ? ctx.token  : '';
  return fetch(apiUrl + path, Object.assign({
    credentials: 'include',
    headers: Object.assign({'Content-Type':'application/json'}, token ? {'Authorization':'Bearer '+token} : {}),
  }, opts)).then(function(r) {
    if (!r.ok) return r.json().catch(function(){return {};}).then(function(e){ throw new Error(e.error || r.status); });
    return r.json();
  });
}

function getGameId() { var c = window.getPkrCtx ? window.getPkrCtx() : null; return c ? c.gameId : ''; }
function toast(msg)  { window.showToast && window.showToast(msg); }
function gameInfo()  { return (window.state && window.state.game) || {}; }

var hs = {
  hand: null, history: [], actions: [], pot: 0,
  street: 'pre', board: [], holes: {}, chipInput: '',
  view: 'main', cardTarget: null,
  straddleSeat: null, liveCardsEnabled: false,
  _pendingHand: null,
};

function getSeated() {
  if (!window.state || !window.state.players) return [];
  return Object.keys(window.state.players).map(function(sid) {
    var p = window.state.players[sid];
    return p && p.name && (window.pBuyin ? window.pBuyin(p) > 0 : true)
      ? { sid:sid, seat:parseInt(sid.replace('seat',''),10), name:p.name, p:p } : null;
  }).filter(Boolean).sort(function(a,b){return a.seat-b.seat;});
}

function blindsInChips() {
  var g = gameInfo();
  var sb=1, bb=2, str=4;
  if (g.small_blind && g.chip_value && g.chip_value>0) {
    sb=Math.round(g.small_blind/g.chip_value); bb=sb*2; str=bb*2;
  } else if (g.small_blind && g.big_blind) {
    sb=g.small_blind; bb=g.big_blind; str=bb*2;
  }
  return {sb:sb, bb:bb, straddle:str};
}

// ─── POKER LOGIC: compute who acts next ──────────────────────────────────────
// Street complete when: all active non-allin players have voluntarily acted
// AND all have matched the current max bet.
// BB gets option (check/raise) pre-flop if no one raised above their post.
// Straddler gets option pre-flop if no one raised above their straddle.
// A raise re-opens action for everyone who previously called/checked.
function computeNextPlayer(street, actions, hand) {
  if (!hand) return null;
  var seated = getSeated();
  if (!seated.length) return null;
  var seats = seated.map(function(p){return p.seat;});

  var folded={}, allin={};
  actions.forEach(function(a){
    if (a.action==='fold')  folded[a.display_name]=true;
    if (a.action==='allin') allin[a.display_name]=true;
  });

  var active  = seated.filter(function(p){return !folded[p.name];});
  var canAct  = active.filter(function(p){return !allin[p.name];});
  if (active.length<=1 || canAct.length===0) return null;

  // Chips per player this street (posts + voluntary)
  var streetActs = actions.filter(function(a){return a.street===street;});
  var chips={};
  seated.forEach(function(p){chips[p.name]=0;});
  streetActs.forEach(function(a){if(a.chips>0) chips[a.display_name]=(chips[a.display_name]||0)+a.chips;});
  var maxBet = Math.max.apply(null, [0].concat(canAct.map(function(p){return chips[p.name]||0;})));

  // Voluntary actions only (not posts/straddles)
  var voluntary={};
  streetActs.forEach(function(a){
    if (a.action!=='post' && a.action!=='straddle') voluntary[a.display_name]=a;
  });

  // Determine order start seat
  var sbSeat=hand.sb_seat, bbSeat=hand.bb_seat, dSeat=hand.dealer_seat, strSeat=hs.straddleSeat;

  function nextCanActAfter(targetSeat) {
    var idx=seats.indexOf(targetSeat);
    for (var j=1;j<=seats.length;j++){
      var ns=seats[(idx+j)%seats.length];
      var f=canAct.find(function(p){return p.seat===ns;});
      if(f) return f;
    }
    return canAct[0];
  }

  var firstActor;
  if (street==='pre') {
    // UTG = seat after straddler (if straddle) or BB
    firstActor = nextCanActAfter(strSeat||bbSeat);
  } else {
    // SB or next active after dealer
    firstActor = canAct.find(function(p){return p.seat===sbSeat;}) || nextCanActAfter(dSeat);
  }

  var startIdx = canAct.indexOf(firstActor);
  if (startIdx<0) startIdx=0;
  var ordered=[];
  for (var k=0;k<canAct.length;k++) ordered.push(canAct[(startIdx+k)%canAct.length]);

  for (var m=0;m<ordered.length;m++) {
    var pl=ordered[m];
    var myChips=chips[pl.name]||0;
    var myAct=voluntary[pl.name];
    var matched=myChips>=maxBet;

    if (!myAct) {
      // Special: BB/Straddler have option if their post covers current max bet
      var isSpecial = (street==='pre') && ((pl.seat===bbSeat)||(strSeat&&pl.seat===strSeat));
      if (isSpecial && matched) return pl.name; // give them their option
      return pl.name;
    }
    if (!matched) return pl.name; // re-opened by a raise, needs to respond
    // acted and matched — skip
  }
  return null;
}

function loadCurrentHand() {
  return htApi('/games/'+getGameId()+'/hands').then(function(hands){
    hs.history=hands||[];
    if (hands&&hands.length>0) {
      var h=hands[0];
      hs.hand=h; hs.actions=h.actions||[]; hs.pot=h.pot_chips||0; hs.board=h.board||[];
      hs.straddleSeat=null;
      if (h.straddle) {
        var sa=(h.actions||[]).find(function(a){return a.action==='straddle';});
        if (sa) { var sp=getSeated().find(function(p){return p.name===sa.display_name;}); hs.straddleSeat=sp?sp.seat:null; }
      }
      try { hs.holes=h.result&&h.result.hole_cards?JSON.parse(typeof h.result.hole_cards==='string'?h.result.hole_cards:JSON.stringify(h.result.hole_cards)):{};} catch(e){hs.holes={};}
    }
    renderBoardOnFelt();
  }).catch(function(e){console.warn('loadCurrentHand:',e.message);});
}

window.toggleHandTracking = function() {
  htApi('/games/'+getGameId()+'/tracking/toggle',{method:'POST'}).then(function(r){
    if(window.state&&window.state.game){window.state.game.hand_tracking=r.hand_tracking; if(window.saveState)window.saveState();}
    updateUI(r.hand_tracking);
    toast(r.hand_tracking?'🃏 Hand tracking ON':'Hand tracking OFF');
    if(r.hand_tracking) loadCurrentHand();
  }).catch(function(e){toast('⚠ '+e.message);});
};

window.htToggleLiveCards = function() {
  hs.liveCardsEnabled=!hs.liveCardsEnabled;
  if(window.state&&window.state.game){window.state.game.live_cards_enabled=hs.liveCardsEnabled; if(window.saveState)window.saveState();}
  htApi('/games/'+getGameId()+'/tracking/live-cards',{method:'POST',body:JSON.stringify({enabled:hs.liveCardsEnabled})}).catch(function(){});
  toast(hs.liveCardsEnabled?'👁 Players can now submit their cards in the live view':'Live card submission OFF');
  renderBody();
};

function updateUI(on){
  var b=document.getElementById('handTrackerBtn'); if(b) b.style.display=on?'':'none';
  var t=document.getElementById('trackHandsBtn');  if(t) t.style.color=on?'var(--gold)':'var(--muted)';
}

window.openHandTracker = function() {
  var p=gameInfo().hand_tracking?loadCurrentHand():Promise.resolve();
  p.then(function(){hs.view='main';renderBody();openSheet('handTrackerSheet');});
};
window.closeHandTracker = function(){closeSheet('handTrackerSheet');};
window.toggleHandHistory = function(){hs.view=hs.view==='history'?'main':'history';renderBody();};

function openSheet(id){var s=document.getElementById(id);if(s)s.classList.add('open');}
function closeSheet(id){var s=document.getElementById(id);if(s)s.classList.remove('open');}

window.htStartHand = function() {
  var seated=getSeated();
  if(seated.length<2){toast('Need at least 2 players');return;}
  var seats=seated.map(function(p){return p.seat;});
  var last=gameInfo().currentDealerSeat||0;
  var next=seats.find(function(s){return s>last;})||seats[0];
  var di=seats.indexOf(next);
  var sb=seats[(di+1)%seats.length], bb=seats[(di+2)%seats.length], utg=seats[(di+3)%seats.length];
  hs.straddleSeat=null;
  hs._pendingHand={dealer:next,sb:sb,bb:bb,utg:utg};
  hs.view='straddle'; renderBody();
};

window.htConfirmStart = function(straddleSeat) {
  var p=hs._pendingHand; if(!p)return;
  htApi('/games/'+getGameId()+'/hands',{
    method:'POST',
    body:JSON.stringify({dealer_seat:p.dealer,sb_seat:p.sb,bb_seat:p.bb,straddle:straddleSeat?1:0,mode:'full'}),
  }).then(function(h){
    if(window.state.game) window.state.game.currentDealerSeat=p.dealer;
    hs.hand=h; hs.actions=[]; hs.pot=0; hs.board=[]; hs.holes={}; hs.street='pre'; hs.chipInput='';
    hs.view='main'; hs.straddleSeat=straddleSeat||null; hs._pendingHand=null;
    hs.history.unshift(h);
    autoPost(h,getSeated(),straddleSeat,function(){renderBody();renderBoardOnFelt();});
    toast('Hand #'+h.hand_no+' started');
  }).catch(function(e){toast('⚠ '+e.message);});
};

function autoPost(hand,seated,straddleSeat,cb) {
  var bl=blindsInChips();
  var sbP=seated.find(function(p){return p.seat===hand.sb_seat;});
  var bbP=seated.find(function(p){return p.seat===hand.bb_seat;});
  var strP=straddleSeat?seated.find(function(p){return p.seat===straddleSeat;}):null;
  var posts=[];
  if(sbP)  posts.push({name:sbP.name, userId:sbP.p.userId, chips:bl.sb,       action:'post'});
  if(bbP)  posts.push({name:bbP.name, userId:bbP.p.userId, chips:bl.bb,       action:'post'});
  if(strP) posts.push({name:strP.name,userId:strP.p.userId,chips:bl.straddle, action:'straddle'});
  function doPost(i){
    if(i>=posts.length){cb&&cb();return;}
    var po=posts[i];
    htApi('/games/'+getGameId()+'/hands/'+hand.id+'/actions',{method:'POST',
      body:JSON.stringify({user_id:po.userId||null,display_name:po.name,street:'pre',action:po.action,chips:po.chips}),
    }).then(function(r){hs.actions=r.actions;hs.pot=r.pot_chips;doPost(i+1);}).catch(function(){doPost(i+1);});
  }
  doPost(0);
}

window.htVoidHand = function(){
  if(!hs.hand)return;
  if(!confirm('Void hand #'+hs.hand.hand_no+'?'))return;
  htApi('/games/'+getGameId()+'/hands/'+hs.hand.id,{method:'DELETE'}).then(function(){
    hs.hand=null;hs.actions=[];hs.pot=0;hs.board=[];hs.holes={};hs.straddleSeat=null;
    return htApi('/games/'+getGameId()+'/hands');
  }).then(function(hands){
    hs.history=hands||[]; if(hands&&hands.length>0)hs.hand=hands[0];
    renderBody();renderBoardOnFelt();toast('Hand voided');
  }).catch(function(e){toast('⚠ '+e.message);});
};

window.htUndoAction = function(){
  if(!hs.hand)return;
  htApi('/games/'+getGameId()+'/hands/'+hs.hand.id+'/actions/last',{method:'DELETE'}).then(function(r){
    hs.actions=r.actions;hs.pot=r.pot_chips;renderBody();renderBoardOnFelt();
  }).catch(function(e){toast('⚠ '+e.message);});
};

window.htAct = function(action,playerName) {
  if(!hs.hand)return;
  var chips=parseInt(hs.chipInput)||0;
  if(action==='call'){
    var sm={};
    hs.actions.filter(function(a){return a.street===hs.street;}).forEach(function(a){if(a.chips>0)sm[a.display_name]=(sm[a.display_name]||0)+a.chips;});
    var mb=Math.max.apply(null,[0].concat(Object.values(sm)));
    chips=Math.max(0,mb-(sm[playerName]||0));
    if(chips<=0){toast('Nothing to call');return;}
  }
  if((action==='bet'||action==='raise')&&chips===0){toast('Enter chip amount');return;}
  if(action==='allin'&&chips===0){toast('Enter chip amount for all-in');return;}
  var pE=null; Object.values(window.state.players).forEach(function(p){if(p&&p.name===playerName)pE=p;});
  htApi('/games/'+getGameId()+'/hands/'+hs.hand.id+'/actions',{method:'POST',
    body:JSON.stringify({user_id:pE?pE.userId:null,display_name:playerName,street:hs.street,action:action,chips:chips}),
  }).then(function(r){hs.actions=r.actions;hs.pot=r.pot_chips;hs.chipInput='';renderBody();renderBoardOnFelt();})
  .catch(function(e){toast('⚠ '+e.message);});
};

window.htSetStreet = function(s){hs.street=s;hs.chipInput='';renderBody();};
window.htSetChip   = function(n){hs.chipInput=String(n);renderBody();};
window.htChipInput = function(v){hs.chipInput=v;renderBody();};

window.htOpenCards = function(target){hs.cardTarget=target;hs.view='cards';renderBody();};
window.htPickCard  = function(card){
  if(typeof hs.cardTarget==='number'){
    var b=hs.board.slice(),ex=b.indexOf(card);
    if(ex!==-1)b.splice(ex,1);else b[hs.cardTarget]=card;
    hs.board=b.filter(Boolean);
    if(hs.hand)htApi('/games/'+getGameId()+'/hands/'+hs.hand.id+'/board',{method:'PUT',body:JSON.stringify({board:hs.board})}).catch(function(){});
    renderBoardOnFelt();
  } else {
    var hc=(hs.holes[hs.cardTarget]||[]).slice(),ix=hc.indexOf(card);
    if(ix!==-1)hc.splice(ix,1);else if(hc.length<2)hc.push(card);
    hs.holes[hs.cardTarget]=hc;
  }
  hs.view='main';renderBody();
};

window.htDeclareWinner = function(name){
  if(!hs.hand)return;
  var pE=null;Object.values(window.state.players).forEach(function(p){if(p&&p.name===name)pE=p;});
  htApi('/games/'+getGameId()+'/hands/'+hs.hand.id+'/result',{method:'POST',
    body:JSON.stringify({winner_user_id:pE?pE.userId:null,winner_name:name,hole_cards:hs.holes,split_pot:false}),
  }).then(function(){
    hs.hand.result={winner_name:name,pot_chips:hs.pot};hs.view='main';
    renderBody();renderBoardOnFelt();
    return htApi('/games/'+getGameId()+'/hands');
  }).then(function(h){hs.history=h||[];toast('🏆 '+name+' wins '+hs.pot+' chips!');})
  .catch(function(e){toast('⚠ '+e.message);});
};

window.htUndoWinner = function(){
  if(!hs.hand||!hs.hand.result)return;
  htApi('/games/'+getGameId()+'/hands/'+hs.hand.id+'/result',{method:'DELETE'}).then(function(h){
    hs.hand=h;hs.actions=h.actions||[];hs.pot=h.pot_chips||0;hs.board=h.board||[];
    hs.view='main';renderBody();renderBoardOnFelt();toast('Winner undone');
  }).catch(function(e){toast('⚠ '+e.message);});
};

function renderBoardOnFelt(){
  var tc=document.getElementById('tableCenter'); if(!tc)return;
  ['htBoard','htPot'].forEach(function(id){var el=document.getElementById(id);if(el)el.remove();});
  if(!hs.hand||hs.hand.result)return;
  var row=document.createElement('div');row.id='htBoard';row.style.cssText='display:flex;gap:4px;justify-content:center;margin-top:8px;pointer-events:all';
  for(var i=0;i<5;i++){
    var card=hs.board[i],isRed=card&&(card.indexOf('\u2665')>=0||card.indexOf('\u2666')>=0);
    var el=document.createElement('div');
    el.style.cssText='width:clamp(20px,4.5vw,30px);height:clamp(30px,7vw,48px);border-radius:3px;display:flex;flex-direction:column;align-items:center;justify-content:center;cursor:pointer;font-weight:700;line-height:1.1;'
      +(card?'background:#fff;color:'+(isRed?'#d63031':'#1a1a1a')+';':'background:rgba(255,255,255,0.06);border:1px dashed rgba(201,168,76,0.3);color:rgba(201,168,76,0.25);');
    if(card){var rd=document.createElement('div');rd.style.fontSize='clamp(8px,1.9vw,12px)';rd.textContent=card.slice(0,-1);var sd=document.createElement('div');sd.style.fontSize='clamp(9px,2.1vw,14px)';sd.textContent=card.slice(-1);el.appendChild(rd);el.appendChild(sd);}
    else{el.style.fontSize='clamp(5px,1vw,7px)';el.style.textAlign='center';el.textContent=i<3?'F':i===3?'T':'R';}
    el.dataset.slot=i;el.addEventListener('click',function(){window.htOpenCards(parseInt(this.dataset.slot));openSheet('handTrackerSheet');});row.appendChild(el);
  }
  tc.appendChild(row);
  if(hs.pot>0){var cv2=gameInfo().chip_value||0,p2=document.createElement('div');p2.id='htPot';p2.style.cssText='font-size:clamp(0.6rem,1.3vw,0.75rem);color:var(--gold);margin-top:3px;font-weight:600;pointer-events:none';p2.textContent='POT '+hs.pot+(cv2?' · $'+(hs.pot*cv2/100).toFixed(2):'');tc.appendChild(p2);}
}

function cDiv(card,small){
  var isRed=card&&(card.indexOf('\u2665')>=0||card.indexOf('\u2666')>=0),d=document.createElement('div');
  if(card){d.style.cssText='background:#fff;border-radius:2px;padding:'+(small?'1px 3px':'2px 5px')+';font-size:'+(small?'0.65rem':'0.82rem')+';font-weight:700;color:'+(isRed?'#d63031':'#1a1a1a')+';display:inline-flex;align-items:center;line-height:1';d.textContent=card;}
  else{d.style.cssText='width:'+(small?'16px':'20px')+';height:'+(small?'22px':'28px')+';background:rgba(255,255,255,0.07);border:1px dashed rgba(201,168,76,0.3);border-radius:2px;display:inline-flex;align-items:center;justify-content:center;font-size:8px;color:rgba(201,168,76,0.3)';d.textContent='?';}
  return d;
}
function bdg(txt,bg,col,round){
  var b=document.createElement('span');b.style.cssText='font-size:0.58rem;font-weight:700;padding:1px 5px;border-radius:'+(round?'50%':'3px')+';background:'+bg+';color:'+col+';display:inline-flex;align-items:center;justify-content:center;'+(round?'width:16px;height:16px;':'');b.textContent=txt;return b;
}
function mkB(label,style,onClick){var b=document.createElement('button');b.style.cssText=style;b.textContent=label;b.addEventListener('click',onClick);return b;}
function infoBox(txt,bg,br,col){var d=document.createElement('div');d.style.cssText='background:'+bg+';border:1px solid '+br+';border-radius:8px;padding:9px 14px;margin-bottom:8px;text-align:center;font-size:0.78rem;color:'+col+';font-weight:600';d.textContent=txt;return d;}

function renderBody(){
  var body=document.getElementById('handTrackerBody');if(!body)return;
  body.innerHTML='';
  var ub=document.getElementById('undoActionBtn');if(ub)ub.style.display=(hs.hand&&!hs.hand.result&&hs.actions.length>0)?'':'none';
  if(hs.view==='cards'){renderCards(body);return;}
  if(hs.view==='winner'){renderWinner(body);return;}
  if(hs.view==='history'){renderHistory(body);return;}
  if(hs.view==='straddle'){renderStraddleView(body);return;}
  renderMain(body);
}

function renderStraddleView(body){
  var p=hs._pendingHand;if(!p)return;
  var seated=getSeated(),bl=blindsInChips(),cv=gameInfo().chip_value||0;
  var ti=document.createElement('div');ti.style.cssText='font-size:0.9rem;font-weight:700;color:var(--cream);margin-bottom:6px';ti.textContent='Hand #'+((hs.hand?hs.hand.hand_no:0)+1);body.appendChild(ti);
  var su=document.createElement('div');su.style.cssText='font-size:0.75rem;color:var(--muted);margin-bottom:14px;line-height:1.6';
  su.innerHTML='Dealer: Seat '+p.dealer+' &nbsp;·&nbsp; SB: Seat '+p.sb+' &nbsp;·&nbsp; BB: Seat '+p.bb+'<br>BB = '+bl.bb+' chips'+(cv?' ($'+(bl.bb*cv/100).toFixed(2)+')':'');body.appendChild(su);
  var sl=document.createElement('div');sl.style.cssText='font-size:0.7rem;text-transform:uppercase;letter-spacing:1.5px;color:var(--gold);margin-bottom:10px';sl.textContent='Straddle option?';body.appendChild(sl);
  body.appendChild(mkB('No straddle — start hand','width:100%;padding:13px;background:rgba(255,255,255,0.04);border:1px solid var(--border);color:var(--cream);border-radius:8px;cursor:pointer;font-size:0.85rem;font-family:DM Sans,sans-serif;margin-bottom:8px;font-weight:600',function(){window.htConfirmStart(null);}));
  var utgPlayer=seated.find(function(pl){return pl.seat===p.utg;});
  if(utgPlayer){
    body.appendChild(mkB(utgPlayer.name+' straddles ('+bl.straddle+' chips'+(cv?' · $'+(bl.straddle*cv/100).toFixed(2)+')':')'),
      'width:100%;padding:13px;background:rgba(201,168,76,0.08);border:1px solid rgba(201,168,76,0.3);color:var(--gold);border-radius:8px;cursor:pointer;font-size:0.85rem;font-family:DM Sans,sans-serif;margin-bottom:8px;font-weight:600',
      function(){window.htConfirmStart(p.utg);}));
  }
  body.appendChild(mkB('← Cancel','background:none;border:none;color:var(--muted);cursor:pointer;font-size:0.8rem;padding:0;margin-top:4px;font-family:DM Sans,sans-serif',function(){hs.view='main';hs._pendingHand=null;renderBody();}));
}

function renderMain(body){
  var cv=gameInfo().chip_value||0,seated=getSeated();

  if(!hs.hand||hs.hand.result){
    if(hs.hand&&hs.hand.result){
      var res=hs.hand.result,rb=document.createElement('div');
      rb.style.cssText='background:rgba(46,204,113,0.07);border:1px solid rgba(46,204,113,0.2);border-radius:10px;padding:12px 14px;margin-bottom:12px;display:flex;align-items:center;gap:10px';
      var ri=document.createElement('div');ri.style.flex='1';
      ri.innerHTML='<div style="font-size:0.85rem;color:var(--green);font-weight:700">\ud83c\udfc6 Hand #'+hs.hand.hand_no+'</div>'
        +'<div style="font-size:0.75rem;color:var(--muted);margin-top:2px">'+(res.winner_name||'')+' won '+(res.pot_chips||hs.pot)+' chips'+(cv&&res.pot_chips?' ($'+(res.pot_chips*cv/100).toFixed(2)+')':'')+'</div>';
      rb.appendChild(ri);rb.appendChild(mkB('↩ Undo','background:none;border:1px solid rgba(231,76,60,0.3);color:var(--red);padding:6px 10px;border-radius:6px;cursor:pointer;font-size:0.72rem;font-family:DM Sans,sans-serif;flex-shrink:0',window.htUndoWinner));
      body.appendChild(rb);
    }
    var nextNo=hs.hand?hs.hand.hand_no+1:1,sb2=document.createElement('button');
    sb2.className='btn-primary';sb2.style.cssText='width:100%;padding:16px;font-size:1rem;border-radius:10px;margin-bottom:10px';
    sb2.textContent='\u25b6\ufe0f Start Hand #'+nextNo;sb2.addEventListener('click',window.htStartHand);body.appendChild(sb2);
    appendLiveCardsToggle(body);return;
  }

  var hand=hs.hand,allFolded={},allAllin={};
  hs.actions.forEach(function(a){if(a.action==='fold')allFolded[a.display_name]=true;if(a.action==='allin')allAllin[a.display_name]=true;});
  var nextPlayer=computeNextPlayer(hs.street,hs.actions,hand);

  // Street tabs
  var tabs=document.createElement('div');tabs.style.cssText='display:flex;gap:3px;margin-bottom:10px';
  ['pre','flop','turn','river'].forEach(function(s){
    var active=hs.street===s;
    var t=mkB(s,'flex:1;padding:7px 4px;border-radius:6px;cursor:pointer;font-size:0.7rem;font-weight:700;text-transform:uppercase;letter-spacing:0.05em;font-family:DM Sans,sans-serif;border:1px solid '+(active?'rgba(201,168,76,0.5)':'rgba(201,168,76,0.1)')+';background:'+(active?'rgba(201,168,76,0.15)':'transparent')+';color:'+(active?'var(--gold)':'var(--muted)'),
      function(){window.htSetStreet(this.textContent);});t.textContent=s;tabs.appendChild(t);
  });body.appendChild(tabs);

  // Board row
  var boardRow=document.createElement('div');boardRow.style.cssText='display:flex;gap:6px;align-items:center;background:rgba(0,0,0,0.25);border-radius:8px;padding:9px 12px;margin-bottom:10px';
  var bl2=document.createElement('div');bl2.style.cssText='font-size:0.6rem;text-transform:uppercase;letter-spacing:1.5px;color:var(--muted);flex-shrink:0;margin-right:2px';bl2.textContent='Board';boardRow.appendChild(bl2);
  var bc=document.createElement('div');bc.style.cssText='display:flex;gap:4px;flex:1';
  for(var si=0;si<5;si++){
    var bcard=hs.board[si],isR2=bcard&&(bcard.indexOf('\u2665')>=0||bcard.indexOf('\u2666')>=0);
    var be=document.createElement('div');
    be.style.cssText='width:26px;height:36px;border-radius:3px;display:flex;flex-direction:column;align-items:center;justify-content:center;cursor:pointer;font-weight:700;line-height:1.1;'
      +(bcard?'background:#fff;color:'+(isR2?'#d63031':'#1a1a1a')+';':'background:rgba(255,255,255,0.04);border:1px dashed rgba(201,168,76,0.25);color:rgba(201,168,76,0.25);font-size:0.55rem;');
    if(bcard){var rr=document.createElement('div');rr.style.fontSize='0.7rem';rr.textContent=bcard.slice(0,-1);var ss=document.createElement('div');ss.style.fontSize='0.8rem';ss.textContent=bcard.slice(-1);be.appendChild(rr);be.appendChild(ss);}
    else{be.textContent=si<3?'F':si===3?'T':'R';}
    be.dataset.slot=si;be.addEventListener('click',function(){window.htOpenCards(parseInt(this.dataset.slot));});bc.appendChild(be);
  }
  boardRow.appendChild(bc);
  if(hs.pot>0){var pl3=document.createElement('div');pl3.style.cssText='font-size:0.75rem;color:var(--gold);font-weight:700;text-align:right;flex-shrink:0';pl3.innerHTML='<div>'+hs.pot+'</div><div style="font-size:0.6rem;color:var(--muted);font-weight:400">'+(cv?'$'+(hs.pot*cv/100).toFixed(2):'chips')+'</div>';boardRow.appendChild(pl3);}
  body.appendChild(boardRow);

  // Street chip totals
  var scm={};seated.forEach(function(p){scm[p.name]=0;});
  hs.actions.filter(function(a){return a.street===hs.street;}).forEach(function(a){if(a.chips>0)scm[a.display_name]=(scm[a.display_name]||0)+a.chips;});
  var maxBet=Math.max.apply(null,[0].concat(Object.values(scm)));

  seated.forEach(function(pl){
    var isFolded=allFolded[pl.name],isAllin=allAllin[pl.name],isNext=pl.name===nextPlayer;
    var myChips=scm[pl.name]||0,callAmt=Math.max(0,maxBet-myChips);
    var isD=pl.seat===hand.dealer_seat,isSB=pl.seat===hand.sb_seat,isBB=pl.seat===hand.bb_seat,isStr=hs.straddleSeat&&pl.seat===hs.straddleSeat;
    var sActs=hs.actions.filter(function(a){return a.street===hs.street&&a.display_name===pl.name&&a.action!=='post'&&a.action!=='straddle';});
    var lastAct=sActs[sActs.length-1];
    var postActs=hs.actions.filter(function(a){return a.street==='pre'&&a.display_name===pl.name&&(a.action==='post'||a.action==='straddle');});
    var posted=postActs.length>0?postActs[postActs.length-1].chips:0;

    var rowDiv=document.createElement('div');
    rowDiv.style.cssText='border-radius:8px;margin-bottom:4px;overflow:hidden;border:1px solid '+(isNext?'rgba(201,168,76,0.35)':'rgba(255,255,255,0.05)')+';background:'+(isNext?'rgba(201,168,76,0.06)':isFolded?'rgba(0,0,0,0.1)':'rgba(255,255,255,0.02)')+';opacity:'+(isFolded?'0.45':'1');

    var infoRow=document.createElement('div');infoRow.style.cssText='display:flex;align-items:center;gap:8px;padding:8px 10px';
    var av=document.createElement('div');av.style.cssText='width:30px;height:30px;border-radius:50%;background:linear-gradient(135deg,#7a5820,#5a3010);display:flex;align-items:center;justify-content:center;font-size:0.68rem;font-weight:700;color:var(--cream);flex-shrink:0';
    av.textContent=window.inits?window.inits(pl.name):pl.name.slice(0,2).toUpperCase();infoRow.appendChild(av);

    var inf=document.createElement('div');inf.style.flex='1';
    var nl=document.createElement('div');nl.style.cssText='display:flex;align-items:center;gap:3px;flex-wrap:wrap';
    var nm=document.createElement('span');nm.style.cssText='font-size:0.85rem;color:var(--cream);font-weight:600';nm.textContent=pl.name;nl.appendChild(nm);
    if(isD)  nl.appendChild(bdg('D','var(--gold)','#000',true));
    if(isSB) nl.appendChild(bdg('SB','rgba(58,106,170,0.3)','#6aaaee',false));
    if(isBB) nl.appendChild(bdg('BB','rgba(170,58,58,0.3)','#ee8888',false));
    if(isStr)nl.appendChild(bdg('STR','rgba(201,168,76,0.2)','var(--gold)',false));
    if(isAllin)nl.appendChild(bdg('ALL-IN','rgba(46,204,113,0.15)','var(--green)',false));
    inf.appendChild(nl);

    var sub=document.createElement('div');sub.style.cssText='font-size:0.68rem;margin-top:1px;color:'+(isFolded?'var(--red)':isNext?'var(--gold)':'var(--muted)');
    if(isFolded){sub.textContent='\u2715 Folded';}
    else if(isAllin){
      var aiChips=hs.actions.filter(function(a){return a.display_name===pl.name&&a.action==='allin';}).reduce(function(s,a){return s+(a.chips||0);},0);
      sub.textContent='All-in · '+aiChips+' chips'+(cv&&aiChips?' ($'+(aiChips*cv/100).toFixed(2)+')':'');
    }
    else if(isNext){
      var isOption=hs.street==='pre'&&(isBB||isStr)&&myChips>=maxBet&&!lastAct;
      if(isOption){sub.textContent='\u25b6 '+(isStr?'Straddler':'BB')+' option — check or raise';}
      else if(callAmt>0){sub.textContent='\u25b6 To call: '+callAmt+' chips'+(cv?' ($'+(callAmt*cv/100).toFixed(2)+')':'');}
      else{sub.textContent='\u25b6 Your turn';}
    }
    else if(lastAct){sub.textContent=lastAct.action+(lastAct.chips>0?' '+lastAct.chips+' chips'+(cv?' ($'+(lastAct.chips*cv/100).toFixed(2)+')':''):'');}
    else if(posted>0){sub.textContent=(isStr?'Straddle ':'Posted ')+posted+' chips';}
    else{sub.textContent='Waiting';}
    inf.appendChild(sub);infoRow.appendChild(inf);

    var hc2=hs.holes[pl.name]||[],hcBtn=document.createElement('div');
    hcBtn.style.cssText='display:flex;gap:2px;align-items:center;cursor:pointer;padding:4px 6px;border-radius:5px;border:1px solid rgba(255,255,255,0.07);background:rgba(0,0,0,0.2)';
    hcBtn.dataset.player=pl.name;
    if(hc2.length>0){hc2.forEach(function(c){hcBtn.appendChild(cDiv(c,true));});}
    else{var ph=document.createElement('span');ph.style.cssText='font-size:0.72rem;color:rgba(255,255,255,0.12)';ph.textContent='\ud83c\udca0\ud83c\udca0';hcBtn.appendChild(ph);}
    hcBtn.addEventListener('click',function(){window.htOpenCards(this.dataset.player);});infoRow.appendChild(hcBtn);
    rowDiv.appendChild(infoRow);

    if(isNext){
      var actPanel=document.createElement('div');actPanel.style.cssText='padding:10px 10px 12px;border-top:1px solid rgba(201,168,76,0.1);background:rgba(0,0,0,0.12)';
      var isOption2=maxBet===0||(hs.street==='pre'&&(isBB||isStr)&&myChips>=maxBet&&!lastAct);
      var actBtns=document.createElement('div');actBtns.style.cssText='display:flex;gap:4px;margin-bottom:7px';
      var acts=isOption2?[
        {a:'fold', l:'Fold',  bg:'rgba(231,76,60,0.12)', col:'#e74c3c',    br:'rgba(231,76,60,0.3)'},
        {a:'check',l:'Check', bg:'rgba(107,140,110,0.1)',col:'var(--muted)',br:'var(--border)'},
        {a:'bet',  l:'Bet',   bg:'rgba(201,168,76,0.1)', col:'var(--gold)', br:'rgba(201,168,76,0.3)'},
        {a:'allin',l:'All-in',bg:'rgba(46,204,113,0.1)',col:'var(--green)', br:'rgba(46,204,113,0.3)'},
      ]:[
        {a:'fold', l:'Fold',         bg:'rgba(231,76,60,0.12)', col:'#e74c3c',    br:'rgba(231,76,60,0.3)'},
        {a:'call', l:'Call '+callAmt,bg:'rgba(58,106,170,0.12)',col:'#6aaaee',    br:'rgba(58,106,170,0.3)'},
        {a:'raise',l:'Raise',        bg:'rgba(201,168,76,0.1)', col:'var(--gold)', br:'rgba(201,168,76,0.3)'},
        {a:'allin',l:'All-in',       bg:'rgba(46,204,113,0.1)',col:'var(--green)', br:'rgba(46,204,113,0.3)'},
      ];
      var cn=pl.name;
      acts.forEach(function(cfg){
        var b=document.createElement('button');
        b.style.cssText='flex:1;padding:9px 2px;background:'+cfg.bg+';color:'+cfg.col+';border:1px solid '+cfg.br+';border-radius:6px;cursor:pointer;font-size:0.75rem;font-weight:700;font-family:DM Sans,sans-serif;min-width:0';
        b.textContent=cfg.l;b.dataset.action=cfg.a;b.dataset.player=cn;
        b.addEventListener('click',function(){window.htAct(this.dataset.action,this.dataset.player);});actBtns.appendChild(b);
      });
      actPanel.appendChild(actBtns);
      var chipRow=document.createElement('div');chipRow.style.cssText='display:flex;gap:3px;flex-wrap:wrap;margin-bottom:7px';
      [1,2,4,5,8,10,20,50,100].forEach(function(n){
        var sel=hs.chipInput===String(n),cb=document.createElement('button');
        cb.style.cssText='padding:5px 7px;background:'+(sel?'var(--gold)':'rgba(255,255,255,0.05)')+';color:'+(sel?'#000':'var(--cream2)')+';border:1px solid '+(sel?'var(--gold)':'rgba(255,255,255,0.08)')+';border-radius:4px;cursor:pointer;font-size:0.72rem;font-family:DM Sans,sans-serif;font-weight:'+(sel?'700':'400');
        cb.textContent=String(n);cb.dataset.chips=n;cb.addEventListener('click',function(){window.htSetChip(parseInt(this.dataset.chips));});chipRow.appendChild(cb);
      });
      actPanel.appendChild(chipRow);
      var inpRow=document.createElement('div');inpRow.style.cssText='display:flex;gap:6px;align-items:center';
      var inp=document.createElement('input');inp.type='number';inp.min='0';inp.value=hs.chipInput||'';inp.placeholder='or enter chips';
      inp.style.cssText='flex:1;background:rgba(4,12,5,0.9);border:1px solid var(--border);color:var(--cream);padding:8px 10px;font-size:0.88rem;border-radius:6px;outline:none;font-family:DM Sans,sans-serif';
      inp.addEventListener('input',function(){window.htChipInput(this.value);});inpRow.appendChild(inp);
      var cn2=parseInt(hs.chipInput)||0;
      if(cv&&cn2>0){var cvl=document.createElement('span');cvl.style.cssText='font-size:0.82rem;color:var(--gold);font-weight:700;white-space:nowrap';cvl.textContent='$'+(cn2*cv/100).toFixed(2);inpRow.appendChild(cvl);}
      actPanel.appendChild(inpRow);rowDiv.appendChild(actPanel);
    }
    body.appendChild(rowDiv);
  });

  if(!nextPlayer){
    var activePl=seated.filter(function(p){return !allFolded[p.name];});
    if(activePl.length<=1) body.appendChild(infoBox('All others folded — declare the winner','rgba(201,168,76,0.07)','rgba(201,168,76,0.2)','var(--gold)'));
    else body.appendChild(infoBox('Betting round complete — tap next street tab or declare winner','rgba(46,204,113,0.05)','rgba(46,204,113,0.15)','var(--green)'));
  }

  var btm=document.createElement('div');btm.style.cssText='display:flex;gap:6px;margin-top:6px';
  btm.appendChild(mkB('\u2715 Void','padding:10px;background:rgba(231,76,60,0.06);border:1px solid rgba(231,76,60,0.2);color:var(--red);border-radius:7px;cursor:pointer;font-size:0.75rem;font-family:DM Sans,sans-serif',window.htVoidHand));
  btm.appendChild(mkB('\ud83c\udfc6 Declare Winner','flex:1;padding:10px;background:rgba(46,204,113,0.08);color:var(--green);border:1px solid rgba(46,204,113,0.25);border-radius:7px;cursor:pointer;font-size:0.85rem;font-weight:700;font-family:DM Sans,sans-serif',function(){hs.view='winner';renderBody();}));
  body.appendChild(btm);
  appendLiveCardsToggle(body);
}

function appendLiveCardsToggle(body){
  var div=document.createElement('div');div.style.cssText='border-top:1px solid rgba(255,255,255,0.05);margin:14px 0 10px';body.appendChild(div);
  var row=document.createElement('div');row.style.cssText='display:flex;align-items:center;justify-content:space-between;padding:4px 2px';
  var lbl=document.createElement('div');
  lbl.innerHTML='<div style="font-size:0.82rem;color:var(--cream);font-weight:600">\ud83d\udc41 Live card submission</div><div style="font-size:0.7rem;color:var(--muted);margin-top:2px">Players submit hole cards from the live view — revealed after hand</div>';
  row.appendChild(lbl);
  var tog=document.createElement('button');
  tog.style.cssText='padding:6px 14px;border-radius:20px;font-size:0.75rem;font-weight:700;cursor:pointer;font-family:DM Sans,sans-serif;flex-shrink:0;border:none;'+(hs.liveCardsEnabled?'background:var(--gold);color:#000':'background:rgba(255,255,255,0.08);color:var(--muted)');
  tog.textContent=hs.liveCardsEnabled?'ON':'OFF';tog.addEventListener('click',window.htToggleLiveCards);row.appendChild(tog);body.appendChild(row);
}

function renderWinner(body){
  var cv=gameInfo().chip_value||0;
  body.appendChild(mkB('← Cancel','background:none;border:none;color:var(--muted);cursor:pointer;font-size:0.85rem;margin-bottom:12px;padding:0;font-family:DM Sans,sans-serif',function(){hs.view='main';renderBody();}));
  var h=document.createElement('div');h.style.cssText='font-size:1rem;font-weight:700;color:var(--cream);margin-bottom:4px';h.textContent='\ud83c\udfc6 Who won?';body.appendChild(h);
  var pl4=document.createElement('div');pl4.style.cssText='font-size:0.8rem;color:var(--gold);margin-bottom:14px';pl4.textContent='Pot: '+hs.pot+' chips'+(cv?' = $'+(hs.pot*cv/100).toFixed(2):'');body.appendChild(pl4);
  var f2={};hs.actions.forEach(function(a){if(a.action==='fold')f2[a.display_name]=true;});
  getSeated().forEach(function(pl){
    if(f2[pl.name])return;
    var hc3=hs.holes[pl.name]||[],rb2=document.createElement('button');
    rb2.style.cssText='width:100%;display:flex;align-items:center;gap:10px;padding:11px 14px;margin-bottom:6px;background:rgba(255,255,255,0.03);border:1px solid var(--border);border-radius:8px;cursor:pointer;text-align:left';
    rb2.dataset.winner=pl.name;
    var av2=document.createElement('div');av2.style.cssText='width:32px;height:32px;border-radius:50%;background:linear-gradient(135deg,#7a5820,#5a3010);display:flex;align-items:center;justify-content:center;font-size:0.72rem;font-weight:700;color:var(--cream);flex-shrink:0';av2.textContent=window.inits?window.inits(pl.name):pl.name.slice(0,2).toUpperCase();
    var nm2=document.createElement('span');nm2.style.cssText='flex:1;color:var(--cream);font-size:0.9rem;font-weight:600';nm2.textContent=pl.name;
    rb2.appendChild(av2);rb2.appendChild(nm2);
    if(hc3.length>0){var cr=document.createElement('div');cr.style.cssText='display:flex;gap:3px';hc3.forEach(function(c){cr.appendChild(cDiv(c,true));});rb2.appendChild(cr);}
    rb2.addEventListener('click',function(){window.htDeclareWinner(this.dataset.winner);});body.appendChild(rb2);
  });
}

function renderHistory(body){
  body.appendChild(mkB('← Back','background:none;border:none;color:var(--gold);cursor:pointer;font-size:0.85rem;margin-bottom:12px;padding:0;font-family:DM Sans,sans-serif',function(){hs.view='main';renderBody();}));
  if(!hs.history.length){var em=document.createElement('div');em.style.cssText='text-align:center;color:var(--muted);padding:30px 0;font-size:0.85rem';em.textContent='No hands yet';body.appendChild(em);return;}
  hs.history.forEach(function(h){
    var row=document.createElement('div');row.style.cssText='background:rgba(255,255,255,0.02);border:1px solid var(--border);border-radius:8px;padding:10px 12px;margin-bottom:6px';
    var top=document.createElement('div');top.style.cssText='display:flex;justify-content:space-between;align-items:center';
    var num=document.createElement('span');num.style.cssText='color:var(--gold);font-weight:700;font-size:0.9rem';num.textContent='Hand #'+h.hand_no;
    var res=document.createElement('span');res.style.cssText='font-size:0.75rem;color:'+(h.result?'var(--green)':'var(--muted)');res.textContent=h.result?'\ud83c\udfc6 '+(h.result.winner_name||'')+' \u00b7 '+(h.result.pot_chips||0)+' chips':'In progress';
    top.appendChild(num);top.appendChild(res);row.appendChild(top);
    if(h.board&&h.board.length){var br=document.createElement('div');br.style.cssText='display:flex;gap:3px;margin-top:6px';h.board.forEach(function(c){br.appendChild(cDiv(c,true));});row.appendChild(br);}
    body.appendChild(row);
  });
}

function renderCards(body){
  var isBoard=typeof hs.cardTarget==='number';
  var title=isBoard?(['Flop 1','Flop 2','Flop 3','Turn','River'][hs.cardTarget]||'Card'):hs.cardTarget+' hole cards';
  body.appendChild(mkB('← '+title,'background:none;border:none;color:var(--muted);cursor:pointer;font-size:0.85rem;margin-bottom:8px;padding:0;font-family:DM Sans,sans-serif',function(){hs.view='main';renderBody();}));
  var allDealt=hs.board.concat(Object.values(hs.holes).reduce(function(a,v){return a.concat(v);},[]));
  var currentSel=isBoard?hs.board:(hs.holes[hs.cardTarget]||[]);
  ['\u2660','\u2665','\u2666','\u2663'].forEach(function(suit){
    var isRed=suit==='\u2665'||suit==='\u2666';
    var row=document.createElement('div');row.style.cssText='display:flex;gap:3px;margin-bottom:5px;align-items:center';
    var sl=document.createElement('span');sl.style.cssText='width:18px;font-size:1rem;color:'+(isRed?'#e74c3c':'#f0e6c8')+';flex-shrink:0;text-align:center';sl.textContent=suit;row.appendChild(sl);
    ['A','K','Q','J','T','9','8','7','6','5','4','3','2'].forEach(function(rank){
      var card=rank+suit,dealt=allDealt.indexOf(card)>=0&&currentSel.indexOf(card)<0,sel3=currentSel.indexOf(card)>=0;
      var b=document.createElement('button');
      b.style.cssText='flex:1;min-width:0;padding:6px 2px;background:'+(sel3?'var(--gold)':dealt?'rgba(255,255,255,0.02)':'rgba(255,255,255,0.05)')+';color:'+(sel3?'#000':dealt?'rgba(255,255,255,0.12)':isRed?'#e74c3c':'#f0e6c8')+';border:1px solid '+(sel3?'var(--gold)':dealt?'transparent':'rgba(255,255,255,0.08)')+';border-radius:4px;cursor:'+(dealt?'not-allowed':'pointer')+';font-size:clamp(0.62rem,2vw,0.8rem);font-weight:700;font-family:DM Sans,sans-serif';
      b.textContent=rank;b.dataset.card=card;
      if(!dealt)b.addEventListener('click',function(){window.htPickCard(this.dataset.card);});row.appendChild(b);
    });
    body.appendChild(row);
  });
}

waitForState(function(){
  var g=gameInfo();
  updateUI(g&&g.hand_tracking);
  hs.liveCardsEnabled=!!(g&&g.live_cards_enabled);
  if(g&&g.hand_tracking) loadCurrentHand();
});

})();