// hand-tracker.js — PKR Reloaded Hand Tracker
// Loaded as a static script from /public/hand-tracker.js
// This avoids ALL string escaping issues from injecting JS into template literals

(function() {
'use strict';

// ── Wait for the main table JS to be ready ──────────────────────────────────
function waitForState(cb) {
  if (window.state && window.state.game !== undefined && window.pkrApi) {
    cb();
  } else {
    setTimeout(function() { waitForState(cb); }, 100);
  }
}

// ── API helper ──────────────────────────────────────────────────────────────
function htApi(path, opts) {
  opts = opts || {};
  var ctx = window.getPkrCtx ? window.getPkrCtx() : null;
  var apiUrl = ctx ? ctx.apiUrl : (window._pkrApiUrl || '');
  var token  = ctx ? ctx.token  : '';
  return fetch(apiUrl + path, Object.assign({
    credentials: 'include',
    headers: Object.assign(
      {'Content-Type': 'application/json'},
      token ? {'Authorization': 'Bearer ' + token} : {}
    ),
  }, opts)).then(function(r) {
    if (!r.ok) return r.json().catch(function(){return {};}).then(function(e){ throw new Error(e.error || String(r.status)); });
    return r.json();
  });
}

function getGameId() {
  var ctx = window.getPkrCtx ? window.getPkrCtx() : null;
  return ctx ? ctx.gameId : '';
}

// ── State ────────────────────────────────────────────────────────────────────
var hs = {
  currentHand:   null,
  handHistory:   [],
  handActions:   [],
  potChips:      0,
  street:        'pre',
  boardCards:    [],
  holeCards:     {},
  selectedPlayer: null,
  chipInput:     '',
  showHistory:   false,
  editingAssign: false,
  pickerTarget:  'board',
  pickerSlot:    0,
};

// ── Load current hand from server ────────────────────────────────────────────
function loadCurrentHand() {
  return htApi('/games/' + getGameId() + '/hands').then(function(hands) {
    hs.handHistory = hands || [];
    if (hands && hands.length > 0 && !hands[0].result) {
      var h = hands[0];
      hs.currentHand  = h;
      hs.handActions  = h.actions || [];
      hs.potChips     = h.pot_chips || 0;
      hs.boardCards   = h.board || [];
      try {
        hs.holeCards = h.result && h.result.hole_cards
          ? (typeof h.result.hole_cards === 'string' ? JSON.parse(h.result.hole_cards) : h.result.hole_cards)
          : {};
      } catch(e) { hs.holeCards = {}; }
    } else if (hands && hands.length > 0) {
      hs.currentHand = hands[0];
    }
    renderBoardOnFelt();
  }).catch(function(e) { console.warn('loadCurrentHand:', e.message); });
}

// ── Toggle tracking on/off ───────────────────────────────────────────────────
window.toggleHandTracking = function() {
  htApi('/games/' + getGameId() + '/tracking/toggle', {method: 'POST'}).then(function(r) {
    if (window.state && window.state.game) window.state.game.hand_tracking = r.hand_tracking;
    var btn  = document.getElementById('handTrackerBtn');
    var tBtn = document.getElementById('trackHandsBtn');
    if (btn)  btn.style.display  = r.hand_tracking ? '' : 'none';
    if (tBtn) tBtn.style.color   = r.hand_tracking ? 'var(--gold)' : 'var(--muted)';
    if (tBtn) tBtn.title = r.hand_tracking ? 'Hand tracking ON' : 'Hand tracking OFF';
    window.showToast && window.showToast(r.hand_tracking ? '🃏 Hand tracking ON' : 'Hand tracking OFF');
    if (r.hand_tracking) loadCurrentHand();
  }).catch(function(e) { window.showToast && window.showToast('⚠️ ' + e.message); });
};

// ── Open/close tracker sheet ─────────────────────────────────────────────────
window.openHandTracker = function() {
  if (window.state && window.state.game && window.state.game.hand_tracking) {
    loadCurrentHand().then(function() { renderBody(); });
  } else {
    renderBody();
  }
  var s = document.getElementById('handTrackerSheet');
  if (s) s.classList.add('open');
};
window.closeHandTracker = function() {
  var s = document.getElementById('handTrackerSheet');
  if (s) s.classList.remove('open');
};
window.toggleHandHistory = function() {
  hs.showHistory = !hs.showHistory;
  renderBody();
};

// ── Start new hand ───────────────────────────────────────────────────────────
window.htStartHand = function() {
  if (!window.state) return;
  var seated = Object.keys(window.state.players).filter(function(sid) {
    var p = window.state.players[sid];
    return p && p.name && (window.pBuyin ? window.pBuyin(p) > 0 : true);
  });
  if (seated.length < 2) { window.showToast && window.showToast('Need at least 2 players'); return; }
  var nums = seated.map(function(s) { return parseInt(s.replace('seat',''), 10); }).sort(function(a,b){return a-b;});
  var last = (window.state.game && window.state.game.currentDealerSeat) || 0;
  var next = nums.find(function(n){return n>last;}) || nums[0];
  var di   = nums.indexOf(next);
  var sb   = nums[(di+1) % nums.length];
  var bb   = nums[(di+2) % nums.length];

  htApi('/games/' + getGameId() + '/hands', {
    method: 'POST',
    body: JSON.stringify({dealer_seat: next, sb_seat: sb, bb_seat: bb, mode: 'full'}),
  }).then(function(h) {
    if (window.state.game) window.state.game.currentDealerSeat = next;
    hs.currentHand   = h;
    hs.handActions   = [];
    hs.potChips      = 0;
    hs.boardCards    = [];
    hs.holeCards     = {};
    hs.street        = 'pre';
    hs.selectedPlayer = null;
    hs.chipInput     = '';
    hs.editingAssign = false;
    hs.handHistory.unshift(h);
    renderBody();
    renderBoardOnFelt();
    window.showToast && window.showToast('Hand #' + h.hand_no + ' started');
  }).catch(function(e) { window.showToast && window.showToast('⚠️ ' + e.message); });
};

// ── Void hand ────────────────────────────────────────────────────────────────
window.htVoidHand = function() {
  if (!hs.currentHand) return;
  if (!confirm('Void hand #' + hs.currentHand.hand_no + '? This cannot be undone.')) return;
  htApi('/games/' + getGameId() + '/hands/' + hs.currentHand.id, {method: 'DELETE'}).then(function() {
    hs.currentHand   = null;
    hs.handActions   = [];
    hs.potChips      = 0;
    hs.boardCards    = [];
    hs.holeCards     = {};
    hs.street        = 'pre';
    return htApi('/games/' + getGameId() + '/hands');
  }).then(function(hands) {
    hs.handHistory = hands || [];
    if (hands && hands.length > 0) hs.currentHand = hands[0];
    renderBody();
    renderBoardOnFelt();
    window.showToast && window.showToast('Hand voided');
  }).catch(function(e) { window.showToast && window.showToast('⚠️ ' + e.message); });
};

// ── Undo last action ─────────────────────────────────────────────────────────
window.htUndoAction = function() {
  if (!hs.currentHand) return;
  htApi('/games/' + getGameId() + '/hands/' + hs.currentHand.id + '/actions/last', {method: 'DELETE'}).then(function(r) {
    hs.handActions = r.actions;
    hs.potChips    = r.pot_chips;
    renderBody();
    renderBoardOnFelt();
  }).catch(function(e) { window.showToast && window.showToast('⚠️ ' + e.message); });
};

// ── Street navigation ────────────────────────────────────────────────────────
window.htSetStreet = function(s) { hs.street = s; hs.selectedPlayer = null; renderBody(); };

// ── Select player ────────────────────────────────────────────────────────────
window.htSelectPlayer = function(el) {
  var name = el.dataset.player;
  hs.selectedPlayer = (hs.selectedPlayer === name) ? null : name;
  renderBody();
};

// ── Quick chip amount ────────────────────────────────────────────────────────
window.htSetChip = function(n) { hs.chipInput = String(n); renderBody(); };
window.htChipChange = function(val) { hs.chipInput = val; renderBody(); };

// ── Record action ────────────────────────────────────────────────────────────
window.htRecordAction = function(action) {
  if (!hs.currentHand || !hs.selectedPlayer) return;
  var chips = parseInt(hs.chipInput) || 0;
  var pEntry = null;
  Object.values(window.state.players).forEach(function(p) {
    if (p && p.name === hs.selectedPlayer) pEntry = p;
  });
  if (!pEntry) return;
  htApi('/games/' + getGameId() + '/hands/' + hs.currentHand.id + '/actions', {
    method: 'POST',
    body: JSON.stringify({
      user_id: pEntry.userId || null,
      display_name: pEntry.name,
      street: hs.street,
      action: action,
      chips: chips,
    }),
  }).then(function(r) {
    hs.handActions   = r.actions;
    hs.potChips      = r.pot_chips;
    hs.selectedPlayer = null;
    hs.chipInput     = '';
    renderBody();
    renderBoardOnFelt();
  }).catch(function(e) { window.showToast && window.showToast('⚠️ ' + e.message); });
};

// ── Edit D/SB/BB ─────────────────────────────────────────────────────────────
window.htToggleEditAssign = function() { hs.editingAssign = !hs.editingAssign; renderBody(); };
window.htSaveAssign = function() {
  if (!hs.currentHand) return;
  var d  = document.getElementById('htAssignD');
  var sb = document.getElementById('htAssignSB');
  var bb = document.getElementById('htAssignBB');
  htApi('/games/' + getGameId() + '/hands/' + hs.currentHand.id + '/assign', {
    method: 'PUT',
    body: JSON.stringify({
      dealer_seat: d  ? parseInt(d.value)  : hs.currentHand.dealer_seat,
      sb_seat:     sb ? parseInt(sb.value) : hs.currentHand.sb_seat,
      bb_seat:     bb ? parseInt(bb.value) : hs.currentHand.bb_seat,
    }),
  }).then(function(h) {
    hs.currentHand.dealer_seat = h.dealer_seat;
    hs.currentHand.sb_seat     = h.sb_seat;
    hs.currentHand.bb_seat     = h.bb_seat;
    if (window.state.game) window.state.game.currentDealerSeat = h.dealer_seat;
    hs.editingAssign = false;
    renderBody();
    window.showToast && window.showToast('Positions updated');
  }).catch(function(e) { window.showToast && window.showToast('⚠️ ' + e.message); });
};

// ── Board card picker ────────────────────────────────────────────────────────
window.htOpenBoardCard = function(slot) {
  hs.pickerTarget = 'board';
  hs.pickerSlot   = slot;
  renderCardPicker('Pick board card (slot ' + (slot + 1) + ')');
  var s = document.getElementById('cardPickerSheet');
  if (s) s.classList.add('open');
};
window.htOpenHoleCards = function(el) {
  var name = el.dataset.player;
  hs.pickerTarget = name;
  renderCardPicker(name + ' hole cards');
  var s = document.getElementById('cardPickerSheet');
  if (s) s.classList.add('open');
};
window.closeCardPicker = function() {
  var s = document.getElementById('cardPickerSheet');
  if (s) s.classList.remove('open');
};
window.htPickCard = function(el) {
  var card = el.dataset.card;
  var allDealt = hs.boardCards.concat(
    Object.values(hs.holeCards).reduce(function(a, v) { return a.concat(v); }, [])
  );
  if (hs.pickerTarget === 'board') {
    var b = hs.boardCards.slice();
    var ex = b.indexOf(card);
    if (ex !== -1) { b.splice(ex, 1); }
    else { b[hs.pickerSlot] = card; }
    hs.boardCards = b.filter(Boolean);
    if (hs.currentHand) {
      htApi('/games/' + getGameId() + '/hands/' + hs.currentHand.id + '/board', {
        method: 'PUT',
        body: JSON.stringify({board: hs.boardCards}),
      }).catch(function(){});
    }
    renderBoardOnFelt();
  } else {
    var hc = (hs.holeCards[hs.pickerTarget] || []).slice();
    var idx2 = hc.indexOf(card);
    if (idx2 !== -1) hc.splice(idx2, 1);
    else if (hc.length < 2) hc.push(card);
    hs.holeCards[hs.pickerTarget] = hc;
  }
  window.closeCardPicker();
  renderBody();
};

// ── Declare winner ───────────────────────────────────────────────────────────
window.htOpenWinner = function() {
  var cv  = (window.state.game && window.state.game.chip_value) || 0;
  var lbl = document.getElementById('winnerPotLabel');
  if (lbl) lbl.textContent = 'Pot: ' + hs.potChips + ' chips' + (cv ? ' = $' + (hs.potChips * cv / 100).toFixed(2) : '');
  var list = document.getElementById('winnerPlayerList');
  if (!list) return;
  list.innerHTML = '';
  Object.keys(window.state.players).forEach(function(sid) {
    var p = window.state.players[sid];
    if (!p || !p.name) return;
    var bi = window.pBuyin ? window.pBuyin(p) : 0;
    if (!bi) return;
    var folded = hs.handActions.some(function(a) { return a.action === 'fold' && a.display_name === p.name; });
    if (folded) return;
    var hc    = hs.holeCards[p.name] || [];
    var cards = hc.map(function(c) {
      var red = c.indexOf('\u2665') >= 0 || c.indexOf('\u2666') >= 0;
      var d = document.createElement('span');
      d.style.cssText = 'background:#fff;border-radius:2px;padding:1px 4px;font-size:0.75rem;font-weight:700;color:' + (red ? '#d63031' : '#1a1a1a') + ';margin-left:2px';
      d.textContent = c;
      return d.outerHTML;
    }).join('');
    var btn = document.createElement('button');
    btn.className = 'btn-primary';
    btn.style.cssText = 'width:100%;display:flex;align-items:center;gap:10px;padding:10px 14px;margin-bottom:4px;text-align:left';
    var av = document.createElement('div');
    av.style.cssText = 'width:32px;height:32px;border-radius:50%;background:linear-gradient(135deg,#7a5820,#5a3010);display:flex;align-items:center;justify-content:center;font-size:0.75rem;font-weight:700;color:var(--cream);flex-shrink:0';
    av.textContent = (window.inits ? window.inits(p.name) : p.name.slice(0,2).toUpperCase());
    var nm = document.createElement('span');
    nm.style.cssText = 'flex:1;color:var(--cream);font-size:0.9rem;font-weight:600';
    nm.textContent = p.name;
    btn.appendChild(av);
    btn.appendChild(nm);
    if (cards) { var cd = document.createElement('span'); cd.innerHTML = cards; btn.appendChild(cd); }
    btn.dataset.winner = p.name;
    btn.addEventListener('click', function() { window.htDeclareWinner(this.dataset.winner, false); });
    list.appendChild(btn);
  });
  var ov = document.getElementById('winnerOverlay');
  if (ov) ov.classList.add('open');
};
window.closeWinnerOverlay = function() {
  var ov = document.getElementById('winnerOverlay');
  if (ov) ov.classList.remove('open');
};
window.htDeclareWinner = function(winnerName, splitPot) {
  if (!hs.currentHand) return;
  var pEntry = null;
  Object.values(window.state.players).forEach(function(p) {
    if (p && p.name === winnerName) pEntry = p;
  });
  htApi('/games/' + getGameId() + '/hands/' + hs.currentHand.id + '/result', {
    method: 'POST',
    body: JSON.stringify({
      winner_user_id: pEntry ? pEntry.userId : null,
      winner_name:    winnerName,
      hole_cards:     hs.holeCards,
      split_pot:      splitPot || false,
    }),
  }).then(function() {
    window.closeWinnerOverlay();
    hs.currentHand.result = {winner_name: winnerName, pot_chips: hs.potChips};
    renderBody();
    renderBoardOnFelt();
    return htApi('/games/' + getGameId() + '/hands');
  }).then(function(hands) {
    hs.handHistory = hands || [];
    window.showToast && window.showToast('🏆 ' + winnerName + ' wins hand #' + hs.currentHand.hand_no + '!');
  }).catch(function(e) { window.showToast && window.showToast('⚠️ ' + e.message); });
};

// ── Undo winner ──────────────────────────────────────────────────────────────
window.htUndoWinner = function() {
  if (!hs.currentHand || !hs.currentHand.result) return;
  htApi('/games/' + getGameId() + '/hands/' + hs.currentHand.id + '/result', {method: 'DELETE'}).then(function(h) {
    hs.currentHand  = h;
    hs.handActions  = h.actions || [];
    hs.potChips     = h.pot_chips || 0;
    hs.boardCards   = h.board || [];
    var idx = hs.handHistory.findIndex(function(x) { return x.id === h.id; });
    if (idx !== -1) hs.handHistory[idx] = h;
    renderBody();
    renderBoardOnFelt();
    window.showToast && window.showToast('Winner undone — hand reopened');
  }).catch(function(e) { window.showToast && window.showToast('⚠️ ' + e.message); });
};

// ── Render board cards on felt ───────────────────────────────────────────────
function renderBoardOnFelt() {
  var tc = document.getElementById('tableCenter');
  if (!tc) return;
  ['htBoard', 'htPot'].forEach(function(id) {
    var el = document.getElementById(id);
    if (el) el.remove();
  });
  var hand = hs.currentHand;
  if (!hand || hand.result) return;

  // Board row
  var row = document.createElement('div');
  row.id = 'htBoard';
  row.style.cssText = 'display:flex;gap:3px;justify-content:center;margin-top:6px;pointer-events:all';
  for (var slot = 0; slot < 5; slot++) {
    var card = hs.boardCards[slot];
    var isRed = card && (card.indexOf('\u2665') >= 0 || card.indexOf('\u2666') >= 0);
    var el = document.createElement('div');
    el.style.cssText = 'width:clamp(16px,3.5vw,24px);height:clamp(22px,5vw,33px);'
      + 'background:' + (card ? '#fff' : 'rgba(255,255,255,0.07)') + ';'
      + 'border-radius:2px;border:' + (card ? 'none' : '1px dashed rgba(201,168,76,0.3)') + ';'
      + 'display:flex;align-items:center;justify-content:center;cursor:pointer;'
      + 'font-size:clamp(6px,1.4vw,10px);font-weight:700;flex-direction:column;line-height:1.1;'
      + 'color:' + (card ? (isRed ? '#d63031' : '#1a1a1a') : 'rgba(201,168,76,0.3)');
    if (card) {
      // Split into rank and suit spans
      var rank = card.slice(0, -1);
      var suit = card.slice(-1);
      var rs = document.createElement('span'); rs.textContent = rank;
      var ss = document.createElement('span'); ss.textContent = suit;
      el.appendChild(rs);
      el.appendChild(ss);
    } else {
      el.textContent = '?';
    }
    el.dataset.slot = slot;
    el.addEventListener('click', function() { window.htOpenBoardCard(parseInt(this.dataset.slot)); });
    row.appendChild(el);
  }
  tc.appendChild(row);

  // Pot label
  if (hs.potChips > 0) {
    var cv = (window.state.game && window.state.game.chip_value) || 0;
    var pot = document.createElement('div');
    pot.id = 'htPot';
    pot.style.cssText = 'font-size:clamp(0.55rem,1.2vw,0.7rem);color:var(--gold);margin-top:4px;pointer-events:none;letter-spacing:1px';
    pot.textContent = 'POT \u00b7 ' + hs.potChips + ' chips' + (cv ? ' \u00b7 $' + (hs.potChips * cv / 100).toFixed(2) : '');
    tc.appendChild(pot);
  }
}

// ── Render tracker body ──────────────────────────────────────────────────────
function renderBody() {
  var body = document.getElementById('handTrackerBody');
  if (!body) return;
  var undoBtn = document.getElementById('undoActionBtn');
  if (undoBtn) undoBtn.style.display = (hs.currentHand && !hs.currentHand.result && hs.handActions.length > 0) ? '' : 'none';

  var cv = (window.state && window.state.game && window.state.game.chip_value) || 0;
  body.innerHTML = '';

  if (hs.showHistory) {
    renderHistory(body);
    return;
  }

  // Undo winner button
  if (hs.currentHand && hs.currentHand.result) {
    var undoW = document.createElement('button');
    undoW.style.cssText = 'width:100%;background:rgba(231,76,60,0.08);color:var(--red);border:1px solid rgba(231,76,60,0.25);padding:10px;border-radius:var(--rs);font-family:DM Sans,sans-serif;font-size:0.82rem;font-weight:600;cursor:pointer;margin-bottom:12px';
    undoW.textContent = '\u21a9 Wrong winner? Undo & reopen hand';
    undoW.addEventListener('click', window.htUndoWinner);
    body.appendChild(undoW);
  }

  // Start hand button
  if (!hs.currentHand || hs.currentHand.result) {
    var nextNo = hs.currentHand ? (hs.currentHand.hand_no + 1) : 1;
    var startBtn = document.createElement('button');
    startBtn.className = 'btn-primary';
    startBtn.style.cssText = 'width:100%;padding:14px;margin-bottom:16px;font-size:0.9rem';
    startBtn.textContent = '\u25b6 Start Hand #' + nextNo;
    startBtn.addEventListener('click', window.htStartHand);
    body.appendChild(startBtn);
    return;
  }

  if (!hs.currentHand.result) {
    renderActiveHand(body, cv);
  }
}

function renderHistory(body) {
  var hdr = document.createElement('div');
  hdr.style.cssText = 'font-size:0.7rem;text-transform:uppercase;letter-spacing:2px;color:var(--gold-dim);margin-bottom:10px';
  hdr.textContent = 'Hand History';
  body.appendChild(hdr);

  if (!hs.handHistory.length) {
    var empty = document.createElement('div');
    empty.style.cssText = 'color:var(--muted);font-size:0.85rem;text-align:center;padding:20px 0';
    empty.textContent = 'No hands recorded yet';
    body.appendChild(empty);
    return;
  }

  hs.handHistory.forEach(function(h) {
    var row = document.createElement('div');
    row.style.cssText = 'background:var(--bg2);border:1px solid var(--border);border-radius:var(--rs);padding:10px 12px;margin-bottom:8px';
    var top = document.createElement('div');
    top.style.cssText = 'display:flex;justify-content:space-between;align-items:center;margin-bottom:4px';
    var num = document.createElement('span');
    num.style.cssText = 'color:var(--gold);font-weight:700;font-size:0.9rem';
    num.textContent = 'Hand #' + h.hand_no;
    top.appendChild(num);
    var res = document.createElement('span');
    res.style.cssText = 'font-size:0.8rem;color:' + (h.result ? 'var(--green)' : 'var(--muted)');
    res.textContent = h.result ? ('\ud83c\udfc6 ' + (h.result.winner_name || '') + ' \u00b7 ' + h.result.pot_chips + ' chips') : 'In progress';
    top.appendChild(res);
    row.appendChild(top);
    if (h.board && h.board.length) {
      var cards = document.createElement('div');
      cards.style.cssText = 'display:flex;gap:3px;margin-top:4px';
      h.board.forEach(function(c) {
        var isRed = c.indexOf('\u2665') >= 0 || c.indexOf('\u2666') >= 0;
        var cd = document.createElement('div');
        cd.style.cssText = 'width:22px;height:30px;background:#fff;border-radius:2px;display:inline-flex;align-items:center;justify-content:center;font-size:8px;font-weight:700;color:' + (isRed ? '#d63031' : '#1a1a1a');
        cd.textContent = c;
        cards.appendChild(cd);
      });
      row.appendChild(cards);
    }
    body.appendChild(row);
  });
}

function renderActiveHand(body, cv) {
  var h = hs.currentHand;

  // Edit assign or void buttons
  if (hs.editingAssign) {
    var editBox = document.createElement('div');
    editBox.style.cssText = 'background:var(--bg2);border:1px solid rgba(201,168,76,0.3);border-radius:var(--rs);padding:10px 12px;margin-bottom:10px';
    var editHdr = document.createElement('div');
    editHdr.style.cssText = 'font-size:0.7rem;text-transform:uppercase;letter-spacing:2px;color:var(--gold);margin-bottom:8px';
    editHdr.textContent = 'Edit positions';
    editBox.appendChild(editHdr);

    var grid = document.createElement('div');
    grid.style.cssText = 'display:grid;grid-template-columns:1fr 1fr 1fr;gap:6px;margin-bottom:8px';
    var seatedNums = Object.keys(window.state.players)
      .filter(function(sid) { var p = window.state.players[sid]; return p && p.name && (window.pBuyin ? window.pBuyin(p) > 0 : true); })
      .map(function(sid) { return parseInt(sid.replace('seat',''), 10); })
      .sort(function(a,b){return a-b;});

    [['htAssignD','Dealer',h.dealer_seat],['htAssignSB','Small Blind',h.sb_seat],['htAssignBB','Big Blind',h.bb_seat]].forEach(function(cfg) {
      var wrap = document.createElement('div');
      var lbl = document.createElement('div');
      lbl.style.cssText = 'font-size:0.65rem;color:var(--muted);margin-bottom:3px';
      lbl.textContent = cfg[1];
      var sel = document.createElement('select');
      sel.id = cfg[0];
      sel.style.cssText = 'width:100%;background:var(--bg3);border:1px solid var(--border);color:var(--cream);padding:5px;border-radius:4px;font-family:DM Sans,sans-serif;font-size:0.8rem';
      seatedNums.forEach(function(n) {
        var opt = document.createElement('option');
        opt.value = n;
        opt.textContent = 'Seat ' + n;
        if (n === cfg[2]) opt.selected = true;
        sel.appendChild(opt);
      });
      wrap.appendChild(lbl);
      wrap.appendChild(sel);
      grid.appendChild(wrap);
    });
    editBox.appendChild(grid);

    var btnRow = document.createElement('div');
    btnRow.style.cssText = 'display:flex;gap:6px';
    var save = document.createElement('button');
    save.style.cssText = 'flex:1;padding:7px;background:var(--gold);color:#000;border:none;border-radius:4px;cursor:pointer;font-size:0.8rem;font-weight:700;font-family:DM Sans,sans-serif';
    save.textContent = 'Save';
    save.addEventListener('click', window.htSaveAssign);
    var cancel = document.createElement('button');
    cancel.style.cssText = 'flex:1;padding:7px;background:none;border:1px solid var(--border);color:var(--muted);border-radius:4px;cursor:pointer;font-size:0.8rem;font-family:DM Sans,sans-serif';
    cancel.textContent = 'Cancel';
    cancel.addEventListener('click', window.htToggleEditAssign);
    btnRow.appendChild(save);
    btnRow.appendChild(cancel);
    editBox.appendChild(btnRow);
    body.appendChild(editBox);
  } else {
    var ctrlRow = document.createElement('div');
    ctrlRow.style.cssText = 'display:flex;gap:6px;margin-bottom:10px';
    var editBtn = document.createElement('button');
    editBtn.style.cssText = 'flex:1;padding:6px;background:none;border:1px solid var(--border);color:var(--muted);border-radius:4px;cursor:pointer;font-size:0.72rem;font-family:DM Sans,sans-serif';
    editBtn.textContent = '\u270f\ufe0f Edit D/SB/BB';
    editBtn.addEventListener('click', window.htToggleEditAssign);
    var voidBtn = document.createElement('button');
    voidBtn.style.cssText = 'padding:6px 12px;background:rgba(231,76,60,0.08);border:1px solid rgba(231,76,60,0.2);color:var(--red);border-radius:4px;cursor:pointer;font-size:0.72rem;font-family:DM Sans,sans-serif';
    voidBtn.textContent = '\u2715 Void Hand';
    voidBtn.addEventListener('click', window.htVoidHand);
    ctrlRow.appendChild(editBtn);
    ctrlRow.appendChild(voidBtn);
    body.appendChild(ctrlRow);
  }

  // Street tabs
  var tabs = document.createElement('div');
  tabs.style.cssText = 'display:flex;gap:4px;margin-bottom:12px';
  ['pre','flop','turn','river'].forEach(function(s) {
    var t = document.createElement('button');
    var active = hs.street === s;
    t.style.cssText = 'flex:1;padding:6px 4px;border-radius:4px;cursor:pointer;font-size:0.7rem;font-weight:700;text-transform:uppercase;letter-spacing:0.06em;font-family:DM Sans,sans-serif;'
      + 'border:1px solid ' + (active ? 'rgba(201,168,76,0.4)' : 'rgba(201,168,76,0.1)') + ';'
      + 'background:' + (active ? 'rgba(201,168,76,0.15)' : 'none') + ';'
      + 'color:' + (active ? 'var(--gold)' : 'var(--muted)');
    t.textContent = s;
    t.dataset.street = s;
    t.addEventListener('click', function() { window.htSetStreet(this.dataset.street); });
    tabs.appendChild(t);
  });
  body.appendChild(tabs);

  // Player rows
  var plHdr = document.createElement('div');
  plHdr.style.cssText = 'font-size:0.7rem;text-transform:uppercase;letter-spacing:2px;color:var(--gold-dim);margin-bottom:8px';
  plHdr.textContent = 'Select player then action';
  body.appendChild(plHdr);

  Object.keys(window.state.players).forEach(function(sid) {
    var p = window.state.players[sid];
    if (!p || !p.name) return;
    var bi = window.pBuyin ? window.pBuyin(p) : 0;
    if (!bi) return;

    var seatNum   = parseInt(sid.replace('seat',''), 10);
    var isD       = seatNum === h.dealer_seat;
    var isSB      = seatNum === h.sb_seat;
    var isBB      = seatNum === h.bb_seat;
    var streetActs = hs.handActions.filter(function(a) { return a.street === hs.street && a.display_name === p.name; });
    var lastAct   = streetActs[streetActs.length - 1];
    var isFolded  = hs.handActions.some(function(a) { return a.action === 'fold' && a.display_name === p.name; });
    var isSel     = hs.selectedPlayer === p.name;
    var hc        = hs.holeCards[p.name] || [];

    var row = document.createElement('div');
    row.style.cssText = 'display:flex;align-items:center;gap:8px;padding:8px 10px;margin-bottom:4px;border-radius:var(--rs);'
      + 'cursor:' + (isFolded ? 'default' : 'pointer') + ';'
      + 'background:' + (isSel ? 'rgba(201,168,76,0.1)' : isFolded ? 'rgba(0,0,0,0.2)' : 'var(--bg2)') + ';'
      + 'border:1px solid ' + (isSel ? 'rgba(201,168,76,0.4)' : 'var(--border)') + ';'
      + 'opacity:' + (isFolded ? '0.4' : '1');
    row.dataset.player = p.name;
    if (!isFolded) row.addEventListener('click', function(e) {
      if (!e.target.closest('[data-hcbtn]')) window.htSelectPlayer(this);
    });

    // Avatar
    var av = document.createElement('div');
    av.style.cssText = 'width:36px;height:36px;border-radius:50%;background:linear-gradient(135deg,#7a5820,#5a3010);display:flex;align-items:center;justify-content:center;font-size:0.75rem;font-weight:700;color:var(--cream);flex-shrink:0';
    av.textContent = window.inits ? window.inits(p.name) : p.name.slice(0,2).toUpperCase();
    row.appendChild(av);

    // Name + badges + last action
    var info = document.createElement('div');
    info.style.cssText = 'flex:1;min-width:0';
    var nameLine = document.createElement('div');
    nameLine.style.cssText = 'display:flex;align-items:center;gap:4px';
    var nm = document.createElement('span');
    nm.style.cssText = 'font-size:0.9rem;color:var(--cream);font-weight:600';
    nm.textContent = p.name;
    nameLine.appendChild(nm);
    if (isD) {
      var db = document.createElement('span');
      db.style.cssText = 'width:16px;height:16px;border-radius:50%;background:var(--gold);color:#000;font-size:0.6rem;font-weight:700;display:inline-flex;align-items:center;justify-content:center;flex-shrink:0';
      db.textContent = 'D';
      nameLine.appendChild(db);
    }
    if (isSB) {
      var sb2 = document.createElement('span');
      sb2.style.cssText = 'background:rgba(58,106,170,0.3);color:#6aaaee;font-size:0.6rem;font-weight:700;padding:1px 4px;border-radius:2px';
      sb2.textContent = 'SB';
      nameLine.appendChild(sb2);
    }
    if (isBB) {
      var bb2 = document.createElement('span');
      bb2.style.cssText = 'background:rgba(170,58,58,0.3);color:#ee8888;font-size:0.6rem;font-weight:700;padding:1px 4px;border-radius:2px';
      bb2.textContent = 'BB';
      nameLine.appendChild(bb2);
    }
    info.appendChild(nameLine);
    var sub = document.createElement('div');
    sub.style.cssText = 'font-size:0.72rem;color:' + (isFolded ? 'var(--muted)' : lastAct ? 'var(--gold)' : 'var(--muted)') + ';margin-top:1px';
    sub.textContent = isFolded ? '\u2715 Folded' : (lastAct ? (lastAct.action + (lastAct.chips > 0 ? ' ' + lastAct.chips + ' chips' : '')) : 'Waiting');
    info.appendChild(sub);
    row.appendChild(info);

    // Hole cards button
    var hcBtn = document.createElement('div');
    hcBtn.dataset.hcbtn = '1';
    hcBtn.dataset.player = p.name;
    hcBtn.style.cssText = 'display:flex;gap:2px;align-items:center;padding:3px 6px;border-radius:3px;border:1px solid var(--border);cursor:pointer;background:var(--bg3)';
    hcBtn.addEventListener('click', function(e) { e.stopPropagation(); window.htOpenHoleCards(this); });
    if (hc.length > 0) {
      hc.forEach(function(c) {
        var isRed = c.indexOf('\u2665') >= 0 || c.indexOf('\u2666') >= 0;
        var cs = document.createElement('span');
        cs.style.cssText = 'background:#fff;border-radius:2px;padding:1px 3px;font-size:0.65rem;font-weight:700;color:' + (isRed ? '#d63031' : '#1a1a1a');
        cs.textContent = c;
        hcBtn.appendChild(cs);
      });
    } else {
      hcBtn.textContent = '\ud83c\udca0\ud83c\udca0';
    }
    row.appendChild(hcBtn);
    body.appendChild(row);
  });

  // Action buttons (shown when player selected)
  if (hs.selectedPlayer) {
    var actBox = document.createElement('div');
    actBox.style.cssText = 'background:var(--bg2);border:1px solid var(--border2);border-radius:var(--r);padding:12px;margin-top:8px;margin-bottom:12px';

    var selLbl = document.createElement('div');
    selLbl.style.cssText = 'font-size:0.75rem;color:var(--gold);margin-bottom:8px;font-weight:600';
    selLbl.textContent = hs.selectedPlayer;
    actBox.appendChild(selLbl);

    // Action buttons row
    var actRow = document.createElement('div');
    actRow.style.cssText = 'display:flex;gap:4px;margin-bottom:8px';
    [
      {a:'fold',  lbl:'Fold',   bg:'rgba(231,76,60,0.12)',   col:'#e74c3c', br:'rgba(231,76,60,0.3)'},
      {a:'check', lbl:'Check',  bg:'rgba(107,140,110,0.12)', col:'var(--muted)', br:'var(--border)'},
      {a:'call',  lbl:'Call',   bg:'rgba(58,106,170,0.15)',  col:'#6aaaee', br:'rgba(58,106,170,0.3)'},
      {a:'raise', lbl:'Raise',  bg:'rgba(201,168,76,0.12)',  col:'var(--gold)', br:'rgba(201,168,76,0.3)'},
      {a:'allin', lbl:'All-in', bg:'rgba(46,204,113,0.12)', col:'var(--green)', br:'rgba(46,204,113,0.3)'},
    ].forEach(function(cfg) {
      var b = document.createElement('button');
      b.style.cssText = 'flex:1;padding:8px 4px;background:' + cfg.bg + ';color:' + cfg.col + ';border:1px solid ' + cfg.br + ';border-radius:4px;cursor:pointer;font-size:0.78rem;font-weight:700;font-family:DM Sans,sans-serif';
      b.textContent = cfg.lbl;
      b.dataset.action = cfg.a;
      b.addEventListener('click', function() { window.htRecordAction(this.dataset.action); });
      actRow.appendChild(b);
    });
    actBox.appendChild(actRow);

    // Quick chip buttons
    var chipRow = document.createElement('div');
    chipRow.style.cssText = 'display:flex;gap:4px;flex-wrap:wrap;margin-bottom:8px';
    [2,4,8,10,20,30,40,50,100].forEach(function(n) {
      var b = document.createElement('button');
      var sel2 = hs.chipInput === String(n);
      b.style.cssText = 'padding:4px 8px;background:' + (sel2?'var(--gold)':'var(--bg3)') + ';color:' + (sel2?'#000':'var(--cream2)') + ';border:1px solid var(--border);border-radius:3px;cursor:pointer;font-size:0.75rem;font-family:DM Sans,sans-serif;font-weight:500';
      b.textContent = String(n);
      b.dataset.chips = n;
      b.addEventListener('click', function() { window.htSetChip(parseInt(this.dataset.chips)); });
      chipRow.appendChild(b);
    });
    actBox.appendChild(chipRow);

    // Manual input + $ conversion
    var inputRow = document.createElement('div');
    inputRow.style.cssText = 'display:flex;gap:6px;align-items:center';
    var inp = document.createElement('input');
    inp.id = 'htChipInput';
    inp.type = 'number';
    inp.min = '0';
    inp.value = hs.chipInput || '';
    inp.placeholder = 'chips';
    inp.style.cssText = 'flex:1;background:rgba(4,12,5,0.9);border:1px solid var(--border);color:var(--cream);padding:8px 10px;font-size:0.9rem;border-radius:var(--rs);outline:none;font-family:DM Sans,sans-serif';
    inp.addEventListener('input', function() { window.htChipChange(this.value); });
    inputRow.appendChild(inp);
    var chipNum = parseInt(hs.chipInput) || 0;
    if (cv && chipNum > 0) {
      var cvLbl = document.createElement('span');
      cvLbl.style.cssText = 'font-size:0.8rem;color:var(--gold);white-space:nowrap';
      cvLbl.textContent = '= $' + (chipNum * cv / 100).toFixed(2);
      inputRow.appendChild(cvLbl);
    }
    actBox.appendChild(inputRow);
    body.appendChild(actBox);
  }

  // Declare winner button
  var winBtn = document.createElement('button');
  winBtn.style.cssText = 'width:100%;background:rgba(46,204,113,0.1);color:var(--green);border:1px solid rgba(46,204,113,0.3);padding:12px;border-radius:var(--r);font-family:DM Sans,sans-serif;font-size:0.9rem;font-weight:700;cursor:pointer;margin-top:4px';
  winBtn.textContent = '\ud83c\udfc6 Declare Winner';
  winBtn.addEventListener('click', window.htOpenWinner);
  body.appendChild(winBtn);
}

// ── Card picker ──────────────────────────────────────────────────────────────
function renderCardPicker(title) {
  var titleEl = document.getElementById('cardPickerTitle');
  if (titleEl) titleEl.textContent = title;
  var body = document.getElementById('cardPickerBody');
  if (!body) return;
  body.innerHTML = '';

  var allDealt = hs.boardCards.concat(
    Object.values(hs.holeCards).reduce(function(a, v) { return a.concat(v); }, [])
  );
  var currentSel = hs.pickerTarget === 'board' ? hs.boardCards : (hs.holeCards[hs.pickerTarget] || []);

  ['\u2660','\u2665','\u2666','\u2663'].forEach(function(suit) {
    var isRed = suit === '\u2665' || suit === '\u2666';
    var row = document.createElement('div');
    row.style.cssText = 'display:flex;gap:3px;margin-bottom:6px;align-items:center';
    var sl = document.createElement('span');
    sl.style.cssText = 'width:16px;font-size:0.9rem;color:' + (isRed ? '#d63031' : '#f0e6c8') + ';flex-shrink:0';
    sl.textContent = suit;
    row.appendChild(sl);
    ['A','K','Q','J','T','9','8','7','6','5','4','3','2'].forEach(function(rank) {
      var card  = rank + suit;
      var dealt = allDealt.includes(card) && !currentSel.includes(card);
      var sel2  = currentSel.includes(card);
      var b = document.createElement('button');
      b.style.cssText = 'flex:1;min-width:0;padding:5px 2px;'
        + 'background:' + (sel2 ? 'var(--gold)' : dealt ? 'rgba(107,140,110,0.08)' : 'rgba(240,230,200,0.06)') + ';'
        + 'color:' + (sel2 ? '#000' : dealt ? 'rgba(107,140,110,0.3)' : isRed ? '#e74c3c' : '#f0e6c8') + ';'
        + 'border:1px solid ' + (sel2 ? 'var(--gold)' : dealt ? 'transparent' : 'rgba(201,168,76,0.15)') + ';'
        + 'border-radius:3px;cursor:' + (dealt ? 'not-allowed' : 'pointer') + ';'
        + 'font-size:clamp(0.6rem,2vw,0.78rem);font-weight:700;font-family:DM Sans,sans-serif';
      b.textContent = rank;
      b.dataset.card = card;
      if (!dealt) b.addEventListener('click', function() { window.htPickCard(this); });
      row.appendChild(b);
    });
    body.appendChild(row);
  });
}

// ── Boot on load ─────────────────────────────────────────────────────────────
waitForState(function() {
  // Show/hide tracker tab based on current game state
  var htBtn  = document.getElementById('handTrackerBtn');
  var trkBtn = document.getElementById('trackHandsBtn');
  var game   = window.state && window.state.game;
  if (htBtn)  htBtn.style.display = (game && game.hand_tracking) ? '' : 'none';
  if (trkBtn) trkBtn.style.color  = (game && game.hand_tracking) ? 'var(--gold)' : 'var(--muted)';
  if (game && game.hand_tracking) loadCurrentHand();
});

})();
