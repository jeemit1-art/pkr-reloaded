// hand-tracker.js — PKR Reloaded Hand Tracker v7
// v6 features + mid-session player changes + pause/resume + roster + all-in/side pot + action log + chip denoms + player stats + session export

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
  _pendingHand: null, _suggestedDealer: null,
  potWinners: [], currentPotIndex: 0, _autoCardMode: null,
  _lastHandSummary: null,
  _pendingJoins: [],
  _pendingLeaves: [],
  _wasHU: false,
};

function getSeated() {
  if (!window.state || !window.state.players) return [];
  return Object.keys(window.state.players).map(function(sid) {
    var p = window.state.players[sid];
    if (!p || !p.name) return null;
    if (window.pBuyin && window.pBuyin(p) <= 0) return null;
    if (hs._pendingLeaves && hs._pendingLeaves.indexOf(sid) >= 0) return null;
    return { sid:sid, seat:parseInt(sid.replace('seat',''),10), name:p.name, p:p,
             pendingPost: !!(p._pendingPost) };
  }).filter(Boolean).sort(function(a,b){return a.seat-b.seat;});
}

window.htAddPlayerMidSession = function(sid, name, postBB) {
  if (!sid || !name) return;
  var seat = parseInt(sid.replace('seat',''), 10);
  if (hs.hand) {
    var already = hs._pendingJoins.find(function(p){return p.sid===sid;});
    if (!already) {
      hs._pendingJoins.push({sid:sid, name:name, seat:seat, postBB:!!postBB});
      toast(name + ' will join after this hand');
    }
    renderBody();
    return;
  }
  if (window.state && window.state.players && window.state.players[sid]) {
    window.state.players[sid]._pendingPost = !!postBB;
  }
  var prevCount = getSeated().length;
  toast(name + ' joined' + (postBB ? ' — must post BB' : ''));
  var newCount = getSeated().length;
  if (hs._wasHU && newCount >= 3) {
    hs._wasHU = false;
    toast('Heads-up mode off — back to full ring rules');
  }
  renderBody();
};

window.htRemovePlayerMidSession = function(sid) {
  if (!sid) return;
  var seated = getSeated();
  var player = seated.find(function(p){return p.sid===sid;});
  if (!player) return;
  if (hs.hand) {
    if (hs._pendingLeaves.indexOf(sid) < 0) {
      hs._pendingLeaves.push(sid);
      toast(player.name + ' will leave after this hand');
    }
    renderBody();
    return;
  }
  _applyLeave(sid, player, seated);
};

function _applyLeave(sid, player, seated) {
  if (window.state && window.state.players && window.state.players[sid]) {
    if (window.state.players[sid].buyin !== undefined) window.state.players[sid].buyin = 0;
    if (window.state.players[sid].stack !== undefined) window.state.players[sid].stack = 0;
  }
  var remaining = getSeated();
  toast(player.name + ' left the game');
  if (remaining.length === 2 && !hs._wasHU) {
    hs._wasHU = true;
    toast('Heads-up mode on — dealer posts SB and acts first pre-flop');
  }
  if (remaining.length < 2) {
    toast('Not enough players — game paused');
  }
  renderBody();
}

function flushPendingPlayerChanges() {
  if (!hs._pendingLeaves.length && !hs._pendingJoins.length) return;
  var seated = getSeated();
  hs._pendingLeaves.forEach(function(sid) {
    var player = seated.find(function(p){return p.sid===sid;});
    if (player) _applyLeave(sid, player, seated);
  });
  hs._pendingLeaves = [];
  hs._pendingJoins.forEach(function(j) {
    if (window.state && window.state.players && window.state.players[j.sid]) {
      window.state.players[j.sid]._pendingPost = !!j.postBB;
    }
    toast(j.name + ' joined' + (j.postBB ? ' — must post BB' : ''));
  });
  hs._pendingJoins = [];
  var finalCount = getSeated().length;
  if (finalCount === 2 && !hs._wasHU) {
    hs._wasHU = true;
    toast('Heads-up mode on');
  } else if (finalCount >= 3 && hs._wasHU) {
    hs._wasHU = false;
    toast('Heads-up mode off — back to full ring rules');
  }
  renderBody();
}

function isHeadsUp() { return getSeated().filter(function(p){ var f={}; hs.actions.forEach(function(a){if(a.action==='fold')f[a.display_name]=true;}); return !f[p.name]; }).length === 2; }

function blindsInChips() {
  if (hs._chipConfig) {
    var sb=hs._chipConfig.sb||1, bb=hs._chipConfig.bb||2;
    return {sb:sb, bb:bb, straddle:bb*2};
  }
  var g = gameInfo();
  var sb=1, bb=2, str=4;
  if (g.small_blind && g.chip_value && g.chip_value>0) {
    sb=Math.round(g.small_blind/g.chip_value); bb=sb*2; str=bb*2;
  } else if (g.small_blind && g.big_blind) {
    sb=g.small_blind; bb=g.big_blind; str=bb*2;
  }
  return {sb:sb, bb:bb, straddle:str};
}

function getChipValue() {
  if (hs._chipConfig && hs._chipConfig.chipValue > 0) return hs._chipConfig.chipValue;
  return gameInfo().chip_value || 0;
}

// --- POKER LOGIC ---
function computeNextPlayer(street, actions, hand) {
  if (!hand) return null;

  var seated = getSeated();
  if (!seated.length) return null;

  // Build the physical clockwise ring for THIS hand.
  var totalSeats = gameInfo().seats || Math.max.apply(null, seated.map(function(p){ return p.seat; }).concat([9]));
  var cwOrder = buildClockwiseOrder(totalSeats);
  var ring = cwOrder.filter(function(seatNo){
    return seated.some(function(p){ return p.seat === seatNo; });
  });

  var playerBySeat = {};
  var seatByName = {};
  seated.forEach(function(p){
    playerBySeat[p.seat] = p;
    seatByName[p.name] = p.seat;
  });

  var folded = {}, allin = {};
  actions.forEach(function(a){
    if (a.action === 'fold') folded[a.display_name] = true;
    if (a.action === 'allin') allin[a.display_name] = true;
  });

  var activeSeats = ring.filter(function(seatNo){
    var p = playerBySeat[seatNo];
    return p && !folded[p.name];
  });
  var canActSeats = activeSeats.filter(function(seatNo){
    var p = playerBySeat[seatNo];
    return p && !allin[p.name];
  });

  if (activeSeats.length <= 1 || canActSeats.length === 0) return null;

  function nextActiveSeatAfter(seatNo, includeAllIn) {
    var pool = includeAllIn ? activeSeats : canActSeats;
    var idx = ring.indexOf(seatNo);
    if (idx === -1) idx = 0;
    for (var i = 1; i <= ring.length; i++) {
      var s = ring[(idx + i) % ring.length];
      if (pool.indexOf(s) >= 0) return s;
    }
    return null;
  }

  var streetActs = actions.filter(function(a){ return a.street === street; });

  // Progressive contribution tracking for this street.
  var contrib = {};
  seated.forEach(function(p){ contrib[p.name] = 0; });

  // Who has taken a voluntary action this street?
  var voluntaryActed = {};
  // Last seat that changed the amount to call.
  var lastAmountChangeSeat = null;

  // Track current bet and minimum full raise size.
  var bl = blindsInChips();
  var currentBet = 0;
  var lastFullRaise = (street === 'pre')
    ? ((hs.straddleSeat && hand && hand.straddle) ? bl.bb : bl.bb)
    : bl.bb;

  streetActs.forEach(function(a){
    var name = a.display_name;
    var prevPlayer = contrib[name] || 0;
    var prevBet = currentBet;

    if (a.chips > 0) contrib[name] = prevPlayer + a.chips;

    if (a.action !== 'post' && a.action !== 'straddle') {
      voluntaryActed[name] = true;
    }

    var newPlayer = contrib[name] || 0;

    // Detect any change to the amount to call.
    if (newPlayer > prevBet && a.action !== 'post' && a.action !== 'straddle') {
      lastAmountChangeSeat = seatByName[name];
      var raiseSize = newPlayer - prevBet;

      // Bet / raise always re-open.
      if (a.action === 'bet' || a.action === 'raise') {
        if (raiseSize > 0) lastFullRaise = raiseSize;
      }

      // All-in only sets a new full-raise size if it is large enough.
      if (a.action === 'allin' && raiseSize >= lastFullRaise) {
        lastFullRaise = raiseSize;
      }

      currentBet = newPlayer;
    } else {
      currentBet = Math.max(currentBet, newPlayer);
    }
  });

  var dealerSeat = hand.dealer_seat;
  var bbSeat = hand.bb_seat;
  var strSeat = hs.straddleSeat;

  // First actor by standard hold'em rules.
  var firstActorSeat;
  if (street === 'pre') {
    firstActorSeat = nextActiveSeatAfter(strSeat || bbSeat, false);
  } else {
    firstActorSeat = nextActiveSeatAfter(dealerSeat, false);
  }
  if (!firstActorSeat) return null;

  // Case 1: unopened street / no voluntary action has changed the price to call.
  // Example: pre-flop limped pot returning to BB, or checked-around flop.
  if (!lastAmountChangeSeat) {
    var cursor = firstActorSeat;
    for (var j = 0; j < ring.length; j++) {
      if (canActSeats.indexOf(cursor) >= 0) {
        var p0 = playerBySeat[cursor];
        if (!voluntaryActed[p0.name]) return p0.name;
      }
      cursor = nextActiveSeatAfter(cursor, false);
      if (cursor === null) break;
    }
    return null;
  }

  // Case 2: there is a bet / raise / all-in that increased the amount to call.
  // Action continues from the NEXT active player clockwise after that seat.
  var cursor2 = nextActiveSeatAfter(lastAmountChangeSeat, false);
  if (!cursor2) return null;

  for (var k = 0; k < ring.length; k++) {
    if (cursor2 === lastAmountChangeSeat) break;

    var p1 = playerBySeat[cursor2];
    if (p1 && canActSeats.indexOf(cursor2) >= 0) {
      var owes = (contrib[p1.name] || 0) < currentBet;
      if (owes) return p1.name;
    }

    var nextSeat = nextActiveSeatAfter(cursor2, false);
    if (nextSeat === null) break;
    cursor2 = nextSeat;
  }

  return null;
}function loadCurrentHand() {
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
    toast(r.hand_tracking?'\uD83C\uDCCF Hand tracking ON':'Hand tracking OFF');
    if(r.hand_tracking) loadCurrentHand();
  }).catch(function(e){toast('\u26A0 '+e.message);});
};

window.htToggleLiveCards = function() {
  hs.liveCardsEnabled=!hs.liveCardsEnabled;
  if(window.state&&window.state.game){window.state.game.live_cards_enabled=hs.liveCardsEnabled; if(window.saveState)window.saveState();}
  htApi('/games/'+getGameId()+'/tracking/live-cards',{method:'POST',body:JSON.stringify({enabled:hs.liveCardsEnabled})}).catch(function(){});
  toast(hs.liveCardsEnabled?'\uD83D\uDC41 Players can now submit their cards':'Live card submission OFF');
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
window.closeHandTracker = function(){
  closeSheet('handTrackerSheet');
  renderActionPanel(); // re-render compact panel when full sheet closes
};
window.toggleHandHistory = function(){hs.view=hs.view==='history'?'main':'history';renderBody();};

function openSheet(id){var s=document.getElementById(id);if(s)s.classList.add('open');}
function closeSheet(id){var s=document.getElementById(id);if(s)s.classList.remove('open');}

window.openCardPicker = function(){
  var sheet = document.getElementById('cardPickerSheet');
  var body = document.getElementById('cardPickerBody');
  var title = document.getElementById('cardPickerTitle');
  if(!sheet || !body) return;

  body.innerHTML = '';
  if(title){
    if(typeof hs.cardTarget === 'number'){
      title.textContent = 'Pick board card';
    } else {
      title.textContent = 'Pick card';
    }
  }

  if(typeof renderCards === 'function'){
    renderCards(body);
  }

  sheet.onclick = function(e){
    if(e.target === sheet && typeof window.closeCardPicker === 'function'){
      window.closeCardPicker();
    }
  };

  openSheet('cardPickerSheet');
};

window.closeCardPicker = function(){
  closeSheet('cardPickerSheet');
  var body = document.getElementById('cardPickerBody');
  if(body) body.innerHTML = '';
  if(typeof renderActionPanel === 'function') renderActionPanel();
};

// --- START HAND ---
window.htStartHand = function() {
  flushPendingPlayerChanges();
  var seated=getSeated();
  seated.forEach(function(p){ saveToRoster(p.name); });
  if(seated.length<2){toast('Need at least 2 players');return;}

  var totalSeats = gameInfo().seats || Math.max.apply(null, seated.map(function(p){return p.seat;}).concat([9]));
  var cwOrder = buildClockwiseOrder(totalSeats);
  var cwSeats = cwOrder.filter(function(s){ return seated.some(function(p){return p.seat===s;}); });

  var last = gameInfo().currentDealerSeat||0;
  // Find next dealer clockwise from last
  var lastIdx = cwSeats.indexOf(last);
  var nextIdx = lastIdx === -1 ? 0 : (lastIdx+1) % cwSeats.length;
  var suggested = cwSeats[nextIdx];
  hs._suggestedDealer = suggested;

  // Only show dealer picker on very first hand (no previous dealer set)
  if (!last) {
    hs.view='dealer'; renderBody();
  } else {
    // Auto-rotate dealer, skip picker
    window.htPickDealer(suggested);
  }
};

// Builds the physical clockwise seat order for any seat count,
// matching the buildSeats() layout in page.tsx:
//   seat 1 = top, seats 2..leftCount+1 = left top-to-bottom,
//   next seat = bottom, remaining = right top-to-bottom.
// Clockwise = 1 → right (top→bot) → bottom → left (bot→top)
function buildClockwiseOrder(totalSeats) {
  var sideCount = totalSeats - 2;
  var leftCount = Math.ceil(sideCount / 2);
  var rightCount = Math.floor(sideCount / 2);
  // seat index layout (0-based): 0=top, 1..leftCount=left, leftCount+1=bottom, leftCount+2..end=right
  var topSeat    = 1;
  var leftStart  = 2;
  var bottomSeat = leftCount + 2;
  var rightStart = leftCount + 3;
  var order = [topSeat];
  // right side top-to-bottom
  for (var r = 0; r < rightCount; r++) order.push(rightStart + r);
  // bottom
  order.push(bottomSeat);
  // left side bottom-to-top
  for (var l = leftCount - 1; l >= 0; l--) order.push(leftStart + l);
  return order;
}

window.htPickDealer = function(dealerSeat) {
  var seated = getSeated();
  var occupiedSeats = seated.map(function(p){ return p.seat; });
  // total seats in the game (may be larger than occupied count)
  var totalSeats = (gameInfo().seats) || Math.max.apply(null, occupiedSeats.concat([9]));
  var cwOrder = buildClockwiseOrder(totalSeats);
  // filter to only occupied seats, preserving clockwise order
  var seats = cwOrder.filter(function(s){
    return occupiedSeats.indexOf(s) !== -1;
  });
  // fallback: if dealerSeat not found (e.g. added mid-session beyond totalSeats)
  // append any occupied seats not in cwOrder, in ascending order
  occupiedSeats.forEach(function(s){
    if (seats.indexOf(s) === -1) seats.push(s);
  });
  var di = seats.indexOf(dealerSeat);
  if (di === -1) { toast('Dealer seat not found'); return; }
  var n = seats.length;
  function next(i){ return seats[(di + i) % n]; }
  var huMode = n === 2;
  var sb, bb, utg;
  if (huMode) {
    sb = dealerSeat;
    bb = next(1);
    utg = bb;
  } else {
    sb  = next(1);
    bb  = next(2);
    utg = next(3);
  }
  hs.straddleSeat = null;
  hs._pendingHand = {dealer:dealerSeat, sb:sb, bb:bb, utg:utg};
  hs.view = 'straddle'; renderBody();
};

window.htConfirmStart = function(straddleSeat) {
  var p=hs._pendingHand; if(!p)return;
  htApi('/games/'+getGameId()+'/hands',{
    method:'POST',
    body:JSON.stringify({dealer_seat:p.dealer,sb_seat:p.sb,bb_seat:p.bb,straddle:straddleSeat?1:0,mode:'full'}),
  }).then(function(h){
    if(window.state.game) window.state.game.currentDealerSeat=p.dealer;
    hs.hand=h; hs.actions=[]; hs.pot=0; hs.board=[]; hs.holes={}; hs.street='pre'; hs.chipInput='';
    hs.potWinners=[]; hs.currentPotIndex=0; hs._autoCardMode=null; hs._lastHandSummary=null;
    hs.view='main'; hs.straddleSeat=straddleSeat||null; hs._pendingHand=null; saveSession();
    hs.history.unshift(h);
    autoPost(h,getSeated(),straddleSeat,function(){renderBody();renderBoardOnFelt();});
    toast('Hand #'+h.hand_no+' started');
  }).catch(function(e){toast('\u26A0 '+e.message);});
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
    hs.hand=null;hs.actions=[];hs.pot=0;hs.board=[];hs.holes={};hs.straddleSeat=null;hs._lastHandSummary=null;saveSession();
    return htApi('/games/'+getGameId()+'/hands');
  }).then(function(hands){
    hs.history=hands||[]; if(hands&&hands.length>0)hs.hand=hands[0];
    renderBody();renderBoardOnFelt();toast('Hand voided');
  }).catch(function(e){toast('\u26A0 '+e.message);});
};

