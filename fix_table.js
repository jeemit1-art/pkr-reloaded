const fs = require('fs');
const path = require('path');

const FILE = path.join(__dirname, 'frontend', 'public', 'table.html');

if (!fs.existsSync(FILE)) {
  console.error('❌ Could not find:', FILE);
  process.exit(1);
}

let html = fs.readFileSync(FILE, 'utf8');
let changed = 0;

// FIX 1 — call updateSaveResultsBtn() after every transaction
const F1 = `  syncToCloud().catch(() => {});
  const phone = getPhone(p.name);`;
const R1 = `  syncToCloud().catch(() => {});
  updateSaveResultsBtn();
  const phone = getPhone(p.name);`;
if (html.includes(F1)) { html = html.replace(F1, R1); changed++; console.log('✅ Fix 1 applied'); }
else console.warn('⚠️  Fix 1 skipped — already applied?');

// FIX 2 — set _pkrResultsSaved flag after successful save
const F2 = `      toast('Results saved to PKR ✓');
      // Update end game button to show it's ready
      var endBtn = document.getElementById('endGameBtn');
      if (endBtn) endBtn.style.color = 'var(--green)';`;
const R2 = `      toast('Results saved to PKR ✓');
      window._pkrResultsSaved = true;
      var endBtn = document.getElementById('endGameBtn');
      if (endBtn) { endBtn.style.color = 'var(--green)'; endBtn.title = 'Results saved — ready to end'; }`;
if (html.includes(F2)) { html = html.replace(F2, R2); changed++; console.log('✅ Fix 2 applied'); }
else console.warn('⚠️  Fix 2 skipped — already applied?');

// FIX 3 — replace PKR bridge endGame() with gated version
const F3_START = `    window.endGame = function() {
      var overlay = document.createElement('div');
      overlay.style.cssText = 'position:fixed;inset:0;z-index:600;background:rgba(0,0,0,0.85);display:flex;align-items:center;justify-content:center;padding:24px';
      var box = document.createElement('div');
      box.style.cssText = 'background:#1a0a0a;border:1px solid rgba(231,76,60,0.5);border-radius:16px;padding:24px;width:100%;max-width:320px';
      box.innerHTML =
        '<div style="font-size:1.1rem;font-weight:700;color:#ff6b5b;margin-bottom:10px">End Game?</div>'
        +'<div style="font-size:0.9rem;color:#d4c4a0;margin-bottom:20px;line-height:1.6">Results will be settled and saved to the PKR leaderboard.</div>'`;

const F3_END = `      overlay.onclick = function(e){ if(e.target===overlay) overlay.remove(); };
    };`;

const F3_FULL_START = html.indexOf(F3_START);
const F3_FULL_END = html.indexOf(F3_END, F3_FULL_START) + F3_END.length;

