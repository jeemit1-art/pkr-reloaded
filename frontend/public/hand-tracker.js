// hand-tracker.js — PKR Reloaded Hand Tracker v3
// Mobile-first, single-sheet flow with poker logic

(function() {
'use strict';

// ── Wait for main table JS ───────────────────────────────────────────────────
function waitForState(cb) {
  if (window.state && window.state.game !== undefined && window.getPkrCtx) cb();
  else setTimeout(function() { waitForState(cb); }, 100);
}

// ── API ──────────────────────────────────────────────────────────────────────
function htApi(path, opts) {
  opts = opts || {};
  var ctx = window.getPkrCtx ? window.getPkrCtx() : null;
  var apiUrl = ctx ? ctx.apiUrl : '';
  var token  = ctx ? ctx.token  : '';
  return fetch(apiUrl + path, Object.assign({
    credentials: 'include',
    headers: Object.assign({'Content-Type':'application/json'}, token ? {'Authorization':'Bearer '+token} : {}),
  }, opts)).then(function(r) {
    if (!r.ok) return r.json().catch(function(){return {};}).then(function(e){ throw new Error(e.error || String(r.status)); });
    return r.json();
  });
}

function getGameId() { var ctx = window.getPkrCtx ? window.getPkrCtx() : null; return ctx ? ctx.gameId : ''; }
function toast(msg) { window.showToast && window.showToast(msg); }

// ── State ────────────────────────────────────────────────────────────────────
var hs = {
  hand: null,          // current hand object
  history: [],         // all hands
  actions: [],         // actions for current hand
  pot: 0,
  street: 'pre',
  board: [],           // 5 community cards
  holes: {},           // {playerName: [card1, card2]}
  activePlayer: null,  // whose turn it is
  chipInput: '',
  showHistory: false,
  showCardPicker: false,
  cardPickerSlot: null, // 0-4 for board, or playerName for holes
  showWinner: false,
  turnOrder: [],       // ordered list of player names for this street
};

// ── Poker logic: compute turn order ─────────────────────────────────────────
function getSeatedPlayers() {
  if (!window.state || !window.state.players) return [];
  return Object.keys(window.state.players)
    .filter(function(sid) {
      var p = window.state.players[sid];
      return p && p.name && (window.pBuyin ? window.pBuyin(p) > 0 : true);
    })
    .map(function(sid) {
      return { sid: sid, seat: parseInt(sid.replace('seat',''), 10), name: window.state.players[sid].name };
    })
    .sort(function(a, b) { return a.seat - b.seat; });
}

function computeTurnOrder(street) {
  if (!hs.hand) return [];
  var players = getSeatedPlayers();
  if (!players.length) return [];
  var seats = players.map(function(p) { return p.seat; });

  // Find dealer, SB, BB positions
  var dSeat  = hs.hand.dealer_seat;
  var sbSeat = hs.hand.sb_seat;
  var bbSeat = hs.hand.bb_seat;

  // Get active players (not folded)
  var folded = {};
  hs.actions.forEach(function(a) { if (a.action === 'fold') folded[a.display_name] = true; });
  var active = players.filter(function(p) { return !folded[p.name]; });

  function nextAfter(seatNum) {
    // Find next active player after this seat
    var idx = seats.indexOf(seatNum);
    for (var i = 1; i <= seats.length; i++) {
      var next = seats[(idx + i) % seats.length];
      var p = active.find(function(ap) { return ap.seat === next; });
      if (p) return p;
    }
    return null;
  }

  var order = [];
  if (street === 'pre') {
    // Pre-flop: UTG (after BB) goes first
    var utg = nextAfter(bbSeat);
    if (!utg) return active.map(function(p){return p.name;});
    var start = active.indexOf(utg);
    for (var i = 0; i < active.length; i++) {
      order.push(active[(start + i) % active.length].name);
    }
  } else {
    // Post-flop: SB goes first (or next active after dealer)
    var sb = active.find(function(p) { return p.seat === sbSeat; });
    var startPost = sb ? active.indexOf(sb) : 0;
    if (!sb) {
      // SB folded, find next after dealer
      var nextP = nextAfter(dSeat);
      if (nextP) startPost = active.indexOf(nextP);
    }
    for (var j = 0; j < active.length; j++) {
      order.push(active[(startPost + j) % active.length].name);
    }
  }
  return order;
}

function getNextPlayer() {
  if (!hs.hand || hs.hand.result) return null;
  var order = computeTurnOrder(hs.street);
  if (!order.length) return null;

  // Get players who already acted this street
  var streetActions = hs.actions.filter(function(a) { return a.street === hs.street; });
  var acted = {};
  streetActions.forEach(function(a) { acted[a.display_name] = a; });

  // Find max bet this street
  var bets = {};
  streetActions.forEach(function(a) {
    if (a.chips > 0) bets[a.display_name] = (bets[a.display_name] || 0) + a.chips;
  });
  var maxBet = Math.max.apply(null, [0].concat(Object.values(bets)));

  // Find first player in order who hasn't acted or needs to call
  for (var i = 0; i < order.length; i++) {
    var name = order[i];
    var act = acted[name];
    if (!act) return name; // hasn't acted
    if (act.action === 'fold') continue; // folded, skip
    if (act.action === 'check' && maxBet > 0) return name; // needs to call a bet
  }
  return null; // all players acted
}

// ── Boot: auto-post SB/BB when hand starts ───────────────────────────────────
function autoPostBlinds(hand) {
  var players = getSeatedPlayers();
  var sb = players.find(function(p) { return p.seat === hand.sb_seat; });
  var bb = players.find(function(p) { return p.seat === hand.bb_seat; });
  var game = window.state && window.state.game;
  var sbChips = game && game.small_blind ? Math.round(game.small_blind / (game.chip_value || 1)) : 1;
  var bbChips = sbChips * 2;

  var posts = [];
  if (sb) posts.push({name: sb.name, chips: sbChips, label: 'SB'});
  if (bb) posts.push({name: bb.name, chips: bbChips, label: 'BB'});

  // Post them sequentially
  function postNext(i) {
    if (i >= posts.length) { hs.activePlayer = getNextPlayer(); renderBody(); return; }
    var p2 = posts[i];
    var pEntry = null;
    Object.values(window.state.players).forEach(function(p) { if (p && p.name === p2.name) pEntry = p; });
    htApi('/games/' + getGameId() + '/hands/' + hand.id + '/actions', {
      method: 'POST',
      body: JSON.stringify({
        user_id: pEntry ? pEntry.userId : null,
        display_name: p2.name,
        street: 'pre',
        action: 'post',
        chips: p2.chips,
      }),
    }).then(function(r) {
      hs.actions = r.actions;
      hs.pot = r.pot_chips;
      postNext(i + 1);
    }).catch(function() { postNext(i + 1); });
  }
  postNext(0);
}

// ── Toggle tracking ───────────────────────────────────────────────────────────
window.toggleHandTracking = function() {
  htApi('/games/' + getGameId() + '/tracking/toggle', {method:'POST'}).then(function(r) {
    if (window.state && window.state.game) {
      window.state.game.hand_tracking = r.hand_tracking;
      if (window.saveState) window.saveState();
    }
    var btn  = document.getElementById('handTrackerBtn');
    var tBtn = document.getElementById('trackHandsBtn');
    if (btn)  btn.style.display = r.hand_tracking ? '' : 'none';
    if (tBtn) tBtn.style.color  = r.hand_tracking ? 'var(--gold)' : 'var(--muted)';
    toast(r.hand_tracking ? '🃏 Hand tracking ON' : 'Hand tracking OFF');
    if (r.hand_tracking) loadCurrentHand();
  }).catch(function(e) { toast('⚠️ ' + e.message); });
};

// ── Load current hand ─────────────────────────────────────────────────────────
function loadCurrentHand() {
  return htApi('/games/' + getGameId() + '/hands').then(function(hands) {
    hs.history = hands || [];
    if (hands && hands.length > 0) {
      var h = hands[0];
      hs.hand    = h;
      hs.actions = h.actions || [];
      hs.pot     = h.pot_chips || 0;
      hs.board   = h.board || [];
      try { hs.holes = h.result && h.result.hole_cards ? JSON.parse(typeof h.result.hole_cards === 'string' ? h.result.hole_cards : JSON.stringify(h.result.hole_cards)) : {}; } catch(e) { hs.holes = {}; }
      if (!h.result) hs.activePlayer = getNextPlayer();
    }
    renderBoardOnFelt();
  }).catch(function(e) { console.warn('loadCurrentHand:', e.message); });
}

// ── Open/close ────────────────────────────────────────────────────────────────
window.openHandTracker = function() {
  var p = window.state && window.state.game && window.state.game.hand_tracking
    ? loadCurrentHand() : Promise.resolve();
  p.then(function() { renderBody(); openSheet('handTrackerSheet'); });
};
window.closeHandTracker = function() { closeSheet('handTrackerSheet'); };
window.toggleHandHistory = function() { hs.showHistory = !hs.showHistory; renderBody(); };

function openSheet(id) { var s = document.getElementById(id); if (s) s.classList.add('open'); }
function closeSheet(id) { var s = document.getElementById(id); if (s) s.classList.remove('open'); }

// ── Start hand ────────────────────────────────────────────────────────────────
window.htStartHand = function() {
  var players = getSeatedPlayers();
  if (players.length < 2) { toast('Need at least 2 players'); return; }
  var seats = players.map(function(p) { return p.seat; });
  var last   = (window.state.game && window.state.game.currentDealerSeat) || 0;
  var next   = seats.find(function(s) { return s > last; }) || seats[0];
  var di     = seats.indexOf(next);
  var sb     = seats[(di + 1) % seats.length];
  var bb     = seats[(di + 2) % seats.length];

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
    hs.showWinner = false;
    hs.showCardPicker = false;
    hs.history.unshift(h);
    autoPostBlinds(h);
    renderBoardOnFelt();
    toast('Hand #' + h.hand_no + ' started');
  }).catch(function(e) { toast('⚠️ ' + e.message); });
};

