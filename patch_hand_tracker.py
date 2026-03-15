#!/usr/bin/env python3
"""
Patch hand-tracker.js v5 with missing features:
1. _autoCardMode + auto-advance streets (flop 3 cards, turn 1, river 1)
2. calculateSidePots function
3. potWinners / htAssignPotWinner (multi-winner per pot)
4. Side pot display in board row and winner view
5. potWinners reset on new hand / undo
"""

HT = '/workspaces/pkr-reloaded/frontend/public/hand-tracker.js'

with open(HT, 'r', encoding='utf-8') as f:
    c = f.read()

errors = []

def patch(old, new, label):
    global c
    if old in c:
        c = c.replace(old, new, 1)
        print(f'  \u2705 {label}')
        return True
    print(f'  \u274c {label}')
    errors.append(label)
    return False

# ── 1. Add _autoCardMode and potWinners to state ──────────────────────────────
print('[1] Add new state fields')
patch(
    "  straddleSeat: null, liveCardsEnabled: false,\n  _pendingHand: null,",
    "  straddleSeat: null, liveCardsEnabled: false,\n  _pendingHand: null,\n  _autoCardMode: null,\n  potWinners: [],\n  currentPotIndex: 0,",
    'add _autoCardMode + potWinners to state'
)

# ── 2. Auto-advance streets after htAct ──────────────────────────────────────
print('[2] Auto-advance streets')
patch(
    "  }).then(function(r){hs.actions=r.actions;hs.pot=r.pot_chips;hs.chipInput='';renderBody();renderBoardOnFelt();})\n  .catch(function(e){toast('\u26a0\ufe0f '+e.message);});",
    """  }).then(function(r){
    hs.actions=r.actions;hs.pot=r.pot_chips;hs.chipInput='';
    // Auto-advance street if betting round complete
    var next=computeNextPlayer(hs.street,hs.actions,hs.hand);
    if(!next && hs.hand && !hs.hand.result) {
      var streetOrder=['pre','flop','turn','river'];
      var sidx=streetOrder.indexOf(hs.street);
      if(sidx<3) {
        var nextStreet=streetOrder[sidx+1];
        var cardSlot={pre:0,flop:3,turn:4}[hs.street];
        var streetNames={pre:'Flop',flop:'Turn',turn:'River'};
        toast('Betting done \u2014 deal the '+streetNames[hs.street]+'!');
        setTimeout(function(){
          hs.street=nextStreet;
          hs.chipInput='';
          if(cardSlot!==undefined){
            hs.cardTarget=cardSlot;
            hs.view='cards';
            hs._autoCardMode=(nextStreet==='flop'?'flop':null);
          }
          renderBody();
          var sheet=document.getElementById('handTrackerSheet');
          if(sheet) sheet.classList.add('open');
        }, 600);
      }
    }
    renderBody();renderBoardOnFelt();
  })
  .catch(function(e){toast('\u26a0\ufe0f '+e.message);});""",
    'auto-advance streets after htAct'
)

# ── 3. Keep flop picker open for 3 cards ─────────────────────────────────────
print('[3] Flop 3-card picker')
patch(
    """window.htPickCard  = function(card){
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
};""",
    """window.htPickCard  = function(card){
  if(typeof hs.cardTarget==='number'){
    var b=hs.board.slice(),ex=b.indexOf(card);
    if(ex!==-1){ b.splice(ex,1); }
    else { b[hs.cardTarget]=card; }
    hs.board=b.filter(Boolean);
    if(hs.hand)htApi('/games/'+getGameId()+'/hands/'+hs.hand.id+'/board',{method:'PUT',body:JSON.stringify({board:hs.board})}).catch(function(){});
    renderBoardOnFelt();
    // Flop mode: stay in picker until all 3 flop cards picked
    if(hs._autoCardMode==='flop'){
      var nextSlot=null;
      for(var si=0;si<3;si++){ if(!hs.board[si]){nextSlot=si;break;} }
      if(nextSlot!==null){ hs.cardTarget=nextSlot; renderBody(); return; }
      else { hs._autoCardMode=null; hs.view='main'; renderBody(); return; }
    }
    hs._autoCardMode=null; hs.view='main'; renderBody();
  } else {
    var hc=(hs.holes[hs.cardTarget]||[]).slice(),ix=hc.indexOf(card);
    if(ix!==-1)hc.splice(ix,1);else if(hc.length<2)hc.push(card);
    hs.holes[hs.cardTarget]=hc;
    hs.view='main';renderBody();
  }
};""",
    'flop 3-card picker'
)

