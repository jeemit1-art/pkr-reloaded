// hand-tracker.js — PKR Reloaded Hand Tracker v4
// Correct poker betting round logic

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
function toast(msg) { window.showToast && window.showToast(msg); }

// ── State ─────────────────────────────────────────────────────────────────────
var hs = {
  hand: null,
  history: [],
  actions: [],
  pot: 0,
  street: 'pre',
  board: [],
  holes: {},
  chipInput: '',
  view: 'main', // 'main' | 'cards' | 'winner' | 'history'
  cardTarget: null, // number (board slot) or string (player name)
};

// ── Seated players sorted by seat number ─────────────────────────────────────
function getSeated() {
  if (!window.state || !window.state.players) return [];
  return Object.keys(window.state.players)
    .map(function(sid) {
      var p = window.state.players[sid];
      return p && p.name && (window.pBuyin ? window.pBuyin(p) > 0 : true)
        ? { sid: sid, seat: parseInt(sid.replace('seat',''), 10), name: p.name, p: p }
        : null;
    })
    .filter(Boolean)
    .sort(function(a, b) { return a.seat - b.seat; });
}

// ── Core poker logic: compute who acts next ───────────────────────────────────
//
// Rules:
//  1. Build the action order for this street
//  2. A player's turn is OPEN if they haven't acted yet this street
//  3. A player's turn is RE-OPENED if someone raised after their last action
//     (i.e. there is a bet/raise with chips > their current street contribution)
//  4. All-in players are skipped
//  5. Folded players are skipped
//  6. Street ends when no player has an open or re-opened turn
//
function computeNextPlayer(street, actions) {
  var seated = getSeated();
  if (!seated.length || !hs.hand) return null;

  var seats = seated.map(function(p) { return p.seat; });
  var dSeat  = hs.hand.dealer_seat;
  var sbSeat = hs.hand.sb_seat;
  var bbSeat = hs.hand.bb_seat;

  // Build per-player state from actions this street
  var streetActs = actions.filter(function(a) { return a.street === street; });
  var allActs    = actions; // all streets

  // Folded players (any street)
  var folded = {};
  allActs.forEach(function(a) { if (a.action === 'fold') folded[a.display_name] = true; });

  // All-in players
  var allin = {};
  allActs.forEach(function(a) { if (a.action === 'allin') allin[a.display_name] = true; });

  // Active players = seated, not folded, not all-in
  var active = seated.filter(function(p) { return !folded[p.name]; });
  if (active.length <= 1) return null; // hand over

  var canAct = active.filter(function(p) { return !allin[p.name]; });
  if (!canAct.length) return null;

  // Chips each player has put in this street
  var streetChips = {};
  seated.forEach(function(p) { streetChips[p.name] = 0; });
  streetActs.forEach(function(a) {
    if (a.chips > 0) streetChips[a.display_name] = (streetChips[a.display_name] || 0) + a.chips;
  });

  // Highest bet this street
  var maxBet = Math.max.apply(null, [0].concat(Object.values(streetChips)));

  // Last aggressor index (player who made the last bet/raise)
  // The action order circles back to them — they close the action
  var lastAggressorName = null;
  for (var i = streetActs.length - 1; i >= 0; i--) {
    var a = streetActs[i];
    if (a.action === 'bet' || a.action === 'raise' || a.action === 'allin') {
      lastAggressorName = a.display_name;
      break;
    }
  }

  // Who has acted this street (at least once, not counting posts)
  var hasActed = {};
  streetActs.forEach(function(a) {
    if (a.action !== 'post') hasActed[a.display_name] = true;
  });

  // Build action order for this street
  // Pre-flop: UTG (one after BB) goes first
  // Post-flop: SB (or next active after dealer) goes first
  function nextSeatAfter(targetSeat, playerList) {
    var pSeats = playerList.map(function(p) { return p.seat; });
    var idx = seats.indexOf(targetSeat);
    for (var j = 1; j <= seats.length; j++) {
      var ns = seats[(idx + j) % seats.length];
      var found = playerList.find(function(p) { return p.seat === ns; });
      if (found) return found;
    }
    return playerList[0];
  }

  var orderStart;
  if (street === 'pre') {
    // UTG = player after BB
    var utg = nextSeatAfter(bbSeat, canAct);
    orderStart = canAct.indexOf(utg);
  } else {
    // SB or next active after dealer
    var sbPlayer = canAct.find(function(p) { return p.seat === sbSeat; });
    if (sbPlayer) {
      orderStart = canAct.indexOf(sbPlayer);
    } else {
      var nextAfterD = nextSeatAfter(dSeat, canAct);
      orderStart = canAct.indexOf(nextAfterD);
    }
  }

  // Build ordered list starting from orderStart
  var ordered = [];
  for (var k = 0; k < canAct.length; k++) {
    ordered.push(canAct[(orderStart + k) % canAct.length]);
  }

  // Find the first player in order who still needs to act:
  // - hasn't acted yet (not counting posts), OR
  // - has acted but their bet is less than maxBet (needs to call/raise/fold)
  // Special pre-flop case: BB gets to act even if no raise (can check or raise)
  for (var m = 0; m < ordered.length; m++) {
    var pl = ordered[m];
    var myChips = streetChips[pl.name] || 0;

    // Skip if they've already matched and acted (and aren't the last aggressor)
    var acted = hasActed[pl.name];
    var matched = myChips >= maxBet;

    if (!acted) {
      // Pre-flop special: BB posted 2 chips as a 'post' action
      // They still need to act (check or raise) unless someone raised above their post
      if (street === 'pre' && pl.seat === bbSeat && myChips >= maxBet && maxBet === myChips) {
        // BB has option to raise — but only if no one has raised above their post
        // Check if BB has actually taken their action turn (not just posted)
        var bbVoluntaryActs = streetActs.filter(function(a) { return a.display_name === pl.name && a.action !== 'post'; });
        if (bbVoluntaryActs.length === 0) return pl.name; // BB still has option
      } else {
        return pl.name;
      }
    } else if (!matched) {
      // Has acted but needs to respond to a raise
      return pl.name;
    }
    // else: acted and matched — skip
  }

  return null; // street complete
}