// ── Void hand ─────────────────────────────────────────────────────────────────
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

// ── Undo last action ──────────────────────────────────────────────────────────
window.htUndoAction = function() {
  if (!hs.hand) return;
  htApi('/games/' + getGameId() + '/hands/' + hs.hand.id + '/actions/last', {method:'DELETE'}).then(function(r) {
    hs.actions = r.actions;
    hs.pot     = r.pot_chips;
    hs.activePlayer = getNextPlayer();
    renderBody(); renderBoardOnFelt();
  }).catch(function(e) { toast('⚠️ ' + e.message); });
};

// ── Record action ─────────────────────────────────────────────────────────────
window.htRecordAction = function(action) {
  if (!hs.hand || !hs.activePlayer) return;
  var chips = parseInt(hs.chipInput) || 0;
  var pEntry = null;
  Object.values(window.state.players).forEach(function(p) { if (p && p.name === hs.activePlayer) pEntry = p; });
  if (!pEntry) return;

  // Validate chip amount for call/raise/allin
  if ((action === 'call' || action === 'raise' || action === 'bet') && chips === 0) {
    toast('Enter chip amount'); return;
  }

  htApi('/games/' + getGameId() + '/hands/' + hs.hand.id + '/actions', {
    method: 'POST',
    body: JSON.stringify({user_id: pEntry.userId || null, display_name: pEntry.name, street: hs.street, action: action, chips: chips}),
  }).then(function(r) {
    hs.actions  = r.actions;
    hs.pot      = r.pot_chips;
    hs.chipInput = '';
    hs.activePlayer = getNextPlayer();
    // If no next player, check if street is done
    if (!hs.activePlayer) {
      toast('Street complete — advance to next street or declare winner');
    }
    renderBody(); renderBoardOnFelt();
  }).catch(function(e) { toast('⚠️ ' + e.message); });
};

