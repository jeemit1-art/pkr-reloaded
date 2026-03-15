#!/usr/bin/env python3
"""
Add side pot calculator to hand-tracker.js
- Calculates multiple side pots when players go all-in
- Shows who is eligible for each pot
- Displays $ value of each pot
- Integrates into the board/pot display area in the tracker sheet
"""

HT = '/workspaces/pkr-reloaded/frontend/public/hand-tracker.js'

with open(HT, 'r') as f:
    c = f.read()

def patch(old, new, label):
    global c
    if old in c:
        c = c.replace(old, new, 1)
        print(f'✅ {label}')
        return True
    print(f'❌ {label}')
    return False

# ── 1. Add side pot calculation function ─────────────────────────────────────
SIDE_POT_FN = """
// ── Side pot calculator ───────────────────────────────────────────────────────
// Returns array of {chips, eligible: [playerName], label}
function calculateSidePots(actions, seated) {
  if (!seated || !seated.length) return [];

  var folded = {};
  actions.forEach(function(a) { if (a.action === 'fold') folded[a.display_name] = true; });

  // Total chips each player has put in across ALL streets
  var totalChips = {};
  seated.forEach(function(p) { totalChips[p.name] = 0; });
  actions.forEach(function(a) {
    if (a.chips > 0) totalChips[a.display_name] = (totalChips[a.display_name] || 0) + a.chips;
  });

  // All-in amounts per player (total contribution when they went all-in)
  var allinAt = {}; // playerName -> chips at time of all-in
  actions.forEach(function(a) {
    if (a.action === 'allin') {
      allinAt[a.display_name] = totalChips[a.display_name];
    }
  });

  var allinPlayers = Object.keys(allinAt);
  if (allinPlayers.length === 0) return []; // no side pots needed

  // Sort all-in levels ascending
  var levels = allinPlayers
    .map(function(name) { return allinAt[name]; })
    .filter(function(v, i, arr) { return arr.indexOf(v) === i; }) // unique
    .sort(function(a, b) { return a - b; });

  // Add a final level for the remaining pot (non-allin callers)
  var maxContrib = Math.max.apply(null, Object.values(totalChips).concat([0]));
  if (levels.indexOf(maxContrib) < 0) levels.push(maxContrib);

  var pots = [];
  var prevLevel = 0;

  levels.forEach(function(level) {
    if (level <= prevLevel) return;
    var potChips = 0;
    var eligible = [];

    seated.forEach(function(pl) {
      var contrib = totalChips[pl.name] || 0;
      var thisLevel = Math.min(contrib, level) - Math.min(contrib, prevLevel);
      if (thisLevel > 0) potChips += thisLevel;
      // Eligible = contributed at least to this level AND not folded
      if (!folded[pl.name] && contrib >= level) eligible.push(pl.name);
      // Also eligible if they went all-in exactly at this level
      if (!folded[pl.name] && allinAt[pl.name] === level) {
        if (eligible.indexOf(pl.name) < 0) eligible.push(pl.name);
      }
    });

    if (potChips > 0) {
      pots.push({ chips: potChips, eligible: eligible, level: level });
    }
    prevLevel = level;
  });

  // Label them
  if (pots.length === 1) {
    pots[0].label = 'Main Pot';
  } else {
    pots[0].label = 'Main Pot';
    for (var i = 1; i < pots.length; i++) {
      pots[i].label = 'Side Pot ' + i;
    }
  }

  return pots;
}

"""

# Insert before renderBoardOnFelt
patch(
    "function renderBoardOnFelt(){",
    SIDE_POT_FN + "function renderBoardOnFelt(){",
    'side pot calculator function added'
)

