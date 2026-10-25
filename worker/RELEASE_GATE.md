# PKR Reloaded — release readiness and go/no-go checklist

**Status: NOT CLEARED FOR PRODUCTION.** Keep PR #1 a draft and keep all work on `codex/pkr-production-protection-20261024`. This document does not authorise a merge or deployment.

## What is verified in isolated staging

- GitHub Actions check the dedicated Worker and isolated D1 schema. The SQL checks and optional integrity migration tests use **disposable, in-memory SQLite**, never remote production data.
- GitHub Actions independently build the Next.js frontend with `VERCEL_ENV=preview`, `NEXT_PUBLIC_PKR_ENV=staging` and a public, isolated staging Worker URL. These checks deploy nothing.
- The separate Cloudflare staging Worker is configured to use `wrangler.staging.toml`, the dedicated staging D1 and KV. The original production config `wrangler.toml` must remain untouched.
- No production financial or player records have been imported into staging.
- A read-only restored-copy preflight is tested using **synthetic local SQLite files**. It checks reference schema, declared foreign keys, foreign-key violations, basic integrity and aggregate financial totals. Passing synthetic tests does **not** establish that a real production backup has been restored or verified.


## Features deliberately disabled pending database sign-off

The optional additive migration is `worker/migrations/20261024_staging_integrity.sql` (NOT applied remotely by CI). It defines:
- `game_player_revisions` and `game_financial_audit`, including insert, update and delete/ID-reuse revision tracking.
- `hand_stack_baselines` for immutable, host-confirmed opening chips.

The Worker flags **`PKR_INTEGRITY_REVISIONS`** and **`PKR_INTEGRITY_STACKS`** default to off. Do not set either to `1` until the actual target D1 schema and backup have been independently verified, the migration has been applied to the **isolated staging D1 only**, and the associated browser and Worker tests have passed against that migrated staging database. Do not silently fall back to legacy updates after a revision-aware request.

## Mandatory release blockers

1. **Staging Worker deployment and preview acceptance:** The isolated Cloudflare Worker and frontend builds are passing on the current staging branch. The browser smoke suite uses synthetic data across six viewport sizes; successful CI alone does not prove a real signed-in game or production readiness. Test the full app on iPhone, Android, tablet and desktop, including landscape rotation and unreliable connections.
2. **Real-device gameplay:** Run a complete event/game cycle using fictional players on at least two phones, including login, seats/RSVPs, buy-ins, cash-outs, hands, all-ins, side pots, tied winners, tournament levels/rebuys, settlement and later reloading. Repeat with a deliberate connection loss, duplicate taps and browser/tab closure at critical financial steps.
3. **Financial integrity:** Compare each player's original buy-ins, buy-in totals, cash-out and net, and confirm aggregate balances reconcile to settlement transfers. Exercise missing/duplicate sync ACKs and value-change-then-revert (ABA).
4. **Host-confirmed stacks:** Verify all opening chips against physical counts, fail a false all-in, reject an over-stack wager, interrupt before first blind, restore the same unfinished hand and make sure no blind posts twice. Preserve separate read-only audit output.
5. **Legacy compatibility:** Check existing production client/server database structure **read-only** against the staging assumptions before any schema change. Identify legacy games, historical hand results and discontinued client versions. Do not introduce a destructive migration.
6. **Backup and tested restoration:** Arrange an independently verified production D1 backup, restore a copy into a separately named disposable database, and compare row counts and critical financial totals. Do not use this staging database as a restore target. Record a tested rollback procedure, deployment ownership and failure monitoring.
7. **RSVP v2 and mobile membership acceptance:** The user confirmed the isolated staging RSVP tables and phone-membership tables were created, with staging flags enabled, and an invalid invite received the expected error. These are configuration checks, not a completed acceptance test. Verify private edit keys, seat conflicts, host-defined arrival times, concurrent RSVP updates, WhatsApp link sharing and notification opt-in. No WhatsApp Business group bot is implemented. Consult `RSVP_BOARD_ROLLOUT.md`.
8. **Framework security:** Source package and lockfile are now pinned to `next@16.4.3` and `react@19.3.1`; the `frontend-security-audit` and independent frontend build passed on staging commit `d78f38e`. The unsupported Next 14 baseline is no longer present. **Still required:** real-device OAuth/authentication compatibility testing, dependency review before release, and rerunning security/build checks on the frozen production candidate. See https://nextjs.org/blog/nextjs-security-update-october-14-2026 .
9. **Installed-PWA identity:** Validate that mobile membership survives installation and reopening on real iOS and Android devices. iOS may isolate web-app storage; do not transmit session JWTs in invite or query URLs as a workaround. Require a fresh, host-approved recovery route if needed.
10. **Owner acceptance:** Confirm the production release candidate against a frozen commit and obtain explicit written owner approval to merge/release. Only then plan a production rollout. Commercialisation remains out of scope.