if (F3_FULL_START !== -1) {
  const R3 = `    window._pkrResultsSaved = false;

    window.endGame = function() {
      if (!window._pkrResultsSaved) {
        var saveBtn = document.getElementById('saveResultsBtn');
        var saveVisible = saveBtn && saveBtn.style.display !== 'none';
        var overlay = document.createElement('div');
        overlay.style.cssText = 'position:fixed;inset:0;z-index:600;background:rgba(0,0,0,0.85);display:flex;align-items:center;justify-content:center;padding:24px';
        var box = document.createElement('div');
        box.style.cssText = 'background:#1a0a0a;border:1px solid rgba(231,76,60,0.5);border-radius:16px;padding:24px;width:100%;max-width:320px;text-align:center';
        box.innerHTML =
          '<div style="font-size:2rem;margin-bottom:12px">⚠️</div>'
          + '<div style="font-size:1rem;font-weight:700;color:#ff6b5b;margin-bottom:10px">Save Results First</div>'
          + '<div style="font-size:0.88rem;color:#d4c4a0;margin-bottom:20px;line-height:1.6">'
          + (saveVisible ? 'Tap <strong style="color:#c9a84c">Save Results ✅</strong> before ending.' : 'Cash out all players first, then tap <strong style="color:#c9a84c">Save Results ✅</strong>.')
          + '</div>'
          + (saveVisible ? '<button id="pkrGoSave" style="width:100%;background:linear-gradient(135deg,#1e6b2a,#0f4a1a);color:#fff;border:none;padding:13px;border-radius:10px;font-family:DM Sans,sans-serif;font-size:0.9rem;font-weight:700;cursor:pointer;margin-bottom:10px">✅ Save Results Now</button>' : '')
          + '<button id="pkrEndBlockClose" style="width:100%;background:none;border:1px solid rgba(201,168,76,0.2);color:#6b8c6e;padding:12px;border-radius:10px;font-family:DM Sans,sans-serif;font-size:0.9rem;cursor:pointer">OK</button>';
        overlay.appendChild(box);
        document.body.appendChild(overlay);
        var closeBtn = document.getElementById('pkrEndBlockClose');
        if (closeBtn) closeBtn.onclick = function() { overlay.remove(); };
        var goSaveBtn = document.getElementById('pkrGoSave');
        if (goSaveBtn) goSaveBtn.onclick = function() { overlay.remove(); saveResultsToPkr(); };
        overlay.onclick = function(e) { if (e.target === overlay) overlay.remove(); };
        return;
      }
      var overlay = document.createElement('div');
      overlay.style.cssText = 'position:fixed;inset:0;z-index:600;background:rgba(0,0,0,0.85);display:flex;align-items:center;justify-content:center;padding:24px';
      var box = document.createElement('div');
      box.style.cssText = 'background:#1a0a0a;border:1px solid rgba(46,204,113,0.3);border-radius:16px;padding:24px;width:100%;max-width:320px';
      box.innerHTML =
        '<div style="font-size:1.1rem;font-weight:700;color:#2ecc71;margin-bottom:10px">🏁 End Game?</div>'
        + '<div style="font-size:0.9rem;color:#d4c4a0;margin-bottom:20px;line-height:1.6">Results are saved ✓. This will close the game and return to the events page.</div>'
        + '<button id="pkrEndYes" style="width:100%;background:linear-gradient(135deg,#1e6b2a,#0f4a1a);color:#fff;border:none;padding:13px;border-radius:10px;font-family:DM Sans,sans-serif;font-size:0.9rem;font-weight:700;cursor:pointer;margin-bottom:10px">Yes, End Game</button>'
        + '<button id="pkrEndNo" style="width:100%;background:none;border:1px solid rgba(201,168,76,0.2);color:#6b8c6e;padding:12px;border-radius:10px;font-family:DM Sans,sans-serif;font-size:0.9rem;cursor:pointer">Cancel</button>';
      overlay.appendChild(box);
      document.body.appendChild(overlay);
      document.getElementById('pkrEndNo').onclick = function() { overlay.remove(); };
      document.getElementById('pkrEndYes').onclick = function() {
        try { if (window.stopSyncPolling) window.stopSyncPolling(); } catch(e) {}
        try { if (window.setCloudRole) window.setCloudRole(null, null, null); } catch(e) {}
        try { if (window.state) { window.state.game = null; window.state.players = {}; } if (window.saveState) window.saveState(); localStorage.removeItem('pkrCtx'); } catch(e) {}
        overlay.remove();
        window.location.href = '/events/' + ctx.eventId;
      };
      overlay.onclick = function(e) { if (e.target === overlay) overlay.remove(); };
    };`;

  html = html.slice(0, F3_FULL_START) + R3 + html.slice(F3_FULL_END);
  changed++; console.log('✅ Fix 3 applied');
} else {
  console.warn('⚠️  Fix 3 skipped — already applied?');
}

if (changed > 0) {
  fs.writeFileSync(FILE + '.bak', fs.readFileSync(FILE));
  fs.writeFileSync(FILE, html, 'utf8');
  console.log('\n✅ Done! ' + changed + '/3 fixes applied.');
  console.log('   Backup saved to: frontend/public/table.html.bak');
} else {
  console.log('\nℹ️  No changes made.');
}
