#!/usr/bin/env python3
"""Guarded production PKR Settlement V2 activation.

Default mode is READ-ONLY. With --apply, creates a private D1 SQL export,
independently restores it into SQLite, verifies financial aggregates, applies
the additive V2 migration, deploys the reviewed Worker, enables the flag, and
checks the live route. It never wipes or imports any production game records.

Optional --mark-historical-paid is a SEPARATE audited, owner-authorised action.
Never commit, attach, publish, or upload the private SQL backup.
"""
from __future__ import annotations
import argparse
import datetime as dt
import json
import os
import re
import sqlite3
import subprocess
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

WORKER = Path(__file__).resolve().parents[1]
REPO = WORKER.parent
WRANGLER = ["npx", "--no-install", "wrangler"]
EXPECTED_ACCOUNT = "4b4794b983d6966f4207d2ff4fd8c991"
EXPECTED_DB = "e21a4823-ef28-496a-9f49-fa3e04dc73bf"
WORKER_URL = "https://pkr-reloaded-worker.jeemit1.workers.dev"
EXPECTED_LEGACY = (326, 7_523_500)  # historical user-authorised batch, cents
AGG_SQL = (
    "SELECT "
    "(SELECT COUNT(*) FROM games) AS games,"
    "(SELECT COUNT(*) FROM game_players) AS players,"
    "(SELECT COUNT(*) FROM settlement_transfers) AS transfers,"
    "(SELECT COALESCE(SUM(amount),0) FROM settlement_transfers) AS cents,"
    "(SELECT COUNT(*) FROM settlement_transfers WHERE status='legacy') AS legacy,"
    "(SELECT COALESCE(SUM(amount),0) FROM settlement_transfers WHERE status='legacy') AS legacy_cents"
)
FIELDS = ("games", "players", "transfers", "cents", "legacy", "legacy_cents")
REQUIRED_TABLES = {"settlement_notification_settings", "settlement_confirmation_events"}


class Stop(RuntimeError):
    pass


def run(*args: str, stdin: str | None = None, quiet: bool = True) -> str:
    proc = subprocess.run(args, cwd=WORKER, text=True, input=stdin,
                          capture_output=True)
    if proc.returncode:
        # Do not echo stdout/stderr; remote SQL or authentication errors can
        # contain player or account information.
        raise Stop("Command failed: " + " ".join(args[:5]) +
                   " [exit " + str(proc.returncode) + "]")
    if not quiet:
        print("Command completed:", " ".join(args[:4]), flush=True)
    return proc.stdout


def git(*args: str) -> str:
    return run("git", *args).strip()


def assert_target() -> None:
    cfg = (WORKER / "wrangler.toml").read_text(encoding="utf-8")
    for literal in (
        'account_id = "' + EXPECTED_ACCOUNT + '"',
        'name = "pkr-reloaded-worker"',
        'database_id = "' + EXPECTED_DB + '"',
        'binding = "DB"',
        'FRONTEND_URL = "https://mypkr.app"',
        'PKR_ENV = "production"',
    ):
        if literal not in cfg:
            raise Stop("The checked-out Wrangler config does not match the live PKR account/database.")
    if git("rev-parse", "--abbrev-ref", "HEAD") != "main":
        raise Stop("Switch to the reviewed main branch before accessing production.")
    if git("status", "--porcelain", "--untracked-files=no"):
        raise Stop("Tracked Worker/repository files have uncommitted changes.")
    # Prevent deploying an older detached source by requiring the checked out
    # main to equal the currently fetched remote main.
    git("fetch", "--no-tags", "origin", "main")
    if git("rev-parse", "HEAD") != git("rev-parse", "origin/main"):
        raise Stop("Local main is not the latest GitHub main; update and retry.")
    if not (WORKER / "node_modules/wrangler/bin/wrangler.js").exists():
        print("Installing pinned Worker dependencies before Cloudflare preflight...")
        run("npm", "ci")
    whoami = run(*WRANGLER, "whoami")
    if EXPECTED_ACCOUNT not in whoami:
        raise Stop("Wrangler is not authenticated to the expected Cloudflare account.")


def json_results(raw: str) -> list[dict]:
    for opening in ("[", "{"):
        at = raw.find(opening)
        if at < 0:
            continue
        try:
            parsed = json.loads(raw[at:])
        except (ValueError, TypeError):
            continue
        return parsed if isinstance(parsed, list) else [parsed]
    raise Stop("Wrangler did not return valid D1 JSON.")