## Read-only schema inventory for future authorised review

Run in the **explicitly selected target** SQL console, confirming the database name/ID first. The queries below are read-only. Do not run a SQL migration from this checklist.

```sql
SELECT name,type FROM sqlite_master
 WHERE type IN ('table','index','trigger')
   AND name NOT LIKE 'sqlite_%'
 ORDER BY type,name;
SELECT name FROM pragma_table_info('game_players');
SELECT name FROM pragma_table_info('hands');
SELECT name FROM pragma_table_info('tournament_state');
SELECT name FROM pragma_table_info('game_player_revisions');
SELECT name FROM pragma_table_info('hand_stack_baselines');
```

Do not share customer data, auth secrets or SQL dumps in GitHub. Record differences and escalation in the private release review.

## Evidence and approval register

| Gate | Evidence to attach | Current status |
| --- | --- | --- |
| Worker + SQL + tests | Exact green GitHub Actions run and commit | Automated staging verification only |
| Frontend source build | Exact green GitHub frontend-preview-build job | Automated staging verification only |
| Cloudflare isolated Worker build | Successful dedicated staging deployment | **Passing on latest staging commits; production not verified** |
| RSVP v2 and phone membership | User-confirmed isolated staging schema, secret, flag, non-existent invite check | **Configured on staging; end-to-end member/RSVP testing pending** |
| Vercel interactive preview | Successful build and browser smoke | **Synthetic six-viewport checks passing; real-device session/game test pending** |
| Remote optional D1 migration | Authorised staged migration and row/version audit | **Not performed** |
| Multi-device/offline UAT | Signed test log and reconciled example game | **Outstanding (synthetic browser smoke is not sufficient)** |
| Production D1 compatibility | Read-only schema comparison | **Outstanding** |
| Production backup restore rehearsal | Backup metadata and independent restore evidence | **Outstanding** |
| Frontend security upgrade | Next `16.4.3` + React `19.3.1` locked; staging security audit and build passed | **Code upgrade verified; real-device auth and frozen release checks still outstanding** |
| Installed PWA identity | iPhone and Android installed-app login/recovery and push test | **Outstanding** |
| Owner production approval | Explicit written authorisation tied to commit | **Not given** |

Stop the release if any item is unverified. No staging code change is an approval to alter production.

## Read-only restore-preflight hardening

The local restore verifier now detects **missing UNIQUE constraints**, including
ones that prevent duplicate hand numbers, plus missing or changed migration
audit triggers when the staging integrity upgrade is required. The reference
indexes must not be treated as equivalent to these required UNIQUE keys.

It also supports comparison against a **separately supplied local baseline
summary** of row counts and financial totals. A one-cent mismatch fails the
preflight. No private player identities are included in this report.

These are sample local commands only; no Cloudflare operations occur:

