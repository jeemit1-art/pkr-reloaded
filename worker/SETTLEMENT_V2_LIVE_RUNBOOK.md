# PKR Settlement V2 — production activation and acceptance

Scope: Cloudflare Worker + production D1. A GitHub/Vercel frontend deployment does NOT deploy the Worker.

Previous production behaviour: GET /games/:id/settlement-control returned 404. Current source defines the route; a correctly deployed Worker rejects unauthenticated callers with 401, and the feature requires the additive D1 migration plus PKR_SETTLEMENT_V2=1.

## One-command guarded release from an authenticated PKR Codespace

    cd /workspaces/pkr-reloaded
    git switch main && git pull --ff-only
    python3 worker/scripts/deploy-settlement-v2-live.py

That command is READ ONLY: it validates GitHub main, the exact Cloudflare account, production D1 UUID and Worker identity, the required schema, and financial record counts.

After explicit owner approval of the release, while no live settlement edits are underway:

    python3 worker/scripts/deploy-settlement-v2-live.py --apply --mark-historical-paid

The --apply operation exports FULL live D1 to a private directory outside GitHub (by default ~/pkr-private-backups). It restores the export independently into SQLite, runs quick_check, checks foreign keys and financial aggregates, rehearses the additive V2 migration twice, and stops on any discrepancy. It then applies ONLY 20261027_settlement_v2.sql, verifies both new tables and unchanged financial aggregates, deploys the production Worker, requires a 401 authentication response on the previously missing route, and sets PKR_SETTLEMENT_V2=1.

The optional --mark-historical-paid performs a SEPARATE audit-controlled update, under the owner's instruction of 27 October 2026. It will accept only 326 legacy transfers totalling $75,235 (7,523,500 cents), or zero remaining; any other count/amount causes a stop. After a second independent full export/restore check, it changes legacy statuses to paid and logs an audit event for each: owner_marked_legacy_paid_without_recipient_confirmation. This is owner-directed administrative recording, NOT evidence that each recipient confirmed receiving funds. If you want to activate V2 without reclassifying history, omit --mark-historical-paid. Monetary amounts, participants, historical games and buy-ins/cash-outs are not rewritten.

Keep SQL exports PRIVATE: do not attach, email, upload, commit or paste them into ChatGPT. Retain them in the owner's secure backup system.

## Acceptance checks after release

1. Worker: Verify /health shows the expected production Worker. Unauthenticated GET /games/test-id/settlement-control must return 401, not 404. Authenticated room members should see the V2 settings for a real settled game, not 503.
2. Host: In a safe synthetic game, cash out, settle, Save Results, End Game; open the saved game summary, send settlement notifications and enable 24-hour reminders. Push-service acceptance is not proof of device delivery.
3. Participants: With two separate, verified member accounts, payer marks sent. Recipient then confirms received or not received. Status and audit must update and notifications must go to the correct person.
4. Bulk changes: Host/co-host can mark selected, current non-legacy transfers paid/unpaid; membership and settlement restrictions must be enforced.
5. Legacy: If the optional audited historical action was applied, zero records remain legacy and 326 audit rows total exactly $75,235. Confirm Insights reflects the actual D1 statuses.
6. Devices: Test iPhone PWA, Android and desktop with opted-in push, duplicate taps, reminder opt-out, lost network and reloading.
7. Integrity: Compare counts and financial aggregates of games, players and transfers with the private pre-release D1 backup.

## Failure and rollback

If preflight, schema, backup or financial comparison fails, the helper makes no changes. If a later deployment or feature-flag step fails, inspect the live state before retrying: optional V2 tables may exist, but historical financial data should remain unchanged. Do NOT drop production tables or blindly restore the entire database over newer games. Set PKR_SETTLEMENT_V2=0 in the Cloudflare secret settings to disable V2, and use Cloudflare's Worker deployment rollback for code if needed. Any historical reclassification reversal needs a separate reviewed reconciliation.

This command REQUIRES an authenticated Cloudflare Wrangler session in the owner's account. GitHub/Vercel access does not provide Cloudflare deployment or D1 access. Never send credentials or full financial backups in chat.
