/*
 * PKR read-only seat stack calculator.
 * Buy-ins are recorded in dollars. Poker actions/pot awards are in chips.
 * Only display a tracked live stack when the opening chips are configured,
 * bank sizes are known, and all non-voided hands reconcile.
 *
 * No money or hand records are written by this module.
 */
(function(root,create){
  'use strict';
  var ledger=create();
  if(typeof module!=='undefined'&&module.exports)module.exports=ledger;
  if(root)root.pkrSeatStackLedger=ledger;
})(typeof window!=='undefined'?window:null,function(){
  'use strict';

  function goodInt(n){return Number.isSafeInteger(n)&&n>=0;}
  function key(name){return String(name||'').trim().toLocaleLowerCase();}
  function plus(a,b){var n=a+b;return goodInt(n)?n:null;}
  function make(game,players,hands){
    game=game||{};
    players=players||{};
    var entries={},names={},ambiguous={};
    var initial=Number(game.starting_chips);
    var bank=Number(game.bank_size||game.defaultBuyin);
    var chipCents=Number(game.chip_value)||0;
    var configured=goodInt(initial)&&initial>0&&Number.isFinite(bank)&&bank>0;
    Object.keys(players).forEach(function(sid){
      var p=players[sid];
      if(!p||!p.name)return;
      var transactions=Array.isArray(p.transactions)?p.transactions:[];
      var buys=transactions.filter(function(tx){return tx&&tx.type!=='cashout';});
      var dollars=buys.reduce(function(total,tx){return total+Number(tx.amount||0);},0);
      var bought=buys.length>0&&dollars>0;
      var standard=configured&&bought&&buys.every(function(tx){
        var amt=Number(tx.amount);
        return Number.isFinite(amt)&&Math.abs(Math.round(amt*100)-Math.round(bank*100))<=1&&!tx.pkrEstimated;
      });
      var issued=standard?initial*buys.length:null;
      if(!goodInt(issued))issued=null;
      entries[sid]={name:p.name,issued:issued,chips:issued,
        buyins:buys.length,buyinDollars:Math.round(dollars*100)/100,
        source:issued===null?'money':'issued',hands:0,unsettledChips:0,
        cashValue:null,reason:issued===null?'Chip issuance is not confirmed for these buy-ins.':''};
      var n=key(p.name);
      if(names[n]){ambiguous[n]=true;}else names[n]=sid;
    });
    if(!game.hand_tracking||!Array.isArray(hands)||!hands.length)return entries;
    var list=hands.filter(function(h){return h&&h.voided!==1&&h.voided!==true;})
      .sort(function(a,b){return Number(a.hand_no||0)-Number(b.hand_no||0);});
    var deltas={},unsettled={},bad={};
    var tracked=0;
    Object.keys(ambiguous).forEach(function(n){bad[n]='Two current seats share this player name; stack cannot be attributed safely.';});
    list.forEach(function(hand){
      var actions=Array.isArray(hand.actions)?hand.actions:[];
      if(!actions.length)return;
      var contributions={},gross=0;
      var affected={};
      var valid=true;
      actions.forEach(function(a){
        var n=key(a.display_name),chips=Number(a.chips);
        if(!n||!goodInt(chips)){valid=false;return;}
        affected[n]=true;
        var next=plus(contributions[n]||0,chips);
        var newGross=plus(gross,chips);
        if(next===null||newGross===null){valid=false;return;}
        contributions[n]=next;gross=newGross;
      });
      var result=hand.result&&!hand.voided?hand.result:null;
      var winners={},refunded={},paid=0;
      if(result&&gross>0){
        if(!Array.isArray(result.pot_winners)||!result.pot_winners.length)valid=false;
        else {
          result.pot_winners.forEach(function(pot){
            if(!goodInt(pot.chips)||pot.chips===0){valid=false;return;}
            var splits=Array.isArray(pot.split_winners)?pot.split_winners:null;
            var rows=splits||[{winnerName:pot.winnerName,chips:pot.chips}];
            var splitSum=0;
            rows.forEach(function(row){
              var n=key(row.winnerName),amount=Number(row.chips);
              if(!n||!goodInt(amount)){valid=false;return;}
              splitSum=plus(splitSum,amount);
              winners[n]=plus(winners[n]||0,amount);
              if(splitSum===null||winners[n]===null)valid=false;
              affected[n]=true;
            });
            if(splitSum!==pot.chips)valid=false;
            paid=plus(paid,pot.chips);
            if(paid===null)valid=false;
          });
          var refunds=result.uncalled_returns||[];
          if(!Array.isArray(refunds))valid=false;
          else refunds.forEach(function(r){
            var n=key(r.display_name),amount=Number(r.chips);
            if(!n||!goodInt(amount)){valid=false;return;}
            refunded[n]=plus(refunded[n]||0,amount);
            paid=plus(paid,amount);
            if(refunded[n]===null||paid===null)valid=false;
            affected[n]=true;
          });
          if(paid!==gross)valid=false;
        }
      }
      if(hand.pot_chips!==undefined&&Number(hand.pot_chips)!==gross)valid=false;
      if(!valid){
        Object.keys(affected).forEach(function(n){bad[n]='A recorded hand has incomplete or unreconciled chip awards.';});
        return;
      }
      Object.keys(affected).forEach(function(n){
        var change=(winners[n]||0)+(refunded[n]||0)-(contributions[n]||0);
        var next=(deltas[n]||0)+change;
        if(!Number.isSafeInteger(next)){bad[n]='Unsafe chip totals in saved hand history.';return;}
        deltas[n]=next;
        if(!result&&contributions[n])unsettled[n]=(unsettled[n]||0)+contributions[n];
      });
      if(result)tracked++;
    });
    Object.keys(entries).forEach(function(sid){
      var e=entries[sid],n=key(e.name);
      if(bad[n]){
        e.chips=null;e.source='review';e.reason=bad[n];return;
      }
      if(e.issued===null||!goodInt(e.issued)){return;}
      var net=deltas[n]||0;
      var chips=e.issued+net;
      if(!goodInt(chips)){
        e.chips=null;e.source='review';
        e.reason='Recorded wagers exceed the configured starting chips. Confirm the physical stack.';return;
      }
      e.chips=chips;e.hands=tracked;e.unsettledChips=unsettled[n]||0;
      if(tracked||e.unsettledChips)e.source='tracked';
      // Chip value is in cents. Do not advertise a dollar-equivalent stack
      // when the configured chip rate contradicts the recorded bank value.
      if(Number.isFinite(chipCents)&&chipCents>0&&
         Math.abs(initial*chipCents-bank*100)<=1){
        e.cashValue=Math.round(chips*chipCents)/100;
      }
    });
    return entries;
  }
  return {compute:make};
});
