#!/usr/bin/env python3
"""
Fix side pot winner declaration:
- When side pots exist, declare winner per pot
- Track pending pot winners before saving result
- Support split pot per individual pot
- Final result saved after all pots are assigned
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

# ── 1. Add potWinners to state ────────────────────────────────────────────────
patch(
    "  straddleSeat: null, liveCardsEnabled: false, _autoCardMode: null,",
    "  straddleSeat: null, liveCardsEnabled: false, _autoCardMode: null,\n  potWinners: [], // [{potIndex, winnerName, chips}]\n  currentPotIndex: 0, // which pot we're currently assigning",
    'add potWinners to state'
)

# ── 2. Replace htDeclareWinner with multi-pot aware version ──────────────────
old_declare = """window.htDeclareWinner = function(name){
  if(!hs.hand)return;
  var pE=null;Object.values(window.state.players).forEach(function(p){if(p&&p.name===name)pE=p;});
  htApi('/games/'+getGameId()+'/hands/'+hs.hand.id+'/result',{method:'POST',
    body:JSON.stringify({winner_user_id:pE?pE.userId:null,winner_name:name,hole_cards:hs.holes,split_pot:false}),
  }).then(function(){
    hs.hand.result={winner_name:name,pot_chips:hs.pot};hs.view='main';
    renderBody();renderBoardOnFelt();
    return htApi('/games/'+getGameId()+'/hands');
  }).then(function(h){hs.history=h||[];toast('🏆 '+name+' wins '+hs.pot+' chips!');})
  .catch(function(e){toast('⚠️ '+e.message);});
};"""

new_declare = """// Declare winner for a specific pot (used when side pots exist)
window.htAssignPotWinner = function(potIndex, winnerName) {
  var seated = getSeated();
  var sidePots = calculateSidePots(hs.actions, seated);
  var pot = sidePots[potIndex];
  if (!pot) return;

  // Record this pot's winner
  hs.potWinners[potIndex] = {potIndex: potIndex, winnerName: winnerName, chips: pot.chips, label: pot.label};

  // Check if all pots have been assigned
  var allAssigned = sidePots.every(function(p, i) { return hs.potWinners[i]; });
  if (allAssigned) {
    // Save result — use the main pot winner as primary
    var mainWinner = hs.potWinners[0];
    var pE = null;
    Object.values(window.state.players).forEach(function(p){ if(p&&p.name===mainWinner.winnerName) pE=p; });
    var resultSummary = hs.potWinners.map(function(pw){ return pw.label+': '+pw.winnerName+' ('+pw.chips+' chips)'; }).join(' | ');
    htApi('/games/'+getGameId()+'/hands/'+hs.hand.id+'/result', {
      method: 'POST',
      body: JSON.stringify({
        winner_user_id: pE ? pE.userId : null,
        winner_name: hs.potWinners.map(function(pw){return pw.winnerName;}).join(', '),
        hole_cards: hs.holes,
        split_pot: hs.potWinners.length > 1,
        pot_winners: hs.potWinners,
      }),
    }).then(function(){
      hs.hand.result = {
        winner_name: hs.potWinners.map(function(pw){return pw.winnerName;}).join(', '),
        pot_chips: hs.pot,
        pot_winners: hs.potWinners,
      };
      hs.view = 'main';
      hs.potWinners = [];
      hs.currentPotIndex = 0;
      renderBody(); renderBoardOnFelt();
      return htApi('/games/'+getGameId()+'/hands');
    }).then(function(h){
      hs.history = h||[];
      toast('🏆 ' + resultSummary);
    }).catch(function(e){ toast('⚠️ '+e.message); });
  } else {
    // Move to next unassigned pot
    var nextIdx = sidePots.findIndex(function(p, i){ return !hs.potWinners[i]; });
    hs.currentPotIndex = nextIdx;
    renderBody();
    toast(pot.label + ': ' + winnerName + ' wins ' + pot.chips + ' chips');
  }
};