// ── Load / sync ───────────────────────────────────────────────────────────────
function loadCurrentHand() {
  return htApi('/games/' + getGameId() + '/hands').then(function(hands) {
    hs.history = hands || [];
    if (hands && hands.length > 0) {
      var h = hands[0];
      hs.hand    = h;
      hs.actions = h.actions || [];
      hs.pot     = h.pot_chips || 0;
      hs.board   = h.board || [];
      try {
        hs.holes = h.result && h.result.hole_cards
          ? JSON.parse(typeof h.result.hole_cards === 'string' ? h.result.hole_cards : JSON.stringify(h.result.hole_cards))
          : {};
      } catch(e) { hs.holes = {}; }
    }
    renderBoardOnFelt();
  }).catch(function(e) { console.warn('loadCurrentHand:', e.message); });
}

// ── Toggle tracking ───────────────────────────────────────────────────────────
window.toggleHandTracking = function() {
  htApi('/games/' + getGameId() + '/tracking/toggle', {method:'POST'}).then(function(r) {
    if (window.state && window.state.game) {
      window.state.game.hand_tracking = r.hand_tracking;
      if (window.saveState) window.saveState();
    }
    updateTrackingUI(r.hand_tracking);
    toast(r.hand_tracking ? '🃏 Hand tracking ON' : 'Hand tracking OFF');
    if (r.hand_tracking) loadCurrentHand();
  }).catch(function(e) { toast('⚠️ ' + e.message); });
};

function updateTrackingUI(on) {
  var btn  = document.getElementById('handTrackerBtn');
  var tBtn = document.getElementById('trackHandsBtn');
  if (btn)  btn.style.display = on ? '' : 'none';
  if (tBtn) tBtn.style.color  = on ? 'var(--gold)' : 'var(--muted)';
}

// ── Open / close sheet ────────────────────────────────────────────────────────
window.openHandTracker = function() {
  var p = (window.state && window.state.game && window.state.game.hand_tracking)
    ? loadCurrentHand() : Promise.resolve();
  p.then(function() { hs.view = 'main'; renderBody(); openSheet('handTrackerSheet'); });
};
window.closeHandTracker = function() { closeSheet('handTrackerSheet'); };

function openSheet(id)  { var s = document.getElementById(id); if (s) s.classList.add('open'); }
function closeSheet(id) { var s = document.getElementById(id); if (s) s.classList.remove('open'); }

// ── Start hand ────────────────────────────────────────────────────────────────
window.htStartHand = function() {
  var seated = getSeated();
  if (seated.length < 2) { toast('Need at least 2 players'); return; }
  var seats = seated.map(function(p) { return p.seat; });
  var last  = (window.state.game && window.state.game.currentDealerSeat) || 0;
  var next  = seats.find(function(s) { return s > last; }) || seats[0];
  var di    = seats.indexOf(next);
  var sb    = seats[(di + 1) % seats.length];
  var bb    = seats[(di + 2) % seats.length];

  htApi('/games/' + getGameId() + '/hands', {
    method: 'POST',
    body: JSON.stringify({dealer_seat: next, sb_seat: sb, bb_seat: bb, mode: 'full'}),
  }).then(function(h) {
    if (window.state.game) window.state.game.currentDealerSeat = next;
    hs.hand    = h;
    hs.actions = [];
    hs.pot     = 0;
    hs.board   = [];
    hs.holes   = {};
    hs.street  = 'pre';
    hs.chipInput = '';
    hs.view    = 'main';
    hs.history.unshift(h);
    // Auto-post SB and BB
    autoPost(h, seated, function() {
      renderBody();
      renderBoardOnFelt();
    });
    toast('Hand #' + h.hand_no + ' started');
  }).catch(function(e) { toast('⚠️ ' + e.message); });
};

function autoPost(hand, seated, cb) {
  var game    = window.state && window.state.game;
  var sbPlayer = seated.find(function(p) { return p.seat === hand.sb_seat; });
  var bbPlayer = seated.find(function(p) { return p.seat === hand.bb_seat; });

  // Determine blind sizes in chips
  // chip_value is cents per chip. small_blind is in cents.
  var sbChips = 1, bbChips = 2;
  if (game && game.small_blind && game.chip_value && game.chip_value > 0) {
    sbChips = Math.round(game.small_blind / game.chip_value);
    bbChips = sbChips * 2;
  } else if (game && game.small_blind && game.big_blind) {
    // Fallback: use ratio
    sbChips = game.small_blind;
    bbChips = game.big_blind;
  }

  var posts = [];
  if (sbPlayer) posts.push({name: sbPlayer.name, userId: sbPlayer.p.userId, chips: sbChips});
  if (bbPlayer) posts.push({name: bbPlayer.name, userId: bbPlayer.p.userId, chips: bbChips});

  function doPost(i) {
    if (i >= posts.length) { cb && cb(); return; }
    var p = posts[i];
    htApi('/games/' + getGameId() + '/hands/' + hand.id + '/actions', {
      method: 'POST',
      body: JSON.stringify({user_id: p.userId || null, display_name: p.name, street: 'pre', action: 'post', chips: p.chips}),
    }).then(function(r) {
      hs.actions = r.actions;
      hs.pot     = r.pot_chips;
      doPost(i + 1);
    }).catch(function() { doPost(i + 1); });
  }
  doPost(0);
}

