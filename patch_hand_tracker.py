#!/usr/bin/env python3
"""Patch hand-tracker.js v5 with side pots, auto-advance streets, multi-winner"""

HT = '/workspaces/pkr-reloaded/frontend/public/hand-tracker.js'

with open(HT, 'r', encoding='utf-8') as f:
    c = f.read()

errors = []
def patch(old, new, label):
    global c
    if old in c:
        c = c.replace(old, new, 1)
        print(f'  \u2705 {label}')
    else:
        print(f'  \u274c {label}')
        errors.append(label)

# 1. Add potWinners + currentPotIndex + _autoCardMode to state
patch(
    "  straddleSeat: null, liveCardsEnabled: false,\n  _pendingHand: null,",
    "  straddleSeat: null, liveCardsEnabled: false,\n  _pendingHand: null,\n  potWinners: [], currentPotIndex: 0, _autoCardMode: null,",
    'add potWinners/currentPotIndex/_autoCardMode to state'
)

# 2. Reset potWinners on new hand
patch(
    "    hs.hand=h; hs.actions=[]; hs.pot=0; hs.board=[]; hs.holes={}; hs.street='pre'; hs.chipInput='';",
    "    hs.hand=h; hs.actions=[]; hs.pot=0; hs.board=[]; hs.holes={}; hs.street='pre'; hs.chipInput='';\n    hs.potWinners=[]; hs.currentPotIndex=0; hs._autoCardMode=null;",
    'reset potWinners on new hand'
)

# 3. Reset potWinners on undo winner
patch(
    "    hs.hand=h;hs.actions=h.actions||[];hs.pot=h.pot_chips||0;hs.board=h.board||[];\n    hs.view='main';renderBody();renderBoardOnFelt();toast('Winner undone');",
    "    hs.hand=h;hs.actions=h.actions||[];hs.pot=h.pot_chips||0;hs.board=h.board||[];\n    hs.potWinners=[]; hs.currentPotIndex=0;\n    hs.view='main';renderBody();renderBoardOnFelt();toast('Winner undone');",
    'reset potWinners on undo winner'
)

# 4. Auto-advance streets after htAct + flop 3-card mode
patch(
    "  }).then(function(r){hs.actions=r.actions;hs.pot=r.pot_chips;hs.chipInput='';renderBody();renderBoardOnFelt();})\n  .catch(function(e){toast('\u26a0 '+e.message);});",
    """  }).then(function(r){
    hs.actions=r.actions;hs.pot=r.pot_chips;hs.chipInput='';
    var next=computeNextPlayer(hs.street,hs.actions,hs.hand);
    if(!next&&hs.hand&&!hs.hand.result){
      var so=['pre','flop','turn','river'],si=so.indexOf(hs.street);
      if(si>=0&&si<3){
        var ns=so[si+1],slots={pre:[0,1,2],flop:[3],turn:[4]};
        toast('Deal the '+ns.charAt(0).toUpperCase()+ns.slice(1)+'!');
        setTimeout(function(){
          hs.street=ns;hs.chipInput='';
          var sl=slots[hs.street==='flop'?'pre':hs.street==='turn'?'flop':hs.street==='river'?'turn':hs.street];
          if(sl){
            hs.cardTarget=sl[0];hs.view='cards';
            if(ns==='flop'){hs._autoCardMode='flop';}
            else{hs._autoCardMode=null;}
          }
          renderBody();
          var sh=document.getElementById('handTrackerSheet');if(sh)sh.classList.add('open');
        },600);
      }
    }
    renderBody();renderBoardOnFelt();
  })
  .catch(function(e){toast('\u26a0 '+e.message);});""",
    'auto-advance streets after htAct'
)