# ── 4. Add calculateSidePots function before renderBoardOnFelt ───────────────
print('[4] calculateSidePots function')
SIDE_POT_FN = """
// ── Side pot calculator ───────────────────────────────────────────────────────
function calculateSidePots(actions, seated) {
  if (!seated || !seated.length) return [];
  var folded = {};
  actions.forEach(function(a) { if (a.action === 'fold') folded[a.display_name] = true; });
  var totalChips = {};
  seated.forEach(function(p) { totalChips[p.name] = 0; });
  actions.forEach(function(a) { if (a.chips > 0) totalChips[a.display_name] = (totalChips[a.display_name]||0) + a.chips; });
  var allinAt = {};
  actions.forEach(function(a) { if (a.action === 'allin') allinAt[a.display_name] = totalChips[a.display_name]; });
  var allinPlayers = Object.keys(allinAt);
  if (allinPlayers.length === 0) return [];
  var levels = allinPlayers.map(function(n){ return allinAt[n]; })
    .filter(function(v,i,arr){ return arr.indexOf(v)===i; })
    .sort(function(a,b){ return a-b; });
  var maxContrib = Math.max.apply(null, Object.values(totalChips).concat([0]));
  if (levels.indexOf(maxContrib) < 0) levels.push(maxContrib);
  var pots = [], prevLevel = 0;
  levels.forEach(function(level) {
    if (level <= prevLevel) return;
    var potChips = 0, eligible = [];
    seated.forEach(function(pl) {
      var contrib = totalChips[pl.name] || 0;
      var thisLevel = Math.min(contrib, level) - Math.min(contrib, prevLevel);
      if (thisLevel > 0) potChips += thisLevel;
      if (!folded[pl.name] && contrib >= level) eligible.push(pl.name);
      if (!folded[pl.name] && allinAt[pl.name] === level && eligible.indexOf(pl.name) < 0) eligible.push(pl.name);
    });
    if (potChips > 0) pots.push({ chips: potChips, eligible: eligible, level: level });
    prevLevel = level;
  });
  if (pots.length === 1) { pots[0].label = 'Main Pot'; }
  else { pots[0].label = 'Main Pot'; for (var i=1;i<pots.length;i++) pots[i].label = 'Side Pot '+i; }
  return pots;
}

"""

patch(
    "function renderBoardOnFelt(){",
    SIDE_POT_FN + "function renderBoardOnFelt(){",
    'calculateSidePots function'
)

