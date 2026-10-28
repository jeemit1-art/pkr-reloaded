"""One-time source migration; exact preimage, no application/database writes.
Run only on the review branch. Remove this helper before merging the release.
"""
from pathlib import Path
import hashlib

p = Path('frontend/src/app/games/[id]/play/page.tsx')
raw = p.read_bytes()
assert hashlib.sha1(b'blob '+str(len(raw)).encode()+b'\0'+raw).hexdigest() == '39f1c11eed2cb5361d9aeadf1db2dd012c90c434', 'Unexpected gameplay source: stop rather than overwrite'
s = raw.decode()

def replace_once(old, new):
    global s
    assert s.count(old) == 1, 'Missing or ambiguous source anchor: '+old[:90]
    s = s.replace(old, new, 1)

def section(start, end, new):
    global s
    assert s.count(start) == 1
    a = s.index(start)
    b = s.index(end, a)
    s = s[:a] + new + '\n' + s[b:]

section('function renderTable() {', 'window.renderTable = renderTable;', '''function renderTable() {
  if(!state.game)return;
  var area=document.getElementById('tableArea'),wrap=document.getElementById('tableWrap');
  if(!area||!wrap)return;
  var W=area.clientWidth,availableHeight=area.clientHeight;
  if(!W||!availableHeight){setTimeout(renderTable,80);return;}
  var count=Math.max(2,Math.min(36,Number(state.game.seats)||9));
  var compact=_pkrSeatLayout==='compact';
  var hasStacks=!!state.game.hand_tracking;
  var leftCount=Math.ceil((count-2)/2),rightCount=Math.floor((count-2)/2);
  var wideTable=W>=850&&availableHeight>=380;
  var cardWidth=wideTable?(compact?76:148):(compact?60:Math.floor(Math.min(132,Math.max(90,W*.285))));
  var cardHeight=compact?(hasStacks?100:83):(hasStacks?94:72);
  var minimumHeight=wideTable?450:Math.max(410,(Math.max(leftCount,rightCount)+1)*(cardHeight+9)+28);
  var H=Math.max(availableHeight,minimumHeight);
  wrap.style.setProperty('--pkr-canvas-height',H+'px');
  var summary=document.getElementById('pkrSeatSummary');
  area.classList.remove('pkr-table-summary-on');
  if(summary){summary.hidden=true;summary.replaceChildren();}
  var tH=wideTable?Math.min(H*.54,420):Math.max(180,H-2*(cardHeight+21));
  var tW=wideTable?Math.min(W*.68,tH*1.9,1000):Math.min(W*.54,tH*.64);
  var screen=document.getElementById('gameScreen');
  if(screen)screen.classList.toggle('pkr-wide-table',wideTable);
  var cx=W/2,cy=H/2,pad=14;
  var outer=document.getElementById('tableOuter'),felt=document.getElementById('tableFelt');
  if(outer)outer.style.cssText='width:'+(tW+pad*2)+'px;height:'+(tH+pad*2)+'px;left:'+(cx-(tW+pad*2)/2)+'px;top:'+(cy-(tH+pad*2)/2)+'px';
  if(felt)felt.style.cssText='width:'+tW+'px;height:'+tH+'px;left:'+(cx-tW/2)+'px;top:'+(cy-tH/2)+'px';
  var players=Object.values(state.players).filter(function(p){return p&&p.name;});
  var active=players.filter(function(p){return pBuyin(p)>0&&!(p.transactions||[]).some(function(t){return t.type==='cashout';});}).length;
  var name=document.getElementById('tableName'),stats=document.getElementById('tableStats'),meta=document.getElementById('topbarGameMeta');
  if(name)name.textContent=state.game.name;
  var caption=active+' active · '+players.length+' seated';
  if(stats)stats.textContent=players.length?caption:'';
  if(meta)meta.textContent=caption;
  buildSeats(count,tW,tH,cx,cy,wideTable,seatChipRows(),{
    width:W,height:H,cardWidth:cardWidth,cardHeight:cardHeight,compact:compact,hasStacks:hasStacks
  });
  updateBank();updateSaveResultsBtn();
}''')
section('function pkrMockupSeatCard(', 'function onSeatClick(sid) {', '''function pkrSeatMoney(n,signed){
  var text=signed?fmtNet(n):fmt(n);
  return text.endsWith('.00')?text.slice(0,-3):text;
}
function pkrMockupSeatCard(p,sid,bankIn,finalNet,cashed,compact,stackRow){
  var bought=bankIn>0,status=cashed?'CASHED OUT':bought?'IN PLAY':'SEATED';
  var statusClass=cashed?'cashed':bought?'inplay':'waiting';
  var amount=cashed?pkrSeatMoney(finalNet,true):bought?'-'+pkrSeatMoney(bankIn,false):pkrSeatMoney(0,false);
  var amountClass=cashed?nc(finalNet):bought?'neg':'zero';
  var banks=seatBankLabel(bankIn).replace(/ in$/,'').replace('.00','');
  var avatar='<span class="seat-chip '+(cashed?'cashed':'seated')+' pkr-game-seat-avatar"><span class="seat-inner">'+pkrAvatar(p)+'</span></span>';
  var badge=cashed?'✓':bought?'›':'•';
  var main=compact?
    '<span class="pkr-game-compact-avatar">'+avatar+'<span class="pkr-game-status-dot '+statusClass+'" aria-label="'+status+'">'+badge+'</span></span>'+
    '<span class="seat-money pkr-game-compact-bank">'+esc(pkrSeatMoney(bankIn,false))+'</span>'+
    '<strong class="pkr-game-seat-result '+amountClass+'">'+esc(amount)+'</strong>'+
    (cashed?'':'<span class="pkr-game-compact-status '+statusClass+'">'+status+'</span>'):
    '<span class="pkr-game-seat-main">'+avatar+'<span class="pkr-game-seat-copy">'+
    '<strong class="seat-label pkr-game-seat-name">'+esc(p.name)+'</strong>'+
    '<small class="seat-money pkr-game-seat-bank">'+esc(banks)+'</small>'+
    '<strong class="pkr-game-seat-result '+amountClass+'">'+esc(amount)+'</strong></span></span>'+
    '<span class="pkr-game-seat-status '+statusClass+'"><span aria-hidden="true">'+badge+'</span> '+status+'</span>';
  var chipLabel='';
  if(state.game.hand_tracking&&stackRow&&!cashed){
    if(Number.isSafeInteger(stackRow.chips)&&stackRow.chips>=0){
      chipLabel=Number(stackRow.chips).toLocaleString('en-AU')+' chips';
      if(!compact&&stackRow.cashValue!==null&&Number.isFinite(stackRow.cashValue))chipLabel+=' · '+pkrSeatMoney(stackRow.cashValue,false);
    }else if(stackRow.source==='review')chipLabel='Check chips';
  }
  var chips=chipLabel?'<span class="seat-stack pkr-game-stack-readout '+(stackRow.source||'issued')+'">'+esc(chipLabel)+'</span>':'';
  return '<span class="pkr-game-seat-card '+statusClass+'"><span class="pkr-game-seat-number">'+esc(sid.slice(4))+'</span>'+main+chips+'</span>';
}
function buildSeats(count,tW,tH,cx,cy,wideTable,seatRows,g){
  var cont=document.getElementById('seatsContainer');if(!cont)return;
  cont.replaceChildren();
  var leftCount=Math.ceil((count-2)/2),rightCount=Math.floor((count-2)/2),positions=[];
  if(wideTable){
    var rx=Math.min(g.width/2-g.cardWidth/2-12,tW/2+g.cardWidth*.65);
    var ry=Math.min(g.height/2-g.cardHeight/2-16,tH/2+g.cardHeight*.6);
    var polar=function(a){return {x:cx+rx*Math.cos(a),y:cy+ry*Math.sin(a)};};
    positions.push(polar(-Math.PI/2));
    for(var a=0;a<leftCount;a++)positions.push(polar(-Math.PI/2-Math.PI*(a+1)/(leftCount+1)));
    positions.push(polar(Math.PI/2));
    for(var b=0;b<rightCount;b++)positions.push(polar(Math.PI/2-Math.PI*(b+1)/(rightCount+1)));
  }else{
    var top=g.cardHeight/2+14,bottom=g.height-g.cardHeight/2-14;
    var leftX=Math.max(g.cardWidth/2+8,cx-tW/2-g.cardWidth*.32),rightX=g.width-leftX;
    var first=top+g.cardHeight*.6,last=bottom-g.cardHeight*.6;
    var spread=function(i,n){return n<=1?g.height/2:first+(last-first)*i/(n-1);};
    positions.push({x:cx,y:top});
    for(var a=0;a<leftCount;a++)positions.push({x:leftX,y:spread(a,leftCount)});
    positions.push({x:cx,y:bottom});
    // Geometry only: seat IDs remain unchanged; right-hand positions run
    // from bottom to top, as shown in the approved circular seating mockup.
    for(var b=0;b<rightCount;b++)positions.push({x:rightX,y:spread(rightCount-1-b,rightCount)});
  }
  positions.forEach(function(pos,i){
    var sid='seat'+(i+1),p=state.players[sid],seat=document.createElement('div');
    seat.className='seat pkr-mockup-player-seat '+(g.compact?'pkr-layout-compact':'pkr-layout-full');
    seat.id=sid;seat.style.left=pos.x+'px';seat.style.top=pos.y+'px';
    seat.style.setProperty('--pkr-card-width',g.cardWidth+'px');
    seat.style.setProperty('--pkr-card-height',g.cardHeight+'px');
    seat.style.setProperty('--pkr-avatar-size',(wideTable?42:g.width<=360?28:34)+'px');
    seat.style.setProperty('--pkr-name-size',(wideTable?13:g.width<=360?10:11)+'px');
    seat.style.setProperty('--pkr-bank-size',(wideTable?12:g.width<=360?9:10)+'px');
    seat.style.setProperty('--pkr-result-size',(wideTable?17:g.width<=360?12:14)+'px');
    if(i>0&&i<=leftCount)seat.dataset.side='left';
    else if(i>leftCount+1)seat.dataset.side='right';
    seat.setAttribute('role','button');seat.tabIndex=0;
    if(p&&p.name){
      var bi=pBuyin(p),cashed=(p.transactions||[]).some(function(t){return t.type==='cashout';});
      seat.classList.add(cashed?'pkr-cashed-seat':bi>0?'pkr-inplay-seat':'pkr-waiting-seat');
      seat.dataset.status=cashed?'cashed':bi>0?'inplay':'waiting';
      seat.setAttribute('aria-label','Open player '+p.name+': '+(cashed?'Cashed out':bi>0?'In play':'Seated'));
      seat.title=p.name+' · '+seatBankLabel(bi)+' · '+(cashed?'Cashed out; net '+fmtNet(pNet(p)):'Buy-ins outstanding, not a realised loss');
      seat.innerHTML=pkrMockupSeatCard(p,sid,bi,pNet(p),cashed,g.compact,(seatRows||{})[sid]);
    }else{
      seat.classList.add('pkr-empty-seat');
      seat.setAttribute('aria-label','Assign player to seat '+(i+1));
      seat.innerHTML='<span class="seat-chip empty"><span class="seat-inner">+</span></span><span class="seat-label">Seat '+(i+1)+'</span>';
    }
    seat.addEventListener('click',function(){onSeatClick(sid);});
    seat.addEventListener('keydown',function(e){if(e.key==='Enter'||e.key===' '){e.preventDefault();onSeatClick(sid);}});
    cont.appendChild(seat);
  });
}
''')
start=s.index('          <div className="pkr-table-tools-sheet pkr-mockup-tools-sheet" id="pkr-table-tools">')
end=s.index('        </AppDialog>}',start)
s=s[:start]+'''          <div className="pkr-table-tools-sheet pkr-mockup-tools-sheet pkr-reference-tools" id="pkr-table-tools">
            <header className="pkr-table-tools-sheet-header">
              <div><span>POKER NIGHT</span><h2>Table controls</h2><p>Game tools and table view</p></div>
              <button className="pkr-tools-close" type="button" aria-label="Close table controls" onClick={()=>setToolsOpen(false)}>×</button>
            </header>
            <div className="pkr-reference-view-select" role="group" aria-label="Table view">
              <button type="button" aria-label="Full details" aria-pressed={seatLayout==='full'} onClick={()=>selectTableLayout('full')}>Full details</button>
              <button type="button" aria-label="Compact seats" aria-pressed={seatLayout==='compact'} onClick={()=>selectTableLayout('compact')}>Compact seats</button>
            </div>
            <div className="pkr-reference-tool-grid">
              <button id="trackHandsBtn" type="button" aria-label="Hand tracker" onClick={()=>{setToolsOpen(false);(window as any).toggleHandTracking?.();}}><span aria-hidden="true">♠</span><span>Hand<br/>Tracking</span></button>
              <button type="button" aria-label="Tournament" onClick={()=>{setToolsOpen(false);openTournamentReliably();}}><span aria-hidden="true">🏆</span><span>Tournament<br/>Controls</span></button>
              <button type="button" aria-label="Add seat" onClick={()=>{setToolsOpen(false);(window as any).addSeat?.();}}><span aria-hidden="true">♙+</span><span>Add<br/>Seat</span></button>
              <button type="button" aria-label="Remove empty seat" onClick={()=>{setToolsOpen(false);(window as any).removeSeat?.();}}><span aria-hidden="true">−</span><span>Remove<br/>Empty Seat</span></button>
              <button type="button" aria-label="Seat draw" onClick={()=>{setToolsOpen(false);(window as any).openSeatRandomiser?.();}}><span aria-hidden="true">🎲</span><span>Seat<br/>Draw</span></button>
              <button type="button" aria-label="Rabbit hunt" onClick={()=>{setToolsOpen(false);(window as any).openRabbitHunt?.();}}><span aria-hidden="true">🐇</span><span>Rabbit<br/>Hunt</span></button>
            </div>
            <div className="pkr-tools-reconciliation-note">Save Results becomes available after all cash-outs are recorded, the bank balances and synchronisation is clear.</div>
          </div>
'''+s[end:]
# All gameplay, dollar/cents, server-write and reconciliation functions are retained.
assert 'function getSettlementReadiness()' in s
assert "getSettlementReadiness().ready" in s
assert "var dense=count>=10&&!wideTable;" not in s
assert "function renderTable()" in s
p.write_text(s)
compiler=Path('frontend/scripts/compile-theme-a.cjs')
c=compiler.read_text()
old="'pkr-theme-a-overlays.css','pkr-app-experience.css'];"
assert c.count(old)==1
compiler.write_text(c.replace(old,"'pkr-theme-a-overlays.css','pkr-app-experience.css','pkr-gameplay-reference.css'];"))
t=Path('frontend/tests/seat-table-experience.cjs')
a=t.read_text()
assert "filter({hasText:'$25.00'})" in a
a=a.replace("filter({hasText:'$25.00'})","filter({hasText:'$25'})")
t.write_text(a)
print('Applied one unified seat renderer, measured viewport geometry, slim statuses and icon tools. No Worker or database files changed.')