# ── 2. Replace the pot display in the board row with side pot aware display ──
old_pot = """  if(hs.pot>0){
    var pl3=document.createElement('div');pl3.style.cssText='font-size:0.75rem;color:var(--gold);font-weight:700;text-align:right;flex-shrink:0';
    // Check for side pots (multiple all-ins)
    var allinAmounts=[];
    var allAllinCheck={};
    hs.actions.forEach(function(a){if(a.action==='allin')allAllinCheck[a.display_name]=(allAllinCheck[a.display_name]||0)+(a.chips||0);});
    var allinPlayers=Object.keys(allAllinCheck);
    if(allinPlayers.length>=2){
      pl3.innerHTML='<div>'+hs.pot+'</div><div style="font-size:0.6rem;color:var(--muted);font-weight:400">'+(cv?'$'+(hs.pot*cv/100).toFixed(2):'chips')+'</div><div style="font-size:0.58rem;color:rgba(201,168,76,0.6);margin-top:1px">side pots</div>';
    } else {
      pl3.innerHTML='<div>'+hs.pot+'</div><div style="font-size:0.6rem;color:var(--muted);font-weight:400">'+(cv?'$'+(hs.pot*cv/100).toFixed(2):'chips')+'</div>';
    }
    boardRow.appendChild(pl3);
  }"""

new_pot = """  if(hs.pot>0){
    var sidePots=calculateSidePots(hs.actions,seated);
    var pl3=document.createElement('div');pl3.style.cssText='font-size:0.75rem;color:var(--gold);font-weight:700;text-align:right;flex-shrink:0';
    if(sidePots.length>1){
      pl3.innerHTML='<div style="font-size:0.6rem;color:rgba(201,168,76,0.7);font-weight:600;margin-bottom:2px">POTS</div><div>'+hs.pot+'</div><div style="font-size:0.6rem;color:var(--muted);font-weight:400">'+(cv?'$'+(hs.pot*cv/100).toFixed(2):'chips')+'</div>';
    } else {
      pl3.innerHTML='<div>'+hs.pot+'</div><div style="font-size:0.6rem;color:var(--muted);font-weight:400">'+(cv?'$'+(hs.pot*cv/100).toFixed(2):'chips')+'</div>';
    }
    boardRow.appendChild(pl3);
  }"""

patch(old_pot, new_pot, 'board row pot display updated')

# ── 3. Add side pot breakdown section after board row ────────────────────────
old_tabs = """  // Street chip totals
  var scm={};seated.forEach(function(p){scm[p.name]=0;});
  hs.actions.filter(function(a){return a.street===hs.street;}).forEach(function(a){if(a.chips>0)scm[a.display_name]=(scm[a.display_name]||0)+a.chips;});
  var maxBet=Math.max.apply(null,[0].concat(Object.values(scm)));"""

new_tabs = """  // Side pot breakdown (shown when 2+ all-ins)
  var sidePots2=calculateSidePots(hs.actions,seated);
  if(sidePots2.length>1){
    var spBox=document.createElement('div');
    spBox.style.cssText='background:rgba(0,0,0,0.2);border:1px solid rgba(201,168,76,0.15);border-radius:8px;padding:8px 12px;margin-bottom:10px';
    var spHdr=document.createElement('div');
    spHdr.style.cssText='font-size:0.6rem;text-transform:uppercase;letter-spacing:1.5px;color:rgba(201,168,76,0.6);margin-bottom:6px;font-weight:600';
    spHdr.textContent='Side Pots';
    spBox.appendChild(spHdr);
    sidePots2.forEach(function(pot){
      var row2=document.createElement('div');
      row2.style.cssText='display:flex;align-items:flex-start;justify-content:space-between;margin-bottom:5px;gap:8px';
      // Left: label + eligible players
      var left=document.createElement('div');
      var lbl=document.createElement('div');
      lbl.style.cssText='font-size:0.72rem;color:var(--gold);font-weight:700;margin-bottom:2px';
      lbl.textContent=pot.label;
      left.appendChild(lbl);
      // Eligible player avatars/names
      var elig=document.createElement('div');
      elig.style.cssText='display:flex;gap:3px;flex-wrap:wrap';
      pot.eligible.forEach(function(name){
        var chip=document.createElement('div');
        chip.style.cssText='font-size:0.62rem;padding:1px 6px;border-radius:10px;background:rgba(201,168,76,0.12);color:var(--cream2);border:1px solid rgba(201,168,76,0.2);white-space:nowrap';
        chip.textContent=window.inits?window.inits(name):name.slice(0,2).toUpperCase();
        chip.title=name;
        elig.appendChild(chip);
      });
      if(pot.eligible.length===0){
        var na=document.createElement('span');
        na.style.cssText='font-size:0.62rem;color:var(--muted)';
        na.textContent='(none eligible)';
        elig.appendChild(na);
      }
      left.appendChild(elig);
      row2.appendChild(left);
      // Right: chip amount + $
      var right=document.createElement('div');
      right.style.cssText='text-align:right;flex-shrink:0';
      var chipsLbl=document.createElement('div');
      chipsLbl.style.cssText='font-size:0.78rem;color:var(--gold);font-weight:700';
      chipsLbl.textContent=pot.chips+' chips';
      right.appendChild(chipsLbl);
      if(cv&&pot.chips>0){
        var dolLbl=document.createElement('div');
        dolLbl.style.cssText='font-size:0.65rem;color:var(--muted)';
        dolLbl.textContent='$'+(pot.chips*cv/100).toFixed(2);
        right.appendChild(dolLbl);
      }
      row2.appendChild(right);
      spBox.appendChild(row2);
      // Divider between pots
    });
    body.appendChild(spBox);
  }

  // Street chip totals
  var scm={};seated.forEach(function(p){scm[p.name]=0;});
  hs.actions.filter(function(a){return a.street===hs.street;}).forEach(function(a){if(a.chips>0)scm[a.display_name]=(scm[a.display_name]||0)+a.chips;});
  var maxBet=Math.max.apply(null,[0].concat(Object.values(scm)));"""