# ── 5. Add htAssignPotWinner and update htDeclareWinner ──────────────────────
print('[5] htAssignPotWinner + multi-pot winner')
patch(
    "window.htDeclareWinner = function(name){",
    """window.htAssignPotWinner = function(potIndex, winnerName) {
  var seated = getSeated();
  var sidePots = calculateSidePots(hs.actions, seated);
  var pot = sidePots[potIndex];
  if (!pot) return;
  hs.potWinners[potIndex] = {potIndex:potIndex, winnerName:winnerName, chips:pot.chips, label:pot.label};
  var allAssigned = sidePots.every(function(p,i){ return hs.potWinners[i]; });
  if (allAssigned) {
    var mainWinner = hs.potWinners[0];
    var pE = null;
    Object.values(window.state.players).forEach(function(p){ if(p&&p.name===mainWinner.winnerName) pE=p; });
    var resultSummary = hs.potWinners.map(function(pw){ return pw.label+': '+pw.winnerName+' ('+pw.chips+' chips)'; }).join(' | ');
    htApi('/games/'+getGameId()+'/hands/'+hs.hand.id+'/result', {
      method:'POST',
      body:JSON.stringify({winner_user_id:pE?pE.userId:null, winner_name:hs.potWinners.map(function(pw){return pw.winnerName;}).join(', '), hole_cards:hs.holes, split_pot:hs.potWinners.length>1, pot_winners:hs.potWinners}),
    }).then(function(){
      hs.hand.result={winner_name:hs.potWinners.map(function(pw){return pw.winnerName;}).join(', '), pot_chips:hs.pot, pot_winners:hs.potWinners};
      hs.view='main'; hs.potWinners=[]; hs.currentPotIndex=0;
      renderBody(); renderBoardOnFelt();
      return htApi('/games/'+getGameId()+'/hands');
    }).then(function(h){ hs.history=h||[]; toast('\ud83c\udfc6 '+resultSummary); })
    .catch(function(e){ toast('\u26a0\ufe0f '+e.message); });
  } else {
    var nextIdx = sidePots.findIndex(function(p,i){ return !hs.potWinners[i]; });
    hs.currentPotIndex = nextIdx;
    renderBody();
    toast(pot.label+': '+winnerName+' wins '+pot.chips+' chips');
  }
};

window.htDeclareWinner = function(name){""",
    'htAssignPotWinner'
)

# Update htDeclareWinner to route to side pots when needed
patch(
    """window.htDeclareWinner = function(name){
  if(!hs.hand)return;
  var pE=null;Object.values(window.state.players).forEach(function(p){if(p&&p.name===name)pE=p;});
  htApi('/games/'+getGameId()+'/hands/'+hs.hand.id+'/result',{method:'POST',""",
    """window.htDeclareWinner = function(name){
  if(!hs.hand)return;
  var seated=getSeated();
  var sidePots=calculateSidePots(hs.actions,seated);
  if(sidePots.length>1){
    window.htAssignPotWinner(hs.currentPotIndex,name);
    return;
  }
  var pE=null;Object.values(window.state.players).forEach(function(p){if(p&&p.name===name)pE=p;});
  htApi('/games/'+getGameId()+'/hands/'+hs.hand.id+'/result',{method:'POST',""",
    'htDeclareWinner routes to side pots'
)

# ── 6. Reset potWinners on new hand ──────────────────────────────────────────
print('[6] Reset potWinners on new hand + undo')
patch(
    "  hs.view='main'; hs.straddleSeat=straddleSeat||null; hs._pendingHand=null;\n    hs.history.unshift(h);",
    "  hs.view='main'; hs.straddleSeat=straddleSeat||null; hs._pendingHand=null;\n    hs.potWinners=[]; hs.currentPotIndex=0;\n    hs.history.unshift(h);",
    'reset potWinners on new hand'
)

patch(
    "    hs.hand=h;hs.actions=h.actions||[];hs.pot=h.pot_chips||0;hs.board=h.board||[];\n    hs.view='main';renderBody();renderBoardOnFelt();toast('Winner undone');",
    "    hs.hand=h;hs.actions=h.actions||[];hs.pot=h.pot_chips||0;hs.board=h.board||[];\n    hs.potWinners=[];hs.currentPotIndex=0;\n    hs.view='main';renderBody();renderBoardOnFelt();toast('Winner undone');",
    'reset potWinners on undo winner'
)