// ── Set street ────────────────────────────────────────────────────────────────
window.htSetStreet = function(s) {
  hs.street = s;
  hs.activePlayer = getNextPlayer();
  renderBody();
};

// ── Chip input ────────────────────────────────────────────────────────────────
window.htSetChip = function(n) { hs.chipInput = String(n); renderBody(); };
window.htChipChange = function(val) { hs.chipInput = val; renderBody(); };

// ── Card picker ───────────────────────────────────────────────────────────────
window.htOpenCardPicker = function(target) {
  hs.cardPickerSlot = target;
  hs.showCardPicker = true;
  renderBody();
};
window.htCloseCardPicker = function() {
  hs.showCardPicker = false;
  hs.cardPickerSlot = null;
  renderBody();
};
window.htPickCard = function(card) {
  var allDealt = hs.board.concat(Object.values(hs.holes).reduce(function(a,v){return a.concat(v);},[]));
  if (typeof hs.cardPickerSlot === 'number') {
    // Board card
    var b = hs.board.slice();
    var ex = b.indexOf(card);
    if (ex !== -1) { b.splice(ex, 1); }
    else { b[hs.cardPickerSlot] = card; }
    hs.board = b.filter(Boolean);
    if (hs.hand) {
      htApi('/games/' + getGameId() + '/hands/' + hs.hand.id + '/board', {
        method: 'PUT', body: JSON.stringify({board: hs.board}),
      }).catch(function(){});
    }
    renderBoardOnFelt();
  } else {
    // Hole cards
    var hc = (hs.holes[hs.cardPickerSlot] || []).slice();
    var idx = hc.indexOf(card);
    if (idx !== -1) hc.splice(idx, 1);
    else if (hc.length < 2) hc.push(card);
    hs.holes[hs.cardPickerSlot] = hc;
  }
  hs.showCardPicker = false;
  hs.cardPickerSlot = null;
  renderBody();
};

// ── Winner ────────────────────────────────────────────────────────────────────
window.htShowWinner = function() { hs.showWinner = true; renderBody(); };
window.htHideWinner = function() { hs.showWinner = false; renderBody(); };
window.htDeclareWinner = function(winnerName) {
  if (!hs.hand) return;
  var pEntry = null;
  Object.values(window.state.players).forEach(function(p) { if (p && p.name === winnerName) pEntry = p; });
  htApi('/games/' + getGameId() + '/hands/' + hs.hand.id + '/result', {
    method: 'POST',
    body: JSON.stringify({winner_user_id: pEntry ? pEntry.userId : null, winner_name: winnerName, hole_cards: hs.holes, split_pot: false}),
  }).then(function() {
    hs.hand.result = {winner_name: winnerName, pot_chips: hs.pot};
    hs.showWinner = false;
    renderBody(); renderBoardOnFelt();
    return htApi('/games/' + getGameId() + '/hands');
  }).then(function(hands) {
    hs.history = hands || [];
    toast('🏆 ' + winnerName + ' wins ' + hs.pot + ' chips!');
  }).catch(function(e) { toast('⚠️ ' + e.message); });
};
window.htUndoWinner = function() {
  if (!hs.hand || !hs.hand.result) return;
  htApi('/games/' + getGameId() + '/hands/' + hs.hand.id + '/result', {method:'DELETE'}).then(function(h) {
    hs.hand = h; hs.actions = h.actions || []; hs.pot = h.pot_chips || 0; hs.board = h.board || [];
    hs.activePlayer = getNextPlayer();
    renderBody(); renderBoardOnFelt();
    toast('Winner undone');
  }).catch(function(e) { toast('⚠️ ' + e.message); });
};

// ── Board on felt ─────────────────────────────────────────────────────────────
function renderBoardOnFelt() {
  var tc = document.getElementById('tableCenter');
  if (!tc) return;
  ['htBoard','htPot'].forEach(function(id) { var el = document.getElementById(id); if (el) el.remove(); });
  if (!hs.hand || hs.hand.result) return;

  var row = document.createElement('div');
  row.id = 'htBoard';
  row.style.cssText = 'display:flex;gap:4px;justify-content:center;margin-top:8px;pointer-events:all';

  for (var slot = 0; slot < 5; slot++) {
    var card = hs.board[slot];
    var isRed = card && (card.indexOf('\u2665') >= 0 || card.indexOf('\u2666') >= 0);
    var el = document.createElement('div');
    // Vertical cards - taller than wide
    el.style.cssText = 'width:clamp(18px,4vw,28px);height:clamp(28px,6.5vw,44px);'
      + 'background:' + (card ? '#fff' : 'rgba(255,255,255,0.06)') + ';'
      + 'border-radius:3px;'
      + 'border:' + (card ? 'none' : '1px dashed rgba(201,168,76,0.3)') + ';'
      + 'display:flex;flex-direction:column;align-items:center;justify-content:center;'
      + 'cursor:pointer;font-weight:700;line-height:1;'
      + 'color:' + (card ? (isRed ? '#d63031' : '#1a1a1a') : 'rgba(201,168,76,0.3)');
    if (card) {
      var rank = card.length > 1 ? card.slice(0, -1) : card;
      var suit = card.slice(-1);
      var rs = document.createElement('div'); rs.style.fontSize = 'clamp(7px,1.6vw,11px)'; rs.textContent = rank;
      var ss = document.createElement('div'); ss.style.fontSize = 'clamp(8px,1.8vw,12px)'; ss.textContent = suit;
      el.appendChild(rs); el.appendChild(ss);
    } else {
      el.style.fontSize = 'clamp(7px,1.4vw,10px)';
      el.textContent = slot < 3 ? 'flop' : (slot === 3 ? 'turn' : 'river');
      el.style.color = 'rgba(201,168,76,0.2)';
      el.style.textAlign = 'center';
      el.style.fontSize = 'clamp(5px,1vw,7px)';
      el.style.letterSpacing = '0';
    }
    el.dataset.slot = slot;
    el.addEventListener('click', function() { window.htOpenCardPicker(parseInt(this.dataset.slot)); openSheet('handTrackerSheet'); });
    row.appendChild(el);
  }
  tc.appendChild(row);

  if (hs.pot > 0) {
    var cv = (window.state.game && window.state.game.chip_value) || 0;
    var pot = document.createElement('div');
    pot.id = 'htPot';
    pot.style.cssText = 'font-size:clamp(0.6rem,1.3vw,0.72rem);color:var(--gold);margin-top:3px;pointer-events:none;letter-spacing:0.5px;font-weight:600';
    pot.textContent = 'POT ' + hs.pot + (cv ? ' · $' + (hs.pot * cv / 100).toFixed(2) : '');
    tc.appendChild(pot);
  }
}

