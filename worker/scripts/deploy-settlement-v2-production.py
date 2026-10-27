#!/usr/bin/env python3
"""Guarded, additive Settlement V2 production deploy through GitHub Actions.

No production credentials are committed. Requires CLOUDFLARE_API_TOKEN as
a GitHub Actions secret. Does not classify legacy payments, alter bankroll
records, or enable unrelated integrity/AI flags. Fails closed.
"""
import json
import os
import re
import sqlite3
import subprocess
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
CONFIG = ROOT / "wrangler.toml"
DB = "DB"
ACCOUNT = "4b4794b983d6966f4207d2ff4fd8c991"
DATABASE_ID = "e21a4823-ef28-496a-9f49-fa3e04dc73bf"
WORKER = "pkr-reloaded-worker"
HOST = "https://pkr-reloaded-worker.jeemit1.workers.dev"
MIGRATION = "migrations/20261027_settlement_v2.sql"


class Stop(RuntimeError):
    pass


def command(*args, stdin=None):
    proc = subprocess.run(args, input=stdin, text=True, cwd=ROOT,
                          capture_output=True, timeout=300)
    if proc.returncode:
        # Never echo Wrangler output, auth headers or SQL/customer records.
        raise Stop("Command failed (" + str(proc.returncode) + "): " +
                   " ".join(args[:5]))
    return proc.stdout


def wrangler(*args, stdin=None):
    return command("npx", "--no-install", "wrangler", *args, stdin=stdin)


def parse_d1(raw):
    # Wrangler may prefix JSON with its own CLI banner.
    start = raw.find("[")
    if start < 0:
        raise Stop("Expected JSON array from Wrangler D1.")
    try:
        doc = json.loads(raw[start:])
        entries = doc if isinstance(doc, list) else [doc]
        return next(x["results"] for x in entries
                    if isinstance(x, dict) and isinstance(x.get("results"), list))
    except (ValueError, KeyError, TypeError, StopIteration) as exc:
        raise Stop("Cannot parse remote D1 response.") from exc


def remote_query(sql):
    return parse_d1(wrangler(
        "d1", "execute", DB, "--config", "wrangler.toml", "--remote",
        "--json", "--command", sql))


def aggregate_sql(table):
    # This is read-only; do not print names, emails, player IDs or records.
    if table == "settlement_transfers":
        return ("SELECT COUNT(*) AS n, COALESCE(SUM(amount),0) AS cents,"
                " SUM(CASE WHEN status='legacy' THEN 1 ELSE 0 END) AS legacy "
                " FROM settlement_transfers")
    if table == "game_players":
        return ("SELECT COUNT(*) AS n,COALESCE(SUM(buy_in_total),0) AS cents,"
                " COALESCE(SUM(cashout),0) AS cashouts,"
                " COALESCE(SUM(net),0) AS net FROM game_players")
    raise Stop("Unexpected financial table.")


def aggregate(table):
    rows = remote_query(aggregate_sql(table))
    if len(rows) != 1:
        raise Stop("Unexpected financial summary shape.")
    return tuple(int(rows[0][key] or 0) for key in
                 (("n", "cents", "legacy") if table == "settlement_transfers"
                  else ("n", "cents", "cashouts", "net")))


def verify_target():
    config = CONFIG.read_text()
    for marker in ('account_id = "' + ACCOUNT + '"',
                   'database_id = "' + DATABASE_ID + '"',
                   'name = "' + WORKER + '"',
                   'PKR_ENV = "production"',
                   'FRONTEND_URL = "https://mypkr.app"'):
        if marker not in config:
            raise Stop("STOP: production Worker/D1 identity mismatch.")
    if not os.environ.get("CLOUDFLARE_API_TOKEN"):
        raise Stop("CLOUDFLARE_API_TOKEN is missing. Add a scoped GitHub Actions secret.")
    if os.environ.get("CLOUDFLARE_ACCOUNT_ID") != ACCOUNT:
        raise Stop("Cloudflare account ID does not match reviewed production account.")
    health = command("curl", "-fsS", "--max-time", "20", HOST + "/health")
    try:
        result = json.loads(health)
    except ValueError as exc:
        raise Stop("Production Worker health response is not JSON.") from exc
    if result.get("service") != WORKER or result.get("environment") != "production":
        raise Stop("Wrong Worker environment. No changes made.")
    print("Production Worker and D1 identity preflight: PASS", flush=True)


def secret_names():
    raw = wrangler("secret", "list", "--config", "wrangler.toml")
    try:
        rows = json.loads(raw[raw.find("["):])
        return {x["name"] for x in rows if isinstance(x, dict) and "name" in x}
    except (ValueError, TypeError, KeyError) as exc:
        raise Stop("Cannot safely establish deployed secret names.") from exc


def preflight_secrets():
    names = secret_names()
    needed = {"JWT_SECRET", "GOOGLE_CLIENT_SECRET",
              "VAPID_PUBLIC_KEY", "VAPID_PRIVATE_KEY", "VAPID_EMAIL"}
    missing = needed - names
    if missing:
        raise Stop("Production Worker secrets not ready: " + ", ".join(sorted(missing)))
    print("Existing push/auth secrets: PRESENT (values never read)", flush=True)