# ── 7. Add side pot breakdown display in renderMain ──────────────────────────
print('[7] Side pot display in board row')
patch(
    "  // Street chip totals\n  var scm={};seated.forEach(function(p){scm[p.name]=0;});",
    """  // Side pot breakdown (shown when 2+ all-ins)
  var sidePots2=calculateSidePots(hs.actions,seated);
  if(sidePots2.length>1){
    var spBox=document.createElement('div');
    spBox.style.cssText='background:rgba(0,0,0,0.2);border:1px solid rgba(201,168,76,0.15);border-radius:8px;padding:8px 12px;margin-bottom:10px';
    var spHdr=document.createElement('div');spHdr.style.cssText='font-size:0.6rem;text-transform:uppercase;letter-spacing:1.5px;color:rgba(201,168,76,0.6);margin-bottom:6px;font-weight:600';spHdr.textContent='Side Pots';spBox.appendChild(spHdr);
    var cv3=gameInfo().chip_value||0;
    sidePots2.forEach(function(pot){
      var pr=document.createElement('div');pr.style.cssText='display:flex;align-items:flex-start;justify-content:space-between;margin-bottom:5px;gap:8px';
      var left=document.createElement('div');
      var lbl=document.createElement('div');lbl.style.cssText='font-size:0.72rem;color:var(--gold);font-weight:700;margin-bottom:2px';lbl.textContent=pot.label;left.appendChild(lbl);
      var elig=document.createElement('div');elig.style.cssText='display:flex;gap:3px;flex-wrap:wrap';
      pot.eligible.forEach(function(name){var chip=document.createElement('div');chip.style.cssText='font-size:0.62rem;padding:1px 6px;border-radius:10px;background:rgba(201,168,76,0.12);color:var(--cream2);border:1px solid rgba(201,168,76,0.2);white-space:nowrap';chip.textContent=window.inits?window.inits(name):name.slice(0,2).toUpperCase();chip.title=name;elig.appendChild(chip);});
      left.appendChild(elig);pr.appendChild(left);
      var right=document.createElement('div');right.style.cssText='text-align:right;flex-shrink:0';
      var cl=document.createElement('div');cl.style.cssText='font-size:0.78rem;color:var(--gold);font-weight:700';cl.textContent=pot.chips+' chips';right.appendChild(cl);
      if(cv3&&pot.chips>0){var dl=document.createElement('div');dl.style.cssText='font-size:0.65rem;color:var(--muted)';dl.textContent='$'+(pot.chips*cv3/100).toFixed(2);right.appendChild(dl);}
      pr.appendChild(right);spBox.appendChild(pr);
    });
    body.appendChild(spBox);
  }

  // Street chip totals
  var scm={};seated.forEach(function(p){scm[p.name]=0;});""",
    'side pot breakdown display'
)

# ── 8. Update renderWinner to show per-pot UI ─────────────────────────────────
print('[8] renderWinner with side pot support')

