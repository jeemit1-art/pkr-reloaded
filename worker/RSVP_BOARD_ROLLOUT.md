# PKR — WhatsApp RSVP Board v2 (staging-first)

**Implementation branch:** codex/pkr-production-protection-20261024 (draft PR #1).
**Production:** NOT AUTHORISED. No production D1 migration, merge, OAuth change or release.

## Guest experience
1. The host schedules a game and opens **Live RSVP & Arrival Times**.
2. Hosts configure 1–8 arrival choices in `HH:MM` (defaults 19:00, 20:00, 21:00). **Running late** and **Not coming** remain available.
3. Share **https://<preview>/games/<gameId>/rsvp** using the WhatsApp share button. Sharing is user-initiated; the app **does not post to WhatsApp groups automatically**.
4. Each guest picks their name, arrival choice and optionally an unclaimed seat. Responses are visible to anyone with the link and refresh automatically every five seconds while open.
5. The server gives new guests a random 256-bit edit key. Only the device holding that key can change the saved guest response. The public board never displays keys, phone numbers or contact IDs.
6. Host and guest can optionally request browser notifications. With a supported installed PWA they can opt into event push; existing staging push dispatch is intentionally disabled. No silent WhatsApp group messages.
7. At start, server-side seating honours available RSVP seat picks without displacing anyone already assigned by the host. If a seat has become unavailable, the guest is reassigned only to another vacant seat, or remains unseated.

## Storage and constraints
- Additive migration: `worker/migrations/20261025_staging_rsvp_board.sql`.
- `game_rsvp_arrivals`: host-configured choices per game.
- `game_rsvp_guests`: separate from legacy `game_rsvps`; unique case-insensitive name and unique per-game live seat.
- Phone numbers and edit keys are **not** stored in guest records. Only SHA-256 token hashes are stored.
- API: `GET /games/:id/rsvp-board`, `POST /games/:id/rsvp-board`,
  `PUT /games/:id/rsvp-arrivals` (host/co-host only).
- `PKR_RSVP_V2=1` gates new endpoints and game-start import until migration is verified.
  No migration is performed by build, CI, this document or normal deployment.
- Legacy `/games/:id/lobby` remains available as fallback during staging verification.
- Anyone with the shareable link can view names/arrival/seat; host should not share the link outside the group. A link is not identity proof. Names are user-supplied and may be impersonated by someone with the URL before the real person signs up. Stronger invitation access and moderation are future work, not a verified feature.

## REQUIRED before enabling the feature on isolated staging
1. Verify target name `pkr-reloaded-db-staging` and ID `03577857-fc94-49ed-bd1b-5cd658aa0978`. **Do not use production or the original production wrangler.toml.**
2. Verify staging secret names `GOOGLE_CLIENT_SECRET` and `JWT_SECRET`, and ensure the Cloudflare Workers Build for staging has the *correct* `wrangler.staging.toml` deployment command. Secret values must never be committed or printed. The separate Cloudflare build failure needs operator inspection in its own console.
3. With explicit operator authorisation, export/backup the isolated staging D1, verify database identity, and record source totals and a rollback plan. All export bytes must stay private.
4. Only then apply the additive migration **to staging D1 only**, e.g. from the worker directory:

    `npx wrangler d1 execute pkr-reloaded-db-staging --config wrangler.staging.toml --remote --file=./migrations/20261025_staging_rsvp_board.sql`

5. Verify both new tables and indexes using read-only queries. Do not turn on the flag before the migration is present.
6. Set `PKR_RSVP_V2=1` on the **staging Worker only** and redeploy using the dedicated config, without overwriting its encrypted secrets. Do not set the flag in production.
7. Test host options; 7/8/9 PM, Late, Not coming; duplicates; two simultaneous claims of the same seat; changed/removed RSVP; no leaked contacts; existing manual seats; host game-start import; a browser reload and two devices; then notification opt-in.
8. If any failure occurs, **turn off `PKR_RSVP_V2` first**. Keep the new tables intact and retain backups; never drop historical guest rows or restore over production.

## Release dependencies not completed by this branch
- Real two-device/connection-loss gameplay and finance reconciliation.
- Production schema inspection **read-only**, independently verified D1 backup and test restore to a distinct database, and explicit release approval.
- Optional financial-revision and stack-baseline migrations remain separately disabled.
- WhatsApp Business API group-bot integration is not implemented; the RSVP link can be shared in a group manually.
- Cloudflare staging Worker build and encrypted secret persistence still require cloud account review.

## Test coverage
- `worker/src/routes/rsvp-board.test.ts`: public projection, validation, edit key isolation, host arrival validation and closed-game responses.
- `worker/src/game-start-seating.test.ts`: RSVP reservations and legacy seat ordering.
- `worker/scripts/test-rsvp-board-migration.py`: disposable in-memory SQLite uniqueness, case-insensitive names, closed choices and seat release.
- `worker/scripts/check-staging-queries.py`: verifies static SQL against a disposable schema with both additive migrations.
- GitHub CI does not deploy or migrate any D1 database.

## Cloudflare Build configuration repair (October 2026)

Set **Worker** to `pkr-reloaded-worker-staging`, **Root Directory** to `worker`, **Build command** to `npm run build:staging` (or leave blank after CI checks), **Deploy command** to `npm run deploy:staging`, and configure builds only from the staging branch `codex/pkr-production-protection-20261024`. Never select the root `wrangler.toml` or the default `npm run deploy`, which target the production Worker. Cloudflare's default command `npx wrangler deploy` may select the wrong configuration. Staging deployment uses `--config wrangler.staging.toml --keep-vars` explicitly. The remote secret-list diagnostic remains available separately as `npm run diagnose:staging:secrets` when an authorised operator has Cloudflare access; it is intentionally not part of CI deploy because authentication permissions can make list operations fail independently of deployment. Verify secret **names** before applying any migration or enabling RSVP v2; never log secret values. Confirm deployment target and database name before running any command. 
