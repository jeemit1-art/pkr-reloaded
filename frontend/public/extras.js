// extras.js — PKR Reloaded: Rabbit Hunt + Seat Randomiser
(function() {
'use strict';
function extApi(path,opts){
  var ctx=window.getPkrCtx?window.getPkrCtx():null;
  var apiUrl=ctx?ctx.apiUrl:'';var token=ctx?ctx.token:'';
  return fetch(apiUrl+path,Object.assign({credentials:'include',headers:Object.assign({'Content-Type':'application/json'},token?{'Authorization':'Bearer '+token}:{})},opts||{}))
    .then(function(r){if(!r.ok)return r.json().catch(function(){return{};}).then(function(e){throw new Error(e.error||r.status);});return r.json();});
}
function getGameId(){var c=window.getPkrCtx?window.getPkrCtx():null;return c?c.gameId:'';}
function toast(msg){window.showToast&&window.showToast(msg);}
function mkB(label,style,onClick){var b=document.createElement('button');b.style.cssText=style;b.textContent=label;b.addEventListener('click',onClick);return b;}

// ── RABBIT HUNT ───────────────────────────────────────────────────────────────
var rh={board:[],revealed:[],view:'main'};
window.openRabbitHunt=function(){
  rh.board=window._htState&&window._htState.board?window._htState.board.slice():[];
  rh.revealed=[];rh.view='main';
  var s=document.getElementById('rabbitSheet');if(s)s.classList.add('open');renderRabbit();
};
window.closeRabbitHunt=function(){var s=document.getElementById('rabbitSheet');if(s)s.classList.remove('open');};
function renderRabbit(){
  var body=document.getElementById('rabbitBody');if(!body)return;body.innerHTML='';
  if(rh.view==='picker'){renderRabbitPicker(body);return;}
  var board=rh.board;var boardLen=board.filter(Boolean).length;
  var h=document.createElement('div');h.style.cssText='font-size:1rem;font-weight:700;color:var(--cream);margin-bottom:8px';h.textContent='\ud83d\udc30 Rabbit Hunt';body.appendChild(h);
  var sub=document.createElement('div');sub.style.cssText='font-size:0.78rem;color:var(--muted);margin-bottom:14px';
  sub.textContent=boardLen<3?'No board cards yet':boardLen===3?'Flop dealt \u2014 reveal turn and/or river':boardLen===4?'Turn dealt \u2014 reveal the river':'All 5 cards dealt';body.appendChild(sub);
  var br=document.createElement('div');br.style.cssText='display:flex;gap:4px;margin-bottom:16px';
  for(var i=0;i<5;i++){
    var card=board[i];var isRed=card&&(card.indexOf('\u2665')>=0||card.indexOf('\u2666')>=0);
    var el=document.createElement('div');
    if(card){el.style.cssText='width:32px;height:44px;border-radius:4px;display:flex;flex-direction:column;align-items:center;justify-content:center;font-weight:700;line-height:1.1;background:#fff;color:'+(isRed?'#d63031':'#1a1a1a');var rd=document.createElement('div');rd.style.fontSize='0.75rem';rd.textContent=card.slice(0,-1);var sd=document.createElement('div');sd.style.fontSize='0.85rem';sd.textContent=card.slice(-1);el.appendChild(rd);el.appendChild(sd);}
    else if(rh.revealed[i-boardLen]!==undefined){var rc=rh.revealed[i-boardLen];var rcRed=rc&&(rc.indexOf('\u2665')>=0||rc.indexOf('\u2666')>=0);el.style.cssText='width:32px;height:44px;border-radius:4px;display:flex;flex-direction:column;align-items:center;justify-content:center;font-weight:700;line-height:1.1;background:linear-gradient(135deg,#1a1a2e,#16213e);border:1px solid rgba(201,168,76,0.4);color:'+(rcRed?'#d63031':'#f0e6c8');var rr=document.createElement('div');rr.style.fontSize='0.75rem';rr.textContent=rc.slice(0,-1);var ss=document.createElement('div');ss.style.fontSize='0.85rem';ss.textContent=rc.slice(-1);el.appendChild(rr);el.appendChild(ss);}
    else{el.style.cssText='width:32px;height:44px;border-radius:4px;display:flex;align-items:center;justify-content:center;font-size:1rem;color:rgba(201,168,76,0.3);background:rgba(255,255,255,0.04);border:1px dashed rgba(201,168,76,0.25)';el.textContent='?';}
    br.appendChild(el);
  }
  body.appendChild(br);
  if(boardLen>=3&&boardLen<5)body.appendChild(mkB('\ud83d\udc30 Reveal '+(5-boardLen===2?'Turn + River':'River'),'width:100%;padding:13px;background:rgba(201,168,76,0.08);border:1px solid rgba(201,168,76,0.3);color:var(--gold);border-radius:8px;cursor:pointer;font-size:0.85rem;font-weight:700;font-family:DM Sans,sans-serif;margin-bottom:8px',function(){rh.view='picker';renderRabbit();}));
  if(rh.revealed.length>0)body.appendChild(mkB('\ud83d\udd04 Reset','width:100%;padding:10px;background:rgba(255,255,255,0.03);border:1px solid var(--border);color:var(--muted);border-radius:8px;cursor:pointer;font-size:0.8rem;font-family:DM Sans,sans-serif',function(){rh.revealed=[];renderRabbit();}));
}
function renderRabbitPicker(body){
  var allDealt=rh.board.concat(rh.revealed);
  body.appendChild(mkB('\u2190 Back','background:none;border:none;color:var(--muted);cursor:pointer;font-size:0.85rem;margin-bottom:8px;padding:0;font-family:DM Sans,sans-serif',function(){rh.view='main';renderRabbit();}));
  ['\u2660','\u2665','\u2666','\u2663'].forEach(function(suit){
    var isRed=suit==='\u2665'||suit==='\u2666';
    var row=document.createElement('div');row.style.cssText='display:flex;gap:3px;margin-bottom:5px;align-items:center';
    var sl=document.createElement('span');sl.style.cssText='width:18px;font-size:1rem;color:'+(isRed?'#e74c3c':'#f0e6c8')+';flex-shrink:0;text-align:center';sl.textContent=suit;row.appendChild(sl);
    ['A','K','Q','J','T','9','8','7','6','5','4','3','2'].forEach(function(rank){
      var card=rank+suit,dealt=allDealt.indexOf(card)>=0;
      var b=document.createElement('button');b.style.cssText='flex:1;padding:6px 2px;background:'+(dealt?'rgba(255,255,255,0.02)':'rgba(255,255,255,0.05)')+';color:'+(dealt?'rgba(255,255,255,0.12)':isRed?'#e74c3c':'#f0e6c8')+';border:1px solid '+(dealt?'transparent':'rgba(255,255,255,0.08)')+';border-radius:4px;cursor:'+(dealt?'not-allowed':'pointer')+';font-size:clamp(0.62rem,2vw,0.8rem);font-weight:700;font-family:DM Sans,sans-serif';
      b.textContent=rank;b.dataset.card=card;
      if(!dealt)b.addEventListener('click',function(){rh.revealed.push(this.dataset.card);if(rh.revealed.length>=(5-rh.board.filter(Boolean).length)){rh.view='main';}renderRabbit();});
      row.appendChild(b);
    });
    body.appendChild(row);
  });
}

// ── SEAT RANDOMISER ───────────────────────────────────────────────────────────
var sr={players:[],result:[],animating:false};
window.openSeatRandomiser=function(){
  sr.players=window.state&&window.state.players?Object.values(window.state.players).filter(function(p){return p&&p.name;}).map(function(p){return p.name;}):[];
  sr.result=[];sr.animating=false;
  var s=document.getElementById('seatSheet');if(s)s.classList.add('open');renderSeat();
};
window.closeSeatRandomiser=function(){var s=document.getElementById('seatSheet');if(s)s.classList.remove('open');};
function shuffle(arr){var a=arr.slice();for(var i=a.length-1;i>0;i--){var j=Math.floor(Math.random()*(i+1));var t=a[i];a[i]=a[j];a[j]=t;}return a;}
window.doSeatDraw=function(){
  if(sr.players.length<2){toast('Need at least 2 players');return;}
  sr.animating=true;sr.result=[];renderSeat();
  var shuffled=shuffle(sr.players);var idx=0;
  function next(){
    if(idx>=shuffled.length){sr.animating=false;sr.result=shuffled.map(function(n,i){return{name:n,seat:i+1};});extApi('/games/'+getGameId()+'/seat-draw',{method:'POST',body:JSON.stringify({result:sr.result})}).catch(function(){});renderSeat();return;}
    sr.result.push({name:shuffled[idx],seat:idx+1});idx++;renderSeat();setTimeout(next,300+Math.random()*200);
  }
  setTimeout(next,400);
};
function renderSeat(){
  var body=document.getElementById('seatBody');if(!body)return;body.innerHTML='';
  var h=document.createElement('div');h.style.cssText='font-size:1rem;font-weight:700;color:var(--cream);margin-bottom:6px';h.textContent='\ud83c\udfb2 Seat Draw';body.appendChild(h);
  var sub=document.createElement('div');sub.style.cssText='font-size:0.78rem;color:var(--muted);margin-bottom:16px';sub.textContent=sr.players.length+' players';body.appendChild(sub);
  if(sr.result.length>0||sr.animating){
    for(var i=1;i<=sr.players.length;i++){
      var entry=sr.result.find(function(r){return r.seat===i;});
      var row=document.createElement('div');row.style.cssText='display:flex;align-items:center;gap:12px;padding:10px 14px;margin-bottom:5px;border-radius:8px;border:1px solid '+(entry?'rgba(201,168,76,0.25)':'rgba(255,255,255,0.05)')+';background:'+(entry?'rgba(201,168,76,0.06)':'rgba(255,255,255,0.02)')+(entry?'':';opacity:0.4');
      var sn=document.createElement('div');sn.style.cssText='width:32px;height:32px;border-radius:50%;background:'+(entry?'var(--gold)':'rgba(255,255,255,0.06)')+';display:flex;align-items:center;justify-content:center;font-size:0.85rem;font-weight:700;color:'+(entry?'#000':'var(--muted)')+';flex-shrink:0';sn.textContent=i;
      var pn=document.createElement('div');pn.style.cssText='font-size:0.9rem;color:'+(entry?'var(--cream)':'var(--muted)')+';font-weight:'+(entry?'600':'400');pn.textContent=entry?entry.name:(sr.animating?'...':'\u2014');
      row.appendChild(sn);row.appendChild(pn);body.appendChild(row);
    }
  }
  if(!sr.animating){body.appendChild(mkB(sr.result.length>0?'\ud83d\udd04 Redraw Seats':'\ud83c\udfb2 Draw Seats','width:100%;padding:14px;background:rgba(201,168,76,0.08);border:1px solid rgba(201,168,76,0.3);color:var(--gold);border-radius:10px;cursor:pointer;font-size:0.9rem;font-weight:700;font-family:DM Sans,sans-serif;margin-top:'+(sr.result.length>0?'12px':'0'),window.doSeatDraw));}
}
// Expose board state hook for rabbit hunt
Object.defineProperty(window,'_htState',{writable:true,configurable:true,value:null});
})();