// ── Card helper ───────────────────────────────────────────────────────────────
function cardEl(card, small) {
  var isRed = card && (card.indexOf('\u2665') >= 0 || card.indexOf('\u2666') >= 0);
  var d = document.createElement('div');
  if (card) {
    d.style.cssText = 'background:#fff;border-radius:2px;padding:' + (small?'1px 3px':'2px 5px') + ';font-size:' + (small?'0.65rem':'0.8rem') + ';font-weight:700;color:' + (isRed?'#d63031':'#1a1a1a') + ';display:inline-flex;align-items:center';
    d.textContent = card;
  } else {
    d.style.cssText = 'width:' + (small?'16px':'20px') + ';height:' + (small?'22px':'28px') + ';background:rgba(255,255,255,0.07);border:1px dashed rgba(201,168,76,0.3);border-radius:2px;display:inline-flex;align-items:center;justify-content:center;font-size:8px;color:rgba(201,168,76,0.3)';
    d.textContent = '?';
  }
  return d;
}

// ── Main render ───────────────────────────────────────────────────────────────
function renderBody() {
  var body = document.getElementById('handTrackerBody');
  if (!body) return;
  body.innerHTML = '';

  var undoBtn = document.getElementById('undoActionBtn');
  if (undoBtn) undoBtn.style.display = (hs.hand && !hs.hand.result && hs.actions.length > 0) ? '' : 'none';

  if (hs.showCardPicker) { renderCardPicker(body); return; }
  if (hs.showHistory)    { renderHistory(body); return; }
  if (hs.showWinner)     { renderWinner(body); return; }

  // ── No hand / hand complete ──
  if (!hs.hand || hs.hand.result) {
    // Show undo winner if last hand was just finished
    if (hs.hand && hs.hand.result) {
      var res = hs.hand.result;
      var resBox = document.createElement('div');
      resBox.style.cssText = 'background:rgba(46,204,113,0.08);border:1px solid rgba(46,204,113,0.2);border-radius:8px;padding:12px 14px;margin-bottom:12px;display:flex;align-items:center;justify-content:space-between';
      var resLabel = document.createElement('div');
      resLabel.innerHTML = '<div style="font-size:0.8rem;color:var(--green);font-weight:700">\ud83c\udfc6 Hand #' + hs.hand.hand_no + '</div><div style="font-size:0.75rem;color:var(--muted);margin-top:2px">' + (res.winner_name || '') + ' won ' + (res.pot_chips || hs.pot) + ' chips</div>';
      var undoW = document.createElement('button');
      undoW.style.cssText = 'background:none;border:1px solid rgba(231,76,60,0.3);color:var(--red);padding:5px 10px;border-radius:4px;cursor:pointer;font-size:0.72rem;font-family:DM Sans,sans-serif;white-space:nowrap';
      undoW.textContent = '↩ Undo';
      undoW.addEventListener('click', window.htUndoWinner);
      resBox.appendChild(resLabel);
      resBox.appendChild(undoW);
      body.appendChild(resBox);
    }

    var nextNo = hs.hand ? (hs.hand.hand_no + 1) : 1;
    var startBtn = document.createElement('button');
    startBtn.className = 'btn-primary';
    startBtn.style.cssText = 'width:100%;padding:16px;font-size:1rem;margin-bottom:8px;border-radius:10px';
    startBtn.textContent = '\u25b6\ufe0f Start Hand #' + nextNo;
    startBtn.addEventListener('click', window.htStartHand);
    body.appendChild(startBtn);
    return;
  }

  // ── Active hand ──────────────────────────────────────────────────────────────
  var hand = hs.hand;
  var cv   = (window.state.game && window.state.game.chip_value) || 0;

  // Header: hand info + street tabs
  var hdrBox = document.createElement('div');
  hdrBox.style.cssText = 'margin-bottom:10px';

  // Street tabs
  var tabs = document.createElement('div');
  tabs.style.cssText = 'display:flex;gap:3px;margin-bottom:10px';
  ['pre','flop','turn','river'].forEach(function(s) {
    var t = document.createElement('button');
    var active = hs.street === s;
    t.style.cssText = 'flex:1;padding:7px 4px;border-radius:6px;cursor:pointer;font-size:0.7rem;font-weight:700;text-transform:uppercase;letter-spacing:0.05em;font-family:DM Sans,sans-serif;transition:all 0.15s;'
      + 'border:1px solid ' + (active ? 'rgba(201,168,76,0.5)' : 'rgba(201,168,76,0.1)') + ';'
      + 'background:' + (active ? 'rgba(201,168,76,0.15)' : 'transparent') + ';'
      + 'color:' + (active ? 'var(--gold)' : 'var(--muted)');
    t.textContent = s;
    t.dataset.street = s;
    t.addEventListener('click', function() { window.htSetStreet(this.dataset.street); });
    tabs.appendChild(t);
  });
  body.appendChild(tabs);

  // Board cards inline
  var boardRow = document.createElement('div');
  boardRow.style.cssText = 'display:flex;gap:6px;align-items:center;margin-bottom:10px;background:rgba(0,0,0,0.3);border-radius:8px;padding:10px 12px';

  var boardLabel = document.createElement('div');
  boardLabel.style.cssText = 'font-size:0.65rem;text-transform:uppercase;letter-spacing:1.5px;color:var(--muted);flex-shrink:0';
  boardLabel.textContent = 'Board';
  boardRow.appendChild(boardLabel);

  var boardCards = document.createElement('div');
  boardCards.style.cssText = 'display:flex;gap:4px;flex:1';
  var slots = hs.street === 'pre' ? 0 : hs.street === 'flop' ? 3 : hs.street === 'turn' ? 4 : 5;
  for (var slot = 0; slot < 5; slot++) {
    var bc = hs.board[slot];
    var isRed2 = bc && (bc.indexOf('\u2665') >= 0 || bc.indexOf('\u2666') >= 0);
    var bEl = document.createElement('div');
    bEl.style.cssText = 'width:28px;height:38px;border-radius:3px;display:flex;flex-direction:column;align-items:center;justify-content:center;cursor:pointer;font-weight:700;line-height:1.1;'
      + (bc ? 'background:#fff;color:' + (isRed2 ? '#d63031' : '#1a1a1a') + ';' : 'background:rgba(255,255,255,0.05);border:1px dashed rgba(201,168,76,' + (slot < slots ? '0.4' : '0.15') + ');color:rgba(201,168,76,' + (slot < slots ? '0.5' : '0.2') + ');');
    if (bc) {
      var r2 = document.createElement('div'); r2.style.fontSize = '0.75rem'; r2.textContent = bc.slice(0,-1);
      var s2 = document.createElement('div'); s2.style.fontSize = '0.85rem'; s2.textContent = bc.slice(-1);
      bEl.appendChild(r2); bEl.appendChild(s2);
    } else {
      bEl.style.fontSize = '0.6rem';
      bEl.textContent = slot === 0 ? 'F' : slot === 3 ? 'T' : slot === 4 ? 'R' : '';
    }
    bEl.dataset.slot = slot;
    bEl.addEventListener('click', function() { window.htOpenCardPicker(parseInt(this.dataset.slot)); });
    boardCards.appendChild(bEl);
  }
  boardRow.appendChild(boardCards);

  if (hs.pot > 0) {
    var potLbl = document.createElement('div');
    potLbl.style.cssText = 'font-size:0.75rem;color:var(--gold);font-weight:700;flex-shrink:0;text-align:right';
    potLbl.innerHTML = '<div>' + hs.pot + '</div><div style="font-size:0.6rem;color:var(--muted);font-weight:400">' + (cv ? '$' + (hs.pot * cv / 100).toFixed(2) : 'chips') + '</div>';
    boardRow.appendChild(potLbl);
  }
  body.appendChild(boardRow);

  // ── Active player action area ─────────────────────────────────────────────
  var folded = {};
  hs.actions.forEach(function(a) { if (a.action === 'fold') folded[a.display_name] = true; });

  if (hs.activePlayer && !folded[hs.activePlayer]) {
    var activeBox = document.createElement('div');
    activeBox.style.cssText = 'background:linear-gradient(135deg,rgba(201,168,76,0.08),rgba(201,168,76,0.03));border:1px solid rgba(201,168,76,0.3);border-radius:10px;padding:12px 14px;margin-bottom:10px';

    var activeLbl = document.createElement('div');
    activeLbl.style.cssText = 'font-size:0.65rem;text-transform:uppercase;letter-spacing:1.5px;color:var(--gold);margin-bottom:8px;font-weight:600';
    activeLbl.textContent = '\u25b6 ' + hs.activePlayer + "'s turn";
    activeBox.appendChild(activeLbl);

    // Hole cards for active player
    var hc = hs.holes[hs.activePlayer] || [];
    var hcRow = document.createElement('div');
    hcRow.style.cssText = 'display:flex;gap:4px;align-items:center;margin-bottom:10px';
    var hcLbl = document.createElement('div');
    hcLbl.style.cssText = 'font-size:0.65rem;color:var(--muted);margin-right:4px';
    hcLbl.textContent = 'Cards:';
    hcRow.appendChild(hcLbl);
    [0,1].forEach(function(ci) {
      var hcEl = hc[ci] ? cardEl(hc[ci], false) : cardEl(null, false);
      hcEl.style.cursor = 'pointer';
      hcEl.dataset.player = hs.activePlayer;
      hcEl.addEventListener('click', function() { window.htOpenCardPicker(this.dataset.player); });
      hcRow.appendChild(hcEl);
    });
    activeBox.appendChild(hcRow);

    // Action buttons - 2 rows
    var row1 = document.createElement('div');
    row1.style.cssText = 'display:flex;gap:4px;margin-bottom:6px';
    [
      {a:'fold',  l:'Fold',  bg:'rgba(231,76,60,0.15)',  col:'#e74c3c', br:'rgba(231,76,60,0.3)'},
      {a:'check', l:'Check', bg:'rgba(107,140,110,0.1)', col:'var(--muted)', br:'var(--border)'},
      {a:'call',  l:'Call',  bg:'rgba(58,106,170,0.15)', col:'#6aaaee', br:'rgba(58,106,170,0.3)'},
    ].forEach(function(cfg) {
      var b = document.createElement('button');
      b.style.cssText = 'flex:1;padding:9px 4px;background:' + cfg.bg + ';color:' + cfg.col + ';border:1px solid ' + cfg.br + ';border-radius:6px;cursor:pointer;font-size:0.8rem;font-weight:700;font-family:DM Sans,sans-serif';
      b.textContent = cfg.l;
      b.dataset.action = cfg.a;
      b.addEventListener('click', function() { window.htRecordAction(this.dataset.action); });
      row1.appendChild(b);
    });
    activeBox.appendChild(row1);

    var row2 = document.createElement('div');
    row2.style.cssText = 'display:flex;gap:4px;margin-bottom:8px';
    [
      {a:'bet',   l:'Bet',    bg:'rgba(201,168,76,0.12)', col:'var(--gold)',  br:'rgba(201,168,76,0.3)'},
      {a:'raise', l:'Raise',  bg:'rgba(201,168,76,0.12)', col:'var(--gold)',  br:'rgba(201,168,76,0.3)'},
      {a:'allin', l:'All-in', bg:'rgba(46,204,113,0.12)', col:'var(--green)', br:'rgba(46,204,113,0.3)'},
    ].forEach(function(cfg) {
      var b = document.createElement('button');
      b.style.cssText = 'flex:1;padding:9px 4px;background:' + cfg.bg + ';color:' + cfg.col + ';border:1px solid ' + cfg.br + ';border-radius:6px;cursor:pointer;font-size:0.8rem;font-weight:700;font-family:DM Sans,sans-serif';
      b.textContent = cfg.l;
      b.dataset.action = cfg.a;
      b.addEventListener('click', function() { window.htRecordAction(this.dataset.action); });
      row2.appendChild(b);
    });
    activeBox.appendChild(row2);

    // Quick chip amounts
    var chipRow = document.createElement('div');
    chipRow.style.cssText = 'display:flex;gap:4px;flex-wrap:wrap;margin-bottom:8px';
    [1,2,4,6,8,10,20,50,100].forEach(function(n) {
      var b = document.createElement('button');
      var sel = hs.chipInput === String(n);
      b.style.cssText = 'padding:5px 8px;background:' + (sel?'var(--gold)':'rgba(255,255,255,0.05)') + ';color:' + (sel?'#000':'var(--cream2)') + ';border:1px solid ' + (sel?'var(--gold)':'var(--border)') + ';border-radius:4px;cursor:pointer;font-size:0.72rem;font-family:DM Sans,sans-serif;font-weight:' + (sel?'700':'400');
      b.textContent = String(n);
      b.dataset.chips = n;
      b.addEventListener('click', function() { window.htSetChip(parseInt(this.dataset.chips)); });
      chipRow.appendChild(b);
    });
    activeBox.appendChild(chipRow);

    // Manual input
    var inputRow = document.createElement('div');
    inputRow.style.cssText = 'display:flex;gap:6px;align-items:center';
    var inp = document.createElement('input');
    inp.type = 'number'; inp.min = '0';
    inp.value = hs.chipInput || '';
    inp.placeholder = 'chips';
    inp.style.cssText = 'flex:1;background:rgba(4,12,5,0.9);border:1px solid var(--border);color:var(--cream);padding:8px 10px;font-size:0.9rem;border-radius:6px;outline:none;font-family:DM Sans,sans-serif';
    inp.addEventListener('input', function() { window.htChipChange(this.value); });
    inputRow.appendChild(inp);
    var chipNum = parseInt(hs.chipInput) || 0;
    if (cv && chipNum > 0) {
      var cvLbl = document.createElement('span');
      cvLbl.style.cssText = 'font-size:0.8rem;color:var(--gold);white-space:nowrap;font-weight:600';
      cvLbl.textContent = '$' + (chipNum * cv / 100).toFixed(2);
      inputRow.appendChild(cvLbl);
    }
    activeBox.appendChild(inputRow);
    body.appendChild(activeBox);
  } else if (!hs.activePlayer) {
    // Street complete
    var doneBox = document.createElement('div');
    doneBox.style.cssText = 'background:rgba(46,204,113,0.06);border:1px solid rgba(46,204,113,0.2);border-radius:8px;padding:10px 14px;margin-bottom:10px;text-align:center';
    doneBox.innerHTML = '<div style="font-size:0.8rem;color:var(--green);font-weight:600">Street complete</div><div style="font-size:0.72rem;color:var(--muted);margin-top:2px">Advance to next street or declare winner</div>';
    body.appendChild(doneBox);
  }

  // ── Player status rows ────────────────────────────────────────────────────
  var players = getSeatedPlayers();
  var plSection = document.createElement('div');
  plSection.style.cssText = 'margin-bottom:10px';

  players.forEach(function(pl) {
    var isFolded = folded[pl.name];
    var isActive = pl.name === hs.activePlayer;
    var streetActs = hs.actions.filter(function(a) { return a.street === hs.street && a.display_name === pl.name; });
    var lastAct = streetActs[streetActs.length - 1];
    var allActs = hs.actions.filter(function(a) { return a.display_name === pl.name; });
    var totalChips = allActs.reduce(function(sum, a) { return sum + (a.chips || 0); }, 0);

    var seatNum = pl.seat;
    var isD   = seatNum === hand.dealer_seat;
    var isSB  = seatNum === hand.sb_seat;
    var isBB  = seatNum === hand.bb_seat;

    var row = document.createElement('div');
    row.style.cssText = 'display:flex;align-items:center;gap:8px;padding:7px 10px;margin-bottom:3px;border-radius:7px;'
      + 'background:' + (isActive ? 'rgba(201,168,76,0.06)' : 'rgba(255,255,255,0.02)') + ';'
      + 'border:1px solid ' + (isActive ? 'rgba(201,168,76,0.2)' : 'rgba(255,255,255,0.04)') + ';'
      + 'opacity:' + (isFolded ? '0.4' : '1');

    // Avatar
    var av = document.createElement('div');
    av.style.cssText = 'width:30px;height:30px;border-radius:50%;background:linear-gradient(135deg,#7a5820,#5a3010);display:flex;align-items:center;justify-content:center;font-size:0.7rem;font-weight:700;color:var(--cream);flex-shrink:0';
    av.textContent = window.inits ? window.inits(pl.name) : pl.name.slice(0,2).toUpperCase();
    row.appendChild(av);

    // Info
    var info = document.createElement('div');
    info.style.cssText = 'flex:1;min-width:0';
    var nameLine = document.createElement('div');
    nameLine.style.cssText = 'display:flex;align-items:center;gap:3px;flex-wrap:wrap';
    var nm = document.createElement('span');
    nm.style.cssText = 'font-size:0.85rem;color:var(--cream);font-weight:600';
    nm.textContent = pl.name;
    nameLine.appendChild(nm);
    if (isD) { var db = mkBadge('D','var(--gold)','#000'); nameLine.appendChild(db); }
    if (isSB) { var sb2 = mkBadge('SB','rgba(58,106,170,0.3)','#6aaaee'); nameLine.appendChild(sb2); }
    if (isBB) { var bb2 = mkBadge('BB','rgba(170,58,58,0.3)','#ee8888'); nameLine.appendChild(bb2); }
    info.appendChild(nameLine);

    var sub = document.createElement('div');
    sub.style.cssText = 'font-size:0.68rem;color:' + (isFolded ? 'var(--red)' : lastAct ? 'var(--gold)' : 'var(--muted)') + ';margin-top:1px';
    sub.textContent = isFolded ? '\u2715 Folded'
      : lastAct ? (lastAct.action + (lastAct.chips > 0 ? ' ' + lastAct.chips + ' chips' : ''))
      : 'Waiting';
    info.appendChild(sub);
    row.appendChild(info);

    // Hole cards tap
    var hc2 = hs.holes[pl.name] || [];
    var hcBtn = document.createElement('div');
    hcBtn.style.cssText = 'display:flex;gap:2px;align-items:center;cursor:pointer;padding:3px;border-radius:4px;border:1px solid rgba(255,255,255,0.06);background:rgba(0,0,0,0.2)';
    hcBtn.dataset.player = pl.name;
    if (hc2.length > 0) {
      hc2.forEach(function(c) { hcBtn.appendChild(cardEl(c, true)); });
    } else {
      var ph = document.createElement('span');
      ph.style.cssText = 'font-size:0.7rem;color:rgba(255,255,255,0.15);padding:0 2px';
      ph.textContent = '\ud83c\udca0\ud83c\udca0';
      hcBtn.appendChild(ph);
    }
    hcBtn.addEventListener('click', function() { window.htOpenCardPicker(this.dataset.player); });
    row.appendChild(hcBtn);
    plSection.appendChild(row);
  });
  body.appendChild(plSection);

  // ── Bottom actions ────────────────────────────────────────────────────────
  var btmRow = document.createElement('div');
  btmRow.style.cssText = 'display:flex;gap:6px;margin-top:4px';

  var voidBtn = document.createElement('button');
  voidBtn.style.cssText = 'padding:10px;background:rgba(231,76,60,0.06);border:1px solid rgba(231,76,60,0.2);color:var(--red);border-radius:7px;cursor:pointer;font-size:0.75rem;font-family:DM Sans,sans-serif';
  voidBtn.textContent = '\u2715 Void';
  voidBtn.addEventListener('click', window.htVoidHand);
  btmRow.appendChild(voidBtn);

  var winBtn = document.createElement('button');
  winBtn.style.cssText = 'flex:1;padding:10px;background:rgba(46,204,113,0.1);color:var(--green);border:1px solid rgba(46,204,113,0.3);border-radius:7px;cursor:pointer;font-size:0.85rem;font-weight:700;font-family:DM Sans,sans-serif';
  winBtn.textContent = '\ud83c\udfc6 Declare Winner';
  winBtn.addEventListener('click', window.htShowWinner);
  btmRow.appendChild(winBtn);
  body.appendChild(btmRow);
}