# 5. Flop 3-card picker - stay open until all 3 cards picked
patch(
    "    if(ex!==-1)b.splice(ex,1);else b[hs.cardTarget]=card;\n    hs.board=b.filter(Boolean);\n    if(hs.hand)htApi('/games/'+getGameId()+'/hands/'+hs.hand.id+'/board',{method:'PUT',body:JSON.stringify({board:hs.board})}).catch(function(){});\n    renderBoardOnFelt();\n  } else {",
    """    if(ex!==-1)b.splice(ex,1);else b[hs.cardTarget]=card;
    hs.board=b.filter(Boolean);
    if(hs.hand)htApi('/games/'+getGameId()+'/hands/'+hs.hand.id+'/board',{method:'PUT',body:JSON.stringify({board:hs.board})}).catch(function(){});
    renderBoardOnFelt();
    if(hs._autoCardMode==='flop'){
      var nextSlot=null;
      for(var fsi=0;fsi<3;fsi++){if(!hs.board[fsi]){nextSlot=fsi;break;}}
      if(nextSlot!==null){hs.cardTarget=nextSlot;renderBody();return;}
      else{hs._autoCardMode=null;hs.view='main';renderBody();return;}
    }
  } else {""",
    'flop 3-card auto-picker'
)

# 6. Add calculateSidePots before renderBoardOnFelt
SIDE_POTS = """
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

"""

patch(
    "function renderBoardOnFelt(){",
    SIDE_POTS + "function renderBoardOnFelt(){",
    'add calculateSidePots'
)

# 7. Add htAssignPotWinner before htDeclareWinner
ASSIGN_POT = """window.htAssignPotWinner = function(potIdx, winnerName){
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
      hs.hand.result={winner_name:potWinnersForApi.map(function(pw){return pw.winnerName;}).join(', '),pot_chips:hs.pot,pot_winners:potWinnersForApi};
      hs.view='main';hs.potWinners=[];hs.currentPotIndex=0;
      renderBody();renderBoardOnFelt();
      return htApi('/games/'+getGameId()+'/hands');
    }).then(function(h){hs.history=h||[];toast('\ud83c\udfc6 '+summary);})
    .catch(function(e){toast('\u26a0 '+e.message);});
  } else {
    var next=pots.findIndex(function(p,i){return !hs.potWinners[i];});
    hs.currentPotIndex=next;
    toast(pot.label+': '+winnerName+' wins '+pot.chips+' chips');
    renderBody();
  }
};

"""

patch(
    "window.htDeclareWinner = function(name){",
    ASSIGN_POT + "window.htDeclareWinner = function(name){",
    'add htAssignPotWinner'
)

# 8. Update htDeclareWinner to route through side pots when needed
patch(
    "window.htDeclareWinner = function(name){\n  if(!hs.hand)return;\n  var pE=null;Object.values(window.state.players).forEach(function(p){if(p&&p.name===name)pE=p;});",
    """window.htDeclareWinner = function(name){
  if(!hs.hand)return;
  var seated=getSeated();
  var pots=calculateSidePots(hs.actions,seated);
  if(pots.length>1){window.htAssignPotWinner(hs.currentPotIndex,name);return;}
  var pE=null;Object.values(window.state.players).forEach(function(p){if(p&&p.name===name)pE=p;});""",
    'htDeclareWinner routes to side pots'
)

# 9. Replace renderWinner with side pot support
OLD_WINNER = """function renderWinner(body){
  var cv=gameInfo().chip_value||0;
  body.appendChild(mkB('\u2190 Cancel','background:none;border:none;color:var(--muted);cursor:pointer;font-size:0.85rem;margin-bottom:12px;padding:0;font-family:DM Sans,sans-serif',function(){hs.view='main';renderBody();}));
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
}"""

