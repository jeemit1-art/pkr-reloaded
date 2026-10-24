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
| Concurrent money edits | Atomic value-based guards for exact buy-ins and cash-outs; legacy cash-out POST is first-write-only and cannot overwrite an existing figure; conflict responses retain local journal and pause replay | Staging Worker concurrent route tests and browser journal tests |
| Player seat protection | Conditional seat moves and atomic first-seat claims; prevent deleting a player with buy-ins, cash-outs or recorded hand history | Staging-only route concurrency tests |
| Hand actions | Atomic action insert/undo and pot recalculation, deterministic same-second action ordering, protect finished hands and games | Hand action transaction and undo tests |
| Betting order | Prevent repeated big-blind option after checking; assert preflop/postflop actor sequence | Real shipped JavaScript action-order tests |
| Side pots | Use the same accounting function for winner selection and display, include folded contributions | Chip conservation and side-pot fixture tests |
| Hand result history | Persist individual side-pot allocations through existing result JSON without a migration; preserve historic result formats | Serialization and hand-route round-trip tests |
| Hand tracker UI | Render dynamic player/winner names as text, not injected HTML | Browser script parse gate |
| Recovery | Per-game hand sessions, durable browser journal of unsynced seat/money changes; absolute retry-safe buy-in updates, stop sync on closed game | Offline journal replay, refresh and closed-game tests |
| Deployment safeguards | Staging-only Worker/D1/KV bindings, 222 SQL statement compatibility checks, typecheck, unit tests, live read-only staging smoke and browser syntax | GitHub staging-isolation CI |

Run logs are available in GitHub Actions; test count grows with each change.

## Important unresolved blockers — do not release yet

1. **Multi-device concurrent editing.** Conditional buy-in/cash-out writes and seat changes now reject stale values. Seat removal also protects money and hand history. Offline conflicts remain retained. **Still open:** monotonic revisions (ABA is not detected), RSVP auto-seating, a complete manual conflict-resolution UI, legacy buy-in increments and mobile/offline verification. Do not release until these are addressed.
2. **Offline browser lifecycle.** Journal uses localStorage, not a guaranteed durable offline database. Browser storage can be cleared or unavailable; page reload while offline may require connectivity to load the app. Validate realistic mobile/PWA recovery, storage exceptions, and network interruptions before release.
3. **Complex poker hand rules.** Need focused tests and design decisions for uncalled overbets returned to the bettor, short all-in minimum-raise rules, odd-chip division in split pots and tournament payout/clock edge cases. The current side-pot tests verify contribution accounting, not exhaustive poker rule compliance.
4. **Hand server validation.** The server validates street/action/chips, but complete legal-turn and stack-limit validation is not implemented. The UI computes turn order; a malicious client can still submit legal-shaped but strategically illegal hand actions.
5. **Existing production data model.** The staging schema was reconstructed from route usage. Compare it against the **actual** current production schema and write backwards-compatible migrations only after validating backups and test restores. Never run the staging schema against production.
6. **Server-side event/transaction revisions.** Ensure financial/hand history edits are protected against race conditions and reviewed corrections. Avoid silently overwriting another host's edits.
7. **Release process.** Need independent production D1 backup and verified restore test, before/after reconciliation of financial data, deployed Worker revision snapshot, monitoring, rollout plan and explicit user approval.

## Acceptance requirements for any future release

- No production deployment or `main` merge during the current audit.
- All CI checks green on the exact reviewed commit.
- All core actions tested in isolated staging, including targeted changes introduced by this work (not repeated baseline scenarios).
- No real card/session history or financial records copied into staging.
- Financial records and historic hands remain accessible after a tested, backward-compatible deployment.
- Production backups and rollback plan independently verified.
- Explicit owner approval to promote a reviewed build.