window.htUndoAction = function(){
  if(!hs.hand)return;
  htApi('/games/'+getGameId()+'/hands/'+hs.hand.id+'/actions/last',{method:'DELETE'}).then(function(r){
    hs.actions=r.actions;hs.pot=r.pot_chips;renderBody();renderBoardOnFelt();
  }).catch(function(e){toast('\u26A0 '+e.message);});
};

window.htAct = function(action, playerName) {
  if (!hs.hand) return;

  var chips = parseInt(hs.chipInput) || 0;

  if (action === 'call') {
    var sm = {};
    hs.actions
      .filter(function(a) { return a.street === hs.street; })
      .forEach(function(a) {
        if (a.chips > 0) sm[a.display_name] = (sm[a.display_name] || 0) + a.chips;
      });

    var activeNames = {};
    getSeated().forEach(function(p) { activeNames[p.name] = true; });

    hs.actions.forEach(function(a) {
      if (a.action === 'fold') delete activeNames[a.display_name];
    });

    var mb = Math.max.apply(null, [0].concat(Object.keys(activeNames).map(function(name) {
      return sm[name] || 0;
    })));

    chips = Math.max(0, mb - (sm[playerName] || 0));
    if (chips <= 0) {
      toast('Nothing to call');
      return;
    }
  }

  if (action === 'allin') {
    var suggested = hs.chipInput && parseInt(hs.chipInput) > 0 ? String(parseInt(hs.chipInput)) : '';
    var entered = window.prompt('Enter all-in amount for ' + playerName, suggested);
    if (entered === null) return;

    chips = parseInt(String(entered).replace(/[^0-9]/g, ''), 10) || 0;
    if (chips <= 0) {
      toast('Enter a valid all-in amount');
      return;
    }
  }

  if ((action === 'bet' || action === 'raise') && chips === 0) {
    toast('Enter chip amount');
    return;
  }

  var pE = null;
  Object.values(window.state.players).forEach(function(p) {
    if (p && p.name === playerName) pE = p;
  });

  htApi('/games/' + getGameId() + '/hands/' + hs.hand.id + '/actions', {
    method: 'POST',
    body: JSON.stringify({
      user_id: pE ? pE.userId : null,
      display_name: playerName,
      street: hs.street,
      action: action,
      chips: chips
    }),
  }).then(function(r) {
    hs.actions = r.actions;
    hs.pot = r.pot_chips;
    hs.chipInput = '';

    var next = computeNextPlayer(hs.street, hs.actions, hs.hand);

    if (!next && hs.hand && !hs.hand.result) {
      var so = ['pre', 'flop', 'turn', 'river'];
      var si = so.indexOf(hs.street);
      if (si >= 0 && si < 3) {
        var ns = so[si + 1];
        var streetName = ns.charAt(0).toUpperCase() + ns.slice(1);

        renderBoardOnFelt();
        setTimeout(function() {
          animateChipsToPot(function() {
            hs.street = ns;
            hs.chipInput = '';

            var slots = { flop: [0, 1, 2], turn: [3], river: [4] };
            var sl = slots[ns];
            if (sl) {
              hs.cardTarget = sl[0];
              hs.view = 'cards';
              if (ns === 'flop') hs._autoCardMode = 'flop';
              else hs._autoCardMode = null;
            }

            renderBody();
            renderBoardOnFelt();

            var sh = document.getElementById('handTrackerSheet');
            if (sh) sh.classList.remove('open');

            if (typeof renderActionPanel === 'function') renderActionPanel();

            if (typeof window.openCardPicker === 'function' && sl) {
              window.openCardPicker();
            } else if (typeof openSheet === 'function' && sl) {
              openSheet('cardPickerSheet');
            }
          });
        }, 300);

        toast('Deal the ' + streetName + '!');
        renderBody();
        renderBoardOnFelt();
        return;
      }
    }

    saveSession();
    renderBody();
    renderBoardOnFelt();
  }).catch(function(e) {
    toast('Error: ' + e.message);
  });
};

window.htSetStreet = function(s){hs.street=s;hs.chipInput='';renderBody();};
window.htSetChip   = function(n){hs.chipInput=String(n);renderBody();};
window.htChipInput = function(v){hs.chipInput=v;renderBody();};

window.htOpenCards = function(target){
  hs.cardTarget=target;
  hs.view='cards';
  if(typeof window.openCardPicker==='function') window.openCardPicker();
  else renderBody();
};
window.htPickCard  = function(card){
  if(typeof hs.cardTarget==='number'){
    var b=hs.board.slice(),ex=b.indexOf(card);
    if(ex!==-1)b.splice(ex,1);else b[hs.cardTarget]=card;
    hs.board=b.filter(Boolean);
    if(hs.hand)htApi('/games/'+getGameId()+'/hands/'+hs.hand.id+'/board',{method:'PUT',body:JSON.stringify({board:hs.board})}).catch(function(){});
    renderBoardOnFelt();

    if(hs._autoCardMode==='flop'){
      var nextSlot=null;
      for(var fsi=0;fsi<3;fsi++){
        if(!hs.board[fsi]){ nextSlot=fsi; break; }
      }
      if(nextSlot!==null){
        hs.cardTarget=nextSlot;
        hs.view='cards';
        if(typeof window.openCardPicker==='function') window.openCardPicker();
        else renderBody();
        return;
      } else {
        hs._autoCardMode=null;
        hs.view='main';
        renderBody();
        if(typeof window.closeCardPicker==='function') window.closeCardPicker();
        return;
      }
    }
  } else {
    var hc=(hs.holes[hs.cardTarget]||[]).slice(),ix=hc.indexOf(card);
    if(ix!==-1)hc.splice(ix,1);else if(hc.length<2)hc.push(card);
    hs.holes[hs.cardTarget]=hc;
  }

  hs.view='main';
  renderBody();
  if(typeof window.closeCardPicker==='function') window.closeCardPicker();
};

window.htAssignPotWinner = function(potIdx, winnerName){
  var seated=getSeated();
  var pots=calculateSidePots(hs.actions,seated);
  var pot=pots[potIdx];if(!pot)return;
  hs.potWinners[potIdx]={potIdx:potIdx,winnerName:winnerName,chips:pot.chips,label:pot.label};
  var allDone=pots.every(function(p,i){return hs.potWinners[i];});
  if(allDone){
    var pE=null;Object.values(window.state.players).forEach(function(p){if(p&&p.name===hs.potWinners[0].winnerName)pE=p;});
    var summary=hs.potWinners.map(function(pw){return pw.label+': '+pw.winnerName;}).join(' | ');
    var potWinnersForApi=hs.potWinners.slice();
    htApi('/games/'+getGameId()+'/hands/'+hs.hand.id+'/result',{method:'POST',
      body:JSON.stringify({winner_user_id:pE?pE.userId:null,winner_name:hs.potWinners.map(function(pw){return pw.winnerName;}).join(', '),hole_cards:hs.holes,split_pot:hs.potWinners.length>1,pot_winners:hs.potWinners}),
    }).then(function(){
      var cv2=gameInfo().chip_value||0;
      hs._lastHandSummary={
        handNo: hs.hand.hand_no,
        winner: potWinnersForApi.map(function(pw){return pw.winnerName;}).join(', '),
        pot: hs.pot,
        potDollar: cv2?(hs.pot*cv2/100).toFixed(2):null,
        nextDealer: nextDealerName(),
      };
      hs.hand.result={winner_name:potWinnersForApi.map(function(pw){return pw.winnerName;}).join(', '),pot_chips:hs.pot,pot_winners:potWinnersForApi};
      hs.view='summary'; hs.potWinners=[]; hs.currentPotIndex=0;
      renderBody(); renderBoardOnFelt();
      return htApi('/games/'+getGameId()+'/hands');
    }).then(function(h){hs.history=h||[];toast('\uD83C\uDFC6 '+summary);})
    .catch(function(e){toast('\u26A0 '+e.message);});
  } else {
    var next=pots.findIndex(function(p,i){return !hs.potWinners[i];});
    hs.currentPotIndex=next;
    toast(pot.label+': '+winnerName+' wins '+pot.chips+' chips');
    renderBody();
  }
};

window.htDeclareWinner = function(name){
  if(!hs.hand)return;
  var cv2=gameInfo().chip_value||0;
  var seated=getSeated();
  var pots=calculateSidePots(hs.actions,seated);
  if(pots.length>1){window.htAssignPotWinner(hs.currentPotIndex,name);return;}
  var pE=null;Object.values(window.state.players).forEach(function(p){if(p&&p.name===name)pE=p;});
  htApi('/games/'+getGameId()+'/hands/'+hs.hand.id+'/result',{method:'POST',
    body:JSON.stringify({winner_user_id:pE?pE.userId:null,winner_name:name,hole_cards:hs.holes,split_pot:false}),
  }).then(function(){
    hs._lastHandSummary={
      handNo: hs.hand.hand_no,
      winner: name,
      pot: hs.pot,
      potDollar: cv2?(hs.pot*cv2/100).toFixed(2):null,
      nextDealer: nextDealerName(),
    };
    hs.hand.result={winner_name:name,pot_chips:hs.pot};
    hs.view='summary';
    renderBody(); renderBoardOnFelt();
    return htApi('/games/'+getGameId()+'/hands');
  }).then(function(h){hs.history=h||[];saveSession();toast('\uD83C\uDFC6 '+name+' wins '+hs.pot+' chips!');})
  .catch(function(e){toast('\u26A0 '+e.message);});
};

window.htUndoWinner = function(){
  if(!hs.hand||!hs.hand.result)return;
  htApi('/games/'+getGameId()+'/hands/'+hs.hand.id+'/result',{method:'DELETE'}).then(function(h){
    hs.hand=h;hs.actions=h.actions||[];hs.pot=h.pot_chips||0;hs.board=h.board||[];
    hs.potWinners=[]; hs.currentPotIndex=0; hs._lastHandSummary=null;
    hs.view='main';renderBody();renderBoardOnFelt();toast('Winner undone');
  }).catch(function(e){toast('\u26A0 '+e.message);});
};

function nextDealerName(){
  var seated=getSeated();
  if(!seated.length) return '';
  var seats=seated.map(function(p){return p.seat;});
  var last=gameInfo().currentDealerSeat||0;
  var nextSeat=seats.find(function(s){return s>last;})||seats[0];
  var pl=seated.find(function(p){return p.seat===nextSeat;});
  return pl?pl.name:'';
}

function calculateSidePots(actions,seated){
  if(!seated||!seated.length)return[];
  var folded={};
  actions.forEach(function(a){if(a.action==='fold')folded[a.display_name]=true;});
  var total={};
  seated.forEach(function(p){total[p.name]=0;});
  actions.forEach(function(a){if(a.chips>0)total[a.display_name]=(total[a.display_name]||0)+a.chips;});
  var allinAt={};
  actions.forEach(function(a){if(a.action==='allin')allinAt[a.display_name]=total[a.display_name];});
  if(!Object.keys(allinAt).length)return[];
  var levels=Object.values(allinAt).filter(function(v,i,arr){return arr.indexOf(v)===i;}).sort(function(a,b){return a-b;});
  var mx=Math.max.apply(null,Object.values(total).concat([0]));
  if(levels.indexOf(mx)<0)levels.push(mx);
  var pots=[],prev=0;
  levels.forEach(function(level){
    if(level<=prev)return;
    var chips=0,elig=[];
    seated.forEach(function(pl){
      var contrib=total[pl.name]||0;
      var share=Math.min(contrib,level)-Math.min(contrib,prev);
      if(share>0)chips+=share;
      if(!folded[pl.name]&&contrib>=level)elig.push(pl.name);
    });
    if(chips>0)pots.push({chips:chips,eligible:elig,level:level});
    prev=level;
  });
  if(pots.length===1)pots[0].label='Main Pot';
  else{pots[0].label='Main Pot';for(var i=1;i<pots.length;i++)pots[i].label='Side Pot '+i;}
  return pots;
}

// --- DEALER CHIP ON FELT ---
// ─── CHIP ANIMATION SYSTEM ───────────────────────────────────────────────────

// Inject global CSS for chip animations (once)
function ensureChipStyles() {
  if (document.getElementById('ht-chip-styles')) return;
  var s = document.createElement('style');
  s.id = 'ht-chip-styles';
  s.textContent = [
    '@keyframes htChipPop{0%{transform:translate(-50%,-50%) scale(0.3);opacity:0}60%{transform:translate(-50%,-50%) scale(1.2)}100%{transform:translate(-50%,-50%) scale(1);opacity:1}}',
    '@keyframes htChipSlide{0%{opacity:1}100%{opacity:0}}',
    '@keyframes htGlow{0%,100%{box-shadow:0 0 6px rgba(201,168,76,0.4)}50%{box-shadow:0 0 14px rgba(201,168,76,0.9)}}',
    '.ht-chip-stack{position:absolute;transform:translate(-50%,-50%);pointer-events:none;display:flex;flex-direction:column;align-items:center;gap:2px;z-index:10;animation:htChipPop 0.25s ease-out forwards}',
    '.ht-chip-disc{width:22px;height:22px;border-radius:50%;border:2px solid rgba(255,255,255,0.25);display:flex;align-items:center;justify-content:center;font-size:7px;font-weight:700;color:#fff;font-family:DM Sans,sans-serif}',
    '.ht-chip-amount{font-size:10px;font-weight:700;color:#c9a84c;font-family:DM Sans,sans-serif;text-shadow:0 1px 3px rgba(0,0,0,0.9);white-space:nowrap;background:rgba(0,0,0,0.55);padding:1px 4px;border-radius:3px}',
    '.ht-seat-glow{animation:htGlow 1s ease-in-out infinite}',
    '.ht-seat-folded{opacity:0.3!important}',
    '#htChipsLayer{position:absolute;inset:0;pointer-events:none;z-index:8}',
  ].join('');
  document.head.appendChild(s);
}

// Get absolute pixel position of a seat element relative to tableFelt
function getSeatPos(sid) {
  var seatEl = document.getElementById(sid);
  var felt = document.getElementById('tableFelt');
  if (!seatEl || !felt) return null;
  var sr = seatEl.getBoundingClientRect();
  var fr = felt.getBoundingClientRect();
  return {
    x: sr.left + sr.width/2 - fr.left,
    y: sr.top  + sr.height/2 - fr.top
  };
}

// Get center of felt
function getFeltCenter() {
  var felt = document.getElementById('tableFelt');
  if (!felt) return {x:0,y:0};
  return { x: felt.offsetWidth/2, y: felt.offsetHeight/2 };
}

// Chip colours by denomination bucket
function chipColor(amt) {
  if (amt <= 5)   return '#c0392b'; // red
  if (amt <= 25)  return '#27ae60'; // green
  if (amt <= 100) return '#2980b9'; // blue
  if (amt <= 500) return '#8e44ad'; // purple
  return '#c9a84c;border-color:rgba(201,168,76,0.8)'; // gold
}

