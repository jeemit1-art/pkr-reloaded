# PKR dual dashboard — release milestone and rollback

**Before any implementation: 30 October 2026 (Brisbane)**

- Immutable rollback snapshot: `milestone/pre-dual-dashboard-2026-10-30`
- Baseline Git SHA: `bb7f3855c1d0498c9b6934a52c707e3f90c1d346`
- Baseline Vercel READY deployment: `dpl_C5vz6f5PBye9AYpJUDdaBTvB9Lwx`
- Baseline domain: `mypkr.app`, verified pointing to that deployment when the milestone was created
- Repository: `jeemit1-art/pkr-reloaded`, default branch `main`
- No D1 schema changes, player financial writes or migrations required for dual dashboard
- New preference is a room-scoped Cloudflare KV key prefixed `room-dashboard-layout:v1:`; older code ignores it

## Safe rollback

1. First ensure the original milestone SHA and baseline deployment are still available.
2. For frontend rollback, use the Vercel dashboard/CLI **promote/rollback** to the known baseline production deployment, or revert this feature's merge commit on `main` through a reviewed PR. Do not force-reset or force-push `main`.
3. For Worker rollback, redeploy the Worker from the milestone source via the existing guarded GitHub production workflow. The workflow handles backups and Cloudflare verification.
4. Verify authenticated room loading, gameplay, 9/13 seats, buy-ins, cash-outs, standings, settled transfer statuses, invitations, RSVP, and persistent navigation.
5. The new KV preference keys can be left in place; reverting the code makes them inert. Never delete payment/game records to roll back a dashboard.
6. Record GitHub and Vercel deployment IDs before and after the release so the restore target is explicit.

## Release safety checks

- Server preference GET requires membership; PUT requires **host**, rejects cohost/member, with a strict `command | live` enum.
- Preferences are separate for each room; authoritative server value is refetched on focus. No client-supplied host role is trusted.
- Command Centre and Live Poker both use current authenticated room, game, player, RSVP, leaderboard and settlement APIs. Never render fabricated winnings, current-pot values or payment claims.
- Quick-buy controls redirect to the **existing** player transaction interface; they never write money themselves.
- Missing settlement rows preserve the **unverified** status rather than displaying a confirmed $0.
- Test preview in Chromium/WebKit across 320–1920px and check accessibility, mobile bottom navigation and input safety.
- Deploy and verify the Worker before confirming frontend functionality in production.

**Rollback milestone remains at the pre-feature SHA and must never be modified.**