def remote(sql: str) -> list[dict]:
    output = run(*WRANGLER, "d1", "execute", "DB", "--remote", "--json",
                 "--config", "wrangler.toml", "--command", sql)
    results = json_results(output)
    rows: list[dict] = []
    for result in results:
        if isinstance(result, dict) and isinstance(result.get("results"), list):
            rows.extend(result["results"])
    return rows


def remote_snapshot() -> tuple[int, ...]:
    rows = remote(AGG_SQL)
    if len(rows) != 1:
        raise Stop("Expected exactly one remote financial aggregate result.")
    try:
        return tuple(int(rows[0][name]) for name in FIELDS)
    except (KeyError, TypeError, ValueError) as e:
        raise Stop("Unrecognised remote D1 aggregate schema.") from e


def table_names() -> set[str]:
    return {str(row["name"]) for row in remote(
        "SELECT name FROM sqlite_master WHERE type='table' "
        "AND name IN ('settlement_notification_settings','settlement_confirmation_events')"
    )}



def verify_required_columns() -> None:
    """Fail closed if live D1 predates columns needed by the V2 routes/cron."""
    needed = {
        "settlement_transfers": {
            "id", "game_id", "from_user", "to_user", "from_name", "to_name",
            "amount", "status", "paid_at", "created_at",
            "last_reminded_at", "reminder_count",
        },
        "games": {"id", "event_id", "status", "results_token"},
        "events": {"id"},
    }
    for table, columns in needed.items():
        # These table names are fixed literals; no user identifiers are interpolated.
        actual = {str(row["name"]) for row in remote(
            "SELECT name FROM pragma_table_info('" + table + "')"
        )}
        if not columns.issubset(actual):
            raise Stop("Production D1 lacks required V2 columns on " + table +
                       ". Review and migrate the existing schema before deployment.")

def verify_copy(path: Path, expected: tuple[int, ...], migration: str) -> None:
    if not path.exists() or path.stat().st_size < 4096:
        raise Stop("Private full D1 export is missing or suspiciously small.")
    con = sqlite3.connect(":memory:")
    try:
        con.executescript(path.read_text(encoding="utf-8"))
        before = tuple(int(x) for x in con.execute(AGG_SQL).fetchone())
        if before != expected:
            raise Stop("Restored backup financial totals differ from live D1.")
        if con.execute("PRAGMA quick_check").fetchone()[0] != "ok":
            raise Stop("Restored D1 backup failed SQLite quick_check.")
        if con.execute("PRAGMA foreign_key_check").fetchall():
            raise Stop("Restored D1 backup has foreign-key violations.")
        con.executescript(migration)
        con.executescript(migration)  # additive migration must be idempotent
        after = tuple(int(x) for x in con.execute(AGG_SQL).fetchone())
        if after != before:
            raise Stop("Settlement migration unexpectedly changed financial totals.")
        found = {row[0] for row in con.execute(
            "SELECT name FROM sqlite_master WHERE type='table'")}
        if not REQUIRED_TABLES.issubset(found):
            raise Stop("The restored-copy migration did not add the required tables.")
        if con.execute("PRAGMA foreign_key_check").fetchall():
            raise Stop("Settlement migration introduces foreign-key errors.")
    except sqlite3.Error as e:
        raise Stop("Independent SQLite restore/migration rehearsal failed: " +
                   str(e).splitlines()[0][:200]) from e
    finally:
        con.close()


def live_status(path: str) -> int:
    try:
        with urllib.request.urlopen(
            urllib.request.Request(WORKER_URL + path,
                                   headers={"Cache-Control": "no-cache"}),
            timeout=15,
        ) as response:
            return response.status
    except urllib.error.HTTPError as e:
        return e.code


