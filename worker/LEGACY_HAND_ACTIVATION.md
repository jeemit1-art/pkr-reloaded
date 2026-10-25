# Production rollout with historical "active" games

The live D1 audit on 25 October 2026 found 11 `active` game records, all
scheduled between March and June 2026. Nine had no recorded hand actions.
Two have unfinished hand histories with 2 and 23 actions recorded in April.

**No game is closed, settled, cancelled, deleted or edited by this rollout.**

## Legacy hand exception

The immutable transition cutoff is 1 October 2026, UTC (1790812800).

- A full hand **created before** that cutoff **with recorded actions** and
  **without an existing confirmed baseline** is marked `legacy_unverified`.
  Its existing betting validation remains in place; retroactive opening-chip
  verification is unavailable and must never be fabricated.
- A full hand created on or after that cutoff MUST have a host-confirmed
  complete opening stack before its first action. This applies even in older
  games. Once a baseline exists, normal stack auditing is mandatory.
- Old hands with no actions also require a baseline before they begin betting.
- The action endpoint retains its turn/order validation, compare-and-swap
  and closed-game checks. Legacy status is not proof that the chips were correct.

## Activation gates

The `worker/scripts/activate-live-features.py` script operates only against
the reviewed production Worker/D1/KV. It reads current state first and stops
if any game, hand, player registration, action, or financial edit was created
since 1 October 2026 in a game still marked active. It also stops if the
historical open inventory grows beyond 11 games / two unfinished old hands.
It rechecks the inventory after deploying the Worker and before enabling
feature flags.

Only then, with a private encryption-key backup, it enables
`PKR_INTEGRITY_STACKS` and `PKR_PHONE_MEMBERS_V1` one at a time.
Existing `PKR_RSVP_V2` is preserved. The financial change-audit triggers
already run in D1. Strict `PKR_INTEGRITY_REVISIONS` remains OFF until the
matching frontend (including revision-aware state restoration) is deployed
to mypkr.app. Vercel blocked a matching October 25 build with a
100-API-deployments-per-day Hobby limit; do not force the strict flag while
mypkr.app serves the older frontend.
No SQL migrations, Twilio, WhatsApp API or AI are needed.

This preflight protects historical data, but it cannot establish whether
someone has an unsynchronised browser/offline queue. Do not deploy during a
real game or financial editing session.

After deployment, inspect signed-in links, host-approved private WhatsApp
invitations and recovery, and use a **separate synthetic game** to verify
starting stacks and financial revision changes. Never test financial changes
on an actual client's historical game.