// Single winner (no side pots)
window.htDeclareWinner = function(name){
  if(!hs.hand)return;
  var seated = getSeated();
  var sidePots = calculateSidePots(hs.actions, seated);
  
  if (sidePots.length > 1) {
    // Has side pots — use per-pot assignment instead
    window.htAssignPotWinner(hs.currentPotIndex, name);
    return;
  }

  // Simple case: single pot
  var pE=null;Object.values(window.state.players).forEach(function(p){if(p&&p.name===name)pE=p;});
  htApi('/games/'+getGameId()+'/hands/'+hs.hand.id+'/result',{method:'POST',
    body:JSON.stringify({winner_user_id:pE?pE.userId:null,winner_name:name,hole_cards:hs.holes,split_pot:false}),
  }).then(function(){
    hs.hand.result={winner_name:name,pot_chips:hs.pot};hs.view='main';
    renderBody();renderBoardOnFelt();
    return htApi('/games/'+getGameId()+'/hands');
  }).then(function(h){hs.history=h||[];toast('🏆 '+name+' wins '+hs.pot+' chips!');})
  .catch(function(e){toast('⚠️ '+e.message);});
};"""

patch(old_declare, new_declare, 'multi-pot winner declaration')

# ── 3. Replace renderWinner to show per-pot UI when side pots exist ───────────
old_winner_render = """function renderWinner(body){
  var cv=gameInfo().chip_value||0;
  body.appendChild(mkB('← Cancel','background:none;border:none;color:var(--muted);cursor:pointer;font-size:0.85rem;margin-bottom:12px;padding:0;font-family:DM Sans,sans-serif',function(){hs.view='main';renderBody();}));
  var h=document.createElement('div');h.style.cssText='font-size:1rem;font-weight:700;color:var(--cream);margin-bottom:4px';h.textContent='\ud83c\udfc6 Who won?';body.appendChild(h);
  var sidePots3=calculateSidePots(hs.actions,getSeated());
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
}"""

new_winner_render = """function renderWinner(body){
  var cv=gameInfo().chip_value||0;
  var seated=getSeated();
  var sidePots=calculateSidePots(hs.actions,seated);
  var hasSidePots=sidePots.length>1;

  body.appendChild(mkB('← Cancel','background:none;border:none;color:var(--muted);cursor:pointer;font-size:0.85rem;margin-bottom:12px;padding:0;font-family:DM Sans,sans-serif',function(){
    hs.view='main'; hs.potWinners=[]; hs.currentPotIndex=0; renderBody();
  }));

  if(hasSidePots){
    // ── Side pot mode: assign winner per pot ────────────────────────────────
    var currentPot=sidePots[hs.currentPotIndex];
    if(!currentPot){return;}

    // Progress indicator
    var prog=document.createElement('div');prog.style.cssText='display:flex;gap:4px;margin-bottom:14px';
    sidePots.forEach(function(pot,i){
      var assigned=!!hs.potWinners[i];
      var isCurrent=i===hs.currentPotIndex;
      var dot=document.createElement('div');
      dot.style.cssText='flex:1;height:4px;border-radius:2px;background:'+(assigned?'var(--green)':isCurrent?'var(--gold)':'rgba(255,255,255,0.1)');
      prog.appendChild(dot);
    });
    body.appendChild(prog);

    // Current pot header
    var potHdr=document.createElement('div');
    potHdr.style.cssText='background:rgba(201,168,76,0.08);border:1px solid rgba(201,168,76,0.25);border-radius:10px;padding:12px 14px;margin-bottom:14px';
    potHdr.innerHTML='<div style="font-size:0.7rem;text-transform:uppercase;letter-spacing:1.5px;color:var(--gold);margin-bottom:4px;font-weight:600">'
      +currentPot.label+' ('+(hs.currentPotIndex+1)+' of '+sidePots.length+')</div>'
      +'<div style="font-size:1.1rem;font-weight:700;color:var(--cream)">'
      +currentPot.chips+' chips'+(cv?' <span style="font-size:0.8rem;color:var(--gold);font-weight:400">= $'+(currentPot.chips*cv/100).toFixed(2)+'</span>':'')+'</div>'
      +'<div style="font-size:0.72rem;color:var(--muted);margin-top:4px">Eligible: '
      +currentPot.eligible.join(' · ')+'</div>';
    body.appendChild(potHdr);

    // Already assigned pots summary
    var assignedPots=hs.potWinners.filter(Boolean);
    if(assignedPots.length>0){
      var summary=document.createElement('div');summary.style.cssText='margin-bottom:12px';
      assignedPots.forEach(function(pw){
        var row=document.createElement('div');row.style.cssText='display:flex;align-items:center;justify-content:space-between;padding:5px 0;font-size:0.75rem;border-bottom:1px solid rgba(255,255,255,0.04)';
        row.innerHTML='<span style="color:var(--muted)">'+pw.label+'</span><span style="color:var(--green)">🏆 '+pw.winnerName+' · '+pw.chips+' chips</span>';
        summary.appendChild(row);
      });
      body.appendChild(summary);
    }

    var winLbl=document.createElement('div');winLbl.style.cssText='font-size:0.7rem;text-transform:uppercase;letter-spacing:1.5px;color:var(--muted);margin-bottom:8px';
    winLbl.textContent='Who wins this pot?';body.appendChild(winLbl);

    // Only show eligible players for this pot
    currentPot.eligible.forEach(function(name){
      var pl=seated.find(function(s){return s.name===name;});
      var hc3=hs.holes[name]||[];
      var rb2=document.createElement('button');
      rb2.style.cssText='width:100%;display:flex;align-items:center;gap:10px;padding:11px 14px;margin-bottom:6px;background:rgba(255,255,255,0.03);border:1px solid var(--border);border-radius:8px;cursor:pointer;text-align:left;transition:all 0.15s';
      rb2.dataset.winner=name;rb2.dataset.potIdx=String(hs.currentPotIndex);
      var av2=document.createElement('div');av2.style.cssText='width:32px;height:32px;border-radius:50%;background:linear-gradient(135deg,#7a5820,#5a3010);display:flex;align-items:center;justify-content:center;font-size:0.72rem;font-weight:700;color:var(--cream);flex-shrink:0';
      av2.textContent=window.inits?window.inits(name):name.slice(0,2).toUpperCase();
      var nm2=document.createElement('span');nm2.style.cssText='flex:1;color:var(--cream);font-size:0.9rem;font-weight:600';nm2.textContent=name;
      rb2.appendChild(av2);rb2.appendChild(nm2);
      if(hc3.length>0){var cr=document.createElement('div');cr.style.cssText='display:flex;gap:3px';hc3.forEach(function(cd){cr.appendChild(cDiv(cd,true));});rb2.appendChild(cr);}
      rb2.addEventListener('click',function(){
        window.htAssignPotWinner(parseInt(this.dataset.potIdx),this.dataset.winner);
      });
      body.appendChild(rb2);
    });

    // Split pot option for this pot
    if(currentPot.eligible.length>1){
      var splitBtn=document.createElement('button');
      splitBtn.style.cssText='width:100%;padding:10px;background:rgba(58,106,170,0.08);border:1px solid rgba(58,106,170,0.2);color:#6aaaee;border-radius:8px;cursor:pointer;font-size:0.8rem;font-family:DM Sans,sans-serif;font-weight:600;margin-top:4px';
      splitBtn.textContent='🤝 Split this pot equally';
      splitBtn.dataset.potIdx=String(hs.currentPotIndex);
      splitBtn.addEventListener('click',function(){
        var pi=parseInt(this.dataset.potIdx);
        var pot2=sidePots[pi];
        var names=pot2.eligible.join(', ');
        window.htAssignPotWinner(pi,'SPLIT: '+names);
      });
      body.appendChild(splitBtn);
    }

  } else {
    // ── Simple mode: single pot ─────────────────────────────────────────────
    var h2=document.createElement('div');h2.style.cssText='font-size:1rem;font-weight:700;color:var(--cream);margin-bottom:4px';h2.textContent='\ud83c\udfc6 Who won?';body.appendChild(h2);
    var pl4=document.createElement('div');pl4.style.cssText='font-size:0.8rem;color:var(--gold);margin-bottom:14px';
    pl4.textContent='Pot: '+hs.pot+' chips'+(cv?' = $'+(hs.pot*cv/100).toFixed(2):'');body.appendChild(pl4);

    var f2={};hs.actions.forEach(function(a){if(a.action==='fold')f2[a.display_name]=true;});
    seated.forEach(function(pl){
      if(f2[pl.name])return;
      var hc3=hs.holes[pl.name]||[],rb2=document.createElement('button');
      rb2.style.cssText='width:100%;display:flex;align-items:center;gap:10px;padding:11px 14px;margin-bottom:6px;background:rgba(255,255,255,0.03);border:1px solid var(--border);border-radius:8px;cursor:pointer;text-align:left';
      rb2.dataset.winner=pl.name;
      var av2=document.createElement('div');av2.style.cssText='width:32px;height:32px;border-radius:50%;background:linear-gradient(135deg,#7a5820,#5a3010);display:flex;align-items:center;justify-content:center;font-size:0.72rem;font-weight:700;color:var(--cream);flex-shrink:0';
      av2.textContent=window.inits?window.inits(pl.name):pl.name.slice(0,2).toUpperCase();
      var nm2=document.createElement('span');nm2.style.cssText='flex:1;color:var(--cream);font-size:0.9rem;font-weight:600';nm2.textContent=pl.name;
      rb2.appendChild(av2);rb2.appendChild(nm2);
      if(hc3.length>0){var cr=document.createElement('div');cr.style.cssText='display:flex;gap:3px';hc3.forEach(function(cd){cr.appendChild(cDiv(cd,true));});rb2.appendChild(cr);}
      rb2.addEventListener('click',function(){window.htDeclareWinner(this.dataset.winner);});body.appendChild(rb2);
    });

    // Split pot option
    var activePl2=seated.filter(function(p){var f3={};hs.actions.forEach(function(a){if(a.action==='fold')f3[a.display_name]=true;});return !f3[p.name];});
    if(activePl2.length>1){
      var sb3=document.createElement('button');
      sb3.style.cssText='width:100%;padding:10px;background:rgba(58,106,170,0.08);border:1px solid rgba(58,106,170,0.2);color:#6aaaee;border-radius:8px;cursor:pointer;font-size:0.8rem;font-family:DM Sans,sans-serif;font-weight:600;margin-top:4px';
      sb3.textContent='\ud83e\udd1d Split pot equally';
      sb3.addEventListener('click',function(){
        var names=activePl2.map(function(p){return p.name;}).join(', ');
        window.htDeclareWinner('SPLIT: '+names);
      });
      body.appendChild(sb3);
    }
  }
}"""

patch(old_winner_render, new_winner_render, 'winner view redesigned for side pots')

# ── 4. Reset potWinners when starting new hand ───────────────────────────────
patch(
    "  hs.hand=h; hs.actions=[]; hs.pot=0; hs.board=[]; hs.holes={}; hs.street='pre'; hs.chipInput='';\n  hs.view='main'; hs.straddleSeat=straddleSeat||null; hs._pendingHand=null;",
    "  hs.hand=h; hs.actions=[]; hs.pot=0; hs.board=[]; hs.holes={}; hs.street='pre'; hs.chipInput='';\n  hs.view='main'; hs.straddleSeat=straddleSeat||null; hs._pendingHand=null;\n  hs.potWinners=[]; hs.currentPotIndex=0;",
    'reset potWinners on new hand'
)

# ── 5. Reset potWinners on undo winner ───────────────────────────────────────
patch(
    "    hs.hand=h;hs.actions=h.actions||[];hs.pot=h.pot_chips||0;hs.board=h.board||[];\n    hs.view='main';renderBody();renderBoardOnFelt();toast('Winner undone');",
    "    hs.hand=h;hs.actions=h.actions||[];hs.pot=h.pot_chips||0;hs.board=h.board||[];\n    hs.potWinners=[];hs.currentPotIndex=0;\n    hs.view='main';renderBody();renderBoardOnFelt();toast('Winner undone');",
    'reset potWinners on undo winner'
)

with open(HT, 'w') as f:
    f.write(c)

print('\n✅ Multi-winner side pot complete.')
print('\nFlow:')
print('1. Host taps Declare Winner')
print('2. If side pots exist: progress bar shows pot 1 of N')
print('3. Only eligible players shown for each pot')
print('4. Host picks winner for each pot sequentially')
print('5. Split pot option available for each pot')
print('6. Result saved after all pots assigned')
