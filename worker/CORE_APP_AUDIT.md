# PKR Reloaded — Core Poker App Audit

**Date:** 2026-10-24  
**Scope:** Core game operation, cash-game settlement integrity, hand tracking, side pots, session recovery, authorization, and player privacy.  
**Explicitly outside current scope:** Commercialisation, new pricing, subscription design, checkout changes, or production release.

## Production protection

This work is isolated on the **draft** GitHub PR #1, branch `codex/pkr-production-protection-20261024`. It must **not** be merged or deployed to `main` without a separate approval and independently verified production backup/restore. Existing production Worker/D1/KV bindings are not touched. Staging has its own Worker, D1 database, KV namespace and Vercel Preview branch.

User successfully completed a staging Google login, synthetic table, game, three players, $60 total buy-ins and $60 cash-outs, Alex-to-Charlie $10 settlement, and persistence after browser refresh. Do not repeat these manual tests without a specific reason.

## Code changes under test

| Area | Stage-only changes | Automated verification |
| --- | --- | --- |
| Access permissions | Co-host/host-only financial mutations, authenticated transfer changes, restrict generic status transitions | Route-level mocked-D1 tests |
| Client data exposure | Omit event PIN hashes and game passwords; redact WhatsApp contacts from unauthenticated RSVP/lobby responses | Client response tests and public RSVP tests |
| Cash game settlement | Reject unbalanced outcomes and invalid cents, scope idempotency to game, prevent duplicate paid status changes | Settlement conservation/property tests and API-level tests |
| Concurrent money edits | Atomic value-based guards for exact buy-ins and cash-outs; unprotected incremental buy-in POST is disabled; legacy cash-out POST is first-write-only; pending conflicts retain their journal and pause replay | Staging Worker financial route and browser journal tests |
| Player seat protection | Conditional seat moves and atomic first-seat claims; prevent deleting a player with buy-ins, cash-outs or recorded hand history | Staging-only route concurrency tests |
| Starting games | RSVP seating preserves occupied seats, gives Quick Seat guests priority, respects capacity; final conditional activation and seating are one D1 transaction, preventing losing simultaneous starts from adding guests | Seat planner, concurrent-start API tests and SQL compatibility checks |
| Conflict review UI | Pending edits survive refresh, hosts compare local versus server values, and explicit retries use fresh expected-value guards; occupied seats and monetary-history deletion cannot be overridden | Browser queue regression tests and review-action tests |
| Hand actions | Atomic action insert/undo and pot recalculation, deterministic same-second action ordering, protect finished hands and games | Hand action transaction and undo tests |
| Betting order | Prevent repeated big-blind option after checking; assert preflop/postflop actor sequence | Real shipped JavaScript action-order tests |
| Server betting rules (full hands) | Server checks next player, blind eligibility, exact call, legal check, minimum raise, short all-in that does not reopen betting and street order; CAS-protected hand action append | Unit betting fixtures, Hono route tests and staging SQL compilation |
| Side pots | Use the same accounting function for winner selection and display, include folded contributions | Chip conservation and side-pot fixture tests |
| Hand result history | Persist individual side-pot allocations through existing result JSON without a migration; preserve historic result formats | Serialization and hand-route round-trip tests |
| Hand winner conflicts | Winner declaration is first-write-wins; accept identical HTTP retries, reject competing winners, check pot and game status inside the write; corrections require explicit Undo Winner | Hono route concurrency, retry and mid-write pot-change tests |
| Hand tracker UI | Render dynamic player/winner names as text, not injected HTML | Browser script parse gate |
| Board concurrency | Host must supply previous board; reject stale edits and changed winner, closed or voided hands in one guarded write | API + shipped browser picker tests |
| Hand/tournament accounting | Matched pots, refunds, eligible winner/odd-chip validation, idempotent rebuys, server clock, prize cents and safe finishing positions | Pot conservation, tournament and concurrent API tests |
| Financial ABA revisions (optional) | D1 revision/audit triggers record create, update, delete and re-create; buy-in/cashout PUT guards with revision and browser queue rebasing | Optional migration in SQLite, API and journal tests; flag remains OFF |
| Host-confirmed chip stacks (optional) | Whole-chip verified immutable hand baselines and stack limit validation; confirm before blind auto-post with interruption recovery | Isolated confirmation tests and browser tests; flag remains OFF |
| Game deletion | Conditional deletion restricted to unused, unplayed games; preserve money, hands and tournament records | Route-level history guard tests |
| Recovery | Per-game hand sessions; journaled seat/money changes; block financial network mutations when browser storage fails, and replay only after journal is persisted; stop sync on closed game | Offline journal persistence, denied-storage, recovery and closed-game tests |
| Deployment safeguards | Staging-only Worker/D1/KV bindings, optional integrity migration tested in disposable SQLite, Worker unit/SQL checks, independent Next.js preview build, read-only smoke and browser syntax | GitHub staging-isolation CI; separate Vercel rate-limited preview |

Run logs are available in GitHub Actions; test count grows with each change.

## Important unresolved blockers — do not release yet

1. **Optional migration not applied.** `PKR_INTEGRITY_REVISIONS` and `PKR_INTEGRITY_STACKS` remain disabled by default. The migration and API changes are tested against **disposable SQLite**, not installed or enabled on the remote staging D1. They must first be applied to the exact isolated staging resource after independent schema/backup checks and exercised with the real browser.
2. **Actual mobile/offline and multi-device UAT.** localStorage journalling is best effort; it cannot prevent device storage eviction. Test at least two live devices, network interruption during each financial request, app restart, conflicting seat/board changes, duplicate rebuy/settlement taps and recovery of an unfinished hand. Existing smoke tests do not prove this.
3. **Full hand stack provenance.** The new optional host-confirmed baseline prevents over-stack and false-all-in actions **only when enabled and fully confirmed before blind posting**. Old and incomplete hand records still lack immutable starting stacks and reliable historical player rosters. Do not infer opening stacks from purchase dollars.
4. **Poker rules and legacy results.** Core turn order, cumulative short all-ins, matched side pots, uncalled refunds and clockwise tied-pot odd chips are covered, but exhaustive multiway/legacy rules and real-device UI acceptance are still required before launch.
5. **Vercel preview build rate limit.** New Vercel preview builds are blocked by the account build-rate limit. GitHub Actions now independently build the Next.js preview source successfully, but that is **not** proof a current interactive Vercel preview was deployed.
6. **Actual production schema and data.** The staged schema is reconstructed; production schema compatibility, a verified independent production D1 backup and **successful restore rehearsal**, financial reconciliation, monitoring and documented rollback have not been performed. No production changes are authorised.
7. **Release authorisation.** The owner must approve a specific tested commit in writing before any merge to `main` or promotion to production. Commercialisation is out of scope.

Detailed release gate and read-only schema review instructions: `worker/RELEASE_GATE.md`.

## Acceptance requirements for any future release

- No production deployment or `main` merge during the current audit.
- All CI checks green on the exact reviewed commit.
- All core actions tested in isolated staging, including targeted changes introduced by this work (not repeated baseline scenarios).
- No real card/session history or financial records copied into staging.
- Financial records and historic hands remain accessible after a tested, backward-compatible deployment.
- Production backups and rollback plan independently verified.
- Explicit owner approval to promote a reviewed build.
