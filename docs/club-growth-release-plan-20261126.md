# PKR club growth features — 26 November 2026

**Status: STAGING-ONLY FEATURE CANDIDATE, NOT ACTIVATED.**
Stacked draft [PR #79](https://github.com/jeemit1-art/pkr-reloaded/pull/79) builds on the unified-dashboard draft PR #77. Production remains unchanged.

## Implemented in source
- **Private date polls:** host/cohost suggests 2–5 dates, members vote one choice, host closes with a selected date and can open the existing guarded scheduler with that date prefilled. Voting does not create games automatically, evade paid-host controls or disclose individual voting histories.
- **Waitlists:** room members can queue for a full game. A game permits at most one active provisional availability offer, with a 30-minute notification window. Offers **never reserve a seat or bypass the existing RSVP logic**; a host can offer the next member. RSVP changes trigger an attempt to release a place. Names and member IDs are not published outside the approved room.
- **Player actions:** verified members can ask the host about a buy-in, cash-out, tournament rebuy or add-on while a game is active. Host/cohost approves or rejects the request. These are **messages only**, not actual buy-in transactions or chip/settlement adjustments; the host records money via the existing audited game controls.
- **League seasons:** host/cohost creates seasons with date boundaries and configurable finishing-rank points (defaults 10/7/5/1). Points are based on immutable saved settled-game **net-results ranking**, with competition-style ties. These are not official tournament placing points. Identity collisions remain flagged. Members can download points-only CSV without exporting financial amounts, and see basic achievements (10+ games, top finisher).
- **Growth:** a host can share the public PKR homepage; no private member, ledger or room identifiers are sent.

## Security and data retention
- All APIs enforce authenticated room membership. Management actions require host/cohost.
- The web UI is also disabled unless the build-time public flag `NEXT_PUBLIC_PKR_CLUB_PLANNING_V1=1` is set. Without this, older preview/live Workers receive **no new club feature calls**.
- The new route set is disabled unless `PKR_CLUB_PLANNING_V1=1`.
- D1 changes are additive in `worker/migrations/20261126_club_planning.sql`; migration is NOT executed in staging or production.
- Workers health reports a boolean capability, not readiness or credentials.
- No existing players, RSVPs, money, results, settlements, membership, game schema or historic records are overwritten.
- A provisional waitlist offer is not a guaranteed booking. The existing RSVP seat-conflict checks remain authoritative.
- Shared referral link contains no private room data.

## Automated verification
- TypeScript and Next.js preview build, worker tests and dependency checks are run by existing GitHub Actions.
- `worker/scripts/test-club-planning-migration.py` tests poll uniqueness, one active offer, duplicate pending request prevention and season constraints in disposable in-memory SQLite.
- `worker/src/club-planning-utils.test.ts` tests dates, point rules and tie ranking.
- `worker/src/routes/club-planning.test.ts` checks auth, role permissions, vote validation, request isolation and season projection without exposing net totals.
- `worker/scripts/check-staging-queries.py` compiles new SQL against a disposable upgraded reference schema, not a remote database.
- A passing build does not mean full real-device or staging Worker acceptance.

## Gated rollout procedure (for future PKR Cloudflare account owner)
1. Verify independently backed-up and restored **isolated staging D1**, confirm account and database IDs. Do not run in production.
2. Apply the **new additive migration to isolated staging only**, check uniqueness and existing records.
3. Deploy only to the **isolated staging Worker**, enabling `PKR_CLUB_PLANNING_V1=1` only after migration checks.
   Set the Vercel preview-only public variable `NEXT_PUBLIC_PKR_CLUB_PLANNING_V1=1` and **rebuild the isolated preview** after Worker migration. Do not set the production variable.
4. Align staged frontend with the exact preview origin and OAuth redirect. The current staging Worker still uses the retired preview origin, and the connected Cloudflare account in this ChatGPT session does not own PKR's Worker.
5. Run the full staging smoke suite, new server tests and authenticated end-to-end test on iPhone and Android.
6. Log actual pass/fail for date vote, poll deadline race, conflicting waitlist offers, opt-in push, RSVP cancellation, host request queue, season tie and member access denial.
7. Keep PR #77 and #79 as drafts until existing `worker/RELEASE_GATE.md` and `worker/UAT_ACCEPTANCE.md` are signed off. Use rollback checkpoint branch `release-checkpoints/pkr-live-pre-unified-20261126` and issue #78. Code rollback does not roll back database writes.

## Features not altered or claimed complete
- No new subscription/free-tier/trial billing rules: require separate product and payment acceptance.
- Tournament presets, full group-ledger export, shared-expense splitting and richer player achievement/rivalry history remain separate enhancements.
- No automatic money handling or direct payout transfers; payment status and settlement remain governed by the existing financial engine.
- No production database migration, secrets or financial records are in this PR.