patch(old_tabs, new_tabs, 'side pot breakdown section added after board row')

# ── 4. Update winner view to show pot-specific winner selection ───────────────
old_winner_hdr = """  var pl4=document.createElement('div');pl4.style.cssText='font-size:0.8rem;color:var(--gold);margin-bottom:14px';pl4.textContent='Pot: '+hs.pot+' chips'+(cv?' = $'+(hs.pot*cv/100).toFixed(2):'');body.appendChild(pl4);
  var f2={};hs.actions.forEach(function(a){if(a.action==='fold')f2[a.display_name]=true;});
  getSeated().forEach(function(pl){
    if(f2[pl.name])return;"""

new_winner_hdr = """  var sidePots3=calculateSidePots(hs.actions,getSeated());
  if(sidePots3.length>1){
    // Show side pot breakdown in winner view
    var spInfo=document.createElement('div');
    spInfo.style.cssText='background:rgba(0,0,0,0.2);border:1px solid rgba(201,168,76,0.15);border-radius:8px;padding:8px 12px;margin-bottom:12px';
    sidePots3.forEach(function(pot){
      var pr=document.createElement('div');pr.style.cssText='display:flex;justify-content:space-between;align-items:center;margin-bottom:4px;font-size:0.75rem';
      var pl=document.createElement('span');pl.style.color='var(--gold)';pl.textContent=pot.label+': '+pot.chips+' chips'+(cv?' ($'+(pot.chips*cv/100).toFixed(2)+')':'');
      var pe=document.createElement('span');pe.style.cssText='font-size:0.65rem;color:var(--muted)';pe.textContent='Eligible: '+pot.eligible.join(', ');
      pr.appendChild(pl);pr.appendChild(pe);spInfo.appendChild(pr);
    });
    body.appendChild(spInfo);
    var pl4=document.createElement('div');pl4.style.cssText='font-size:0.8rem;color:var(--gold);margin-bottom:10px;font-weight:600';pl4.textContent='Total pot: '+hs.pot+' chips'+(cv?' = $'+(hs.pot*cv/100).toFixed(2):'');body.appendChild(pl4);
  } else {
    var pl4=document.createElement('div');pl4.style.cssText='font-size:0.8rem;color:var(--gold);margin-bottom:14px';pl4.textContent='Pot: '+hs.pot+' chips'+(cv?' = $'+(hs.pot*cv/100).toFixed(2):'');body.appendChild(pl4);
  }
  var f2={};hs.actions.forEach(function(a){if(a.action==='fold')f2[a.display_name]=true;});
  getSeated().forEach(function(pl){
    if(f2[pl.name])return;"""

patch(old_winner_hdr, new_winner_hdr, 'winner view shows side pot breakdown')

with open(HT, 'w') as f:
    f.write(c)

print('\n✅ Side pot calculator complete.')
print('\nFeatures:')
print('- Calculates main pot + all side pots correctly')
print('- Shows eligible players for each pot (by initial)')
print('- Shows chip count + $ value per pot')
print('- Handles multiple simultaneous all-ins')
print('- Winner view shows which players are eligible for each pot')