# Find and replace the renderWinner function
idx_start = c.find('function renderWinner(body){')
idx_end = c.find('\nfunction renderHistory(body){')
if idx_start > 0 and idx_end > 0:
    old_winner = c[idx_start:idx_end]
    new_winner = """function renderWinner(body){
  var cv=gameInfo().chip_value||0;
  var seated=getSeated();
  var sidePots=calculateSidePots(hs.actions,seated);
  var hasSidePots=sidePots.length>1;

  body.appendChild(mkB('\u2190 Cancel','background:none;border:none;color:var(--muted);cursor:pointer;font-size:0.85rem;margin-bottom:12px;padding:0;font-family:DM Sans,sans-serif',function(){
    hs.view='main'; hs.potWinners=[]; hs.currentPotIndex=0; renderBody();
  }));

  if(hasSidePots){
    var currentPot=sidePots[hs.currentPotIndex];
    if(!currentPot){return;}
    // Progress bar
    var prog=document.createElement('div');prog.style.cssText='display:flex;gap:4px;margin-bottom:14px';
    sidePots.forEach(function(pot,i){
      var assigned=!!hs.potWinners[i],isCurrent=i===hs.currentPotIndex;
      var dot=document.createElement('div');dot.style.cssText='flex:1;height:4px;border-radius:2px;background:'+(assigned?'var(--green)':isCurrent?'var(--gold)':'rgba(255,255,255,0.1)');prog.appendChild(dot);
    });
    body.appendChild(prog);
    // Current pot header
    var potHdr=document.createElement('div');potHdr.style.cssText='background:rgba(201,168,76,0.08);border:1px solid rgba(201,168,76,0.25);border-radius:10px;padding:12px 14px;margin-bottom:14px';
    potHdr.innerHTML='<div style="font-size:0.7rem;text-transform:uppercase;letter-spacing:1.5px;color:var(--gold);margin-bottom:4px;font-weight:600">'+currentPot.label+' ('+(hs.currentPotIndex+1)+' of '+sidePots.length+')</div>'
      +'<div style="font-size:1.1rem;font-weight:700;color:var(--cream)">'+currentPot.chips+' chips'+(cv&&currentPot.chips?' <span style="font-size:0.8rem;color:var(--gold);font-weight:400">= $'+(currentPot.chips*cv/100).toFixed(2)+'</span>':'')+'</div>'
      +'<div style="font-size:0.72rem;color:var(--muted);margin-top:4px">Eligible: '+currentPot.eligible.join(' \u00b7 ')+'</div>';
    body.appendChild(potHdr);
    // Already assigned summary
    var assignedPots=hs.potWinners.filter(Boolean);
    if(assignedPots.length>0){
      var summary=document.createElement('div');summary.style.cssText='margin-bottom:12px';
      assignedPots.forEach(function(pw){var row=document.createElement('div');row.style.cssText='display:flex;align-items:center;justify-content:space-between;padding:5px 0;font-size:0.75rem;border-bottom:1px solid rgba(255,255,255,0.04)';row.innerHTML='<span style="color:var(--muted)">'+pw.label+'</span><span style="color:var(--green)">\ud83c\udfc6 '+pw.winnerName+' \u00b7 '+pw.chips+' chips</span>';summary.appendChild(row);});
      body.appendChild(summary);
    }
    var winLbl=document.createElement('div');winLbl.style.cssText='font-size:0.7rem;text-transform:uppercase;letter-spacing:1.5px;color:var(--muted);margin-bottom:8px';winLbl.textContent='Who wins this pot?';body.appendChild(winLbl);
    currentPot.eligible.forEach(function(name){
      var hc3=hs.holes[name]||[],rb2=document.createElement('button');
      rb2.style.cssText='width:100%;display:flex;align-items:center;gap:10px;padding:11px 14px;margin-bottom:6px;background:rgba(255,255,255,0.03);border:1px solid var(--border);border-radius:8px;cursor:pointer;text-align:left';
      rb2.dataset.winner=name;rb2.dataset.potIdx=String(hs.currentPotIndex);
      var av2=document.createElement('div');av2.style.cssText='width:32px;height:32px;border-radius:50%;background:linear-gradient(135deg,#7a5820,#5a3010);display:flex;align-items:center;justify-content:center;font-size:0.72rem;font-weight:700;color:var(--cream);flex-shrink:0';av2.textContent=window.inits?window.inits(name):name.slice(0,2).toUpperCase();
      var nm2=document.createElement('span');nm2.style.cssText='flex:1;color:var(--cream);font-size:0.9rem;font-weight:600';nm2.textContent=name;
      rb2.appendChild(av2);rb2.appendChild(nm2);
      if(hc3.length>0){var cr=document.createElement('div');cr.style.cssText='display:flex;gap:3px';hc3.forEach(function(cd){cr.appendChild(cDiv(cd,true));});rb2.appendChild(cr);}
      rb2.addEventListener('click',function(){window.htAssignPotWinner(parseInt(this.dataset.potIdx),this.dataset.winner);});
      body.appendChild(rb2);
    });
    if(currentPot.eligible.length>1){
      var splitBtn=document.createElement('button');splitBtn.style.cssText='width:100%;padding:10px;background:rgba(58,106,170,0.08);border:1px solid rgba(58,106,170,0.2);color:#6aaaee;border-radius:8px;cursor:pointer;font-size:0.8rem;font-family:DM Sans,sans-serif;font-weight:600;margin-top:4px';
      splitBtn.textContent='\ud83e\udd1d Split this pot equally';splitBtn.dataset.potIdx=String(hs.currentPotIndex);
      splitBtn.addEventListener('click',function(){var pi=parseInt(this.dataset.potIdx),pot2=sidePots[pi],names=pot2.eligible.join(', ');window.htAssignPotWinner(pi,'SPLIT: '+names);});
      body.appendChild(splitBtn);
    }
  } else {
    var h2=document.createElement('div');h2.style.cssText='font-size:1rem;font-weight:700;color:var(--cream);margin-bottom:4px';h2.textContent='\ud83c\udfc6 Who won?';body.appendChild(h2);
    var pl4=document.createElement('div');pl4.style.cssText='font-size:0.8rem;color:var(--gold);margin-bottom:14px';pl4.textContent='Pot: '+hs.pot+' chips'+(cv?' = $'+(hs.pot*cv/100).toFixed(2):'');body.appendChild(pl4);
    var f2={};hs.actions.forEach(function(a){if(a.action==='fold')f2[a.display_name]=true;});
    seated.forEach(function(pl){
      if(f2[pl.name])return;
      var hc3=hs.holes[pl.name]||[],rb2=document.createElement('button');
      rb2.style.cssText='width:100%;display:flex;align-items:center;gap:10px;padding:11px 14px;margin-bottom:6px;background:rgba(255,255,255,0.03);border:1px solid var(--border);border-radius:8px;cursor:pointer;text-align:left';
      rb2.dataset.winner=pl.name;
      var av2=document.createElement('div');av2.style.cssText='width:32px;height:32px;border-radius:50%;background:linear-gradient(135deg,#7a5820,#5a3010);display:flex;align-items:center;justify-content:center;font-size:0.72rem;font-weight:700;color:var(--cream);flex-shrink:0';av2.textContent=window.inits?window.inits(pl.name):pl.name.slice(0,2).toUpperCase();
      var nm2=document.createElement('span');nm2.style.cssText='flex:1;color:var(--cream);font-size:0.9rem;font-weight:600';nm2.textContent=pl.name;
      rb2.appendChild(av2);rb2.appendChild(nm2);
      if(hc3.length>0){var cr=document.createElement('div');cr.style.cssText='display:flex;gap:3px';hc3.forEach(function(cd){cr.appendChild(cDiv(cd,true));});rb2.appendChild(cr);}
      rb2.addEventListener('click',function(){window.htDeclareWinner(this.dataset.winner);});body.appendChild(rb2);
    });
    var activePl2=seated.filter(function(p){var f3={};hs.actions.forEach(function(a){if(a.action==='fold')f3[a.display_name]=true;});return !f3[p.name];});
    if(activePl2.length>1){
      var sb3=document.createElement('button');sb3.style.cssText='width:100%;padding:10px;background:rgba(58,106,170,0.08);border:1px solid rgba(58,106,170,0.2);color:#6aaaee;border-radius:8px;cursor:pointer;font-size:0.8rem;font-family:DM Sans,sans-serif;font-weight:600;margin-top:4px';
      sb3.textContent='\ud83e\udd1d Split pot equally';
      sb3.addEventListener('click',function(){var names=activePl2.map(function(p){return p.name;}).join(', ');window.htDeclareWinner('SPLIT: '+names);});
      body.appendChild(sb3);
    }
  }
}
"""
    c = c[:idx_start] + new_winner + c[idx_end:]
    print('  \u2705 renderWinner replaced with side pot support')
else:
    print('  \u274c renderWinner not found')
    errors.append('renderWinner')

# ── Write ────────────────────────────────────────────────────────────────────
with open(HT, 'w', encoding='utf-8') as f:
    f.write(c)

print(f'\nFile size: {len(c.splitlines())} lines')
print('\n' + '='*60)
if errors:
    print(f'\u26a0\ufe0f  {len(errors)} error(s): ' + ', '.join(errors))
else:
    print('\u2705 All patches applied!')
print('\nRun:')
print('  git add -A && git commit -m "feat: hand tracker - auto-advance streets, side pots, multi-winner" && git push')
