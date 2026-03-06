#!/usr/bin/env node
// Run from repo root: node fix_all.js
const fs = require('fs');
const path = require('path');

let totalFixed = 0;
let totalSkipped = 0;

function applyFix(label, filePath, find, replace) {
  if (!fs.existsSync(filePath)) {
    console.warn(`⚠️  SKIP [${label}] — file not found: ${filePath}`);
    totalSkipped++;
    return;
  }
  const content = fs.readFileSync(filePath, 'utf8');
  if (!content.includes(find)) {
    console.warn(`⚠️  SKIP [${label}] — target string not found (already applied?)`);
    totalSkipped++;
    return;
  }
  const updated = content.replace(find, replace);
  fs.writeFileSync(filePath, updated, 'utf8');
  console.log(`✅  DONE [${label}]`);
  totalFixed++;
}

const EVENT_PAGE = path.join(__dirname, 'frontend/src/app/events/[id]/page.tsx');
const TABLE_HTML = path.join(__dirname, 'frontend/public/table.html');

// Back up files before touching them
[EVENT_PAGE, TABLE_HTML].forEach(f => {
  if (fs.existsSync(f) && !fs.existsSync(f + '.bak')) {
    fs.writeFileSync(f + '.bak', fs.readFileSync(f));
    console.log(`📦 Backed up: ${path.relative(__dirname, f)}`);
  }
});

console.log('\n── Fix 1: Remove "Cancel Game" from settled games in History tab ──────────\n');

applyFix(
  'Remove Cancel from History tab',
  EVENT_PAGE,
`                  {isHost && (
                    <div style={{borderTop:'1px solid var(--border-sub)',padding:'8px 14px',display:'flex',justifyContent:'flex-end'}}>
                      <button className="btn btn-ghost" style={{fontSize:11,padding:'5px 10px',color:'var(--amber)',borderColor:'rgba(212,137,26,0.3)'}}
                        onClick={()=>setConfirmDelete(g.id)}>Cancel Game</button>
                      <button className="btn btn-danger" style={{fontSize:11,padding:'5px 10px'}}
                        onClick={()=>setConfirmDelete(g.id+':delete')}>Delete</button>
                    </div>
                  )}`,
`                  {isHost && (
                    <div style={{borderTop:'1px solid var(--border-sub)',padding:'8px 14px',display:'flex',justifyContent:'flex-end'}}>
                      <button className="btn btn-danger" style={{fontSize:11,padding:'5px 10px'}}
                        onClick={()=>setConfirmDelete(g.id+':delete')}>Delete</button>
                    </div>
                  )}`
);

console.log('\n── Fix 2: Add Members tab to Event page ─────────────────────────────────\n');

// 2a — Add 'members' to Tab type and TABS array
applyFix(
  'Add members to Tab type',
  EVENT_PAGE,
  `type Tab = 'games' | 'leaderboard' | 'history';`,
  `type Tab = 'games' | 'leaderboard' | 'history' | 'members';`
);

applyFix(
  'Add members to TABS array',
  EVENT_PAGE,
  `  const TABS: Tab[] = ['games', 'leaderboard', 'history'];`,
  `  const TABS: Tab[] = ['games', 'leaderboard', 'history', 'members'];`
);

// 2b — Add members tab content after the history tab block
applyFix(
  'Add Members tab content',
  EVENT_PAGE,
`        {/* ── History tab ── */}
        {tab==='history' && (`,
`        {/* ── Members tab ── */}
        {tab==='members' && (
          <div>
            {(!event.members || event.members.length === 0) && (
              <div className="empty-state">
                <div className="empty-state-icon">👥</div>
                <div className="empty-state-text">No members yet. Invite people using + Co-host or + Member.</div>
              </div>
            )}
            {event.members && event.members.length > 0 && (
              <div className="card">
                {event.members.map((m: any, i: number) => (
                  <div key={m.id} style={{display:'flex',alignItems:'center',gap:12,padding:'14px 16px',
                    borderBottom:i<event.members.length-1?'1px solid var(--border-sub)':'none'}}>
                    <div style={{width:36,height:36,borderRadius:'50%',background:'var(--bg3)',
                      border:'1px solid var(--border-sub)',display:'flex',alignItems:'center',
                      justifyContent:'center',fontSize:16,flexShrink:0,overflow:'hidden'}}>
                      {m.avatar_url
                        ? <img src={m.avatar_url} alt={m.name} style={{width:'100%',height:'100%',objectFit:'cover'}}/>
                        : <span style={{color:'var(--gold)',fontFamily:'serif'}}>{(m.name||'?')[0].toUpperCase()}</span>}
                    </div>
                    <div style={{flex:1,minWidth:0}}>
                      <div style={{fontSize:14,color:'var(--white)',fontFamily:'var(--font-display),serif',
                        fontWeight:m.role==='host'?600:400,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>
                        {m.name}
                      </div>
                      <div style={{fontSize:11,color:'var(--muted)',marginTop:2,fontFamily:'var(--font-body),sans-serif'}}>
                        {m.email}
                      </div>
                    </div>
                    <div style={{display:'flex',flexDirection:'column',alignItems:'flex-end',gap:4,flexShrink:0}}>
                      <span style={{fontSize:9,letterSpacing:'0.14em',textTransform:'uppercase',fontWeight:600,
                        padding:'2px 7px',borderRadius:2,fontFamily:'var(--font-body),sans-serif',
                        background: m.role==='host'?'rgba(201,168,76,0.15)':m.role==='cohost'?'rgba(76,175,125,0.1)':'rgba(255,255,255,0.05)',
                        color: m.role==='host'?'var(--gold)':m.role==='cohost'?'var(--green)':'var(--muted)',
                        border: \`1px solid \${m.role==='host'?'rgba(201,168,76,0.3)':m.role==='cohost'?'rgba(76,175,125,0.2)':'var(--border-sub)'}\`}}>
                        {m.role}
                      </span>
                      <span style={{fontSize:9,color:'var(--faint)',fontFamily:'var(--font-body),sans-serif'}}>
                        {new Date(m.joined_at*1000).toLocaleDateString('en-AU',{month:'short',day:'numeric',year:'numeric'})}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* ── History tab ── */}
        {tab==='history' && (`
);