// Draw a stack of chips at absolute position (x,y) inside #htChipsLayer
function drawChipStack(layer, x, y, amount, label, isAllin, isFolded, cv) {
  var stack = document.createElement('div');
  stack.className = 'ht-chip-stack';
  stack.style.left = x + 'px';
  stack.style.top  = y + 'px';

  if (isFolded) {
    // Just show folded text
    var ft = document.createElement('div');
    ft.style.cssText = 'font-size:10px;font-weight:700;color:rgba(231,76,60,0.7);font-family:DM Sans,sans-serif;background:rgba(0,0,0,0.5);padding:1px 5px;border-radius:3px';
    ft.textContent = '\u2715 FOLD';
    stack.appendChild(ft);
    layer.appendChild(stack);
    return;
  }

  // Stack discs (1-4 visible chips)
  var numDiscs = Math.min(4, Math.max(1, Math.ceil(Math.log10((amount||1)+1))));
  var colors = ['#c0392b','#27ae60','#2980b9','#8e44ad'];
  for (var d = 0; d < numDiscs; d++) {
    var disc = document.createElement('div');
    disc.className = 'ht-chip-disc';
    disc.style.background = colors[d % colors.length];
    disc.style.marginTop = d === 0 ? '0' : '-14px'; // stack overlap
    disc.style.zIndex = String(numDiscs - d);
    if (d === 0) disc.textContent = amount > 999 ? (amount/1000).toFixed(1)+'k' : String(amount);
    stack.appendChild(disc);
  }

  // Amount label
  var lbl = document.createElement('div');
  lbl.className = 'ht-chip-amount';
  var txt = isAllin ? 'ALL-IN ' + amount : String(amount);
  if (cv && amount) txt += ' \u00B7 $' + (amount * cv / 100).toFixed(0);
  lbl.textContent = txt;
  stack.appendChild(lbl);

  layer.appendChild(stack);
  return stack;
}

// Animate all chip stacks sliding to center (called when street ends)
function animateChipsToPot(onDone) {
  var layer = document.getElementById('htChipsLayer');
  if (!layer) { if(onDone) onDone(); return; }
  var center = getFeltCenter();
  var stacks = layer.querySelectorAll('.ht-chip-stack');
  if (!stacks.length) { if(onDone) onDone(); return; }
  var total = stacks.length;
  var done = 0;
  stacks.forEach(function(stack) {
    var startX = parseFloat(stack.style.left);
    var startY = parseFloat(stack.style.top);
    var dx = center.x - startX;
    var dy = center.y - startY;
    stack.style.transition = 'left 0.4s ease-in, top 0.4s ease-in, opacity 0.4s ease-in';
    // force reflow
    void stack.offsetWidth;
    stack.style.left = center.x + 'px';
    stack.style.top  = center.y + 'px';
    stack.style.opacity = '0';
    stack.addEventListener('transitionend', function handler() {
      stack.removeEventListener('transitionend', handler);
      stack.remove();
      done++;
      if (done >= total && onDone) onDone();
    });
  });
}

// ─── MAIN FELT RENDERER ─────────────────────────────────────────────────────

function renderBoardOnFelt(){
  ensureChipStyles();
  var tc = document.getElementById('tableCenter'); if(!tc) return;
  var felt = document.getElementById('tableFelt'); if(!felt) return;

  // Clean up centre HUD elements
  ['htBoard','htPot','htDealerChip'].forEach(function(id){
    var el=document.getElementById(id); if(el) el.remove();
  });

  // Always update seat visuals and action panel
  renderActionPanel();
  updateSeatVisuals();

  if (!hs.hand || hs.hand.result) {
    // Hand over — remove chip layer and clean seats
    var cl = document.getElementById('htChipsLayer');
    if (cl) cl.remove();
    document.querySelectorAll('.seat').forEach(function(el){
      el.style.opacity=''; el.style.filter='';
    });
    return;
  }

  // Ensure chip layer exists
  var layer = document.getElementById('htChipsLayer');
  if (!layer) {
    layer = document.createElement('div');
    layer.id = 'htChipsLayer';
    felt.appendChild(layer);
  }

  // Redraw all chip stacks for current street
  layer.innerHTML = '';
  var seated = getSeated();
  var cv = gameInfo().chip_value||0;
  var allFolded={}, allAllin={};
  hs.actions.forEach(function(a){
    if(a.action==='fold')  allFolded[a.display_name]=true;
    if(a.action==='allin') allAllin[a.display_name]=true;
  });
  var scm={};
  seated.forEach(function(p){scm[p.name]=0;});
  hs.actions.filter(function(a){return a.street===hs.street;}).forEach(function(a){
    if(a.chips>0) scm[a.display_name]=(scm[a.display_name]||0)+a.chips;
  });
  var center = getFeltCenter();

  seated.forEach(function(pl){
    var betAmt = scm[pl.name]||0;
    var isFolded = allFolded[pl.name];
    var isAllin = allAllin[pl.name];
    if (!betAmt && !isFolded) return;

    var pos = getSeatPos(pl.sid);
    if (!pos) return;

    // Position chip stack between seat and center (40% toward center)
    var chipX = pos.x + (center.x - pos.x) * 0.38;
    var chipY = pos.y + (center.y - pos.y) * 0.38;

    drawChipStack(layer, chipX, chipY, betAmt, pl.name, isAllin, isFolded, cv);
  });

  // Board cards
  var row=document.createElement('div');row.id='htBoard';
  row.style.cssText='display:flex;gap:4px;justify-content:center;margin-top:8px;pointer-events:all';
  for(var i=0;i<5;i++){
    var card=hs.board[i],isRed=card&&(card.indexOf('\u2665')>=0||card.indexOf('\u2666')>=0);
    var el=document.createElement('div');
    el.style.cssText='width:clamp(20px,4.5vw,30px);height:clamp(30px,7vw,48px);border-radius:3px;display:flex;flex-direction:column;align-items:center;justify-content:center;cursor:pointer;font-weight:700;line-height:1.1;'
      +(card?'background:#fff;color:'+(isRed?'#d63031':'#1a1a1a')+';':'background:rgba(255,255,255,0.06);border:1px dashed rgba(201,168,76,0.3);color:rgba(201,168,76,0.25);');
    if(card){var rd=document.createElement('div');rd.style.fontSize='clamp(8px,1.9vw,12px)';rd.textContent=card.slice(0,-1);var sd2=document.createElement('div');sd2.style.fontSize='clamp(9px,2.1vw,14px)';sd2.textContent=card.slice(-1);el.appendChild(rd);el.appendChild(sd2);}
    else{el.style.fontSize='clamp(5px,1vw,7px)';el.style.textAlign='center';el.textContent=i<3?'F':i===3?'T':'R';}
    el.dataset.slot=i;
    el.addEventListener('click',function(){window.htOpenCards(parseInt(this.dataset.slot));openSheet('handTrackerSheet');});
    row.appendChild(el);
  }
  tc.appendChild(row);

  // Pot display
  var cv2=gameInfo().chip_value||0;
  var potWrap=document.createElement('div');potWrap.id='htPot';
  potWrap.style.cssText='margin-top:4px;text-align:center;pointer-events:none';
  if(hs.pot>0){
    var pm=document.createElement('div');
    pm.style.cssText='font-size:clamp(0.62rem,1.4vw,0.78rem);color:#c9a84c;font-weight:700;font-family:DM Sans,sans-serif;text-shadow:0 1px 3px rgba(0,0,0,0.8)';
    pm.textContent='POT \u00B7 '+hs.pot+(cv2?' \u00B7 $'+(hs.pot*cv2/100).toFixed(0):'');
    potWrap.appendChild(pm);
  }
  var sp=calculateSidePots(hs.actions,seated);
  if(sp.length>1){
    sp.forEach(function(pot){
      var sd=document.createElement('div');
      sd.style.cssText='font-size:clamp(0.48rem,1vw,0.6rem);color:rgba(46,204,113,0.85);font-weight:600;margin-top:1px;font-family:DM Sans,sans-serif';
      sd.textContent=pot.label+': '+pot.chips+(cv2?' ($'+(pot.chips*cv2/100).toFixed(0)+')':'');
      potWrap.appendChild(sd);
    });
  }
  tc.appendChild(potWrap);

  // Dealer chip
  var dChip=document.createElement('div');dChip.id='htDealerChip';
  var dSeated=getSeated().find(function(p){return p.seat===hs.hand.dealer_seat;});
  dChip.style.cssText='font-size:0.6rem;font-weight:700;color:#000;background:#c9a84c;border-radius:50%;width:16px;height:16px;display:flex;align-items:center;justify-content:center;margin:4px auto 0;pointer-events:none';
  dChip.textContent='D';
  if(dSeated){
    var dn=document.createElement('div');dn.style.cssText='font-size:0.55rem;color:rgba(201,168,76,0.7);margin-top:1px;pointer-events:none';
    dn.textContent=dSeated.name.split(' ')[0];
    var dWrap=document.createElement('div');dWrap.id='htDealerChip';dWrap.style.cssText='display:flex;flex-direction:column;align-items:center;pointer-events:none';
    dWrap.appendChild(dChip);dWrap.appendChild(dn);tc.appendChild(dWrap);
  } else { tc.appendChild(dChip); }
}

// Apply fold/glow/allin visual state to seat elements
function updateSeatVisuals() {
  if (!hs.hand || !gameInfo().hand_tracking) {
    document.querySelectorAll('.seat').forEach(function(el){
      el.style.opacity=''; el.style.filter=''; el.classList.remove('ht-seat-glow');
    });
    return;
  }
  var allFolded={}, allAllin={};
  hs.actions.forEach(function(a){
    if(a.action==='fold')  allFolded[a.display_name]=true;
    if(a.action==='allin') allAllin[a.display_name]=true;
  });
  var nextPlayer = hs.hand && !hs.hand.result ? computeNextPlayer(hs.street,hs.actions,hs.hand) : null;
  var seated = getSeated();
  seated.forEach(function(pl){
    var seatEl = document.getElementById(pl.sid);
    if (!seatEl) return;
    var isFolded = allFolded[pl.name];
    var isNext   = pl.name === nextPlayer;
    seatEl.style.opacity = isFolded ? '0.3' : '1';
    if (isNext) {
      seatEl.style.filter = 'drop-shadow(0 0 8px rgba(201,168,76,0.95))';
      seatEl.classList.add('ht-seat-glow');
    } else {
      seatEl.style.filter = '';
      seatEl.classList.remove('ht-seat-glow');
    }
  });
}


// --- COMPACT ACTION PANEL (floating on felt) ---
var _apOpen = true; // panel expanded state

