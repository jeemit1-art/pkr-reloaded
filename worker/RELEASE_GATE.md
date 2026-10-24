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

1. **Preview availability:** The latest Vercel preview deployment is blocked by a Vercel build-rate limit. A GitHub Next.js build pass does not prove the interactive Vercel deployment is available. Restore preview build capability before visual acceptance tests.
2. **Real-device gameplay:** Run a complete event/game cycle using fictional players on at least two phones, including login, seats/RSVPs, buy-ins, cash-outs, hands, all-ins, side pots, tied winners, tournament levels/rebuys, settlement and later reloading. Repeat with a deliberate connection loss, duplicate taps and browser/tab closure at critical financial steps.
3. **Financial integrity:** Compare each player's original buy-ins, buy-in totals, cash-out and net, and confirm aggregate balances reconcile to settlement transfers. Exercise missing/duplicate sync ACKs and value-change-then-revert (ABA).
4. **Host-confirmed stacks:** Verify all opening chips against physical counts, fail a false all-in, reject an over-stack wager, interrupt before first blind, restore the same unfinished hand and make sure no blind posts twice. Preserve separate read-only audit output.
5. **Legacy compatibility:** Check existing production client/server database structure **read-only** against the staging assumptions before any schema change. Identify legacy games, historical hand results and discontinued client versions. Do not introduce a destructive migration.
6. **Backup and tested restoration:** Arrange an independently verified production D1 backup, restore a copy into a separately named disposable database, and compare row counts and critical financial totals. Do not use this staging database as a restore target. Record a tested rollback procedure, deployment ownership and failure monitoring.
7. **Owner acceptance:** Confirm the production release candidate against a frozen commit and obtain explicit written owner approval to merge/release. Only then plan a production rollout. Commercialisation remains out of scope.

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
| Vercel interactive preview | Successfully built URL and device screenshots | **Blocked by Vercel rate limit** |
| Remote optional D1 migration | Authorised staged migration and row/version audit | **Not performed** |
| Multi-device/offline UAT | Signed test log and reconciled example game | **Outstanding** |
| Production D1 compatibility | Read-only schema comparison | **Outstanding** |
| Production backup restore rehearsal | Backup metadata and independent restore evidence | **Outstanding** |
| Owner production approval | Explicit written authorisation tied to commit | **Not given** |

Stop the release if any item is unverified. No staging code change is an approval to alter production.

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

The optional additive staging migration remains unexecuted remotely and its
integrity flags remain disabled. Test it only after an isolated staging D1
backup, schema inspection and explicit confirmation of staging DB ID.

Cloudflare documentation:
- https://developers.cloudflare.com/d1/best-practices/import-export-data/
- https://developers.cloudflare.com/d1/reference/time-travel/