NEW_WINNER = """function renderWinner(body){
  var cv=gameInfo().chip_value||0;
  var seated=getSeated();
  var pots=calculateSidePots(hs.actions,seated);
  var hasSidePots=pots.length>1;
  body.appendChild(mkB('\u2190 Cancel','background:none;border:none;color:var(--muted);cursor:pointer;font-size:0.85rem;margin-bottom:12px;padding:0;font-family:DM Sans,sans-serif',function(){hs.view='main';hs.potWinners=[];hs.currentPotIndex=0;renderBody();}));

  if(hasSidePots){
    var curPot=pots[hs.currentPotIndex];if(!curPot)return;
    // Progress bar
    var prog=document.createElement('div');prog.style.cssText='display:flex;gap:4px;margin-bottom:12px';
    pots.forEach(function(pot,i){var dot=document.createElement('div');dot.style.cssText='flex:1;height:4px;border-radius:2px;background:'+(hs.potWinners[i]?'var(--green)':i===hs.currentPotIndex?'var(--gold)':'rgba(255,255,255,0.1)');prog.appendChild(dot);});
    body.appendChild(prog);
    // Current pot header
    var ph=document.createElement('div');ph.style.cssText='background:rgba(201,168,76,0.08);border:1px solid rgba(201,168,76,0.25);border-radius:10px;padding:12px 14px;margin-bottom:12px';
    var pl2=document.createElement('div');pl2.style.cssText='font-size:0.7rem;text-transform:uppercase;letter-spacing:1.5px;color:var(--gold);margin-bottom:4px;font-weight:600';pl2.textContent=curPot.label+' ('+(hs.currentPotIndex+1)+' of '+pots.length+')';
    var pc=document.createElement('div');pc.style.cssText='font-size:1.1rem;font-weight:700;color:var(--cream)';pc.textContent=curPot.chips+' chips'+(cv?' = $'+(curPot.chips*cv/100).toFixed(2):'');
    var pe=document.createElement('div');pe.style.cssText='font-size:0.72rem;color:var(--muted);margin-top:4px';pe.textContent='Eligible: '+curPot.eligible.join(' \u00b7 ');
    ph.appendChild(pl2);ph.appendChild(pc);ph.appendChild(pe);body.appendChild(ph);
    // Already assigned
    hs.potWinners.filter(Boolean).forEach(function(pw){var row=document.createElement('div');row.style.cssText='display:flex;justify-content:space-between;padding:5px 0;font-size:0.75rem;border-bottom:1px solid rgba(255,255,255,0.04)';row.innerHTML='<span style="color:var(--muted)">'+pw.label+'</span><span style="color:var(--green)">\ud83c\udfc6 '+pw.winnerName+' \u00b7 '+pw.chips+' chips</span>';body.appendChild(row);});
    // Eligible players for this pot
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
    if(curPot.eligible.length>1){var sp=document.createElement('button');sp.style.cssText='width:100%;padding:10px;background:rgba(58,106,170,0.08);border:1px solid rgba(58,106,170,0.2);color:#6aaaee;border-radius:8px;cursor:pointer;font-size:0.8rem;font-family:DM Sans,sans-serif;font-weight:600;margin-top:4px';sp.textContent='\ud83e\udd1d Split equally';sp.dataset.potidx=String(hs.currentPotIndex);sp.addEventListener('click',function(){window.htAssignPotWinner(parseInt(this.dataset.potidx),'SPLIT: '+curPot.eligible.join(', '));});body.appendChild(sp);}
  } else {
    var h2=document.createElement('div');h2.style.cssText='font-size:1rem;font-weight:700;color:var(--cream);margin-bottom:4px';h2.textContent='\ud83c\udfc6 Who won?';body.appendChild(h2);
    var pl4=document.createElement('div');pl4.style.cssText='font-size:0.8rem;color:var(--gold);margin-bottom:14px';pl4.textContent='Pot: '+hs.pot+' chips'+(cv?' = $'+(hs.pot*cv/100).toFixed(2):'');body.appendChild(pl4);
    var f2={};hs.actions.forEach(function(a){if(a.action==='fold')f2[a.display_name]=true;});
    var activePl=getSeated().filter(function(pl){return !f2[pl.name];});
    activePl.forEach(function(pl){
      var hc3=hs.holes[pl.name]||[],rb2=document.createElement('button');
      rb2.style.cssText='width:100%;display:flex;align-items:center;gap:10px;padding:11px 14px;margin-bottom:6px;background:rgba(255,255,255,0.03);border:1px solid var(--border);border-radius:8px;cursor:pointer;text-align:left';
      rb2.dataset.winner=pl.name;
      var av2=document.createElement('div');av2.style.cssText='width:32px;height:32px;border-radius:50%;background:linear-gradient(135deg,#7a5820,#5a3010);display:flex;align-items:center;justify-content:center;font-size:0.72rem;font-weight:700;color:var(--cream);flex-shrink:0';av2.textContent=window.inits?window.inits(pl.name):pl.name.slice(0,2).toUpperCase();
      var nm2=document.createElement('span');nm2.style.cssText='flex:1;color:var(--cream);font-size:0.9rem;font-weight:600';nm2.textContent=pl.name;
      rb2.appendChild(av2);rb2.appendChild(nm2);
      if(hc3.length>0){var cr=document.createElement('div');cr.style.cssText='display:flex;gap:3px';hc3.forEach(function(c){cr.appendChild(cDiv(c,true));});rb2.appendChild(cr);}
      rb2.addEventListener('click',function(){window.htDeclareWinner(this.dataset.winner);});body.appendChild(rb2);
    });
    if(activePl.length>1){var sb3=document.createElement('button');sb3.style.cssText='width:100%;padding:10px;background:rgba(58,106,170,0.08);border:1px solid rgba(58,106,170,0.2);color:#6aaaee;border-radius:8px;cursor:pointer;font-size:0.8rem;font-family:DM Sans,sans-serif;font-weight:600;margin-top:4px';sb3.textContent='\ud83e\udd1d Split pot equally';sb3.addEventListener('click',function(){var names=activePl.map(function(p){return p.name;}).join(', ');window.htDeclareWinner('SPLIT: '+names);});body.appendChild(sb3);}
  }
}"""