function renderActionPanel(){
  // Remove existing panel
  var existing=document.getElementById('htActionPanel');
  if(existing) existing.remove();

  // Only show when hand is active and not yet resulted
  if(!hs.hand||hs.hand.result||!gameInfo().hand_tracking) return;

  var seated=getSeated();
  var cv=getChipValue();
  var allFolded={},allAllin={};
  hs.actions.forEach(function(a){
    if(a.action==='fold')  allFolded[a.display_name]=true;
    if(a.action==='allin') allAllin[a.display_name]=true;
  });
  var nextPlayer=computeNextPlayer(hs.street,hs.actions,hs.hand);
  var scm={};
  seated.forEach(function(p){scm[p.name]=0;});
  hs.actions.filter(function(a){return a.street===hs.street;}).forEach(function(a){
    if(a.chips>0) scm[a.display_name]=(scm[a.display_name]||0)+a.chips;
  });
  var maxBet=Math.max.apply(null,[0].concat(Object.values(scm)));

  var panel=document.createElement('div');
  panel.id='htActionPanel';
  // Fixed bottom-left, above bottom nav
  panel.style.cssText='position:fixed;bottom:70px;left:8px;z-index:999;width:260px;font-family:DM Sans,sans-serif;';

  if(!_apOpen){
    // Collapsed tab
    var tab=document.createElement('button');
    tab.style.cssText='background:rgba(13,26,15,0.95);border:1px solid rgba(201,168,76,0.4);border-radius:10px;padding:6px 12px;color:var(--gold,#c9a84c);font-size:0.75rem;font-weight:700;cursor:pointer;display:flex;align-items:center;gap:5px;backdrop-filter:blur(4px)';
    tab.innerHTML='\uD83C\uDCCF <span style="font-size:0.65rem;opacity:0.7">'+(nextPlayer?nextPlayer.split(' ')[0]:'...')+'</span>';
    tab.addEventListener('click',function(){_apOpen=true;renderActionPanel();});
    panel.appendChild(tab);
    document.body.appendChild(panel);
    return;
  }

  // Expanded panel
  var box=document.createElement('div');
  box.style.cssText='background:rgba(13,26,15,0.96);border:1px solid rgba(201,168,76,0.3);border-radius:12px;padding:10px;backdrop-filter:blur(6px);box-shadow:0 4px 20px rgba(0,0,0,0.5)';

  // Header row: street + collapse button
  var hdr=document.createElement('div');
  hdr.style.cssText='display:flex;justify-content:space-between;align-items:center;margin-bottom:7px';
  var streetBadge=document.createElement('span');
  streetBadge.style.cssText='font-size:0.6rem;font-weight:700;text-transform:uppercase;letter-spacing:1.5px;color:rgba(201,168,76,0.7)';
  streetBadge.textContent=hs.street+(hs.pot?' \u00B7 '+hs.pot+' chips':'');
  var collapseBtn=document.createElement('button');
  collapseBtn.style.cssText='background:none;border:none;color:rgba(255,255,255,0.3);font-size:0.7rem;cursor:pointer;padding:0;line-height:1';
  collapseBtn.textContent='\u2212';
  collapseBtn.addEventListener('click',function(){_apOpen=false;renderActionPanel();});
  var openFullBtn=document.createElement('button');
  openFullBtn.style.cssText='background:none;border:none;color:rgba(201,168,76,0.5);font-size:0.65rem;cursor:pointer;padding:0 4px;line-height:1';
  openFullBtn.textContent='\u2197';
  openFullBtn.title='Open full tracker';
  openFullBtn.addEventListener('click',function(){openSheet('handTrackerSheet');});
  var btnRow=document.createElement('div');btnRow.style.cssText='display:flex;gap:4px;align-items:center';
  btnRow.appendChild(openFullBtn);btnRow.appendChild(collapseBtn);
  hdr.appendChild(streetBadge);hdr.appendChild(btnRow);
  box.appendChild(hdr);

  if(!nextPlayer){
    // Betting round complete — show deal next street or declare winner
    var activePl=seated.filter(function(p){return !allFolded[p.name];});
    var so=['pre','flop','turn','river'],si=so.indexOf(hs.street);
    if(activePl.length>1&&si>=0&&si<3){
      var ns=so[si+1];
      var dealBtn=document.createElement('button');
      dealBtn.style.cssText='width:100%;padding:8px;background:rgba(201,168,76,0.15);border:1px solid rgba(201,168,76,0.4);color:var(--gold,#c9a84c);border-radius:7px;cursor:pointer;font-size:0.78rem;font-weight:700';
      dealBtn.textContent='\uD83C\uDCA0 Deal '+ns.charAt(0).toUpperCase()+ns.slice(1);
      dealBtn.onclick=function(){
        hs.street=ns;hs.chipInput='';
        var slots={flop:[0,1,2],turn:[3],river:[4]};
        var sl=slots[ns];
        if(sl){hs.cardTarget=sl[0];hs.view='cards';if(ns==='flop')hs._autoCardMode='flop';else hs._autoCardMode=null;}
        renderBody();renderActionPanel();
        if(typeof window.openCardPicker==='function') window.openCardPicker();
        else if(typeof openSheet==='function') openSheet('cardPickerSheet');
      };
      box.appendChild(dealBtn);
    } else if(activePl.length<=1||(si===3)){
      var winBtn=document.createElement('button');
      winBtn.style.cssText='width:100%;padding:8px;background:rgba(46,204,113,0.1);border:1px solid rgba(46,204,113,0.3);color:#2ecc71;border-radius:7px;cursor:pointer;font-size:0.78rem;font-weight:700';
      winBtn.textContent='\uD83C\uDFC6 Declare Winner';
      winBtn.onclick=function(){hs.view='winner';renderBody();renderActionPanel();if(typeof window.openWinnerOverlay==='function') window.openWinnerOverlay();};
      box.appendChild(winBtn);
    }
  } else {
    // Next player to act
    var nextPl=seated.find(function(p){return p.name===nextPlayer;});
    var myChips=scm[nextPlayer]||0;
    var callAmt=Math.max(0,maxBet-myChips);
    var isBB=nextPl&&nextPl.seat===hs.hand.bb_seat;
    var isStr=hs.straddleSeat&&nextPl&&nextPl.seat===hs.straddleSeat;
    var isOption=hs.street==='pre'&&(isBB||isStr)&&myChips>=maxBet;

    // Who's acting
    var who=document.createElement('div');
    who.style.cssText='font-size:0.78rem;font-weight:700;color:#fff;margin-bottom:6px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis';
    who.textContent='\u25B6 '+nextPlayer+(callAmt>0?' \u00B7 call '+callAmt:'')+(isOption?' \u00B7 option':'');
    box.appendChild(who);

    // Action buttons
    var acts=isOption?[
      {a:'fold',l:'Fold',bg:'rgba(231,76,60,0.15)',col:'#e74c3c',br:'rgba(231,76,60,0.3)'},
      {a:'check',l:'Check',bg:'rgba(255,255,255,0.05)',col:'rgba(255,255,255,0.6)',br:'rgba(255,255,255,0.15)'},
      {a:'bet',l:'Bet',bg:'rgba(201,168,76,0.1)',col:'var(--gold,#c9a84c)',br:'rgba(201,168,76,0.3)'},
      {a:'allin',l:'All-in',bg:'rgba(46,204,113,0.1)',col:'#2ecc71',br:'rgba(46,204,113,0.3)'},
    ]:[
      {a:'fold',l:'Fold',bg:'rgba(231,76,60,0.15)',col:'#e74c3c',br:'rgba(231,76,60,0.3)'},
      {a:'call',l:'Call'+(callAmt?' '+callAmt:''),bg:'rgba(58,106,170,0.15)',col:'#6aaaee',br:'rgba(58,106,170,0.3)'},
      {a:'raise',l:'Raise',bg:'rgba(201,168,76,0.1)',col:'var(--gold,#c9a84c)',br:'rgba(201,168,76,0.3)'},
      {a:'allin',l:'All-in',bg:'rgba(46,204,113,0.1)',col:'#2ecc71',br:'rgba(46,204,113,0.3)'},
    ];
    var actRow=document.createElement('div');actRow.style.cssText='display:grid;grid-template-columns:1fr 1fr;gap:4px;margin-bottom:6px';
    acts.forEach(function(cfg){
      var b=document.createElement('button');
      b.style.cssText='padding:6px 2px;background:'+cfg.bg+';color:'+cfg.col+';border:1px solid '+cfg.br+';border-radius:6px;cursor:pointer;font-size:0.7rem;font-weight:700';
      b.textContent=cfg.l;
      b.addEventListener('click',function(){window.htAct(cfg.a,nextPlayer);});
      actRow.appendChild(b);
    });
    box.appendChild(actRow);

    // Chip input
    var chipRow=document.createElement('div');chipRow.style.cssText='display:flex;gap:4px;align-items:center';
    var inp=document.createElement('input');
    inp.type='number';inp.min='0';inp.value=hs.chipInput||'';inp.placeholder='chips';
    inp.style.cssText='flex:1;background:rgba(0,0,0,0.4);border:1px solid rgba(255,255,255,0.1);border-radius:5px;padding:5px 7px;color:#fff;font-size:0.75rem;font-family:DM Sans,sans-serif;outline:none;min-width:0';
    inp.addEventListener('input',function(){window.htChipInput(this.value);});
    chipRow.appendChild(inp);
    if(cv&&parseInt(hs.chipInput)>0){
      var cvl=document.createElement('span');
      cvl.style.cssText='font-size:0.7rem;color:var(--gold,#c9a84c);font-weight:700;white-space:nowrap';
      cvl.textContent='$'+(parseInt(hs.chipInput)*cv/100).toFixed(0);
      chipRow.appendChild(cvl);
    }
    box.appendChild(chipRow);
  }

  panel.appendChild(box);
  document.body.appendChild(panel);
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

// --- RENDER BODY ---
function renderBody(){
  var body=document.getElementById('handTrackerBody');if(!body)return;
  body.innerHTML='';
  var ub=document.getElementById('undoActionBtn');if(ub)ub.style.display=(hs.hand&&!hs.hand.result&&hs.actions.length>0)?'':'none';
  if(hs.view==='cards'){renderCards(body);return;}
  if(hs.view==='winner'){renderWinner(body);return;}
  if(hs.view==='history'){renderHistory(body);return;}
  if(hs.view==='straddle'){renderStraddleView(body);return;}
  if(hs.view==='dealer'){renderDealerView(body);return;}
  if(hs.view==='summary'){renderSummary(body);return;}
  if(hs.view==='add_player'){renderAddPlayerPanel(body);return;}
  if(hs.view==='chip_settings'){renderChipSettings(body);return;}
  if(hs.view==='player_stats'){renderPlayerStatsCard(body,hs._statsPlayer);return;}
  renderMain(body);
}

// --- DEALER PICKER VIEW ---
function renderDealerView(body){
  var seated=getSeated();
  var suggested=hs._suggestedDealer;
  var huMode=seated.length===2;
  var ti=document.createElement('div');
  ti.style.cssText='font-size:0.9rem;font-weight:700;color:var(--cream);margin-bottom:4px';
  ti.textContent='Hand #'+((hs.hand?hs.hand.hand_no:0)+1)+' \u2014 Choose Dealer';
  body.appendChild(ti);
  var sub=document.createElement('div');
  sub.style.cssText='font-size:0.75rem;color:var(--muted);margin-bottom:16px;line-height:1.5';
  sub.textContent=huMode?'Heads-up: dealer posts SB and acts first pre-flop':'Tap the player with the dealer button. Next suggested is highlighted.';
  body.appendChild(sub);
  seated.forEach(function(pl){
    var isSug=pl.seat===suggested;
    var btn=document.createElement('button');
    btn.style.cssText='width:100%;padding:13px 16px;margin-bottom:8px;border-radius:8px;cursor:pointer;font-size:0.88rem;font-family:DM Sans,sans-serif;font-weight:600;display:flex;align-items:center;gap:10px;text-align:left;'+(isSug?'background:rgba(201,168,76,0.12);border:1px solid rgba(201,168,76,0.4);color:var(--gold);':'background:rgba(255,255,255,0.04);border:1px solid var(--border);color:var(--cream);');
    btn.innerHTML='<span style="width:22px;height:22px;background:'+(isSug?'var(--gold)':'rgba(255,255,255,0.1)')+';color:'+(isSug?'#000':'var(--muted)')+';border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:0.65rem;font-weight:700;flex-shrink:0">D</span><span>'+pl.name+'</span><span style="margin-left:auto;font-size:0.7rem;opacity:0.6">Seat '+pl.seat+(isSug?' \u00B7 next':'')+'</span>';
    btn.onclick=function(){window.htPickDealer(pl.seat);};
    body.appendChild(btn);
  });
  var cancel=document.createElement('button');
  cancel.style.cssText='width:100%;padding:10px;background:none;border:1px solid var(--border);color:var(--muted);border-radius:8px;cursor:pointer;font-size:0.82rem;font-family:DM Sans,sans-serif;margin-top:4px';
  cancel.textContent='Cancel';
  cancel.onclick=function(){hs.view='main';renderBody();};
  body.appendChild(cancel);
}

// --- HAND SUMMARY VIEW ---
function renderSummary(body){
  var s=hs._lastHandSummary;
  if(!s){hs.view='main';renderBody();return;}
  var card=document.createElement('div');
  card.style.cssText='background:linear-gradient(135deg,rgba(46,204,113,0.12),rgba(46,204,113,0.04));border:1px solid rgba(46,204,113,0.3);border-radius:12px;padding:20px 16px;margin-bottom:16px;text-align:center';
  card.innerHTML='<div style="font-size:2rem;margin-bottom:6px">\uD83C\uDFC6</div>'
    +'<div style="font-size:1.1rem;font-weight:700;color:var(--green);margin-bottom:4px">'+s.winner+' wins!</div>'
    +'<div style="font-size:0.85rem;color:var(--muted)">Hand #'+s.handNo+' \u00B7 '+s.pot+' chips'+(s.potDollar?' = $'+s.potDollar:'')+'</div>';
  body.appendChild(card);
  if(s.nextDealer){
    var nd=document.createElement('div');
    nd.style.cssText='display:flex;align-items:center;gap:8px;background:rgba(201,168,76,0.06);border:1px solid rgba(201,168,76,0.15);border-radius:8px;padding:10px 14px;margin-bottom:16px';
    nd.innerHTML='<span style="width:20px;height:20px;background:var(--gold);color:#000;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:0.6rem;font-weight:700;flex-shrink:0">D</span>'
      +'<span style="font-size:0.82rem;color:var(--cream)">Next dealer: <strong>'+s.nextDealer+'</strong></span>';
    body.appendChild(nd);
  }
  var undoBtn=document.createElement('button');
  undoBtn.style.cssText='width:100%;padding:10px;background:rgba(231,76,60,0.06);border:1px solid rgba(231,76,60,0.2);color:var(--red);border-radius:8px;cursor:pointer;font-size:0.8rem;font-family:DM Sans,sans-serif;margin-bottom:10px';
  undoBtn.textContent='\u21A9 Undo winner';
  undoBtn.onclick=function(){window.htUndoWinner();};
  body.appendChild(undoBtn);
  var nextBtn=document.createElement('button');
  nextBtn.className='btn-primary';
  nextBtn.style.cssText='width:100%;padding:16px;font-size:1rem;border-radius:10px';
  nextBtn.textContent='\u25B6\uFE0F Start Hand #'+(s.handNo+1);
  nextBtn.onclick=function(){hs.view='main';hs._lastHandSummary=null;renderBody();setTimeout(function(){window.htStartHand();},50);};
  body.appendChild(nextBtn);
  if(hs.history.filter(function(h){return h.result;}).length>=2){
    var shareBtn=document.createElement('button');
    shareBtn.style.cssText='width:100%;padding:11px;background:rgba(255,255,255,0.03);border:1px solid var(--border);color:var(--muted);border-radius:9px;cursor:pointer;font-size:0.8rem;font-family:DM Sans,sans-serif;margin-top:8px';
    shareBtn.textContent='Share session recap';
    shareBtn.addEventListener('click', exportSession);
    body.appendChild(shareBtn);
  }
}

// --- STRADDLE VIEW ---
function renderStraddleView(body){
  var p=hs._pendingHand;if(!p)return;
  var seated=getSeated(),bl=blindsInChips(),cv=gameInfo().chip_value||0;
  var huMode=seated.length===2;
  var ti=document.createElement('div');ti.style.cssText='font-size:0.9rem;font-weight:700;color:var(--cream);margin-bottom:6px';ti.textContent='Hand #'+((hs.hand?hs.hand.hand_no:0)+1);body.appendChild(ti);
  var su=document.createElement('div');su.style.cssText='font-size:0.75rem;color:var(--muted);margin-bottom:14px;line-height:1.6';
  if(huMode){
    su.innerHTML='<span style="background:rgba(201,168,76,0.15);color:var(--gold);padding:1px 5px;border-radius:3px;font-size:0.7rem;font-weight:700">HEADS UP</span> &nbsp;Dealer: '+p.dealer+' (SB) &nbsp;\u00B7&nbsp; BB: Seat '+p.bb+'<br>BB = '+bl.bb+' chips'+(cv?' ($'+(bl.bb*cv/100).toFixed(2)+')':'');
  } else {
    su.innerHTML='Dealer: Seat '+p.dealer+' &nbsp;\u00B7&nbsp; SB: Seat '+p.sb+' &nbsp;\u00B7&nbsp; BB: Seat '+p.bb+'<br>BB = '+bl.bb+' chips'+(cv?' ($'+(bl.bb*cv/100).toFixed(2)+')':'');
  }
  body.appendChild(su);
  var chg=document.createElement('button');
  chg.style.cssText='font-size:0.72rem;color:var(--muted);background:none;border:none;cursor:pointer;padding:0;margin-bottom:12px;font-family:DM Sans,sans-serif;text-decoration:underline';
  chg.textContent='Wrong dealer? Change';
  chg.onclick=function(){hs._pendingHand=null;hs.view='dealer';renderBody();};
  body.appendChild(chg);
  if(!huMode){
    var sl=document.createElement('div');sl.style.cssText='font-size:0.7rem;text-transform:uppercase;letter-spacing:1.5px;color:var(--gold);margin-bottom:10px';sl.textContent='Straddle option?';body.appendChild(sl);
    body.appendChild(mkB('No straddle \u2014 start hand','width:100%;padding:13px;background:rgba(255,255,255,0.04);border:1px solid var(--border);color:var(--cream);border-radius:8px;cursor:pointer;font-size:0.85rem;font-family:DM Sans,sans-serif;margin-bottom:8px;font-weight:600',function(){window.htConfirmStart(null);}));
    var utgPlayer=seated.find(function(pl){return pl.seat===p.utg;});
    if(utgPlayer){
      body.appendChild(mkB(utgPlayer.name+' straddles ('+bl.straddle+' chips'+(cv?' \u00B7 $'+(bl.straddle*cv/100).toFixed(2)+')':')'),
        'width:100%;padding:13px;background:rgba(201,168,76,0.08);border:1px solid rgba(201,168,76,0.3);color:var(--gold);border-radius:8px;cursor:pointer;font-size:0.85rem;font-family:DM Sans,sans-serif;margin-bottom:8px;font-weight:600',
        function(){window.htConfirmStart(p.utg);}));
    }
  } else {
    body.appendChild(mkB('\u25B6\uFE0F Start Hand','width:100%;padding:13px;background:linear-gradient(135deg,rgba(201,168,76,0.2),rgba(201,168,76,0.08));border:1px solid rgba(201,168,76,0.4);color:var(--gold);border-radius:8px;cursor:pointer;font-size:0.88rem;font-family:DM Sans,sans-serif;margin-bottom:8px;font-weight:700',function(){window.htConfirmStart(null);}));
  }
  body.appendChild(mkB('\u2190 Cancel','background:none;border:none;color:var(--muted);cursor:pointer;font-size:0.8rem;padding:0;margin-top:4px;font-family:DM Sans,sans-serif',function(){hs.view='main';hs._pendingHand=null;renderBody();}));
}

// --- MAIN VIEW ---
function renderMain(body){
  var cv=getChipValue(), seated=getSeated();

  // ── No active hand ──────────────────────────────────────────────────────────
  if(!hs.hand||hs.hand.result){
    if(hs.hand&&hs.hand.result){
      var res=hs.hand.result, rb=document.createElement('div');
      rb.style.cssText='background:rgba(46,204,113,0.07);border:1px solid rgba(46,204,113,0.2);border-radius:10px;padding:12px 14px;margin-bottom:12px;display:flex;align-items:center;gap:10px';
      var ri=document.createElement('div');ri.style.flex='1';
      ri.innerHTML='<div style="font-size:0.85rem;color:var(--green);font-weight:700">\uD83C\uDFC6 Hand #'+hs.hand.hand_no+'</div>'
        +'<div style="font-size:0.75rem;color:var(--muted);margin-top:2px">'+(res.winner_name||'')+' won '+(res.pot_chips||hs.pot)+' chips'+(cv&&res.pot_chips?' ($'+(res.pot_chips*cv/100).toFixed(2)+')':'')+'</div>';
      rb.appendChild(ri);
      rb.appendChild(mkB('\u21A9 Undo','background:none;border:1px solid rgba(231,76,60,0.3);color:var(--red);padding:6px 10px;border-radius:6px;cursor:pointer;font-size:0.72rem;font-family:DM Sans,sans-serif;flex-shrink:0',window.htUndoWinner));
      body.appendChild(rb);
    }
    var nextNo=hs.hand?hs.hand.hand_no+1:1, sb2=document.createElement('button');
    sb2.className='btn-primary';
    sb2.style.cssText='width:100%;padding:16px;font-size:1rem;border-radius:10px;margin-bottom:10px';
    sb2.textContent='\u25B6\uFE0F Start Hand #'+nextNo;
    sb2.addEventListener('click',window.htStartHand);
    body.appendChild(sb2);
    appendLiveCardsToggle(body);
    return;
  }

  var hand=hs.hand, allFolded={}, allAllin={};
  hs.actions.forEach(function(a){
    if(a.action==='fold')  allFolded[a.display_name]=true;
    if(a.action==='allin') allAllin[a.display_name]=true;
  });
  var nextPlayer=computeNextPlayer(hs.street,hs.actions,hand);
  var huMode=seated.length===2;

  // ── HUD: street tabs + board + pot ─────────────────────────────────────────
  var hud=document.createElement('div');
  hud.style.cssText='background:rgba(0,0,0,0.25);border-radius:10px;padding:10px 12px;margin-bottom:8px';

  // Street tabs
  var tabs=document.createElement('div');
  tabs.style.cssText='display:flex;gap:3px;margin-bottom:8px';
  ['pre','flop','turn','river'].forEach(function(s){
    var active=hs.street===s;
    var t=document.createElement('button');
    t.style.cssText='flex:1;padding:5px 4px;border-radius:5px;cursor:pointer;font-size:0.68rem;font-weight:700;text-transform:uppercase;letter-spacing:0.05em;font-family:DM Sans,sans-serif;border:1px solid '+(active?'rgba(201,168,76,0.5)':'rgba(201,168,76,0.1)')+';background:'+(active?'rgba(201,168,76,0.15)':'transparent')+';color:'+(active?'var(--gold)':'var(--muted)');
    t.textContent=s;
    t.addEventListener('click',function(){window.htSetStreet(s);});
    tabs.appendChild(t);
  });
  hud.appendChild(tabs);

  // Board + pot row
  var boardRow=document.createElement('div');
  boardRow.style.cssText='display:flex;gap:5px;align-items:center';
  for(var si=0;si<5;si++){
    var bcard=hs.board[si], isR2=bcard&&(bcard.indexOf('\u2665')>=0||bcard.indexOf('\u2666')>=0);
    var be=document.createElement('div');
    be.style.cssText='width:28px;height:38px;border-radius:3px;display:flex;flex-direction:column;align-items:center;justify-content:center;cursor:pointer;font-weight:700;line-height:1.1;flex-shrink:0;'
      +(bcard?'background:#fff;color:'+(isR2?'#d63031':'#1a1a1a')+';':'background:rgba(255,255,255,0.04);border:1px dashed rgba(201,168,76,0.25);color:rgba(201,168,76,0.25);font-size:0.55rem;');
    if(bcard){
      var rr=document.createElement('div');rr.style.fontSize='0.7rem';rr.textContent=bcard.slice(0,-1);
      var ss=document.createElement('div');ss.style.fontSize='0.8rem';ss.textContent=bcard.slice(-1);
      be.appendChild(rr);be.appendChild(ss);
    } else {
      be.textContent=si<3?'F':si===3?'T':'R';
    }
    be.dataset.slot=si;
    be.addEventListener('click',function(){window.htOpenCards(parseInt(this.dataset.slot));});
    boardRow.appendChild(be);
  }
  if(hs.pot>0){
    var potDiv=document.createElement('div');
    potDiv.style.cssText='margin-left:auto;text-align:right;flex-shrink:0';
    potDiv.innerHTML='<div style="font-size:0.8rem;color:var(--gold);font-weight:700">'+hs.pot+' chips</div>'+(cv?'<div style="font-size:0.65rem;color:var(--muted)">$'+(hs.pot*cv/100).toFixed(2)+'</div>':'');
    boardRow.appendChild(potDiv);
  }
  hud.appendChild(boardRow);

  // Street action log (collapsible)
  if(hs.actions.filter(function(a){return a.street===hs.street&&a.action!=='post'&&a.action!=='straddle';}).length>0){
    renderStreetLog(hud,hs.actions,hs.street);
  }

  body.appendChild(hud);

  // ── Deal next street button ──────────────────────────────────────────────────
  if(!nextPlayer){
    var activePl2=seated.filter(function(p){return !allFolded[p.name];});
    if(activePl2.length>1){
      var so2=['pre','flop','turn','river'], si2=so2.indexOf(hs.street);
      if(si2>=0&&si2<3){
        var ns2=so2[si2+1];
        var dealBtn=document.createElement('button');
        dealBtn.style.cssText='width:100%;padding:11px;background:linear-gradient(135deg,rgba(201,168,76,0.15),rgba(201,168,76,0.05));border:1px solid rgba(201,168,76,0.4);color:var(--gold);border-radius:8px;cursor:pointer;font-size:0.85rem;font-weight:700;font-family:DM Sans,sans-serif;margin-bottom:8px;animation:htPulse 1.5s ease-in-out infinite';
        dealBtn.textContent='\uD83C\uDCA0 Deal '+ns2.charAt(0).toUpperCase()+ns2.slice(1);
        dealBtn.onclick=function(){
          hs.street=ns2;hs.chipInput='';
          var slots={flop:[0,1,2],turn:[3],river:[4]};
          var sl=slots[ns2];
          if(sl){hs.cardTarget=sl[0];hs.view='cards';if(ns2==='flop')hs._autoCardMode='flop';else hs._autoCardMode=null;}
          renderBody();
        };
        body.appendChild(dealBtn);
      }
    }
  }

  // ── Side pots ────────────────────────────────────────────────────────────────
  var sidePots2=calculateSidePots(hs.actions,seated);
  if(sidePots2.length>1){
    var spBox=document.createElement('div');
    spBox.style.cssText='background:rgba(0,0,0,0.2);border:1px solid rgba(201,168,76,0.15);border-radius:8px;padding:8px 12px;margin-bottom:8px';
    var spH=document.createElement('div');
    spH.style.cssText='font-size:0.6rem;text-transform:uppercase;letter-spacing:1.5px;color:rgba(201,168,76,0.6);margin-bottom:6px;font-weight:600';
    spH.textContent='Side pots';
    spBox.appendChild(spH);
    var cv3=getChipValue();
    sidePots2.forEach(function(pot){
      var pr=document.createElement('div');
      pr.style.cssText='display:flex;align-items:center;justify-content:space-between;margin-bottom:4px';
      var ll=document.createElement('div');
      var lb=document.createElement('div');lb.style.cssText='font-size:0.72rem;color:var(--gold);font-weight:700';lb.textContent=pot.label;ll.appendChild(lb);
      var eg=document.createElement('div');eg.style.cssText='display:flex;gap:3px;flex-wrap:wrap';
      pot.eligible.forEach(function(name){
        var chip=document.createElement('div');
        chip.style.cssText='font-size:0.62rem;padding:1px 5px;border-radius:10px;background:rgba(201,168,76,0.12);color:var(--cream2);border:1px solid rgba(201,168,76,0.2)';
        chip.textContent=window.inits?window.inits(name):name.slice(0,2).toUpperCase();chip.title=name;eg.appendChild(chip);
      });
      ll.appendChild(eg);pr.appendChild(ll);
      var rr2=document.createElement('div');rr2.style.cssText='text-align:right;flex-shrink:0';
      var cl=document.createElement('div');cl.style.cssText='font-size:0.78rem;color:var(--gold);font-weight:700';cl.textContent=pot.chips+' chips';rr2.appendChild(cl);
      if(cv3&&pot.chips>0){var dl=document.createElement('div');dl.style.cssText='font-size:0.65rem;color:var(--muted)';dl.textContent='$'+(pot.chips*cv3/100).toFixed(2);rr2.appendChild(dl);}
      pr.appendChild(rr2);spBox.appendChild(pr);
    });
    body.appendChild(spBox);
  }

  // ── Seat rows ────────────────────────────────────────────────────────────────
  var scm={};seated.forEach(function(p){scm[p.name]=0;});
  hs.actions.filter(function(a){return a.street===hs.street;}).forEach(function(a){if(a.chips>0)scm[a.display_name]=(scm[a.display_name]||0)+a.chips;});
  var maxBet=Math.max.apply(null,[0].concat(Object.values(scm)));

  seated.forEach(function(pl){
    var isFolded=allFolded[pl.name], isAllin=allAllin[pl.name], isNext=pl.name===nextPlayer;
    var myChips=scm[pl.name]||0, callAmt=Math.max(0,maxBet-myChips);
    var isD=pl.seat===hand.dealer_seat, isSB=pl.seat===hand.sb_seat, isBB=pl.seat===hand.bb_seat, isStr=hs.straddleSeat&&pl.seat===hs.straddleSeat;
    var sActs=hs.actions.filter(function(a){return a.street===hs.street&&a.display_name===pl.name&&a.action!=='post'&&a.action!=='straddle';});
    var lastAct=sActs[sActs.length-1];
    var postActs=hs.actions.filter(function(a){return a.street==='pre'&&a.display_name===pl.name&&(a.action==='post'||a.action==='straddle');});
    var posted=postActs.length>0?postActs[postActs.length-1].chips:0;

    // Seat row container
    var rowDiv=document.createElement('div');
    var borderCol=isNext?'rgba(201,168,76,0.6)':isAllin?'rgba(46,204,113,0.3)':isFolded?'rgba(255,255,255,0.03)':'rgba(255,255,255,0.06)';
    var bgCol=isNext?'rgba(201,168,76,0.05)':isFolded?'rgba(0,0,0,0.08)':'rgba(255,255,255,0.02)';
    rowDiv.style.cssText='border-radius:8px;margin-bottom:5px;overflow:hidden;border-left:3px solid '+borderCol+';border-top:1px solid rgba(255,255,255,0.04);border-right:1px solid rgba(255,255,255,0.04);border-bottom:1px solid rgba(255,255,255,0.04);background:'+bgCol+';opacity:'+(isFolded?'0.38':'1')+';transition:opacity 0.2s,border-color 0.2s';
    if(isNext) rowDiv.style.animation='htActivePulse 2s ease-in-out infinite';

    // Info row
    var infoRow=document.createElement('div');
    infoRow.style.cssText='display:flex;align-items:center;gap:8px;padding:8px 10px';

    var av=document.createElement('div');
    av.style.cssText='width:28px;height:28px;border-radius:50%;background:linear-gradient(135deg,#7a5820,#5a3010);display:flex;align-items:center;justify-content:center;font-size:0.65rem;font-weight:700;color:var(--cream);flex-shrink:0';
    av.textContent=window.inits?window.inits(pl.name):pl.name.slice(0,2).toUpperCase();
    infoRow.appendChild(av);

    var inf=document.createElement('div');inf.style.flex='1';
    var nl=document.createElement('div');nl.style.cssText='display:flex;align-items:center;gap:3px;flex-wrap:wrap';
    var nm=document.createElement('span');nm.style.cssText='font-size:0.85rem;color:var(--cream);font-weight:600';nm.textContent=pl.name;nl.appendChild(nm);
    if(isD)  nl.appendChild(bdg('D','var(--gold)','#000',true));
    if(isSB&&!huMode) nl.appendChild(bdg('SB','rgba(58,106,170,0.3)','#6aaaee',false));
    if(isBB) nl.appendChild(bdg('BB','rgba(170,58,58,0.3)','#ee8888',false));
    if(isStr)nl.appendChild(bdg('STR','rgba(201,168,76,0.2)','var(--gold)',false));
    if(isAllin)nl.appendChild(bdg('ALL-IN','rgba(46,204,113,0.15)','var(--green)',false));
    if(huMode&&isD)nl.appendChild(bdg('HU\u00B7SB','rgba(58,106,170,0.2)','#6aaaee',false));
    inf.appendChild(nl);

    var sub=document.createElement('div');
    sub.style.cssText='font-size:0.68rem;margin-top:1px;color:'+(isFolded?'var(--red)':isNext?'var(--gold)':'var(--muted)');
    if(isFolded){sub.textContent='\u2715 Folded';}
    else if(isAllin){
      var aiChips=hs.actions.filter(function(a){return a.display_name===pl.name&&a.action==='allin';}).reduce(function(s,a){return s+(a.chips||0);},0);
      sub.textContent='All-in \u00B7 '+aiChips+' chips'+(cv&&aiChips?' ($'+(aiChips*cv/100).toFixed(2)+')':'');
    }
    else if(isNext){
      var isOption=hs.street==='pre'&&(isBB||isStr)&&myChips>=maxBet&&!lastAct;
      if(isOption){sub.textContent='\u25B6 '+(isStr?'Straddler':'BB')+' option \u2014 check or raise';}
      else if(callAmt>0){sub.textContent='\u25B6 To call: '+callAmt+' chips'+(cv?' ($'+(callAmt*cv/100).toFixed(2)+')':'');}
      else{sub.textContent='\u25B6 Your turn';}
    }
    else if(lastAct){sub.textContent=lastAct.action+(lastAct.chips>0?' '+lastAct.chips+' chips'+(cv?' ($'+(lastAct.chips*cv/100).toFixed(2)+')':''):'');}
    else if(posted>0){sub.textContent=(isStr?'Straddle ':'Posted ')+posted+' chips';}
    else{sub.textContent='Waiting';}
    inf.appendChild(sub);
    infoRow.appendChild(inf);

    // Hole cards
    var hc2=hs.holes[pl.name]||[], hcBtn=document.createElement('div');
    hcBtn.style.cssText='display:flex;gap:2px;align-items:center;cursor:pointer;padding:4px 6px;border-radius:5px;border:1px solid rgba(255,255,255,0.07);background:rgba(0,0,0,0.2)';
    hcBtn.dataset.player=pl.name;
    if(hc2.length>0){hc2.forEach(function(c){hcBtn.appendChild(cDiv(c,true));});}
    else{var ph=document.createElement('span');ph.style.cssText='font-size:0.72rem;color:rgba(255,255,255,0.12)';ph.textContent='\uD83C\uDCA0\uD83C\uDCA0';hcBtn.appendChild(ph);}
    hcBtn.addEventListener('click',function(){window.htOpenCards(this.dataset.player);});
    infoRow.appendChild(hcBtn);

    rowDiv.appendChild(infoRow);

    // ── Inline action panel (active player only) ─────────────────────────────
    if(isNext){
      var actPanel=document.createElement('div');
      actPanel.style.cssText='padding:10px 10px 12px;border-top:1px solid rgba(201,168,76,0.12);background:rgba(0,0,0,0.15)';

      var isOption2=maxBet===0||(hs.street==='pre'&&(isBB||isStr)&&myChips>=maxBet&&!lastAct);
      var potSize=hs.pot||blindsInChips().bb*2;
      var halfPot=Math.round(potSize/2), thirdPot=Math.round(potSize/3), fullPot=potSize, twoBB=blindsInChips().bb*2;
      var smartChips=[twoBB,thirdPot,halfPot,fullPot].filter(function(v,i,a){return v>0&&a.indexOf(v)===i;}).sort(function(a,b){return a-b;}).slice(0,4);

      // Action buttons
      var actBtns=document.createElement('div');actBtns.style.cssText='display:flex;gap:4px;margin-bottom:8px';
      var acts=isOption2?[
        {a:'fold', l:'Fold',   bg:'rgba(231,76,60,0.12)', col:'#e74c3c',   br:'rgba(231,76,60,0.3)'},
        {a:'check',l:'Check',  bg:'rgba(107,140,110,0.1)',col:'var(--muted)',br:'var(--border)'},
        {a:'bet',  l:'Bet',    bg:'rgba(201,168,76,0.1)', col:'var(--gold)',br:'rgba(201,168,76,0.3)'},
        {a:'allin',l:'All-in', bg:'rgba(46,204,113,0.1)', col:'var(--green)',br:'rgba(46,204,113,0.3)'},
      ]:[
        {a:'fold', l:'Fold',          bg:'rgba(231,76,60,0.12)', col:'#e74c3c',   br:'rgba(231,76,60,0.3)'},
        {a:'call', l:'Call '+callAmt, bg:'rgba(58,106,170,0.12)',col:'#6aaaee',   br:'rgba(58,106,170,0.3)'},
        {a:'raise',l:'Raise',         bg:'rgba(201,168,76,0.1)', col:'var(--gold)',br:'rgba(201,168,76,0.3)'},
        {a:'allin',l:'All-in',        bg:'rgba(46,204,113,0.1)', col:'var(--green)',br:'rgba(46,204,113,0.3)'},
      ];
      var cn=pl.name;
      acts.forEach(function(cfg){
        var b=document.createElement('button');
        b.style.cssText='flex:1;padding:9px 2px;background:'+cfg.bg+';color:'+cfg.col+';border:1px solid '+cfg.br+';border-radius:6px;cursor:pointer;font-size:0.75rem;font-weight:700;font-family:DM Sans,sans-serif;min-width:0';
        b.textContent=cfg.l;b.dataset.action=cfg.a;b.dataset.player=cn;
        b.addEventListener('click',function(){window.htAct(this.dataset.action,this.dataset.player);});
        actBtns.appendChild(b);
      });
      actPanel.appendChild(actBtns);

      // Smart chip buttons
      var chipRow=document.createElement('div');chipRow.style.cssText='display:flex;gap:3px;flex-wrap:wrap;margin-bottom:7px';
      var chipLabels={};chipLabels[twoBB]='2BB';chipLabels[thirdPot]='1/3';chipLabels[halfPot]='1/2';chipLabels[fullPot]='pot';
      smartChips.forEach(function(n){
        var sel=hs.chipInput===String(n), cb=document.createElement('button');
        var lbl=chipLabels[n]||String(n);
        cb.style.cssText='flex:1;padding:5px 3px;background:'+(sel?'var(--gold)':'rgba(255,255,255,0.05)')+';color:'+(sel?'#000':'var(--cream2)')+';border:1px solid '+(sel?'var(--gold)':'rgba(255,255,255,0.08)')+';border-radius:4px;cursor:pointer;font-size:0.62rem;font-family:DM Sans,sans-serif;text-align:center';
        cb.innerHTML='<div style="font-weight:700;font-size:0.68rem">'+n+'</div><div style="font-size:0.55rem;opacity:0.7">'+lbl+'</div>';
        cb.dataset.chips=n;
        cb.addEventListener('click',function(){window.htSetChip(parseInt(this.dataset.chips));});
        chipRow.appendChild(cb);
      });
      // Fixed chip buttons
      [1,2,5,10,25,50,100].forEach(function(n){
        if(smartChips.indexOf(n)>=0)return;
        var sel=hs.chipInput===String(n), cb=document.createElement('button');
        cb.style.cssText='padding:5px 7px;background:'+(sel?'var(--gold)':'rgba(255,255,255,0.05)')+';color:'+(sel?'#000':'var(--cream2)')+';border:1px solid '+(sel?'var(--gold)':'rgba(255,255,255,0.08)')+';border-radius:4px;cursor:pointer;font-size:0.72rem;font-family:DM Sans,sans-serif;font-weight:'+(sel?'700':'400');
        cb.textContent=String(n);cb.dataset.chips=n;
        cb.addEventListener('click',function(){window.htSetChip(parseInt(this.dataset.chips));});
        chipRow.appendChild(cb);
      });
      actPanel.appendChild(chipRow);

      // Chip input + live dollar preview
      var inpRow=document.createElement('div');inpRow.style.cssText='display:flex;gap:6px;align-items:center';
      var inp=document.createElement('input');inp.type='number';inp.min='0';inp.value=hs.chipInput||'';inp.placeholder='chips...';
      inp.style.cssText='flex:1;background:rgba(4,12,5,0.9);border:1px solid var(--border);color:var(--cream);padding:8px 10px;font-size:0.88rem;border-radius:6px;outline:none;font-family:DM Sans,sans-serif';
      var dollarPrev=document.createElement('span');
      dollarPrev.style.cssText='font-size:0.82rem;color:var(--gold);font-weight:700;white-space:nowrap;min-width:40px;text-align:right';
      var cn2=parseInt(hs.chipInput)||0;
      dollarPrev.textContent=cv&&cn2>0?'$'+(cn2*cv/100).toFixed(2):'';
      inp.addEventListener('input',function(){
        window.htChipInput(this.value);
        var v=parseInt(this.value)||0;
        dollarPrev.textContent=cv&&v>0?'$'+(v*cv/100).toFixed(2):'';
      });
      inpRow.appendChild(inp);
      if(cv) inpRow.appendChild(dollarPrev);
      actPanel.appendChild(inpRow);

      rowDiv.appendChild(actPanel);
    }

    body.appendChild(rowDiv);
  });

  // ── All-folded info ──────────────────────────────────────────────────────────
  if(!nextPlayer){
    var activePl3=seated.filter(function(p){return !allFolded[p.name];});
    if(activePl3.length<=1) body.appendChild(infoBox('All others folded \u2014 declare the winner','rgba(201,168,76,0.07)','rgba(201,168,76,0.2)','var(--gold)'));
  }

  // ── Bottom bar: slim, two buttons only ──────────────────────────────────────
  var btm=document.createElement('div');btm.style.cssText='display:flex;gap:6px;margin-top:8px';
  btm.appendChild(mkB('+ Player','padding:9px 12px;background:rgba(255,255,255,0.03);border:1px solid var(--border);color:var(--muted);border-radius:7px;cursor:pointer;font-size:0.72rem;font-family:DM Sans,sans-serif',function(){hs.view='add_player';renderBody();}));
  btm.appendChild(mkB('Chips'+(hs._chipConfig?' \u25CF':''),'padding:9px 12px;background:rgba(255,255,255,0.03);border:1px solid var(--border);color:'+(hs._chipConfig?'var(--gold)':'var(--muted)')+';border-radius:7px;cursor:pointer;font-size:0.72rem;font-family:DM Sans,sans-serif',function(){hs.view='chip_settings';renderBody();}));
  btm.appendChild(mkB('\u2715 Void','padding:9px 12px;background:rgba(231,76,60,0.06);border:1px solid rgba(231,76,60,0.2);color:var(--red);border-radius:7px;cursor:pointer;font-size:0.72rem;font-family:DM Sans,sans-serif',window.htVoidHand));
  btm.appendChild(mkB('\uD83C\uDFC6 Winner','flex:1;padding:9px;background:rgba(46,204,113,0.08);color:var(--green);border:1px solid rgba(46,204,113,0.25);border-radius:7px;cursor:pointer;font-size:0.82rem;font-weight:700;font-family:DM Sans,sans-serif',function(){hs.view='winner';renderBody();}));
  body.appendChild(btm);

  appendLiveCardsToggle(body);
}

function appendLiveCardsToggle(body){
  var div=document.createElement('div');div.style.cssText='border-top:1px solid rgba(255,255,255,0.05);margin:14px 0 10px';body.appendChild(div);
  var row=document.createElement('div');row.style.cssText='display:flex;align-items:center;justify-content:space-between;padding:4px 2px';
  var lbl=document.createElement('div');
  lbl.innerHTML='<div style="font-size:0.82rem;color:var(--cream);font-weight:600">\uD83D\uDC41 Live card submission</div><div style="font-size:0.7rem;color:var(--muted);margin-top:2px">Players submit hole cards from the live view</div>';
  row.appendChild(lbl);
  var tog=document.createElement('button');
  tog.style.cssText='padding:6px 14px;border-radius:20px;font-size:0.75rem;font-weight:700;cursor:pointer;font-family:DM Sans,sans-serif;flex-shrink:0;border:none;'+(hs.liveCardsEnabled?'background:var(--gold);color:#000':'background:rgba(255,255,255,0.08);color:var(--muted)');
  tog.textContent=hs.liveCardsEnabled?'ON':'OFF';tog.addEventListener('click',window.htToggleLiveCards);row.appendChild(tog);body.appendChild(row);
}

// --- WINNER VIEW ---
function renderWinner(body){
  var cv=gameInfo().chip_value||0;
  var seated=getSeated();
  var pots=calculateSidePots(hs.actions,seated);
  var hasSidePots=pots.length>1;
  body.appendChild(mkB('\u2190 Cancel','background:none;border:none;color:var(--muted);cursor:pointer;font-size:0.85rem;margin-bottom:12px;padding:0;font-family:DM Sans,sans-serif',function(){hs.view='main';hs.potWinners=[];hs.currentPotIndex=0;renderBody();}));
  if(hasSidePots){
    var curPot=pots[hs.currentPotIndex];if(!curPot)return;
    var prog=document.createElement('div');prog.style.cssText='display:flex;gap:4px;margin-bottom:12px';
    pots.forEach(function(pot,i){var dot=document.createElement('div');dot.style.cssText='flex:1;height:4px;border-radius:2px;background:'+(hs.potWinners[i]?'var(--green)':i===hs.currentPotIndex?'var(--gold)':'rgba(255,255,255,0.1)');prog.appendChild(dot);});
    body.appendChild(prog);
    var ph=document.createElement('div');ph.style.cssText='background:rgba(201,168,76,0.08);border:1px solid rgba(201,168,76,0.25);border-radius:10px;padding:12px 14px;margin-bottom:12px';
    var plb=document.createElement('div');plb.style.cssText='font-size:0.7rem;text-transform:uppercase;letter-spacing:1.5px;color:var(--gold);margin-bottom:4px;font-weight:600';plb.textContent=curPot.label+' ('+(hs.currentPotIndex+1)+' of '+pots.length+')';
    var pc=document.createElement('div');pc.style.cssText='font-size:1.1rem;font-weight:700;color:var(--cream)';pc.textContent=curPot.chips+' chips'+(cv?' = $'+(curPot.chips*cv/100).toFixed(2):'');
    var pe=document.createElement('div');pe.style.cssText='font-size:0.72rem;color:var(--muted);margin-top:4px';pe.textContent='Eligible: '+curPot.eligible.join(' \u00B7 ');
    ph.appendChild(plb);ph.appendChild(pc);ph.appendChild(pe);body.appendChild(ph);
    hs.potWinners.filter(Boolean).forEach(function(pw){var row=document.createElement('div');row.style.cssText='display:flex;justify-content:space-between;padding:5px 0;font-size:0.75rem;border-bottom:1px solid rgba(255,255,255,0.04)';row.innerHTML='<span style="color:var(--muted)">'+pw.label+'</span><span style="color:var(--green)">\uD83C\uDFC6 '+pw.winnerName+' \u00B7 '+pw.chips+' chips</span>';body.appendChild(row);});
    var wlbl=document.createElement('div');wlbl.style.cssText='font-size:0.7rem;text-transform:uppercase;letter-spacing:1.5px;color:var(--muted);margin:10px 0 6px';wlbl.textContent='Who wins this pot?';body.appendChild(wlbl);
    curPot.eligible.forEach(function(name){
      var hc3=hs.holes[name]||[],rb2=document.createElement('button');
      rb2.style.cssText='width:100%;display:flex;align-items:center;gap:10px;padding:11px 14px;margin-bottom:6px;background:rgba(255,255,255,0.03);border:1px solid var(--border);border-radius:8px;cursor:pointer;text-align:left';
      rb2.dataset.winner=name;rb2.dataset.potidx=String(hs.currentPotIndex);
      var av2=document.createElement('div');av2.style.cssText='width:32px;height:32px;border-radius:50%;background:linear-gradient(135deg,#7a5820,#5a3010);display:flex;align-items:center;justify-content:center;font-size:0.72rem;font-weight:700;color:var(--cream);flex-shrink:0';av2.textContent=window.inits?window.inits(name):name.slice(0,2).toUpperCase();
      var nm2=document.createElement('span');nm2.style.cssText='flex:1;color:var(--cream);font-size:0.9rem;font-weight:600';nm2.textContent=name;
      rb2.appendChild(av2);rb2.appendChild(nm2);
      if(hc3.length>0){var cr=document.createElement('div');cr.style.cssText='display:flex;gap:3px';hc3.forEach(function(cd){cr.appendChild(cDiv(cd,true));});rb2.appendChild(cr);}
      rb2.addEventListener('click',function(){window.htAssignPotWinner(parseInt(this.dataset.potidx),this.dataset.winner);});body.appendChild(rb2);
    });
    if(curPot.eligible.length>1){var sp=document.createElement('button');sp.style.cssText='width:100%;padding:10px;background:rgba(58,106,170,0.08);border:1px solid rgba(58,106,170,0.2);color:#6aaaee;border-radius:8px;cursor:pointer;font-size:0.8rem;font-family:DM Sans,sans-serif;font-weight:600;margin-top:4px';sp.textContent='\uD83E\uDD1D Split equally';sp.dataset.potidx=String(hs.currentPotIndex);sp.addEventListener('click',function(){window.htAssignPotWinner(parseInt(this.dataset.potidx),'SPLIT: '+curPot.eligible.join(', '));});body.appendChild(sp);}
  } else {
    var h2=document.createElement('div');h2.style.cssText='font-size:1rem;font-weight:700;color:var(--cream);margin-bottom:4px';h2.textContent='\uD83C\uDFC6 Who won?';body.appendChild(h2);
    var pl4=document.createElement('div');pl4.style.cssText='font-size:0.8rem;color:var(--gold);margin-bottom:14px';pl4.textContent='Pot: '+hs.pot+' chips'+(cv?' = $'+(hs.pot*cv/100).toFixed(2):'');body.appendChild(pl4);
    var f2={};hs.actions.forEach(function(a){if(a.action==='fold')f2[a.display_name]=true;});
    var activePl4=getSeated().filter(function(pl){return !f2[pl.name];});
    activePl4.forEach(function(pl){
      var hc3=hs.holes[pl.name]||[],rb2=document.createElement('button');
      rb2.style.cssText='width:100%;display:flex;align-items:center;gap:10px;padding:11px 14px;margin-bottom:6px;background:rgba(255,255,255,0.03);border:1px solid var(--border);border-radius:8px;cursor:pointer;text-align:left';
      rb2.dataset.winner=pl.name;
      var av2=document.createElement('div');av2.style.cssText='width:32px;height:32px;border-radius:50%;background:linear-gradient(135deg,#7a5820,#5a3010);display:flex;align-items:center;justify-content:center;font-size:0.72rem;font-weight:700;color:var(--cream);flex-shrink:0';av2.textContent=window.inits?window.inits(pl.name):pl.name.slice(0,2).toUpperCase();
      var nm2=document.createElement('span');nm2.style.cssText='flex:1;color:var(--cream);font-size:0.9rem;font-weight:600';nm2.textContent=pl.name;
      rb2.appendChild(av2);rb2.appendChild(nm2);
      if(hc3.length>0){var cr=document.createElement('div');cr.style.cssText='display:flex;gap:3px';hc3.forEach(function(c){cr.appendChild(cDiv(c,true));});rb2.appendChild(cr);}
      rb2.addEventListener('click',function(){window.htDeclareWinner(this.dataset.winner);});body.appendChild(rb2);
    });
    if(activePl4.length>1){var sb3=document.createElement('button');sb3.style.cssText='width:100%;padding:10px;background:rgba(58,106,170,0.08);border:1px solid rgba(58,106,170,0.2);color:#6aaaee;border-radius:8px;cursor:pointer;font-size:0.8rem;font-family:DM Sans,sans-serif;font-weight:600;margin-top:4px';sb3.textContent='\uD83E\uDD1D Split pot equally';sb3.addEventListener('click',function(){var names=activePl4.map(function(p){return p.name;}).join(', ');window.htDeclareWinner('SPLIT: '+names);});body.appendChild(sb3);}
  }
}

// --- HISTORY VIEW ---
function renderHistory(body){
  var hdrRow=document.createElement('div');hdrRow.style.cssText='display:flex;justify-content:space-between;align-items:center;margin-bottom:12px';
  hdrRow.appendChild(mkB('\u2190 Back','background:none;border:none;color:var(--gold);cursor:pointer;font-size:0.85rem;padding:0;font-family:DM Sans,sans-serif',function(){hs.view='main';renderBody();}));
  var settled2=hs.history.filter(function(h){return h.result;});
  if(settled2.length>=2){
    hdrRow.appendChild(mkB('Share recap','background:none;border:none;color:var(--muted);cursor:pointer;font-size:0.78rem;padding:0;font-family:DM Sans,sans-serif;text-decoration:underline',exportSession));
  }
  body.appendChild(hdrRow);
  if(!hs.history.length){var em=document.createElement('div');em.style.cssText='text-align:center;color:var(--muted);padding:30px 0;font-size:0.85rem';em.textContent='No hands yet';body.appendChild(em);return;}
  var cv=gameInfo().chip_value||0;
  var settled=hs.history.filter(function(h){return h.result;});
  if(settled.length>0){
    var totalPot=settled.reduce(function(s,h){return s+(h.result.pot_chips||0);},0);
    var winners={};
    settled.forEach(function(h){var w=h.result.winner_name||'';winners[w]=(winners[w]||0)+1;});
    var topW=Object.keys(winners).sort(function(a,b){return winners[b]-winners[a];})[0];
    var stats=document.createElement('div');
    stats.style.cssText='background:rgba(0,0,0,0.2);border:1px solid var(--border);border-radius:8px;padding:10px 12px;margin-bottom:14px;display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px;text-align:center';
    stats.innerHTML='<div><div style="font-size:1rem;font-weight:700;color:var(--gold)">'+settled.length+'</div><div style="font-size:0.6rem;color:var(--muted);text-transform:uppercase">Hands</div></div>'
      +'<div><div style="font-size:0.85rem;font-weight:700;color:var(--green)">'+totalPot+(cv?' <span style="font-size:0.6rem">chips</span>':'')+'</div><div style="font-size:0.6rem;color:var(--muted);text-transform:uppercase">Total pot</div></div>'
      +'<div><div style="font-size:0.75rem;font-weight:700;color:var(--cream);overflow:hidden;text-overflow:ellipsis;white-space:nowrap">'+(topW||'\u2014')+'</div><div style="font-size:0.6rem;color:var(--muted);text-transform:uppercase">Most wins</div></div>';
    body.appendChild(stats);
  }
  hs.history.forEach(function(h){
    var cv2=gameInfo().chip_value||0;
    var row=document.createElement('div');row.style.cssText='background:rgba(255,255,255,0.02);border:1px solid var(--border);border-radius:8px;padding:10px 12px;margin-bottom:6px';
    var top=document.createElement('div');top.style.cssText='display:flex;justify-content:space-between;align-items:center;margin-bottom:4px';
    var num=document.createElement('span');num.style.cssText='color:var(--gold);font-weight:700;font-size:0.9rem';num.textContent='Hand #'+h.hand_no;
    var res=document.createElement('div');res.style.cssText='text-align:right';
    if(h.result){
      var winnerSpan=document.createElement('div');winnerSpan.style.cssText='font-size:0.8rem;color:var(--green);font-weight:700';winnerSpan.textContent='\uD83C\uDFC6 '+(h.result.winner_name||'');
      var potSpan=document.createElement('div');potSpan.style.cssText='font-size:0.68rem;color:var(--muted)';potSpan.textContent=(h.result.pot_chips||0)+' chips'+(cv2&&h.result.pot_chips?' = $'+(h.result.pot_chips*cv2/100).toFixed(2):'');
      res.appendChild(winnerSpan);res.appendChild(potSpan);
    } else {
      var ip=document.createElement('span');ip.style.cssText='font-size:0.75rem;color:var(--amber)';ip.textContent='In progress';res.appendChild(ip);
    }
    top.appendChild(num);top.appendChild(res);row.appendChild(top);
    var meta=document.createElement('div');meta.style.cssText='display:flex;gap:8px;flex-wrap:wrap;font-size:0.68rem;color:var(--muted);margin-bottom:4px';
    if(h.dealer_seat){var ds=getSeated().find(function(p){return p.seat===h.dealer_seat;});meta.innerHTML+='<span>\uD83C\uDFAF Dealer: '+(ds?ds.name:'Seat '+h.dealer_seat)+'</span>';}
    if(h.straddle)meta.innerHTML+='<span style="color:var(--gold)">STR</span>';
    var actCount=(h.actions||[]).filter(function(a){return a.action!=='post'&&a.action!=='straddle';}).length;
    if(actCount>0)meta.innerHTML+='<span>'+actCount+' actions</span>';
    row.appendChild(meta);
    if(h.board&&h.board.length){var br=document.createElement('div');br.style.cssText='display:flex;gap:3px;margin-top:4px';h.board.forEach(function(c){br.appendChild(cDiv(c,true));});row.appendChild(br);}
    var playerNames=[];
    (h.actions||[]).forEach(function(a){if(a.display_name&&playerNames.indexOf(a.display_name)<0)playerNames.push(a.display_name);});
    if(playerNames.length>0){
      var prow2=document.createElement('div');prow2.style.cssText='display:flex;flex-wrap:wrap;gap:4px;margin-top:6px';
      playerNames.forEach(function(pn){
        var pc=document.createElement('button');
        var isWinner=h.result&&(h.result.winner_name===pn||(h.result.winner_name||'').indexOf(pn)>=0);
        pc.style.cssText='padding:3px 8px;background:'+(isWinner?'rgba(46,204,113,0.1)':'rgba(255,255,255,0.03)')+';border:1px solid '+(isWinner?'rgba(46,204,113,0.25)':'var(--border)')+';border-radius:20px;color:'+(isWinner?'var(--green)':'var(--muted)')+';font-size:0.68rem;cursor:pointer;font-family:DM Sans,sans-serif';
        pc.textContent=(isWinner?'\uD83C\uDFC6 ':'')+pn;
        pc.addEventListener('click',function(e){e.stopPropagation();hs._statsPlayer=pn;hs.view='player_stats';renderBody();});
        prow2.appendChild(pc);
      });
      row.appendChild(prow2);
    }
    body.appendChild(row);
  });
}

// --- CARD PICKER VIEW ---
function renderCards(body){
  var isBoard=typeof hs.cardTarget==='number';
  var title=isBoard?(['Flop 1','Flop 2','Flop 3','Turn','River'][hs.cardTarget]||'Card'):hs.cardTarget+' hole cards';
  body.appendChild(mkB('\u2190 '+title,'background:none;border:none;color:var(--muted);cursor:pointer;font-size:0.85rem;margin-bottom:8px;padding:0;font-family:DM Sans,sans-serif',function(){hs.view='main';renderBody();}));
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

// --- PLAYER ROSTER ---
var ROSTER_KEY = 'pkr_ht_roster_' + getGameId();
function getRoster() {
  try { return JSON.parse(localStorage.getItem(ROSTER_KEY)) || []; } catch(e) { return []; }
}
function saveToRoster(name) {
  if (!name || name.length < 1) return;
  var roster = getRoster();
  roster = roster.filter(function(n){ return n !== name; });
  roster.unshift(name);
  if (roster.length > 20) roster = roster.slice(0, 20);
  try { localStorage.setItem(ROSTER_KEY, JSON.stringify(roster)); } catch(e) {}
}
function removeFromRoster(name) {
  var roster = getRoster().filter(function(n){ return n !== name; });
  try { localStorage.setItem(ROSTER_KEY, JSON.stringify(roster)); } catch(e) {}
}

function renderAddPlayerPanel(body) {
  var seated = getSeated();
  var seatedNames = seated.map(function(p){ return p.name; });
  var roster = getRoster();
  var title = document.createElement('div');
  title.style.cssText = 'font-size:0.8rem;text-transform:uppercase;letter-spacing:1.5px;color:var(--muted);margin-bottom:10px';
  title.textContent = 'Add player';
  body.appendChild(title);
  var available = roster.filter(function(n){ return seatedNames.indexOf(n) < 0; });
  if (available.length > 0) {
    var chipRow = document.createElement('div');
    chipRow.style.cssText = 'display:flex;flex-wrap:wrap;gap:6px;margin-bottom:12px';
    available.forEach(function(name) {
      var chip = document.createElement('button');
      chip.style.cssText = 'padding:5px 12px;background:rgba(255,255,255,0.04);border:1px solid var(--border);border-radius:20px;color:var(--cream);font-size:0.78rem;cursor:pointer;font-family:DM Sans,sans-serif';
      chip.textContent = name;
      chip.addEventListener('click', function() { _promptPostAndAdd(name, body); });
      chipRow.appendChild(chip);
    });
    body.appendChild(chipRow);
  }
  var inputRow = document.createElement('div');
  inputRow.style.cssText = 'display:flex;gap:8px;margin-bottom:8px';
  var inp = document.createElement('input');
  inp.type = 'text';
  inp.placeholder = 'New player name...';
  inp.style.cssText = 'flex:1;background:rgba(255,255,255,0.05);border:1px solid var(--border);border-radius:7px;padding:9px 12px;color:var(--cream);font-size:0.85rem;font-family:DM Sans,sans-serif;outline:none';
  var addBtn = document.createElement('button');
  addBtn.style.cssText = 'padding:9px 16px;background:rgba(201,168,76,0.12);border:1px solid rgba(201,168,76,0.3);color:var(--gold);border-radius:7px;cursor:pointer;font-size:0.82rem;font-weight:700;font-family:DM Sans,sans-serif';
  addBtn.textContent = 'Add';
  addBtn.addEventListener('click', function() { var name = inp.value.trim(); if (!name) return; _promptPostAndAdd(name, body); });
  inp.addEventListener('keydown', function(e) { if (e.key === 'Enter') { var name = inp.value.trim(); if (name) _promptPostAndAdd(name, body); } });
  inputRow.appendChild(inp); inputRow.appendChild(addBtn);
  body.appendChild(inputRow);
  body.appendChild(mkB('\u2190 Cancel', 'background:none;border:none;color:var(--muted);cursor:pointer;font-size:0.8rem;padding:0;font-family:DM Sans,sans-serif', function(){ hs.view = 'main'; renderBody(); }));
}

function _promptPostAndAdd(name, body) {
  var seated = getSeated();
  var usedSeats = seated.map(function(p){ return p.seat; });
  var newSeat = 1;
  while (usedSeats.indexOf(newSeat) >= 0) newSeat++;
  var sid = 'seat' + newSeat;
  if (window.state && window.state.players) {
    if (!window.state.players[sid]) window.state.players[sid] = {};
    window.state.players[sid].name = name;
    if (window.state.players[sid].buyin === undefined) window.state.players[sid].buyin = 1;
  }
  saveToRoster(name);
  if (hs.hand) {
    window.htAddPlayerMidSession(sid, name, true);
    hs.view = 'main'; renderBody(); return;
  }
  body.innerHTML = '';
  var msg = document.createElement('div');
  msg.style.cssText = 'font-size:0.88rem;color:var(--cream);margin-bottom:14px;line-height:1.5';
  msg.textContent = name + ' is joining. Do they post a dead big blind now, or wait for their natural blind?';
  body.appendChild(msg);
  body.appendChild(mkB('Post dead BB now', 'width:100%;padding:12px;background:rgba(46,204,113,0.08);border:1px solid rgba(46,204,113,0.25);color:var(--green);border-radius:8px;cursor:pointer;font-size:0.85rem;font-weight:700;font-family:DM Sans,sans-serif;margin-bottom:8px', function(){ window.htAddPlayerMidSession(sid, name, true); hs.view = 'main'; renderBody(); }));
  body.appendChild(mkB('Wait for natural BB', 'width:100%;padding:12px;background:rgba(255,255,255,0.04);border:1px solid var(--border);color:var(--cream);border-radius:8px;cursor:pointer;font-size:0.85rem;font-family:DM Sans,sans-serif;margin-bottom:8px', function(){ window.htAddPlayerMidSession(sid, name, false); hs.view = 'main'; renderBody(); }));
  body.appendChild(mkB('\u2190 Back', 'background:none;border:none;color:var(--muted);cursor:pointer;font-size:0.8rem;padding:0;font-family:DM Sans,sans-serif', function(){ hs.view = 'add_player'; renderBody(); }));
}

// --- SESSION EXPORT ---
function buildSessionRecap() {
  var cv = getChipValue();
  var settled = hs.history.filter(function(h){ return h.result; });
  var totalPot = settled.reduce(function(s,h){ return s+(h.result.pot_chips||0); }, 0);
  var winners = {};
  settled.forEach(function(h){ var w = h.result.winner_name||''; winners[w] = (winners[w]||0) + 1; });
  var lines = [];
  lines.push('PKR Session Recap');
  lines.push('==================');
  lines.push('Hands played: ' + settled.length);
  lines.push('Total chips in play: ' + totalPot + (cv ? ' ($'+(totalPot*cv/100).toFixed(2)+')' : ''));
  lines.push('');
  var board = Object.keys(winners).sort(function(a,b){ return winners[b]-winners[a]; });
  if (board.length) {
    lines.push('Leaderboard');
    lines.push('-----------');
    board.forEach(function(name, i){ lines.push((i+1)+'. '+name+' \u2014 '+winners[name]+' hand'+(winners[name]>1?'s':'')+' won'); });
    lines.push('');
  }
  lines.push('Hand Log');
  lines.push('--------');
  settled.slice().reverse().forEach(function(h){
    var potStr = (h.result.pot_chips||0) + ' chips' + (cv&&h.result.pot_chips?' ($'+(h.result.pot_chips*cv/100).toFixed(2)+')':'');
    var boardStr = h.board&&h.board.length ? ' | Board: '+h.board.join(' ') : '';
    lines.push('Hand #'+h.hand_no+': '+(h.result.winner_name||'?')+' won '+potStr+boardStr);
  });
  lines.push('');
  lines.push('Generated by PKR Reloaded \u2014 ' + new Date().toLocaleString());
  return lines.join('\n');
}

function exportSession() {
  var text = buildSessionRecap();
  if (navigator.share) { navigator.share({ title: 'PKR Session Recap', text: text }).catch(function(){}); return; }
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(text).then(function(){ toast('Recap copied to clipboard'); }).catch(function(){ _fallbackCopy(text); });
    return;
  }
  _fallbackCopy(text);
}

function _fallbackCopy(text) {
  var ta = document.createElement('textarea');
  ta.value = text;
  ta.style.cssText = 'position:absolute;left:-9999px;top:-9999px';
  document.body.appendChild(ta);
  ta.select();
  try { document.execCommand('copy'); toast('Recap copied to clipboard'); }
  catch(e) { toast('Could not copy \u2014 check console'); console.log(text); }
  document.body.removeChild(ta);
}

// --- PER-PLAYER STATS ---
function buildPlayerStats(name) {
  var settled = hs.history.filter(function(h){ return h.result; });
  var handsDealt = settled.filter(function(h){
    return (h.actions||[]).some(function(a){ return a.display_name===name; }) ||
           h.dealer_name===name || h.sb_name===name || h.bb_name===name;
  });
  var handsWon = settled.filter(function(h){ var w = h.result.winner_name||''; return w===name || w.indexOf(name)>=0; });
  var totalWon = handsWon.reduce(function(s,h){ return s+(h.result.pot_chips||0); }, 0);
  var biggestPot = handsWon.reduce(function(m,h){ return Math.max(m, h.result.pot_chips||0); }, 0);
  var vpipHands = 0;
  handsDealt.forEach(function(h){
    var preActs = (h.actions||[]).filter(function(a){ return a.display_name===name && a.street==='pre' && (a.action==='call'||a.action==='bet'||a.action==='raise'||a.action==='allin'); });
    if (preActs.length > 0) vpipHands++;
  });
  var vpip = handsDealt.length > 0 ? Math.round(vpipHands/handsDealt.length*100) : 0;
  var winRate = handsDealt.length > 0 ? Math.round(handsWon.length/handsDealt.length*100) : 0;
  return { name:name, handsDealt:handsDealt.length, handsWon:handsWon.length, winRate:winRate, totalWon:totalWon, biggestPot:biggestPot, vpip:vpip };
}

function renderPlayerStatsCard(body, name) {
  var cv = getChipValue();
  var stats = buildPlayerStats(name);
  body.appendChild(mkB('\u2190 History','background:none;border:none;color:var(--gold);cursor:pointer;font-size:0.85rem;margin-bottom:14px;padding:0;font-family:DM Sans,sans-serif',function(){ hs.view='history'; hs._statsPlayer=null; renderBody(); }));
  var header = document.createElement('div');
  header.style.cssText = 'display:flex;align-items:center;gap:12px;margin-bottom:16px';
  var av = document.createElement('div');
  av.style.cssText = 'width:44px;height:44px;border-radius:50%;background:linear-gradient(135deg,rgba(201,168,76,0.3),rgba(201,168,76,0.1));display:flex;align-items:center;justify-content:center;font-size:1rem;font-weight:700;color:var(--gold);flex-shrink:0';
  av.textContent = name.slice(0,2).toUpperCase();
  var nameDiv = document.createElement('div');
  var nd1 = document.createElement('div');nd1.style.cssText = 'font-size:1rem;font-weight:700;color:var(--cream)';nd1.textContent = name;
  var nd2 = document.createElement('div');nd2.style.cssText = 'font-size:0.72rem;color:var(--muted)';nd2.textContent = 'This session';
  nameDiv.appendChild(nd1); nameDiv.appendChild(nd2);
  header.appendChild(av); header.appendChild(nameDiv);
  body.appendChild(header);
  var grid = document.createElement('div');
  grid.style.cssText = 'display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:14px';
  function statBox(label, value, sub, color) {
    var box = document.createElement('div');
    box.style.cssText = 'background:rgba(255,255,255,0.03);border:1px solid var(--border);border-radius:8px;padding:10px 12px';
    var v = document.createElement('div');v.style.cssText = 'font-size:1.1rem;font-weight:700;color:'+(color||'var(--cream)');v.textContent = value;
    var l = document.createElement('div');l.style.cssText = 'font-size:0.62rem;text-transform:uppercase;letter-spacing:1px;color:var(--muted);margin-top:2px';l.textContent = label;
    box.appendChild(v); box.appendChild(l);
    if (sub) { var s = document.createElement('div');s.style.cssText = 'font-size:0.68rem;color:var(--muted);margin-top:3px';s.textContent = sub;box.appendChild(s); }
    return box;
  }
  grid.appendChild(statBox('Hands played', stats.handsDealt, null, 'var(--cream)'));
  grid.appendChild(statBox('Hands won', stats.handsWon, stats.winRate+'% win rate', 'var(--green)'));
  grid.appendChild(statBox('Total chips won', stats.totalWon, cv&&stats.totalWon?'$'+(stats.totalWon*cv/100).toFixed(2):null, 'var(--gold)'));
  grid.appendChild(statBox('Biggest pot', stats.biggestPot, cv&&stats.biggestPot?'$'+(stats.biggestPot*cv/100).toFixed(2):null, 'var(--gold)'));
  body.appendChild(grid);
  var vpipWrap = document.createElement('div');
  vpipWrap.style.cssText = 'background:rgba(255,255,255,0.03);border:1px solid var(--border);border-radius:8px;padding:10px 12px;margin-bottom:8px';
  var vpipTop = document.createElement('div');vpipTop.style.cssText = 'display:flex;justify-content:space-between;margin-bottom:6px';
  var vpipLabel = document.createElement('span');vpipLabel.style.cssText = 'font-size:0.62rem;text-transform:uppercase;letter-spacing:1px;color:var(--muted)';vpipLabel.textContent = 'VPIP (voluntary pre-flop)';
  var vpipVal = document.createElement('span');vpipVal.style.cssText = 'font-size:0.8rem;font-weight:700;color:'+(stats.vpip>50?'var(--red)':stats.vpip>30?'var(--gold)':'var(--green)');vpipVal.textContent = stats.vpip+'%';
  vpipTop.appendChild(vpipLabel); vpipTop.appendChild(vpipVal);
  var bar = document.createElement('div');bar.style.cssText = 'height:4px;background:rgba(255,255,255,0.08);border-radius:2px;overflow:hidden';
  var fill = document.createElement('div');fill.style.cssText = 'height:100%;width:'+stats.vpip+'%;background:'+(stats.vpip>50?'var(--red)':stats.vpip>30?'var(--gold)':'var(--green)')+';border-radius:2px;transition:width .4s';
  bar.appendChild(fill);
  vpipWrap.appendChild(vpipTop); vpipWrap.appendChild(bar);
  body.appendChild(vpipWrap);
  if (stats.handsDealt === 0) {
    var em = document.createElement('div');em.style.cssText = 'text-align:center;color:var(--muted);font-size:0.82rem;padding:10px 0';em.textContent = 'No completed hands yet for ' + name;body.appendChild(em);
  }
}

// --- CHIP DENOMINATION SETTINGS ---
function renderChipSettings(body) {
  var cfg = hs._chipConfig || {};
  var g = gameInfo();
  var defCV = g.chip_value || 0;
  var defSB = g.small_blind && defCV ? Math.round(g.small_blind/defCV) : (g.small_blind||1);
  var defBB = defSB * 2;
  body.appendChild(mkB('\u2190 Back','background:none;border:none;color:var(--muted);cursor:pointer;font-size:0.85rem;margin-bottom:14px;padding:0;font-family:DM Sans,sans-serif',function(){hs.view='main';renderBody();}));
  var title = document.createElement('div');title.style.cssText = 'font-size:0.8rem;text-transform:uppercase;letter-spacing:1.5px;color:var(--muted);margin-bottom:14px';title.textContent = 'Chip denominations';body.appendChild(title);
  function field(label, key, defaultVal) {
    var wrap = document.createElement('div');wrap.style.cssText = 'margin-bottom:12px';
    var lbl = document.createElement('div');lbl.style.cssText = 'font-size:0.72rem;color:var(--muted);margin-bottom:4px;text-transform:uppercase;letter-spacing:1px';lbl.textContent = label;
    var inp = document.createElement('input');inp.type = 'number';inp.min = '1';inp.placeholder = 'Default: ' + defaultVal;inp.value = cfg[key] != null ? cfg[key] : '';
    inp.style.cssText = 'width:100%;background:rgba(255,255,255,0.05);border:1px solid var(--border);border-radius:7px;padding:9px 12px;color:var(--cream);font-size:0.88rem;font-family:DM Sans,sans-serif;outline:none;box-sizing:border-box';
    inp.dataset.key = key;wrap.appendChild(lbl);wrap.appendChild(inp);body.appendChild(wrap);return inp;
  }
  var cvInp = field('Chip value (cents per chip)', 'chipValue', defCV||5);
  var sbInp = field('Small blind (chips)', 'sb', defSB);
  var bbInp = field('Big blind (chips)', 'bb', defBB);
  sbInp.addEventListener('input', function(){ var sv = parseInt(sbInp.value)||0; if (sv > 0 && !bbInp.value) bbInp.value = sv * 2; });
  var presetLabel = document.createElement('div');presetLabel.style.cssText = 'font-size:0.72rem;color:var(--muted);margin:14px 0 6px;text-transform:uppercase;letter-spacing:1px';presetLabel.textContent = 'Quick presets';body.appendChild(presetLabel);
  var presets = [{label:'1\u00A2/2\u00A2',cv:1,sb:1,bb:2},{label:'5\u00A2/10\u00A2',cv:5,sb:1,bb:2},{label:'25\u00A2/50\u00A2',cv:25,sb:1,bb:2},{label:'$1/$2',cv:100,sb:1,bb:2},{label:'$2/$5',cv:100,sb:2,bb:5},{label:'$5/$10',cv:100,sb:5,bb:10}];
  var prow = document.createElement('div');prow.style.cssText = 'display:flex;flex-wrap:wrap;gap:6px;margin-bottom:16px';
  presets.forEach(function(pr){
    var pb = document.createElement('button');pb.style.cssText = 'padding:5px 12px;background:rgba(255,255,255,0.04);border:1px solid var(--border);border-radius:20px;color:var(--cream);font-size:0.75rem;cursor:pointer;font-family:DM Sans,sans-serif';pb.textContent = pr.label;
    pb.addEventListener('click', function(){ cvInp.value = pr.cv; sbInp.value = pr.sb; bbInp.value = pr.bb; });prow.appendChild(pb);
  });
  body.appendChild(prow);
  body.appendChild(mkB('Save chip settings','width:100%;padding:12px;background:rgba(201,168,76,0.12);border:1px solid rgba(201,168,76,0.3);color:var(--gold);border-radius:8px;cursor:pointer;font-size:0.88rem;font-weight:700;font-family:DM Sans,sans-serif;margin-bottom:8px',function(){
    var cv2 = parseInt(cvInp.value)||0, sb2 = parseInt(sbInp.value)||0, bb2 = parseInt(bbInp.value)||0;
    if (!sb2 || !bb2) { toast('Enter SB and BB values'); return; }
    hs._chipConfig = {chipValue: cv2, sb: sb2, bb: bb2};
    saveSession();
    toast('Chip settings saved \u2014 SB ' + sb2 + ' / BB ' + bb2 + (cv2?' \u00B7 '+cv2+'\u00A2/chip':''));
    hs.view = 'main'; renderBody();
  }));
  if (hs._chipConfig) {
    body.appendChild(mkB('Reset to game defaults','width:100%;padding:10px;background:none;border:1px solid rgba(231,76,60,0.2);color:var(--red);border-radius:8px;cursor:pointer;font-size:0.8rem;font-family:DM Sans,sans-serif',function(){
      hs._chipConfig = null; saveSession(); toast('Chip settings reset to game defaults'); hs.view = 'main'; renderBody();
    }));
  }
}

// --- STREET ACTION LOG ---
function renderStreetLog(body, actions, street) {
  var streetActs = actions.filter(function(a){ return a.street === street && a.action !== 'post' && a.action !== 'straddle'; });
  if (!streetActs.length) return;
  var cv = gameInfo().chip_value||0;
  var wrap = document.createElement('div');wrap.style.cssText = 'margin:0 0 8px;padding:0';
  var isOpen = true;
  var toggle = document.createElement('button');
  toggle.style.cssText = 'background:none;border:none;color:var(--muted);font-size:0.68rem;cursor:pointer;padding:0 0 4px;font-family:DM Sans,sans-serif;text-transform:uppercase;letter-spacing:1px;display:flex;align-items:center;gap:4px';
  var arrow = document.createElement('span');arrow.textContent = '\u25BE';arrow.style.cssText = 'font-size:0.75rem;transition:transform .15s';
  var toggleLabel = document.createElement('span');toggleLabel.textContent = street.charAt(0).toUpperCase() + street.slice(1) + ' action';
  toggle.appendChild(arrow);toggle.appendChild(toggleLabel);
  var logBody = document.createElement('div');logBody.style.cssText = 'display:flex;flex-direction:column;gap:2px;padding:4px 0 2px';
  toggle.addEventListener('click', function(){ isOpen = !isOpen; logBody.style.display = isOpen ? 'flex' : 'none'; arrow.style.transform = isOpen ? '' : 'rotate(-90deg)'; });
  var tokens = [];
  streetActs.forEach(function(a){
    var name = a.display_name || '?';
    var short = name.split(' ')[0];
    var chip = a.chips > 0 ? ' ' + a.chips + (cv ? ' ($'+(a.chips*cv/100).toFixed(2)+')' : '') : '';
    var actionColors = {fold:'#e74c3c',check:'var(--muted)',call:'#6aaaee',bet:'var(--gold)',raise:'var(--gold)',allin:'var(--green)'};
    tokens.push({ text: short + ' ' + a.action + chip, color: actionColors[a.action] || 'var(--cream)' });
  });
  var strip = document.createElement('div');strip.style.cssText = 'display:flex;flex-wrap:wrap;gap:4px;align-items:center';
  tokens.forEach(function(tok, i){
    var span = document.createElement('span');span.style.cssText = 'font-size:0.72rem;color:'+tok.color+';font-family:DM Sans,sans-serif;white-space:nowrap';span.textContent = tok.text;strip.appendChild(span);
    if (i < tokens.length - 1) { var sep = document.createElement('span');sep.style.cssText = 'font-size:0.65rem;color:var(--border);user-select:none';sep.textContent = '\u203A';strip.appendChild(sep); }
  });
  logBody.appendChild(strip);wrap.appendChild(toggle);wrap.appendChild(logBody);body.appendChild(wrap);
}

// --- SIDE POT DISPLAY ---
function computeSidePots(actions, seated) {
  var folded = {}, contrib = {};
  seated.forEach(function(p){ contrib[p.name] = 0; });
  actions.forEach(function(a){ if (a.action === 'fold') folded[a.display_name] = true; if (a.chips > 0) contrib[a.display_name] = (contrib[a.display_name]||0) + a.chips; });
  var allinPlayers = [];
  actions.forEach(function(a){ if (a.action === 'allin' && allinPlayers.indexOf(a.display_name) < 0) allinPlayers.push(a.display_name); });
  if (!allinPlayers.length) return [];
  var levels = allinPlayers.map(function(n){ return contrib[n]||0; }).filter(function(v,i,arr){ return arr.indexOf(v)===i; }).sort(function(a,b){ return a-b; });
  var pots = [], prev = 0;
  levels.forEach(function(level){
    var pot = 0, eligible = [];
    seated.forEach(function(p){ if (folded[p.name]) return; var c = contrib[p.name]||0; pot += Math.min(c, level) - Math.min(c, prev); if (c >= level) eligible.push(p.name); });
    if (pot > 0) pots.push({ chips: pot, eligible: eligible, label: 'Side pot '+(pots.length+1) });
    prev = level;
  });
  var mainPot = 0;
  seated.forEach(function(p){ mainPot += Math.max(0, (contrib[p.name]||0) - prev); });
  if (mainPot > 0) { var mainElig = seated.filter(function(p){ return !folded[p.name]; }).map(function(p){ return p.name; }); pots.push({ chips: mainPot, eligible: mainElig, label: 'Main pot' }); }
  return pots;
}

function renderSidePots(body, actions, seated) {
  var pots = computeSidePots(actions, seated);
  if (!pots.length) return;
  var cv = gameInfo().chip_value||0;
  var wrap = document.createElement('div');wrap.style.cssText = 'margin:6px 0;padding:6px 10px;background:rgba(46,204,113,0.04);border:1px solid rgba(46,204,113,0.15);border-radius:7px';
  var lbl = document.createElement('div');lbl.style.cssText = 'font-size:0.62rem;text-transform:uppercase;letter-spacing:1.5px;color:var(--muted);margin-bottom:5px';lbl.textContent = 'Side pots';wrap.appendChild(lbl);
  pots.forEach(function(pot){
    var row = document.createElement('div');row.style.cssText = 'display:flex;justify-content:space-between;font-size:0.75rem;padding:2px 0';
    var left = document.createElement('span');left.style.color = 'var(--muted)';left.textContent = pot.label + ' \u2014 ' + pot.eligible.join(', ');
    var right = document.createElement('span');right.style.color = 'var(--green)';right.textContent = pot.chips + ' chips' + (cv ? ' ($'+(pot.chips*cv/100).toFixed(2)+')' : '');
    row.appendChild(left);row.appendChild(right);wrap.appendChild(row);
  });
  body.appendChild(wrap);
}

// --- SESSION PERSISTENCE ---
var SESSION_KEY = 'pkr_ht_session';
function saveSession() {
  try {
    localStorage.setItem(SESSION_KEY, JSON.stringify({
      hand:hs.hand, history:hs.history, actions:hs.actions, pot:hs.pot, street:hs.street,
      board:hs.board, holes:hs.holes, straddleSeat:hs.straddleSeat, potWinners:hs.potWinners,
      currentPotIndex:hs.currentPotIndex, _lastHandSummary:hs._lastHandSummary,
      _suggestedDealer:hs._suggestedDealer, _wasHU:hs._wasHU, _chipConfig:hs._chipConfig,
      _pendingJoins:hs._pendingJoins, _pendingLeaves:hs._pendingLeaves,
      savedAt:Date.now(), gameId:getGameId(),
    }));
  } catch(e) {}
}

function restoreSession() {
  try {
    var raw = localStorage.getItem(SESSION_KEY);
    if (!raw) return false;
    var snap = JSON.parse(raw);
    if (!snap || snap.gameId !== getGameId()) return false;
    if (Date.now() - (snap.savedAt||0) > 12*60*60*1000) { localStorage.removeItem(SESSION_KEY); return false; }
    hs.hand=snap.hand||null; hs.history=snap.history||[]; hs.actions=snap.actions||[];
    hs.pot=snap.pot||0; hs.street=snap.street||'pre'; hs.board=snap.board||[];
    hs.holes=snap.holes||{}; hs.straddleSeat=snap.straddleSeat||null;
    hs.potWinners=snap.potWinners||[]; hs.currentPotIndex=snap.currentPotIndex||0;
    hs._lastHandSummary=snap._lastHandSummary||null; hs._suggestedDealer=snap._suggestedDealer||null;
    hs._wasHU=snap._wasHU||false; hs._chipConfig=snap._chipConfig||null;
    hs._pendingJoins=snap._pendingJoins||[]; hs._pendingLeaves=snap._pendingLeaves||[];
    return true;
  } catch(e) { return false; }
}

window.htClearSession = function() {
  try { localStorage.removeItem(SESSION_KEY); } catch(e) {}
  hs.hand=null; hs.history=[]; hs.actions=[]; hs.pot=0; hs.street='pre'; hs.board=[];
  hs.holes={}; hs.straddleSeat=null; hs.potWinners=[]; hs.currentPotIndex=0;
  hs._lastHandSummary=null; hs._suggestedDealer=null; hs._wasHU=false;
  hs._pendingJoins=[]; hs._pendingLeaves=[]; hs._chipConfig=null;
  var ap=document.getElementById('htActionPanel');if(ap)ap.remove();
  document.querySelectorAll('.ht-seat-bet').forEach(function(el){el.remove();});
  toast('Session cleared'); renderBody();
};


// ── PKR-style CSS animations ─────────────────────────────────────────────────
(function(){
  if(document.getElementById('ht-pkr-styles')) return;
  var s=document.createElement('style');s.id='ht-pkr-styles';
  s.textContent='@keyframes htActivePulse{0%,100%{border-left-color:rgba(201,168,76,0.6)}50%{border-left-color:rgba(201,168,76,1)}}@keyframes htPulse{0%,100%{opacity:1}50%{opacity:0.65}}';
  document.head.appendChild(s);
})();

waitForState(function(){
  var g=gameInfo();
  updateUI(g&&g.hand_tracking);
  hs.liveCardsEnabled=!!(g&&g.live_cards_enabled);
  if(g&&g.hand_tracking){
    var restored = restoreSession();
    if(restored){ toast('Session restored'); renderBody(); renderBoardOnFelt&&renderBoardOnFelt(); }
    else { loadCurrentHand(); }
  }

  // Hook into renderTable so felt badges re-apply after seat rebuild
  var _origRenderTable = window.renderTable;
  if(_origRenderTable){
    window.renderTable = function(){
      _origRenderTable.apply(this, arguments);
      if(hs.hand && !hs.hand.result && gameInfo().hand_tracking){
        setTimeout(renderBoardOnFelt, 50);
      }
    };
  }
});

})();