function mkBadge(txt, bg, col) {
  var b = document.createElement('span');
  b.style.cssText = 'font-size:0.58rem;font-weight:700;padding:1px 4px;border-radius:3px;background:' + bg + ';color:' + col;
  if (txt === 'D') {
    b.style.cssText = 'width:14px;height:14px;border-radius:50%;background:var(--gold);color:#000;font-size:0.55rem;font-weight:700;display:inline-flex;align-items:center;justify-content:center;flex-shrink:0';
  }
  b.textContent = txt;
  return b;
}

// ── History view ──────────────────────────────────────────────────────────────
function renderHistory(body) {
  var back = document.createElement('button');
  back.style.cssText = 'background:none;border:none;color:var(--gold);cursor:pointer;font-size:0.85rem;margin-bottom:12px;padding:0;font-family:DM Sans,sans-serif';
  back.textContent = '← Back';
  back.addEventListener('click', function() { hs.showHistory = false; renderBody(); });
  body.appendChild(back);

  if (!hs.history.length) {
    var em = document.createElement('div');
    em.style.cssText = 'text-align:center;color:var(--muted);padding:30px 0;font-size:0.85rem';
    em.textContent = 'No hands yet';
    body.appendChild(em);
    return;
  }

  hs.history.forEach(function(h) {
    var row = document.createElement('div');
    row.style.cssText = 'background:rgba(255,255,255,0.02);border:1px solid var(--border);border-radius:8px;padding:10px 12px;margin-bottom:6px';
    var top = document.createElement('div');
    top.style.cssText = 'display:flex;justify-content:space-between;align-items:center';
    var num = document.createElement('span');
    num.style.cssText = 'color:var(--gold);font-weight:700;font-size:0.9rem';
    num.textContent = 'Hand #' + h.hand_no;
    var res = document.createElement('span');
    res.style.cssText = 'font-size:0.75rem;color:' + (h.result ? 'var(--green)' : 'var(--muted)');
    res.textContent = h.result ? ('\ud83c\udfc6 ' + (h.result.winner_name || '') + ' \u00b7 ' + (h.result.pot_chips || 0) + ' chips') : 'In progress';
    top.appendChild(num); top.appendChild(res);
    row.appendChild(top);
    if (h.board && h.board.length) {
      var brow = document.createElement('div');
      brow.style.cssText = 'display:flex;gap:3px;margin-top:6px';
      h.board.forEach(function(c) { brow.appendChild(cardEl(c, true)); });
      row.appendChild(brow);
    }
    body.appendChild(row);
  });
}