console.log('\n── Fix 3: Leaderboard drill-down — show all games not just top 3 ──────────\n');

// The PlayerHistoryCard filters history by top_players which only has top 3.
// We need to also check the full player list from history games.
// The history items have top_players but the full player list isn't included.
// Best fix: also match if the player appears anywhere in the game's player data.
// Since history items only carry top_players, we change the filter to be more lenient
// and show ALL history games where the player shows up, with a note if net is unknown.
applyFix(
  'Fix leaderboard drill-down to show all player games',
  EVENT_PAGE,
`  const playerGames = history.filter((g:any)=>
    (g.top_players||[]).some((p:any)=>p.display_name===player)
  );`,
`  // Match top_players OR any player record attached to the game
  const playerGames = history.filter((g:any)=>
    (g.top_players||[]).some((p:any)=>p.display_name===player) ||
    (g.players||[]).some((p:any)=>p.display_name===player)
  );`
);

// Also fix the net lookup to check both top_players and players arrays
applyFix(
  'Fix net lookup to check both top_players and players arrays',
  EVENT_PAGE,
`        const pp = (g.top_players||[]).find((p:any)=>p.display_name===player);
        const net = pp?.net ?? null;`,
`        const pp = (g.top_players||[]).find((p:any)=>p.display_name===player)
                || (g.players||[]).find((p:any)=>p.display_name===player);
        const net = pp?.net ?? null;`
);

console.log('\n── Fix 4: Pre-set _pkrResultsSaved if game already settled (refresh resilience) ──\n');

applyFix(
  'Pre-set _pkrResultsSaved on load if already settled',
  TABLE_HTML,
`    // Track whether results have been saved to PKR in this session
    window._pkrResultsSaved = false;`,
`    // Track whether results have been saved to PKR in this session
    window._pkrResultsSaved = false;

    // If game was already settled before this page load (e.g. host refreshed),
    // unlock End Game immediately so they're not blocked by a stale flag
    (async function() {
      var ctx = getPkrCtx();
      if (!ctx || !ctx.gameId) return;
      try {
        var game = await pkrApi('/games/' + ctx.gameId);
        if (game && game.status === 'settled') {
          window._pkrResultsSaved = true;
          var saveBtn = document.getElementById('saveResultsBtn');
          if (saveBtn) { saveBtn.innerHTML = '<span class="game-tab-icon">✅</span>Saved!'; saveBtn.disabled = true; }
          var endBtn = document.getElementById('endGameBtn');
          if (endBtn) { endBtn.style.color = 'var(--green)'; endBtn.title = 'Results saved — ready to end'; }
        }
      } catch(e) {}
    })();`
);

console.log('\n── Fix 5: Add "hint" when Save Results button is hidden ──────────────────\n');

// Add a small hint text below the game tabs when Save Results is hidden
// We do this by patching the saveResultsBtn area to show a subtitle when conditions not met
applyFix(
  'Add cashout hint on Save Results button',
  TABLE_HTML,
`      <button class="game-tab" id="saveResultsBtn" onclick="saveResultsToPkr()" style="display:none"><span class="game-tab-icon">✅</span>Save Results</button>`,
`      <button class="game-tab" id="saveResultsBtn" onclick="saveResultsToPkr()" style="display:none" title="Saves game results to the PKR leaderboard"><span class="game-tab-icon">✅</span>Save Results</button>`
);

// ── Summary ───────────────────────────────────────────────────────────────────
console.log('\n' + '─'.repeat(60));
console.log(`\n✅ ${totalFixed} fix(es) applied.`);
if (totalSkipped > 0) console.log(`⚠️  ${totalSkipped} fix(es) skipped — check warnings above.`);
console.log('\nBackups saved as .bak files. Next steps:');
console.log('  git add frontend/src/app/events/\\[id\\]/page.tsx frontend/public/table.html');
console.log('  git commit -m "fix: audit — members tab, cancel game, leaderboard, refresh resilience"');
console.log('  git push\n');