def health() -> None:
    try:
        with urllib.request.urlopen(WORKER_URL + "/health", timeout=15) as response:
            value = json.load(response)
    except Exception as e:
        raise Stop("Production Worker health check failed.") from e
    if not (value.get("ok") is True and
            value.get("service") == "pkr-reloaded-worker" and
            value.get("environment") == "production"):
        raise Stop("Unexpected Worker identity or environment.")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--apply", action="store_true",
                        help="Execute D1 additive migration and production Worker deployment")
    parser.add_argument("--mark-historical-paid", action="store_true",
                        help="After activation, audit-mark the exactly matched 326 owner-authorised historical transfers paid")
    parser.add_argument("--backup-dir", type=Path,
                        default=Path.home() / "pkr-private-backups")
    args = parser.parse_args()
    if args.mark_historical_paid and not args.apply:
        raise Stop("--mark-historical-paid requires --apply.")
    assert_target()
    health()
    verify_required_columns()
    before = remote_snapshot()
    if before[0] <= 0 or before[2] < 0:
        raise Stop("Live database snapshot does not look like the existing PKR installation.")
    print("Verified production Worker, D1 identity and aggregate inventory.")
    print("Historical unknown-status records: count=%d (no identities disclosed)" % before[4])
    if args.mark_historical_paid and tuple(before[-2:]) not in (EXPECTED_LEGACY, (0, 0)):
        raise Stop("Legacy count or cents do not match the owner's authorised 326/$75,235 batch.")
    if not args.apply:
        print("READ-ONLY: nothing deployed or modified. Use --apply after approving a live release.")
        return
    # The export remains outside the repository; it is never uploaded to CI.
    folder = args.backup_dir.expanduser().resolve()
    if REPO.resolve() == folder or REPO.resolve() in folder.parents:
        raise Stop("Backup directory must be OUTSIDE the GitHub checkout.")
    folder.mkdir(parents=True, exist_ok=True, mode=0o700)
    os.chmod(folder, 0o700)
    stamp = dt.datetime.now(dt.timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    path = folder / ("PKR-D1-pre-settlement-v2-" + stamp + "-" + str(os.getpid()) + ".sql")
    migration = (WORKER / "migrations/20261027_settlement_v2.sql").read_text(encoding="utf-8")
    print("Exporting a private production D1 backup for independent restore test...")
    run(*WRANGLER, "d1", "export", "DB", "--remote",
        "--skip-confirmation", "--config", "wrangler.toml", "--output", str(path))
    os.chmod(path, 0o600)
    verify_copy(path, before, migration)
    print("Independent full restore, financial reconciliation, migration replay: PASS.")
    if remote_snapshot() != before:
        raise Stop("Production financial aggregates changed during the export. No writes were made.")
    print("Applying ONLY the additive Settlement V2 D1 migration.")
    run(*WRANGLER, "d1", "execute", "DB", "--remote", "--yes",
        "--config", "wrangler.toml", "--file", "migrations/20261027_settlement_v2.sql")
    if not REQUIRED_TABLES.issubset(table_names()):
        raise Stop("D1 migration did not create both required Settlement V2 tables.")
    if remote_snapshot() != before:
        raise Stop("Unexpected production financial aggregate change after additive migration. STOP.")
    print("Database migration PASS. Deploying reviewed production Worker...")
    run(*WRANGLER, "deploy", "--config", "wrangler.toml")
    for attempt in range(10):
        if live_status("/games/pkr-v2-route-probe/settlement-control") == 401:
            break
        time.sleep(3)
    else:
        raise Stop("New Worker route still missing after deployment; V2 flag NOT enabled.")
    print("Settlement route deployed; enabling PKR_SETTLEMENT_V2.")
    run(*WRANGLER, "secret", "put", "PKR_SETTLEMENT_V2",
        "--config", "wrangler.toml", stdin="1\n")
    health()
    print("WORKER DEPLOYED; V2 FLAG ENABLED; no historical statuses changed by migration.")
    if args.mark_historical_paid and before[4] > 0:
        print("Starting separately audited owner-authorised historical reclassification...")
        run(sys.executable, str(WORKER / "scripts/owner-reconcile-legacy-paid.py"),
            "--apply", "--expected-count", str(EXPECTED_LEGACY[0]),
            "--expected-cents", str(EXPECTED_LEGACY[1]),
            "--private-backup-dir", str(folder))
        if remote_snapshot()[4] != 0:
            raise Stop("Historical owner reconciliation did not clear all unknown-status transfers.")
        print("Historical records reclassified with audit entries (not recipient-confirmed).")
    print("Live route responds with authentication guard; complete a signed-in two-player settlement test before final sign-off.")
    print("Private backup is in:", folder)


if __name__ == "__main__":
    try:
        main()
    except Stop as e:
        print("STOP:", e, file=sys.stderr)
        sys.exit(1)