patch(OLD_WINNER, NEW_WINNER, 'replace renderWinner with side pot support')

# 10. Add side pot display in renderMain (before street chip totals)
patch(
    "  // Street chip totals\n  var scm={};seated.forEach(function(p){scm[p.name]=0;});",
    """  // Side pot breakdown
  var sidePots2=calculateSidePots(hs.actions,seated);
  if(sidePots2.length>1){
    var spBox=document.createElement('div');spBox.style.cssText='background:rgba(0,0,0,0.2);border:1px solid rgba(201,168,76,0.15);border-radius:8px;padding:8px 12px;margin-bottom:10px';
    var spH=document.createElement('div');spH.style.cssText='font-size:0.6rem;text-transform:uppercase;letter-spacing:1.5px;color:rgba(201,168,76,0.6);margin-bottom:6px;font-weight:600';spH.textContent='Side Pots';spBox.appendChild(spH);
    var cv3=gameInfo().chip_value||0;
    sidePots2.forEach(function(pot){
      var pr=document.createElement('div');pr.style.cssText='display:flex;align-items:center;justify-content:space-between;margin-bottom:4px';
      var ll=document.createElement('div');
      var lb=document.createElement('div');lb.style.cssText='font-size:0.72rem;color:var(--gold);font-weight:700';lb.textContent=pot.label;ll.appendChild(lb);
      var eg=document.createElement('div');eg.style.cssText='display:flex;gap:3px;flex-wrap:wrap';
      pot.eligible.forEach(function(name){var chip=document.createElement('div');chip.style.cssText='font-size:0.62rem;padding:1px 5px;border-radius:10px;background:rgba(201,168,76,0.12);color:var(--cream2);border:1px solid rgba(201,168,76,0.2)';chip.textContent=window.inits?window.inits(name):name.slice(0,2).toUpperCase();chip.title=name;eg.appendChild(chip);});
      ll.appendChild(eg);pr.appendChild(ll);
      var rr=document.createElement('div');rr.style.cssText='text-align:right;flex-shrink:0';
      var cl=document.createElement('div');cl.style.cssText='font-size:0.78rem;color:var(--gold);font-weight:700';cl.textContent=pot.chips+' chips';rr.appendChild(cl);
      if(cv3&&pot.chips>0){var dl=document.createElement('div');dl.style.cssText='font-size:0.65rem;color:var(--muted)';dl.textContent='$'+(pot.chips*cv3/100).toFixed(2);rr.appendChild(dl);}
      pr.appendChild(rr);spBox.appendChild(pr);
    });
    body.appendChild(spBox);
  }

  // Street chip totals
  var scm={};seated.forEach(function(p){scm[p.name]=0;});""",
    'side pot display in renderMain'
)

# Write
import re
c = re.sub(r'[\ud800-\udfff]', '', c)
with open(HT, 'w', encoding='utf-8') as f:
    f.write(c)

print(f'\nFile: {len(c.splitlines())} lines')
if errors:
    print(f'\u26a0\ufe0f {len(errors)} errors: ' + ', '.join(errors))
else:
    print('\u2705 All patches applied!')