def preflight_backup():
    before = {table: aggregate(table) for table in
              ("settlement_transfers", "game_players")}
    # Time Travel is a separate on-Cloudflare restore point (7-30 day window).
    # Never execute a destructive restore in this workflow.
    time_travel = wrangler("d1", "time-travel", "info", DB,
                           "--config", "wrangler.toml")
    bookmark_match = re.search(r"bookmark is\s+['\"]([0-9a-fA-F-]+)['\"]",
                               time_travel)
    if not bookmark_match:
        raise Stop("Cloudflare Time Travel bookmark missing; no migration.")
    print("Pre-migration D1 Time Travel bookmark:",
          bookmark_match.group(1), flush=True)
    with tempfile.TemporaryDirectory(prefix="pkr-d1-private-") as folder:
        backup = Path(folder) / "d1-export.sql"
        wrangler("d1", "export", DB, "--config", "wrangler.toml",
                 "--remote", "--skip-confirmation", "--output", str(backup))
        if not backup.exists() or backup.stat().st_size < 4000:
            raise Stop("D1 export absent or suspiciously small.")
        conn = sqlite3.connect(":memory:")
        try:
            conn.executescript(backup.read_text(encoding="utf-8"))
            if conn.execute("PRAGMA quick_check").fetchone()[0] != "ok":
                raise Stop("Independent D1 restore failed SQLite integrity.")
            if conn.execute("PRAGMA foreign_key_check").fetchall():
                raise Stop("Independent D1 restore contains FK violations.")
            for table, expected in before.items():
                rows = conn.execute(aggregate_sql(table)).fetchone()
                actual = tuple(int(x or 0) for x in rows)
                if actual != expected:
                    raise Stop("Restored D1 financial totals differ from live totals.")
        finally:
            conn.close()
    print("Read-only live totals match independently restored export: PASS", flush=True)
    return before


def verify_schema():
    rows = remote_query(
        "SELECT name FROM sqlite_master WHERE type='table' AND name IN "
        "('settlement_notification_settings','settlement_confirmation_events')")
    names = {r["name"] for r in rows}
    expected = {"settlement_notification_settings", "settlement_confirmation_events"}
    if names != expected:
        raise Stop("Settlement V2 migration incomplete; no Worker activation.")
    print("Settlement V2 D1 tables: PRESENT", flush=True)


def pre_migration_schema():
    rows = remote_query(
        "SELECT name FROM sqlite_master WHERE type='table' AND name IN "
        "('settlement_notification_settings','settlement_confirmation_events')")
    names = {r["name"] for r in rows}
    both = {"settlement_notification_settings", "settlement_confirmation_events"}
    if names and names != both:
        raise Stop("Partial existing migration; review before proceeding.")
    return names == both


def check_api_route():
    status = command("curl", "-sS", "--max-time", "20",
                     "-o", "/dev/null", "-w", "%{http_code}",
                     "-H", "Cache-Control: no-cache",
                     HOST + "/games/production-route-probe/settlement-control").strip()
    # Authentication must be checked before looking up a non-existent game.
    if status != "401":
        raise Stop("Expected Settlement V2 unauthenticated 401, got HTTP " + status)
    print("Production Settlement V2 authenticated-route gate: PASS", flush=True)


def main():
    verify_target()
    preflight_secrets()
    before = preflight_backup()
    applied = pre_migration_schema()
    # Recheck totals immediately before the additive D1 schema change.
    if {t: aggregate(t) for t in before} != before:
        raise Stop("Financial data changed since snapshot; retry in a quiet window.")
    if not applied:
        wrangler("d1", "execute", DB, "--config", "wrangler.toml", "--remote",
                 "--file", MIGRATION)
        print("Additive Settlement V2 migration applied.", flush=True)
    else:
        print("Settlement V2 tables already exist; skipping schema migration.")
    verify_schema()
    if {t: aggregate(t) for t in before} != before:
        raise Stop("Financial aggregates changed during migration; halted.")
    # Deploy only after schema check; preserve vars set in Cloudflare dashboard.
    wrangler("deploy", "--config", "wrangler.toml", "--keep-vars")
    print("Production Worker deployed.", flush=True)
    # A prior disabled flag can exist; explicitly activate the reviewed release.
    wrangler("secret", "put", "PKR_SETTLEMENT_V2",
             "--config", "wrangler.toml", stdin="1\n")
    print("Settlement V2 secret configured.", flush=True)
    check_api_route()
    if {t: aggregate(t) for t in before} != before:
        raise Stop("Financial totals changed during deployment; investigate.")
    print("PRODUCTION SETTLEMENT V2 ROLLOUT: PASS.", flush=True)
    print("No legacy payments were reclassified by this workflow.", flush=True)
    print("Remaining: signed-in payer/recipient notification UAT.", flush=True)


if __name__ == "__main__":
    try:
        main()
    except (Stop, OSError, subprocess.TimeoutExpired, sqlite3.Error) as exc:
        print("DEPLOYMENT STOPPED:", str(exc), file=sys.stderr, flush=True)
        sys.exit(1)