~~~sh
# Create a summary from a separately obtained, trusted source copy.
python3 worker/scripts/verify-restored-d1.py \
  --restore /secure/private/source.sqlite \
  > /secure/private/source-summary.json

# Compare the independently restored local copy against that source summary.
python3 worker/scripts/verify-restored-d1.py \
  --restore /secure/private/restored.sqlite \
  --baseline-report /secure/private/source-summary.json

# STAGING ONLY: inspect a restored copy after the independently authorised
# optional integrity migration and confirm all required tables/triggers exist.
python3 worker/scripts/verify-restored-d1.py \
  --restore /secure/private/staging-after-upgrade.sqlite \
  --require-integrity-upgrade
~~~

**This does not verify the authenticity of source data or replace the real
production backup/restore rehearsal.** A reviewer must independently confirm
the export source, source row counts, financial aggregates, target database ID,
and rollback ownership. Do not commit private exports or reports to GitHub.

## Restored-copy verification procedure

Cloudflare modern D1 supports Time Travel bookmarks and read-only SQL exports.
Legacy snapshot backup commands are not appropriate for normal new D1 databases.
A Time Travel restore overwrites the selected database and must NEVER be used
to rehearse recovery on live production.

Use a secure operator workstation. Confirm the production DB name and ID first.
These commands are examples only; nothing is executed from this document.

    # Schema-only, read-only D1 export:
    npx wrangler d1 export <PRODUCTION_DB_NAME> --remote --output=/secure/private/schema.sql --no-data

    # Full export only with authorisation to handle private customer data:
    npx wrangler d1 export <PRODUCTION_DB_NAME> --remote --output=/secure/private/backup.sql

    # Restore to a SEPARATE local SQLite database, not staging or production:
    sqlite3 /secure/private/restored-copy.sqlite < /secure/private/backup.sql

    # Check schema and financial aggregates with a read-only local connection:
    python3 worker/scripts/verify-restored-d1.py --restore /secure/private/restored-copy.sqlite

The script does not create or verify the export; an independent reviewer must
reconcile source and restored row counts and critical financial totals. Never
upload full exported records, database files, auth tokens or private financial
reports to GitHub, Vercel or ChatGPT.

The separate optional integrity migration remains unexecuted remotely and its
integrity flags remain disabled. This is distinct from the user-confirmed RSVP and phone membership staging tables. Test it only after an isolated staging D1
backup, schema inspection and explicit confirmation of staging DB ID.

Cloudflare documentation:
- https://developers.cloudflare.com/d1/best-practices/import-export-data/
- https://developers.cloudflare.com/d1/reference/time-travel/

## Approved visual and functional release scope (25 October 2026)

The user approved premium black, emerald and warm-gold layouts for desktop
home, live table, mobile RSVP, invitations, members, notifications and
Insights/Settlement. Staging work to date includes the shared navigation
shell, actual-data dashboard, insights, schedule, guided PWA installation,
legacy table styling and a synthetic six-viewport browser smoke workflow.

**Still unverified:** exact approved visual parity on every signed-in screen;
complete private join/recovery through an actual WhatsApp flow; seat and
arrival conflicts; real buy-in/cash-out/settlement cycle; exact payment
acknowledgement state and balances; actual push sounds and background
notifications; browser-to-installed-PWA authentication; mobile rotation and
offline reconnection during a hand; migration rehearsal from an independently
restored production D1 copy; patched supported Next.js version.

**Release procedure:** freeze a reviewed commit, take a production D1 Time Travel
bookmark and independently verify an export/restore of a separately named
copy; perform a read-only schema/financial baseline comparison; apply only
validated additive migrations; deploy the approved Worker/frontend in a
controlled window; reconcile critical row counts and totals before and after
and smoke-test sign-in, groups, buy-ins, settlements and historical games;
keep documented rollback ownership. No staging data should overwrite
production records. Roll back code first if needed; a database Time Travel
restore would overwrite post-bookmark writes and must be separately authorised
and reconciled.
