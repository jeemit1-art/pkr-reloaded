from pathlib import Path

FILE = Path("frontend/src/app/games/[id]/play/page.tsx")
text = FILE.read_text()

def replace_function(src, anchor, new_code):
    start = src.find(anchor)
    if start == -1:
        raise Exception(f"Could not find: {anchor}")

    brace_start = src.find("{", start)
    depth = 0
    i = brace_start

    while i < len(src):
        if src[i] == "{":
            depth += 1
        elif src[i] == "}":
            depth -= 1
            if depth == 0:
                end = i + 1
                if src[end:end+1] == ";":
                    end += 1
                return src[:start] + new_code + src[end:]
        i += 1

    raise Exception("Brace match failed")

NEW_COMPUTE = """function computeNextPlayer(street, actions, hand) {
  if (!hand) return null;
  var seated = getSeated();
  if (!seated.length) return null;

  var folded = {}, allin = {};
  actions.forEach(function(a) {
    if (a.action === 'fold') folded[a.display_name] = true;
    if (a.action === 'allin') allin[a.display_name] = true;
  });

  var active = seated.filter(function(p) { return !folded[p.name]; });
  var canAct = active.filter(function(p) { return !allin[p.name]; });

  if (active.length <= 1 || canAct.length === 0) return null;

  var streetActs = actions.filter(function(a) { return a.street === street; });
  var chips = {};
  seated.forEach(function(p) { chips[p.name] = 0; });
  streetActs.forEach(function(a) {
    if (a.chips > 0) chips[a.display_name] = (chips[a.display_name] || 0) + a.chips;
  });

  var maxBet = Math.max.apply(null, [0].concat(active.map(function(p) {
    return chips[p.name] || 0;
  })));

  var voluntary = {};
  streetActs.forEach(function(a) {
    if (a.action !== 'post' && a.action !== 'straddle') {
      voluntary[a.display_name] = a;
    }
  });

  var huMode = seated.length === 2;
  var sbSeat = hand.sb_seat, bbSeat = hand.bb_seat, dSeat = hand.dealer_seat, strSeat = hs.straddleSeat;

  var cwOrder = buildClockwiseOrder(
    gameInfo().seats || Math.max.apply(null, seated.map(function(p) { return p.seat; }).concat([9]))
  );
  var cwSeats = cwOrder.filter(function(s) {
    return seated.some(function(p) { return p.seat === s; });
  });

  function nextCwSeatAfter(targetSeat) {
    var idx = cwSeats.indexOf(targetSeat);
    if (idx === -1) idx = 0;
    for (var j = 1; j <= cwSeats.length; j++) {
      var ns = cwSeats[(idx + j) % cwSeats.length];
      var f = canAct.find(function(p) { return p.seat === ns; });
      if (f) return f;
    }
    return null;
  }

  var firstActor;
  if (street === 'pre') {
    if (huMode) {
      firstActor = canAct.find(function(p) { return p.seat === dSeat; }) || canAct[0];
    } else {
      firstActor = nextCwSeatAfter(strSeat || bbSeat);
    }
  } else {
    if (huMode) {
      firstActor = canAct.find(function(p) { return p.seat !== dSeat; }) || canAct[0];
    } else {
      firstActor = canAct.find(function(p) { return p.seat === sbSeat; }) || nextCwSeatAfter(dSeat);
    }
  }
  if (!firstActor) firstActor = canAct[0];

  var faIdx = cwSeats.indexOf(firstActor.seat);
  if (faIdx === -1) faIdx = 0;

  var ordered = [];
  for (var k = 0; k < cwSeats.length; k++) {
    var s = cwSeats[(faIdx + k) % cwSeats.length];
    var pl = canAct.find(function(p) { return p.seat === s; });
    if (pl) ordered.push(pl);
  }

  for (var m = 0; m < ordered.length; m++) {
    var pl2 = ordered[m];
    var myChips = chips[pl2.name] || 0;
    var myAct = voluntary[pl2.name];
    var matched = myChips >= maxBet;

    if (!myAct) return pl2.name;
    if (!matched) return pl2.name;
  }

  return null;
}"""

NEW_HTACT = """window.htAct = function(action, playerName) {
  if (!hs.hand) return;

  var chips = parseInt(hs.chipInput) || 0;

  if (action === 'call') {
    var sm = {};
    hs.actions.filter(a => a.street === hs.street)
      .forEach(a => { if (a.chips > 0) sm[a.display_name] = (sm[a.display_name] || 0) + a.chips; });

    var mb = Math.max(0, ...Object.values(sm));
    chips = Math.max(0, mb - (sm[playerName] || 0));

    if (chips <= 0) {
      toast('Nothing to call');
      return;
    }
  }

  var pE = Object.values(window.state.players).find(p => p && p.name === playerName);

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
      var order = ['pre','flop','turn','river'];
      var i = order.indexOf(hs.street);
      if (i >= 0 && i < 3) {
        hs.street = order[i+1];
        toast('Next street');
      }
    }

    renderBody();
    renderBoardOnFelt();
  }).catch(e => toast(e.message));
};"""

text = replace_function(text, "function computeNextPlayer", NEW_COMPUTE)
text = replace_function(text, "window.htAct = function", NEW_HTACT)

FILE.write_text(text)

print("SUCCESS: poker logic patched")