// ── Void ──────────────────────────────────────────────────────────────────────
window.htVoidHand = function() {
  if (!hs.hand) return;
  if (!confirm('Void hand #' + hs.hand.hand_no + '?')) return;
  htApi('/games/' + getGameId() + '/hands/' + hs.hand.id, {method:'DELETE'}).then(function() {
    hs.hand = null; hs.actions = []; hs.pot = 0; hs.board = []; hs.holes = {};
    return htApi('/games/' + getGameId() + '/hands');
  }).then(function(hands) {
    hs.history = hands || [];
    if (hands && hands.length > 0) hs.hand = hands[0];
    renderBody(); renderBoardOnFelt();
    toast('Hand voided');
  }).catch(function(e) { toast('⚠️ ' + e.message); });
};

// ── Undo ──────────────────────────────────────────────────────────────────────
window.htUndoAction = function() {
  if (!hs.hand) return;
  htApi('/games/' + getGameId() + '/hands/' + hs.hand.id + '/actions/last', {method:'DELETE'}).then(function(r) {
    hs.actions = r.actions;
    hs.pot     = r.pot_chips;
    renderBody(); renderBoardOnFelt();
  }).catch(function(e) { toast('⚠️ ' + e.message); });
};

// ── Record action ─────────────────────────────────────────────────────────────
window.htAct = function(action, playerName) {
  if (!hs.hand) return;
  var chips = parseInt(hs.chipInput) || 0;
  if ((action === 'bet' || action === 'raise' || action === 'call') && chips === 0) {
    // Try to auto-fill call amount
    if (action === 'call') {
      var streetChips = {};
      hs.actions.filter(function(a){return a.street===hs.street;}).forEach(function(a){
        if (a.chips > 0) streetChips[a.display_name] = (streetChips[a.display_name]||0) + a.chips;
      });
      var maxBet2 = Math.max.apply(null, [0].concat(Object.values(streetChips)));
      var myChips2 = streetChips[playerName] || 0;
      chips = maxBet2 - myChips2;
      if (chips <= 0) { toast('Nothing to call'); return; }
    } else {
      toast('Enter chip amount'); return;
    }
  }

  var pEntry = null;
  Object.values(window.state.players).forEach(function(p) { if (p && p.name === playerName) pEntry = p; });

  htApi('/games/' + getGameId() + '/hands/' + hs.hand.id + '/actions', {
    method: 'POST',
    body: JSON.stringify({user_id: pEntry ? pEntry.userId : null, display_name: playerName, street: hs.street, action: action, chips: chips}),
  }).then(function(r) {
    hs.actions   = r.actions;
    hs.pot       = r.pot_chips;
    hs.chipInput = '';
    renderBody(); renderBoardOnFelt();
  }).catch(function(e) { toast('⚠️ ' + e.message); });
};

// ── Street ────────────────────────────────────────────────────────────────────
window.htSetStreet = function(s) { hs.street = s; hs.chipInput = ''; renderBody(); };
window.htSetChip   = function(n) { hs.chipInput = String(n); renderBody(); };
window.htChipInput = function(v) { hs.chipInput = v; renderBody(); };

// ── Cards ─────────────────────────────────────────────────────────────────────
window.htOpenCards = function(target) { hs.cardTarget = target; hs.view = 'cards'; renderBody(); };
window.htPickCard  = function(card) {
  var allDealt = hs.board.concat(Object.values(hs.holes).reduce(function(a,v){return a.concat(v);},[]));
  if (typeof hs.cardTarget === 'number') {
    var b = hs.board.slice();
    var ex = b.indexOf(card);
    if (ex !== -1) b.splice(ex, 1); else b[hs.cardTarget] = card;
    hs.board = b.filter(Boolean);
    if (hs.hand) htApi('/games/' + getGameId() + '/hands/' + hs.hand.id + '/board', {method:'PUT', body:JSON.stringify({board:hs.board})}).catch(function(){});
    renderBoardOnFelt();
  } else {
    var hc = (hs.holes[hs.cardTarget] || []).slice();
    var ix = hc.indexOf(card);
    if (ix !== -1) hc.splice(ix, 1); else if (hc.length < 2) hc.push(card);
    hs.holes[hs.cardTarget] = hc;
  }
  hs.view = 'main';
  renderBody();
};

// ── Winner ────────────────────────────────────────────────────────────────────
window.htDeclareWinner = function(name) {
  if (!hs.hand) return;
  var pEntry = null;
  Object.values(window.state.players).forEach(function(p) { if (p && p.name === name) pEntry = p; });
  htApi('/games/' + getGameId() + '/hands/' + hs.hand.id + '/result', {
    method: 'POST',
    body: JSON.stringify({winner_user_id: pEntry ? pEntry.userId : null, winner_name: name, hole_cards: hs.holes, split_pot: false}),
  }).then(function() {
    hs.hand.result = {winner_name: name, pot_chips: hs.pot};
    hs.view = 'main';
    renderBody(); renderBoardOnFelt();
    return htApi('/games/' + getGameId() + '/hands');
  }).then(function(h) { hs.history = h || []; toast('🏆 ' + name + ' wins ' + hs.pot + ' chips!'); })
  .catch(function(e) { toast('⚠️ ' + e.message); });
};
window.htUndoWinner = function() {
  if (!hs.hand || !hs.hand.result) return;
  htApi('/games/' + getGameId() + '/hands/' + hs.hand.id + '/result', {method:'DELETE'}).then(function(h) {
    hs.hand = h; hs.actions = h.actions||[]; hs.pot = h.pot_chips||0; hs.board = h.board||[];
    hs.view = 'main'; renderBody(); renderBoardOnFelt(); toast('Winner undone');
  }).catch(function(e) { toast('⚠️ ' + e.message); });
};

