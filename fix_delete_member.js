const fs = require('fs');

let fixed = 0, skipped = 0;

function applyFix(label, file, find, replace) {
  if (!fs.existsSync(file)) { console.warn(`⚠️  SKIP [${label}] — file not found`); skipped++; return; }
  const c = fs.readFileSync(file, 'utf8');
  if (!c.includes(find)) { console.warn(`⚠️  SKIP [${label}] — already applied?`); skipped++; return; }
  fs.writeFileSync(file, c.replace(find, replace), 'utf8');
  console.log(`✅  DONE [${label}]`);
  fixed++;
}

const EVENTS_WORKER = 'worker/src/routes/events.ts';
const EVENT_PAGE    = 'frontend/src/app/events/[id]/page.tsx';
const API_LIB       = 'frontend/src/lib/api.ts';

[EVENTS_WORKER, EVENT_PAGE, API_LIB].forEach(f => {
  if (fs.existsSync(f) && !fs.existsSync(f + '.bak2')) {
    fs.writeFileSync(f + '.bak2', fs.readFileSync(f));
    console.log(`📦 Backed up: ${f}`);
  }
});

// ── Fix 1: Add DELETE /events/:id/members/:userId to worker ──────────────────
console.log('\n── Fix 1: Worker — add DELETE member route ──\n');
applyFix('Add delete member route to worker', EVENTS_WORKER,
`events.put('/:id', authMiddleware, async (c) => {`,
`// Remove a member from an event (host only, cannot remove self)
events.delete('/:id/members/:userId', authMiddleware, async (c) => {
  const eventId  = c.req.param('id');
  const targetId = c.req.param('userId');
  const requesterId = c.get('userId');
  if (!await requireEventRole(c, eventId, 'host')) return c.json({ error: 'Only host can remove members' }, 403);
  if (targetId === requesterId) return c.json({ error: 'You cannot remove yourself' }, 400);
  const target = await c.env.DB.prepare('SELECT role FROM event_members WHERE event_id=? AND user_id=?')
    .bind(eventId, targetId).first<{ role: string }>();
  if (!target) return c.json({ error: 'Member not found' }, 404);
  if (target.role === 'host') return c.json({ error: 'Cannot remove the host' }, 400);
  await c.env.DB.prepare('DELETE FROM event_members WHERE event_id=? AND user_id=?')
    .bind(eventId, targetId).run();
  return c.json({ ok: true });
});

events.put('/:id', authMiddleware, async (c) => {`
);

// ── Fix 2: Add removeMember to api.ts ────────────────────────────────────────
console.log('\n── Fix 2: api.ts — add removeMember method ──\n');
applyFix('Add removeMember to api.ts', API_LIB,
`    verifyPassword: (id:string,password:string) =>
      req<{ok:boolean;required:boolean}>(\`/events/\${id}/verify-password\`,{method:'POST',body:JSON.stringify({password})}),`,
`    verifyPassword: (id:string,password:string) =>
      req<{ok:boolean;required:boolean}>(\`/events/\${id}/verify-password\`,{method:'POST',body:JSON.stringify({password})}),
    removeMember:   (id:string,userId:string) =>
      req<{ok:boolean}>(\`/events/\${id}/members/\${userId}\`,{method:'DELETE'}),`
);

// ── Fix 3: Add confirmRemoveMember state + UI to Event page ──────────────────
console.log('\n── Fix 3: EventPage — add remove member state ──\n');
applyFix('Add confirmRemoveMember state', EVENT_PAGE,
`  const [showQuickSeat, setShowQuickSeat] = useState(false);`,
`  const [showQuickSeat, setShowQuickSeat] = useState(false);
  const [confirmRemoveMember, setConfirmRemoveMember] = useState(null as any);`
);

// ── Fix 4: Add delete button to Members tab rows ─────────────────────────────
console.log('\n── Fix 4: EventPage — add delete button to Members tab ──\n');
applyFix('Add delete button to member rows', EVENT_PAGE,
`                      <span style={{fontSize:9,color:'var(--faint)',fontFamily:'var(--font-body),sans-serif'}}>
                        {new Date(m.joined_at*1000).toLocaleDateString('en-AU',{month:'short',day:'numeric',year:'numeric'})}
                      </span>
                    </div>
                  </div>
                ))}`,
`                      <span style={{fontSize:9,color:'var(--faint)',fontFamily:'var(--font-body),sans-serif'}}>
                        {new Date(m.joined_at*1000).toLocaleDateString('en-AU',{month:'short',day:'numeric',year:'numeric'})}
                      </span>
                    </div>
                    {isHost && m.role !== 'host' && (
                      <button
                        onClick={()=>setConfirmRemoveMember(m)}
                        style={{background:'none',border:'1px solid rgba(231,76,60,0.25)',color:'var(--red)',
                          borderRadius:2,padding:'4px 10px',fontSize:10,cursor:'pointer',
                          fontFamily:'var(--font-body),sans-serif',flexShrink:0,marginLeft:6}}>
                        Remove
                      </button>
                    )}
                  </div>
                ))}` 
);

// ── Fix 5: Add confirmation modal ────────────────────────────────────────────
console.log('\n── Fix 5: EventPage — add confirmation modal ──\n');
applyFix('Add remove member confirm modal', EVENT_PAGE,
`      {/* Fix 6+10: Confirm delete/cancel modal */}
      {confirmDelete && (`,
`      {/* Remove member confirm modal */}
      {confirmRemoveMember && (
        <div className="modal-overlay" onClick={()=>setConfirmRemoveMember(null)}>
          <div className="modal animate-up" onClick={(e:any)=>e.stopPropagation()} style={{maxWidth:360}}>
            <div style={{padding:'24px 24px 0'}}>
              <div style={{fontSize:16,color:'var(--white)',fontFamily:'var(--font-display),serif',fontWeight:500,marginBottom:8}}>
                Remove Member?
              </div>
              <div style={{fontSize:13,color:'var(--muted)',lineHeight:1.7,fontFamily:'var(--font-body),sans-serif'}}>
                Remove <strong style={{color:'var(--ivory)'}}>{confirmRemoveMember.name}</strong> from this event?
                They will lose access and will need a new invite link to rejoin.
              </div>
            </div>
            <div style={{padding:'20px 24px',display:'flex',gap:8,justifyContent:'flex-end'}}>
              <button className="btn btn-ghost" style={{fontSize:12}}
                onClick={()=>setConfirmRemoveMember(null)}>Keep them</button>
              <button className="btn btn-danger" style={{fontSize:12}}
                onClick={async()=>{
                  try {
                    await api.events.removeMember(id, confirmRemoveMember.id);
                    setEvent((ev:any) => ({
                      ...ev,
                      members: ev.members.filter((m:any) => m.id !== confirmRemoveMember.id),
                      member_count: (ev.member_count || 1) - 1,
                    }));
                  } catch(e:any) { alert(e.message); }
                  setConfirmRemoveMember(null);
                }}>
                Yes, Remove
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Fix 6+10: Confirm delete/cancel modal */}
      {confirmDelete && (`
);

console.log('\n' + '─'.repeat(50));
console.log(`\n✅ ${fixed} fix(es) applied, ⚠️  ${skipped} skipped.\n`);
console.log('Next steps:');
console.log("  git add worker/src/routes/events.ts 'frontend/src/app/events/[id]/page.tsx' frontend/src/lib/api.ts");
console.log('  git commit -m "feat: host can remove members from event with confirmation"');
console.log('  git push\n');