// ── Winner view ───────────────────────────────────────────────────────────────
function renderWinner(body) {
  var cv = (window.state.game && window.state.game.chip_value) || 0;

  var back = document.createElement('button');
  back.style.cssText = 'background:none;border:none;color:var(--muted);cursor:pointer;font-size:0.85rem;margin-bottom:12px;padding:0;font-family:DM Sans,sans-serif';
  back.textContent = '← Cancel';
  back.addEventListener('click', function() { hs.showWinner = false; renderBody(); });
  body.appendChild(back);

  var hdr = document.createElement('div');
  hdr.style.cssText = 'font-size:1rem;font-weight:700;color:var(--cream);margin-bottom:4px';
  hdr.textContent = '\ud83c\udfc6 Who won?';
  body.appendChild(hdr);

  var potLbl = document.createElement('div');
  potLbl.style.cssText = 'font-size:0.8rem;color:var(--gold);margin-bottom:14px';
  potLbl.textContent = 'Pot: ' + hs.pot + ' chips' + (cv ? ' = $' + (hs.pot * cv / 100).toFixed(2) : '');
  body.appendChild(potLbl);

  var folded = {};
  hs.actions.forEach(function(a) { if (a.action === 'fold') folded[a.display_name] = true; });

  getSeatedPlayers().forEach(function(pl) {
    if (folded[pl.name]) return;
    var hc = hs.holes[pl.name] || [];
    var btn = document.createElement('button');
    btn.style.cssText = 'width:100%;display:flex;align-items:center;gap:10px;padding:11px 14px;margin-bottom:6px;background:rgba(255,255,255,0.03);border:1px solid var(--border);border-radius:8px;cursor:pointer;text-align:left';
    btn.dataset.winner = pl.name;

    var av = document.createElement('div');
    av.style.cssText = 'width:34px;height:34px;border-radius:50%;background:linear-gradient(135deg,#7a5820,#5a3010);display:flex;align-items:center;justify-content:center;font-size:0.75rem;font-weight:700;color:var(--cream);flex-shrink:0';
    av.textContent = window.inits ? window.inits(pl.name) : pl.name.slice(0,2).toUpperCase();
    btn.appendChild(av);

    var nm = document.createElement('span');
    nm.style.cssText = 'flex:1;color:var(--cream);font-size:0.9rem;font-weight:600';
    nm.textContent = pl.name;
    btn.appendChild(nm);

    if (hc.length > 0) {
      var cRow = document.createElement('div');
      cRow.style.cssText = 'display:flex;gap:3px';
      hc.forEach(function(c) { cRow.appendChild(cardEl(c, true)); });
      btn.appendChild(cRow);
    }

    btn.addEventListener('click', function() { window.htDeclareWinner(this.dataset.winner); });
    body.appendChild(btn);
  });
}

