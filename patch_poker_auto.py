from pathlib import Path
import subprocess

def find_target():
    exts = {".ts", ".tsx", ".js", ".jsx"}
    roots = [Path("frontend"), Path(".")]
    candidates = []

    for root in roots:
        if not root.exists():
            continue
        for p in root.rglob("*"):
            if p.is_file() and p.suffix in exts:
                try:
                    txt = p.read_text(encoding="utf-8", errors="ignore")
                except Exception:
                    continue
                if "computeNextPlayer" in txt and "window.htAct" in txt:
                    candidates.append(p)

    if not candidates:
        raise SystemExit("Could not find a file containing both computeNextPlayer and window.htAct")

    candidates.sort(key=lambda p: (0 if "page.tsx" in str(p) else 1, len(str(p))))
    return candidates[0]

def replace_function(src, anchor, new_code):
    start = src.find(anchor)
    if start == -1:
        raise Exception(f"Could not find anchor: {anchor}")

    brace_start = src.find("{", start)
    if brace_start == -1:
        raise Exception(f"Could not find opening brace for: {anchor}")

    depth = 0
    i = brace_start
    while i < len(src):
        ch = src[i]
        if ch == "{":
            depth += 1
        elif ch == "}":
            depth -= 1
            if depth == 0:
                end = i + 1
                if src[end:end+1] == ";":
                    end += 1
                return src[:start] + new_code + src[end:]
        i += 1

    raise Exception(f"Could not find closing brace for: {anchor}")

target = find_target()
text = target.read_text(encoding="utf-8", errors="ignore")
print(f"Target file: {target}")

new_compute = """function computeNextPlayer(street, actions, hand) {
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

  // Include all active players, including all-in players, when setting the amount to match
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

new_htact = """window.htAct = function(action, playerName) {
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
            if (sh) sh.classList.add('open');
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
};"""

text = replace_function(text, "function computeNextPlayer", new_compute)
print("+ replaced computeNextPlayer")

# handle either "function(action,playerName)" or spaced version
if "window.htAct = function(action,playerName)" in text:
    text = replace_function(text, "window.htAct = function(action,playerName)", new_htact)
else:
    text = replace_function(text, "window.htAct = function(action, playerName)", new_htact)
print("+ replaced htAct")

target.write_text(text, encoding="utf-8")
print(f"+ wrote changes to {target}")