// ── Felt board cards ──────────────────────────────────────────────────────────
function renderBoardOnFelt() {
  var tc = document.getElementById('tableCenter');
  if (!tc) return;
  ['htBoard','htPot'].forEach(function(id){ var el=document.getElementById(id); if(el) el.remove(); });
  if (!hs.hand || hs.hand.result) return;

  var row = document.createElement('div');
  row.id = 'htBoard';
  row.style.cssText = 'display:flex;gap:4px;justify-content:center;margin-top:8px;pointer-events:all';

  for (var i = 0; i < 5; i++) {
    var card  = hs.board[i];
    var isRed = card && (card.indexOf('\u2665')>=0||card.indexOf('\u2666')>=0);
    var el = document.createElement('div');
    el.style.cssText = 'width:clamp(20px,4.5vw,30px);height:clamp(30px,6.8vw,46px);border-radius:3px;'
      + 'display:flex;flex-direction:column;align-items:center;justify-content:center;cursor:pointer;font-weight:700;line-height:1.1;'
      + (card
        ? 'background:#fff;color:'+(isRed?'#d63031':'#1a1a1a')+';'
        : 'background:rgba(255,255,255,0.06);border:1px dashed rgba(201,168,76,0.3);color:rgba(201,168,76,0.25);');
    if (card) {
      var rank = card.slice(0,-1); var suit = card.slice(-1);
      var rd = document.createElement('div'); rd.style.fontSize='clamp(8px,1.8vw,12px)'; rd.textContent=rank;
      var sd = document.createElement('div'); sd.style.fontSize='clamp(9px,2vw,13px)'; sd.textContent=suit;
      el.appendChild(rd); el.appendChild(sd);
    } else {
      el.style.fontSize='clamp(5px,1vw,7px)'; el.style.textAlign='center';
      el.textContent = i<3?'F':i===3?'T':'R';
    }
    el.dataset.slot = i;
    el.addEventListener('click', function(){ window.htOpenCards(parseInt(this.dataset.slot)); openSheet('handTrackerSheet'); });
    row.appendChild(el);
  }
  tc.appendChild(row);

  if (hs.pot > 0) {
    var cv = (window.state.game&&window.state.game.chip_value)||0;
    var p = document.createElement('div');
    p.id = 'htPot';
    p.style.cssText = 'font-size:clamp(0.6rem,1.3vw,0.72rem);color:var(--gold);margin-top:3px;font-weight:600;pointer-events:none';
    p.textContent = 'POT '+hs.pot+(cv?' · $'+(hs.pot*cv/100).toFixed(2):'');
    tc.appendChild(p);
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function cardDiv(card, small) {
  var isRed = card&&(card.indexOf('\u2665')>=0||card.indexOf('\u2666')>=0);
  var d = document.createElement('div');
  if (card) {
    d.style.cssText='background:#fff;border-radius:2px;padding:'+(small?'1px 3px':'2px 5px')+';font-size:'+(small?'0.65rem':'0.82rem')+';font-weight:700;color:'+(isRed?'#d63031':'#1a1a1a')+';display:inline-flex;align-items:center;line-height:1';
    d.textContent=card;
  } else {
    d.style.cssText='width:'+(small?'16px':'20px')+';height:'+(small?'22px':'28px')+';background:rgba(255,255,255,0.07);border:1px dashed rgba(201,168,76,0.3);border-radius:2px;display:inline-flex;align-items:center;justify-content:center;font-size:8px;color:rgba(201,168,76,0.3)';
    d.textContent='?';
  }
  return d;
}

function badge(txt, bg, col, round) {
  var b = document.createElement('span');
  b.style.cssText = 'font-size:0.58rem;font-weight:700;padding:1px 5px;border-radius:'+(round?'50%':'3px')+';background:'+bg+';color:'+col+';display:inline-flex;align-items:center;justify-content:center;'+(round?'width:16px;height:16px;':'');
  b.textContent = txt;
  return b;
}

function btn(label, style, onClick) {
  var b = document.createElement('button');
  b.style.cssText = style;
  b.textContent = label;
  b.addEventListener('click', onClick);
  return b;
}

// ── Main render dispatcher ────────────────────────────────────────────────────
function renderBody() {
  var body = document.getElementById('handTrackerBody');
  if (!body) return;
  body.innerHTML = '';
  var undoBtn = document.getElementById('undoActionBtn');
  if (undoBtn) undoBtn.style.display = (hs.hand && !hs.hand.result && hs.actions.length > 0) ? '' : 'none';

  if (hs.view === 'cards')   { renderCards(body); return; }
  if (hs.view === 'winner')  { renderWinner(body); return; }
  if (hs.view === 'history') { renderHistory(body); return; }
  renderMain(body);
}

// ── Main view ─────────────────────────────────────────────────────────────────
function renderMain(body) {
  var cv = (window.state&&window.state.game&&window.state.game.chip_value)||0;

  // ── No hand / completed hand ──────────────────────────────────────────────
  if (!hs.hand || hs.hand.result) {
    if (hs.hand && hs.hand.result) {
      var res = hs.hand.result;
      var rb = document.createElement('div');
      rb.style.cssText='background:rgba(46,204,113,0.07);border:1px solid rgba(46,204,113,0.2);border-radius:10px;padding:12px 14px;margin-bottom:12px;display:flex;align-items:center;gap:10px';
      var ri = document.createElement('div'); ri.style.flex='1';
      ri.innerHTML='<div style="font-size:0.85rem;color:var(--green);font-weight:700">\ud83c\udfc6 Hand #'+hs.hand.hand_no+'</div><div style="font-size:0.75rem;color:var(--muted);margin-top:2px">'+(res.winner_name||'')+' won '+(res.pot_chips||hs.pot)+' chips</div>';
      rb.appendChild(ri);
      rb.appendChild(btn('↩ Undo','background:none;border:1px solid rgba(231,76,60,0.3);color:var(--red);padding:6px 10px;border-radius:6px;cursor:pointer;font-size:0.72rem;font-family:DM Sans,sans-serif;flex-shrink:0', window.htUndoWinner));
      body.appendChild(rb);
    }
    var nextNo = hs.hand ? hs.hand.hand_no + 1 : 1;
    var sb2 = document.createElement('button');
    sb2.className = 'btn-primary';
    sb2.style.cssText='width:100%;padding:16px;font-size:1rem;border-radius:10px';
    sb2.textContent = '\u25b6\ufe0f Start Hand #' + nextNo;
    sb2.addEventListener('click', window.htStartHand);
    body.appendChild(sb2);
    return;
  }

  // ── Active hand ───────────────────────────────────────────────────────────
  var hand = hs.hand;
  var allFolded = {};
  hs.actions.forEach(function(a){ if(a.action==='fold') allFolded[a.display_name]=true; });
  var allAllin = {};
  hs.actions.forEach(function(a){ if(a.action==='allin') allAllin[a.display_name]=true; });

  var nextPlayer = computeNextPlayer(hs.street, hs.actions);
  var seated     = getSeated();

  // Street tabs
  var tabs = document.createElement('div');
  tabs.style.cssText='display:flex;gap:3px;margin-bottom:10px';
  ['pre','flop','turn','river'].forEach(function(s){
    var active = hs.street === s;
    var t = btn(s,
      'flex:1;padding:7px 4px;border-radius:6px;cursor:pointer;font-size:0.7rem;font-weight:700;text-transform:uppercase;letter-spacing:0.05em;font-family:DM Sans,sans-serif;'
      +'border:1px solid '+(active?'rgba(201,168,76,0.5)':'rgba(201,168,76,0.1)')+';'
      +'background:'+(active?'rgba(201,168,76,0.15)':'transparent')+';'
      +'color:'+(active?'var(--gold)':'var(--muted)'),
      function(){ window.htSetStreet(this.textContent); });
    t.textContent = s;
    tabs.appendChild(t);
  });
  body.appendChild(tabs);

  // Board row
  var boardRow = document.createElement('div');
  boardRow.style.cssText='display:flex;gap:6px;align-items:center;background:rgba(0,0,0,0.25);border-radius:8px;padding:9px 12px;margin-bottom:10px';
  var bl = document.createElement('div');
  bl.style.cssText='font-size:0.6rem;text-transform:uppercase;letter-spacing:1.5px;color:var(--muted);flex-shrink:0;margin-right:2px';
  bl.textContent='Board';
  boardRow.appendChild(bl);

  var bc = document.createElement('div');
  bc.style.cssText='display:flex;gap:4px;flex:1';
  for (var si=0; si<5; si++) {
    var bcard = hs.board[si];
    var isR2 = bcard&&(bcard.indexOf('\u2665')>=0||bcard.indexOf('\u2666')>=0);
    var be = document.createElement('div');
    be.style.cssText='width:26px;height:36px;border-radius:3px;display:flex;flex-direction:column;align-items:center;justify-content:center;cursor:pointer;font-weight:700;line-height:1.1;'
      +(bcard?'background:#fff;color:'+(isR2?'#d63031':'#1a1a1a')+';font-size:0.7rem;':'background:rgba(255,255,255,0.04);border:1px dashed rgba(201,168,76,0.25);color:rgba(201,168,76,0.3);font-size:0.55rem;');
    if (bcard) {
      var rr=document.createElement('div');rr.textContent=bcard.slice(0,-1);rr.style.fontSize='0.7rem';
      var ss=document.createElement('div');ss.textContent=bcard.slice(-1);ss.style.fontSize='0.8rem';
      be.appendChild(rr);be.appendChild(ss);
    } else { be.textContent = si<3?'F':si===3?'T':'R'; }
    be.dataset.slot=si;
    be.addEventListener('click',function(){ window.htOpenCards(parseInt(this.dataset.slot)); });
    bc.appendChild(be);
  }
  boardRow.appendChild(bc);

  if (hs.pot>0) {
    var pl=document.createElement('div');
    pl.style.cssText='font-size:0.75rem;color:var(--gold);font-weight:700;text-align:right;flex-shrink:0';
    pl.innerHTML='<div>'+hs.pot+'</div><div style="font-size:0.6rem;color:var(--muted);font-weight:400">'+(cv?'$'+(hs.pot*cv/100).toFixed(2):'chips')+'</div>';
    boardRow.appendChild(pl);
  }
  body.appendChild(boardRow);

  // ── Compute street-level chip info ────────────────────────────────────────
  var streetChipsMap = {};
  seated.forEach(function(p){ streetChipsMap[p.name]=0; });
  hs.actions.filter(function(a){return a.street===hs.street;}).forEach(function(a){
    if (a.chips>0) streetChipsMap[a.display_name]=(streetChipsMap[a.display_name]||0)+a.chips;
  });
  var maxBet = Math.max.apply(null, [0].concat(Object.values(streetChipsMap)));

  // ── Player rows ───────────────────────────────────────────────────────────
  seated.forEach(function(pl) {
    var isFolded = allFolded[pl.name];
    var isAllin  = allAllin[pl.name];
    var isNext   = pl.name === nextPlayer;
    var myStreetChips = streetChipsMap[pl.name] || 0;
    var needsToCall = !isFolded && !isAllin && myStreetChips < maxBet;

    // Get last action this street
    var streetActs2 = hs.actions.filter(function(a){ return a.street===hs.street&&a.display_name===pl.name&&a.action!=='post'; });
    var lastAct2 = streetActs2[streetActs2.length-1];
    var postAct  = hs.actions.filter(function(a){ return a.street==='pre'&&a.display_name===pl.name&&a.action==='post'; });
    var posted   = postAct.length>0 ? postAct[postAct.length-1].chips : 0;

    var isD  = pl.seat===hand.dealer_seat;
    var isSB = pl.seat===hand.sb_seat;
    var isBB = pl.seat===hand.bb_seat;

    var rowDiv = document.createElement('div');
    rowDiv.style.cssText = 'border-radius:8px;margin-bottom:4px;overflow:hidden;'
      +'border:1px solid '+(isNext?'rgba(201,168,76,0.35)':'rgba(255,255,255,0.05)')+';'
      +'background:'+(isNext?'rgba(201,168,76,0.06)':isFolded?'rgba(0,0,0,0.15)':'rgba(255,255,255,0.02)')+';'
      +'opacity:'+(isFolded?'0.45':'1');

    // Player info row
    var infoRow = document.createElement('div');
    infoRow.style.cssText='display:flex;align-items:center;gap:8px;padding:8px 10px';

    var av=document.createElement('div');
    av.style.cssText='width:30px;height:30px;border-radius:50%;background:linear-gradient(135deg,#7a5820,#5a3010);display:flex;align-items:center;justify-content:center;font-size:0.68rem;font-weight:700;color:var(--cream);flex-shrink:0';
    av.textContent=window.inits?window.inits(pl.name):pl.name.slice(0,2).toUpperCase();
    infoRow.appendChild(av);

    var inf=document.createElement('div'); inf.style.flex='1';
    var nl=document.createElement('div'); nl.style.cssText='display:flex;align-items:center;gap:3px;flex-wrap:wrap';
    var nm=document.createElement('span'); nm.style.cssText='font-size:0.85rem;color:var(--cream);font-weight:600'; nm.textContent=pl.name;
    nl.appendChild(nm);
    if (isD)  nl.appendChild(badge('D','var(--gold)','#000',true));
    if (isSB) nl.appendChild(badge('SB','rgba(58,106,170,0.3)','#6aaaee',false));
    if (isBB) nl.appendChild(badge('BB','rgba(170,58,58,0.3)','#ee8888',false));
    if (isAllin) nl.appendChild(badge('ALL-IN','rgba(201,168,76,0.2)','var(--gold)',false));
    inf.appendChild(nl);

    var sub=document.createElement('div');
    sub.style.cssText='font-size:0.68rem;margin-top:1px;color:'+(isFolded?'var(--red)':isNext?'var(--gold)':'var(--muted)');
    if (isFolded) {
      sub.textContent = '\u2715 Folded';
    } else if (isAllin) {
      sub.textContent = 'All-in · ' + myStreetChips + ' chips';
    } else if (isNext) {
      var callAmt = maxBet - myStreetChips;
      if (hs.street === 'pre' && isBB && myStreetChips >= maxBet && !lastAct2) {
        sub.textContent = '\u25b6 Your option (check or raise)';
      } else if (callAmt > 0) {
        sub.textContent = '\u25b6 To call: ' + callAmt + ' chips' + (cv?' ($'+(callAmt*cv/100).toFixed(2)+')':'');
      } else {
        sub.textContent = '\u25b6 Your turn';
      }
    } else if (lastAct2) {
      sub.textContent = lastAct2.action + (lastAct2.chips>0?' '+lastAct2.chips+' chips':'');
    } else if (posted > 0) {
      sub.textContent = 'Posted ' + posted;
    } else {
      sub.textContent = 'Waiting';
    }
    inf.appendChild(sub);
    infoRow.appendChild(inf);

    // Hole cards
    var hc2 = hs.holes[pl.name]||[];
    var hcBtn=document.createElement('div');
    hcBtn.style.cssText='display:flex;gap:2px;align-items:center;cursor:pointer;padding:4px 6px;border-radius:5px;border:1px solid rgba(255,255,255,0.07);background:rgba(0,0,0,0.2)';
    hcBtn.dataset.player=pl.name;
    if (hc2.length>0) { hc2.forEach(function(c){ hcBtn.appendChild(cardDiv(c,true)); }); }
    else { var ph=document.createElement('span'); ph.style.cssText='font-size:0.72rem;color:rgba(255,255,255,0.12)'; ph.textContent='\ud83c\udca0\ud83c\udca0'; hcBtn.appendChild(ph); }
    hcBtn.addEventListener('click',function(){ window.htOpenCards(this.dataset.player); });
    infoRow.appendChild(hcBtn);
    rowDiv.appendChild(infoRow);

    // ── Action panel (only for the active player) ─────────────────────────
    if (isNext) {
      var actPanel = document.createElement('div');
      actPanel.style.cssText='padding:10px 10px 12px;border-top:1px solid rgba(201,168,76,0.1);background:rgba(0,0,0,0.15)';

      // Action buttons
      var callAmt2 = maxBet - myStreetChips;
      var actBtns = document.createElement('div');
      actBtns.style.cssText='display:flex;gap:4px;margin-bottom:7px';

      var actions2;
      if (maxBet === 0 || (hs.street==='pre' && isBB && myStreetChips>=maxBet && !lastAct2)) {
        // No bet yet (or BB option) — check or bet/raise
        actions2 = [
          {a:'fold',  l:'Fold',  bg:'rgba(231,76,60,0.12)',  col:'#e74c3c',     br:'rgba(231,76,60,0.3)'},
          {a:'check', l:'Check', bg:'rgba(107,140,110,0.1)', col:'var(--muted)', br:'var(--border)'},
          {a:'bet',   l:'Bet',   bg:'rgba(201,168,76,0.1)',  col:'var(--gold)',  br:'rgba(201,168,76,0.3)'},
          {a:'allin', l:'All-in',bg:'rgba(46,204,113,0.1)', col:'var(--green)', br:'rgba(46,204,113,0.3)'},
        ];
      } else {
        // There's a bet to respond to
        actions2 = [
          {a:'fold',  l:'Fold',  bg:'rgba(231,76,60,0.12)',  col:'#e74c3c',     br:'rgba(231,76,60,0.3)'},
          {a:'call',  l:'Call '+callAmt2, bg:'rgba(58,106,170,0.12)', col:'#6aaaee', br:'rgba(58,106,170,0.3)'},
          {a:'raise', l:'Raise', bg:'rgba(201,168,76,0.1)',  col:'var(--gold)',  br:'rgba(201,168,76,0.3)'},
          {a:'allin', l:'All-in',bg:'rgba(46,204,113,0.1)', col:'var(--green)', br:'rgba(46,204,113,0.3)'},
        ];
      }

      var capName = pl.name; // capture for closure
      actions2.forEach(function(cfg){
        var b=document.createElement('button');
        b.style.cssText='flex:1;padding:9px 2px;background:'+cfg.bg+';color:'+cfg.col+';border:1px solid '+cfg.br+';border-radius:6px;cursor:pointer;font-size:0.75rem;font-weight:700;font-family:DM Sans,sans-serif;min-width:0';
        b.textContent=cfg.l;
        b.dataset.action=cfg.a;
        b.dataset.player=capName;
        b.addEventListener('click',function(){ window.htAct(this.dataset.action, this.dataset.player); });
        actBtns.appendChild(b);
      });
      actPanel.appendChild(actBtns);

      // Quick chips
      var chipRow=document.createElement('div');
      chipRow.style.cssText='display:flex;gap:3px;flex-wrap:wrap;margin-bottom:7px';
      [1,2,4,5,8,10,20,50].forEach(function(n){
        var sel2=hs.chipInput===String(n);
        var cb2=document.createElement('button');
        cb2.style.cssText='padding:5px 7px;background:'+(sel2?'var(--gold)':'rgba(255,255,255,0.05)')+';color:'+(sel2?'#000':'var(--cream2)')+';border:1px solid '+(sel2?'var(--gold)':'rgba(255,255,255,0.08)')+';border-radius:4px;cursor:pointer;font-size:0.72rem;font-family:DM Sans,sans-serif;font-weight:'+(sel2?'700':'400');
        cb2.textContent=String(n);
        cb2.dataset.chips=n;
        cb2.addEventListener('click',function(){ window.htSetChip(parseInt(this.dataset.chips)); });
        chipRow.appendChild(cb2);
      });
      actPanel.appendChild(chipRow);

      // Manual input + $ conversion
      var inpRow=document.createElement('div');
      inpRow.style.cssText='display:flex;gap:6px;align-items:center';
      var inp=document.createElement('input');
      inp.type='number'; inp.min='0'; inp.value=hs.chipInput||''; inp.placeholder='or enter chips';
      inp.style.cssText='flex:1;background:rgba(4,12,5,0.9);border:1px solid var(--border);color:var(--cream);padding:8px 10px;font-size:0.88rem;border-radius:6px;outline:none;font-family:DM Sans,sans-serif';
      inp.addEventListener('input',function(){ window.htChipInput(this.value); });
      inpRow.appendChild(inp);
      var chipNum=parseInt(hs.chipInput)||0;
      if (cv&&chipNum>0) {
        var cvl=document.createElement('span');
        cvl.style.cssText='font-size:0.82rem;color:var(--gold);font-weight:700;white-space:nowrap';
        cvl.textContent='$'+(chipNum*cv/100).toFixed(2);
        inpRow.appendChild(cvl);
      }
      actPanel.appendChild(inpRow);
      rowDiv.appendChild(actPanel);
    }

    body.appendChild(rowDiv);
  });

  // Street complete message
  if (!nextPlayer) {
    var activePlayers = seated.filter(function(p){ return !allFolded[p.name]; });
    if (activePlayers.length <= 1) {
      // Only one player left — should declare winner
      var wonMsg = document.createElement('div');
      wonMsg.style.cssText='background:rgba(201,168,76,0.07);border:1px solid rgba(201,168,76,0.2);border-radius:8px;padding:10px 14px;margin-bottom:8px;text-align:center;font-size:0.8rem;color:var(--gold)';
      wonMsg.textContent = 'All others folded — declare the winner';
      body.appendChild(wonMsg);
    } else {
      var doneMsg = document.createElement('div');
      doneMsg.style.cssText='background:rgba(46,204,113,0.05);border:1px solid rgba(46,204,113,0.15);border-radius:8px;padding:9px 14px;margin-bottom:8px;text-align:center';
      doneMsg.innerHTML='<div style="font-size:0.78rem;color:var(--green);font-weight:600">Betting round complete</div><div style="font-size:0.7rem;color:var(--muted);margin-top:2px">Tap next street or declare winner</div>';
      body.appendChild(doneMsg);
    }
  }

  // Bottom bar
  var btm=document.createElement('div');
  btm.style.cssText='display:flex;gap:6px;margin-top:6px';
  btm.appendChild(btn('\u2715 Void','padding:10px;background:rgba(231,76,60,0.06);border:1px solid rgba(231,76,60,0.2);color:var(--red);border-radius:7px;cursor:pointer;font-size:0.75rem;font-family:DM Sans,sans-serif', window.htVoidHand));
  btm.appendChild(btn('\ud83c\udfc6 Declare Winner','flex:1;padding:10px;background:rgba(46,204,113,0.08);color:var(--green);border:1px solid rgba(46,204,113,0.25);border-radius:7px;cursor:pointer;font-size:0.85rem;font-weight:700;font-family:DM Sans,sans-serif', function(){ hs.view='winner'; renderBody(); }));
  body.appendChild(btm);
}

// ── Winner view ───────────────────────────────────────────────────────────────
function renderWinner(body) {
  var cv = (window.state&&window.state.game&&window.state.game.chip_value)||0;
  body.appendChild(btn('← Cancel','background:none;border:none;color:var(--muted);cursor:pointer;font-size:0.85rem;margin-bottom:12px;padding:0;font-family:DM Sans,sans-serif', function(){ hs.view='main'; renderBody(); }));
  var h=document.createElement('div'); h.style.cssText='font-size:1rem;font-weight:700;color:var(--cream);margin-bottom:4px'; h.textContent='\ud83c\udfc6 Who won?'; body.appendChild(h);
  var pl2=document.createElement('div'); pl2.style.cssText='font-size:0.8rem;color:var(--gold);margin-bottom:14px'; pl2.textContent='Pot: '+hs.pot+' chips'+(cv?' = $'+(hs.pot*cv/100).toFixed(2):''); body.appendChild(pl2);
  var folded2={};
  hs.actions.forEach(function(a){ if(a.action==='fold') folded2[a.display_name]=true; });
  getSeated().forEach(function(pl){
    if (folded2[pl.name]) return;
    var hc3=hs.holes[pl.name]||[];
    var rb2=document.createElement('button');
    rb2.style.cssText='width:100%;display:flex;align-items:center;gap:10px;padding:11px 14px;margin-bottom:6px;background:rgba(255,255,255,0.03);border:1px solid var(--border);border-radius:8px;cursor:pointer;text-align:left';
    rb2.dataset.winner=pl.name;
    var av2=document.createElement('div'); av2.style.cssText='width:32px;height:32px;border-radius:50%;background:linear-gradient(135deg,#7a5820,#5a3010);display:flex;align-items:center;justify-content:center;font-size:0.72rem;font-weight:700;color:var(--cream);flex-shrink:0'; av2.textContent=window.inits?window.inits(pl.name):pl.name.slice(0,2).toUpperCase();
    var nm2=document.createElement('span'); nm2.style.cssText='flex:1;color:var(--cream);font-size:0.9rem;font-weight:600'; nm2.textContent=pl.name;
    rb2.appendChild(av2); rb2.appendChild(nm2);
    if (hc3.length>0){ var cr=document.createElement('div'); cr.style.cssText='display:flex;gap:3px'; hc3.forEach(function(c){ cr.appendChild(cardDiv(c,true)); }); rb2.appendChild(cr); }
    rb2.addEventListener('click',function(){ window.htDeclareWinner(this.dataset.winner); });
    body.appendChild(rb2);
  });
}

// ── History view ──────────────────────────────────────────────────────────────
function renderHistory(body) {
  body.appendChild(btn('← Back','background:none;border:none;color:var(--gold);cursor:pointer;font-size:0.85rem;margin-bottom:12px;padding:0;font-family:DM Sans,sans-serif', function(){ hs.view='main'; renderBody(); }));
  if (!hs.history.length) { var em=document.createElement('div'); em.style.cssText='text-align:center;color:var(--muted);padding:30px 0;font-size:0.85rem'; em.textContent='No hands yet'; body.appendChild(em); return; }
  hs.history.forEach(function(h){
    var row=document.createElement('div'); row.style.cssText='background:rgba(255,255,255,0.02);border:1px solid var(--border);border-radius:8px;padding:10px 12px;margin-bottom:6px';
    var top=document.createElement('div'); top.style.cssText='display:flex;justify-content:space-between;align-items:center';
    var num=document.createElement('span'); num.style.cssText='color:var(--gold);font-weight:700;font-size:0.9rem'; num.textContent='Hand #'+h.hand_no;
    var res=document.createElement('span'); res.style.cssText='font-size:0.75rem;color:'+(h.result?'var(--green)':'var(--muted)'); res.textContent=h.result?'\ud83c\udfc6 '+(h.result.winner_name||'')+' \u00b7 '+(h.result.pot_chips||0)+' chips':'In progress';
    top.appendChild(num); top.appendChild(res); row.appendChild(top);
    if (h.board&&h.board.length){ var br=document.createElement('div'); br.style.cssText='display:flex;gap:3px;margin-top:6px'; h.board.forEach(function(c){ br.appendChild(cardDiv(c,true)); }); row.appendChild(br); }
    body.appendChild(row);
  });
}

// ── Card picker view ──────────────────────────────────────────────────────────
function renderCards(body) {
  var isBoard = typeof hs.cardTarget === 'number';
  var title   = isBoard ? ['Flop 1','Flop 2','Flop 3','Turn','River'][hs.cardTarget]||'Card' : hs.cardTarget+' hole cards';
  body.appendChild(btn('← '+title,'background:none;border:none;color:var(--muted);cursor:pointer;font-size:0.85rem;margin-bottom:8px;padding:0;font-family:DM Sans,sans-serif', function(){ hs.view='main'; renderBody(); }));

  var allDealt=hs.board.concat(Object.values(hs.holes).reduce(function(a,v){return a.concat(v);},[]));
  var currentSel = isBoard ? hs.board : (hs.holes[hs.cardTarget]||[]);

  ['\u2660','\u2665','\u2666','\u2663'].forEach(function(suit){
    var isRed=suit==='\u2665'||suit==='\u2666';
    var row=document.createElement('div'); row.style.cssText='display:flex;gap:3px;margin-bottom:5px;align-items:center';
    var sl=document.createElement('span'); sl.style.cssText='width:18px;font-size:1rem;color:'+(isRed?'#e74c3c':'#f0e6c8')+';flex-shrink:0;text-align:center'; sl.textContent=suit; row.appendChild(sl);
    ['A','K','Q','J','T','9','8','7','6','5','4','3','2'].forEach(function(rank){
      var card=rank+suit;
      var dealt=allDealt.indexOf(card)>=0&&currentSel.indexOf(card)<0;
      var sel3=currentSel.indexOf(card)>=0;
      var b=document.createElement('button');
      b.style.cssText='flex:1;min-width:0;padding:6px 2px;background:'+(sel3?'var(--gold)':dealt?'rgba(255,255,255,0.02)':'rgba(255,255,255,0.05)')+';color:'+(sel3?'#000':dealt?'rgba(255,255,255,0.12)':isRed?'#e74c3c':'#f0e6c8')+';border:1px solid '+(sel3?'var(--gold)':dealt?'transparent':'rgba(255,255,255,0.08)')+';border-radius:4px;cursor:'+(dealt?'not-allowed':'pointer')+';font-size:clamp(0.62rem,2vw,0.8rem);font-weight:700;font-family:DM Sans,sans-serif';
      b.textContent=rank; b.dataset.card=card;
      if (!dealt) b.addEventListener('click',function(){ window.htPickCard(this.dataset.card); });
      row.appendChild(b);
    });
    body.appendChild(row);
  });
}

// ── Boot ──────────────────────────────────────────────────────────────────────
waitForState(function(){
  var game=window.state&&window.state.game;
  updateTrackingUI(game&&game.hand_tracking);
  if (game&&game.hand_tracking) loadCurrentHand();
});

})();