// ── Card picker view ──────────────────────────────────────────────────────────
function renderCardPicker(body) {
  var isBoard = typeof hs.cardPickerSlot === 'number';
  var title = isBoard
    ? ['Flop 1','Flop 2','Flop 3','Turn','River'][hs.cardPickerSlot] || 'Board card'
    : hs.cardPickerSlot + ' hole cards';

  var back = document.createElement('button');
  back.style.cssText = 'background:none;border:none;color:var(--muted);cursor:pointer;font-size:0.85rem;margin-bottom:8px;padding:0;font-family:DM Sans,sans-serif';
  back.textContent = '← ' + title;
  back.addEventListener('click', window.htCloseCardPicker);
  body.appendChild(back);

  var allDealt = hs.board.concat(Object.values(hs.holes).reduce(function(a,v){return a.concat(v);},[]));
  var currentSel = isBoard ? hs.board : (hs.holes[hs.cardPickerSlot] || []);

  ['\u2660','\u2665','\u2666','\u2663'].forEach(function(suit) {
    var isRed = suit === '\u2665' || suit === '\u2666';
    var row = document.createElement('div');
    row.style.cssText = 'display:flex;gap:3px;margin-bottom:5px;align-items:center';

    var sl = document.createElement('span');
    sl.style.cssText = 'width:18px;font-size:1rem;color:' + (isRed?'#e74c3c':'#f0e6c8') + ';flex-shrink:0;text-align:center';
    sl.textContent = suit;
    row.appendChild(sl);

    ['A','K','Q','J','T','9','8','7','6','5','4','3','2'].forEach(function(rank) {
      var card  = rank + suit;
      var dealt = allDealt.indexOf(card) >= 0 && currentSel.indexOf(card) < 0;
      var sel   = currentSel.indexOf(card) >= 0;
      var b = document.createElement('button');
      b.style.cssText = 'flex:1;min-width:0;padding:6px 2px;'
        + 'background:' + (sel ? 'var(--gold)' : dealt ? 'rgba(255,255,255,0.02)' : 'rgba(255,255,255,0.05)') + ';'
        + 'color:' + (sel ? '#000' : dealt ? 'rgba(255,255,255,0.15)' : isRed ? '#e74c3c' : '#f0e6c8') + ';'
        + 'border:1px solid ' + (sel ? 'var(--gold)' : dealt ? 'transparent' : 'rgba(255,255,255,0.08)') + ';'
        + 'border-radius:4px;cursor:' + (dealt ? 'not-allowed' : 'pointer') + ';'
        + 'font-size:clamp(0.62rem,2vw,0.8rem);font-weight:700;font-family:DM Sans,sans-serif';
      b.textContent = rank;
      b.dataset.card = card;
      if (!dealt) b.addEventListener('click', function() { window.htPickCard(this.dataset.card); });
      row.appendChild(b);
    });
    body.appendChild(row);
  });
}

// ── Boot ──────────────────────────────────────────────────────────────────────
waitForState(function() {
  var game  = window.state && window.state.game;
  var htBtn = document.getElementById('handTrackerBtn');
  var tBtn  = document.getElementById('trackHandsBtn');
  if (htBtn) htBtn.style.display = (game && game.hand_tracking) ? '' : 'none';
  if (tBtn)  tBtn.style.color    = (game && game.hand_tracking) ? 'var(--gold)' : 'var(--muted)';
  if (game && game.hand_tracking) loadCurrentHand();
});

})();