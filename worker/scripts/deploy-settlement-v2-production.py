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
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
CONFIG = ROOT / "wrangler.toml"
DB = "DB"
EXPORT_DATABASE_NAME = "pkr-reloaded-db"
ACCOUNT = "4b4794b983d6966f4207d2ff4fd8c991"
DATABASE_ID = "e21a4823-ef28-496a-9f49-fa3e04dc73bf"
WORKER = "pkr-reloaded-worker"
HOST = "https://pkr-reloaded-worker.jeemit1.workers.dev"
MIGRATION = "migrations/20261027_settlement_v2.sql"
PROFILE_MIGRATION = "migrations/20261029_room_player_profiles.sql"
PROFILE_COLUMNS = {"event_id","profile_key","screen_name","avatar_data","avatar_emoji",
                   "phone","preferred_contact","private_notes","updated_by","created_at","updated_at"}


class Stop(RuntimeError):
    pass


def safe_export_error_class(output):
    """Map provider output to a fixed, nonsensitive diagnostic.

    Never return raw stderr: it may contain signed URLs, SQL or account data.
    """
    message = (output or "").lower()
    if "virtual table" in message or "fts5" in message:
        return "D1 virtual tables are unsupported by full export"
    if any(x in message for x in ("unauthorized", "forbidden", "insufficient permissions",
                                  "permission denied", "authentication failed")):
        return "Cloudflare D1 export authorisation/permission failure"
    if any(x in message for x in ("rate limit", "too many requests")):
        return "Cloudflare API rate limit"
    if any(x in message for x in ("time out", "timeout", "timed out")):
        return "Cloudflare export timeout"
    if any(x in message for x in ("database is locked", "database busy")):
        return "Cloudflare database busy"
    codes = re.findall(r"(?:error|code)\s*[:=]?\s*([0-9]{4,6})\b", message)
    if codes:
        return "Cloudflare API code " + codes[0]
    return "unknown provider error (no private data logged)"


def command(*args, stdin=None):
    proc = subprocess.run(args, input=stdin, text=True, cwd=ROOT,
                          capture_output=True, timeout=300)
    if proc.returncode:
        # Never echo Wrangler output, auth headers or SQL/customer records.
        if "export" in args and "d1" in args:
            reason = safe_export_error_class(proc.stderr + "\n" + proc.stdout)
            raise Stop("Full D1 export failed: " + reason +
                       ". Migration and payment updates were not started.")
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
                   'database_name = "' + EXPORT_DATABASE_NAME + '"',
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



def export_backup_via_api(destination, *, open_url=None, sleep=None):
    """Official Cloudflare D1 export API fallback for Wrangler CLI failures.

    Only the reviewed account and database are targeted. The full SQL export
    is downloaded into the existing private CI temporary directory and
    independently restored/validated by preflight_backup. No URLs, HTTP
    response bodies, export data or credentials are logged.
    """
    if open_url is None:
        open_url = urllib.request.urlopen
    if sleep is None:
        sleep = time.sleep
    token = os.environ.get("CLOUDFLARE_API_TOKEN")
    if not token:
        raise Stop("Cloudflare API token absent; no export attempted.")
    endpoint = (
        "https://api.cloudflare.com/client/v4/accounts/" + ACCOUNT +
        "/d1/database/" + DATABASE_ID + "/export"
    )
    bookmark = None
    signed_url = None
    for attempt in range(90):
        payload = {"output_format": "polling"}
        if bookmark:
            payload["current_bookmark"] = bookmark
        request = urllib.request.Request(
            endpoint, method="POST", data=json.dumps(payload).encode("utf-8"),
            headers={"Authorization": "Bearer " + token,
                     "Content-Type": "application/json",
                     "Accept": "application/json"},
        )
        try:
            with open_url(request, timeout=30) as response:
                body = response.read(65536)
        except urllib.error.HTTPError as exc:
            # HTTP status codes are safe. Never print the response body.
            raise Stop("Cloudflare D1 export API returned HTTP " +
                       str(exc.code) + "; no backup or migration attempted.") from None
        except (urllib.error.URLError, TimeoutError, OSError):
            raise Stop("Cloudflare D1 export API could not be reached; no migration.") from None
        try:
            doc = json.loads(body)
        except (ValueError, TypeError):
            raise Stop("Cloudflare D1 export API returned an invalid response.") from None
        if not isinstance(doc, dict) or doc.get("success") is False:
            codes = [str(item.get("code")) for item in doc.get("errors", [])
                     if isinstance(item, dict) and isinstance(item.get("code"), int)]
            raise Stop("Cloudflare D1 export API declined the operation" +
                       (" (code " + codes[0] + ")" if codes else "") +
                       "; production data unchanged.")
        item = doc.get("result")
        if not isinstance(item, dict) or item.get("type") not in (None, "export"):
            raise Stop("Unexpected D1 export result; no migration.")
        if item.get("status") == "error":
            reason = safe_export_error_class(str(item.get("error", "")))
            raise Stop("D1 export API rejected full backup: " + reason +
                       "; migration not attempted.")
        if item.get("status") == "complete":
            candidate = item.get("result")
            if isinstance(candidate, dict):
                signed_url = candidate.get("signed_url")
            break
        next_bookmark = item.get("at_bookmark") or item.get("current_bookmark")
        if not isinstance(next_bookmark, str) or not next_bookmark:
            raise Stop("D1 export API provided no polling bookmark; no migration.")
        bookmark = next_bookmark
        sleep(2)
    if not isinstance(signed_url, str):
        raise Stop("Cloudflare D1 export did not complete; migration not attempted.")
    parsed = urllib.parse.urlsplit(signed_url)
    if parsed.scheme != "https" or not parsed.hostname or parsed.username or parsed.password:
        raise Stop("Cloudflare D1 export returned an invalid download URL; no migration.")
    # The signed download URL is returned by the authenticated, fixed Cloudflare
    # endpoint and never logged or persisted. No Bearer token is sent to it.
    max_bytes = 512 * 1024 * 1024
    total = 0
    try:
        with open_url(signed_url, timeout=60) as source:
            with destination.open("wb") as output:
                while True:
                    chunk = source.read(1024 * 1024)
                    if not chunk:
                        break
                    total += len(chunk)
                    if total > max_bytes:
                        raise Stop("D1 backup exceeded the safe export size limit.")
                    output.write(chunk)
    except (urllib.error.URLError, TimeoutError, OSError):
        raise Stop("Cloudflare D1 signed export could not be downloaded; no migration.") from None
    os.chmod(destination, 0o600)
    if total < 4000:
        raise Stop("Cloudflare D1 API export is suspiciously small; no migration.")
    print("Full private D1 export downloaded through official Cloudflare API.", flush=True)


def preflight_backup():
    before = {table: aggregate(table) for table in
              ("settlement_transfers", "game_players")}
    # Cloudflare documents that exporting a database with ANY SQLite virtual
    # table is unsupported. Detect this read-only, never drop a live FTS table.
    virtual = remote_query(
        "SELECT COUNT(*) AS n FROM sqlite_master WHERE type='table' "
        "AND UPPER(sql) LIKE 'CREATE VIRTUAL TABLE%'")
    if len(virtual) != 1:
        raise Stop("Cannot verify remote virtual-table inventory; no export attempted.")
    if int(virtual[0]["n"] or 0) > 0:
        raise Stop("Full D1 export is unsupported because the production "
                   "database contains virtual tables. No schema was altered.")
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
        try:
            wrangler("d1", "export", EXPORT_DATABASE_NAME, "--config", "wrangler.toml",
                     "--remote", "--skip-confirmation", "--output", str(backup))
        except Stop:
            print("Wrangler full D1 export unavailable; trying official Cloudflare export API.", flush=True)
            export_backup_via_api(backup)
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
            # Rehearse this exact additive migration TWICE on the independently
            # restored production export, not only on synthetic staging rows.
            rehearse_profile_migration(conn)
            for table, expected in before.items():
                actual = tuple(int(x or 0) for x in conn.execute(aggregate_sql(table)).fetchone())
                if actual != expected:
                    raise Stop("Profile migration changed a restored financial aggregate.")
            if conn.execute("PRAGMA quick_check").fetchone()[0] != "ok":
                raise Stop("Rehearsed profile migration damaged SQLite integrity.")
            if conn.execute("PRAGMA foreign_key_check").fetchall():
                raise Stop("Rehearsed profile migration introduced foreign key violations.")
        finally:
            conn.close()
    print("Read-only live totals match independently restored export: PASS", flush=True)
    return before


def rehearse_profile_migration(conn):
    """Proof on a throwaway restored SQLite copy. Never writes to live D1."""
    before = {table: tuple(int(x or 0) for x in conn.execute(aggregate_sql(table)).fetchone())
              for table in ("settlement_transfers", "game_players")}
    before_games = int(conn.execute("SELECT COUNT(*) FROM games").fetchone()[0])
    before_members = int(conn.execute("SELECT COUNT(*) FROM event_members").fetchone()[0])
    migration = (ROOT / PROFILE_MIGRATION).read_text(encoding="utf-8")
    if "DROP TABLE" in migration.upper() or "DELETE FROM" in migration.upper():
        raise Stop("Profile migration contains destructive SQL. STOP.")
    conn.executescript(migration)
    conn.executescript(migration)
    columns = {r[1] for r in conn.execute("PRAGMA table_info(room_player_profiles)")}
    if not PROFILE_COLUMNS.issubset(columns):
        raise Stop("Rehearsed profile migration is missing required fields.")
    for table, expected in before.items():
        actual = tuple(int(x or 0) for x in conn.execute(aggregate_sql(table)).fetchone())
        if actual != expected:
            raise Stop("Profile migration altered a restored financial ledger.")
    if (int(conn.execute("SELECT COUNT(*) FROM games").fetchone()[0]) != before_games
            or int(conn.execute("SELECT COUNT(*) FROM event_members").fetchone()[0]) != before_members):
        raise Stop("Profile migration altered restored game or member rows.")
    return True


def profile_schema_state():
    """Distinguish absent from partially applied schema before deployment."""
    rows = remote_query("SELECT name FROM pragma_table_info('room_player_profiles')")
    columns = {row["name"] for row in rows}
    if not columns:
        return False
    if not PROFILE_COLUMNS.issubset(columns):
        raise Stop("Partial room-player profile schema; no Worker deployment.")
    return True


def verify_profile_schema():
    if not profile_schema_state():
        raise Stop("Room-player profile migration missing after application.")
    print("Room-scoped player profile D1 schema: PRESENT", flush=True)


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


def check_api_route(*, attempts=24, delay_seconds=5):
    """Allow new Cloudflare Worker versions to propagate before final sign-off.

    Never treat a 404 as success; a timeout still halts feature activation and
    historical-payment reconciliation. The route must authenticate before
    checking that the synthetic game identifier does not exist.
    """
    for attempt in range(attempts):
        status = command("curl", "-sS", "--max-time", "20",
                         "-o", "/dev/null", "-w", "%{http_code}",
                         "-H", "Cache-Control: no-cache",
                         HOST + "/games/production-route-probe/settlement-control").strip()
        if status == "401":
            payload = command("curl", "-fsS", "--max-time", "20",
                              "-H", "Cache-Control: no-cache", HOST + "/health")
            try:
                health = json.loads(payload)
            except ValueError as exc:
                raise Stop("Production health response invalid; refusing activation.") from exc
            if (health.get("release") == "settlement-v2-github-20261028"
                    and health.get("environment") == "production"
                    and (health.get("features") or {}).get("settlement_v2") is True):
                print("Production Settlement V2 authenticated route and release: PASS",
                      flush=True)
                return
        if attempt + 1 < attempts:
            time.sleep(delay_seconds)
    raise Stop("Production Settlement V2 route/release failed authenticated readiness; "
               "last route HTTP " + status + ". Later feature and payment steps halted.")


def check_profile_route(*, attempts=12, delay_seconds=5):
    """Auth-only smoke test. No personal data or D1 row is accessed."""
    status = "unknown"
    for attempt in range(attempts):
        status = command("curl", "-sS", "--max-time", "20",
                         "-o", "/dev/null", "-w", "%{http_code}",
                         "-H", "Cache-Control: no-cache",
                         HOST + "/events/pkr-release-probe-only/profiles").strip()
        if status == "401":
            print("Authenticated room profile route: PRESENT (401 without token)", flush=True)
            return
        if attempt + 1 < attempts:
            time.sleep(delay_seconds)
    raise Stop("Production profile route did not activate; last HTTP " + status)


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
    # Profiles are strictly additive and require a real database table BEFORE
    # the new public frontend and authenticated Worker routes can be released.
    if {t: aggregate(t) for t in before} != before:
        raise Stop("Financial aggregates changed during settlement migration; halted.")
    already_profiles = profile_schema_state()
    if not already_profiles:
        wrangler("d1", "execute", DB, "--config", "wrangler.toml", "--remote",
                 "--file", PROFILE_MIGRATION)
        print("Additive room-player profile migration applied.", flush=True)
    else:
        print("Room-player profile migration already applied; skipping.", flush=True)
    verify_profile_schema()
    if {t: aggregate(t) for t in before} != before:
        raise Stop("Financial aggregates changed during profile migration; halted.")
    # Deploy only after schema check; preserve vars set in Cloudflare dashboard.
    wrangler("deploy", "--config", "wrangler.toml", "--keep-vars")
    print("Production Worker deployed.", flush=True)
    # A prior disabled flag can exist; explicitly activate the reviewed release.
    wrangler("secret", "put", "PKR_SETTLEMENT_V2",
             "--config", "wrangler.toml", stdin="1\n")
    print("Settlement V2 secret configured.", flush=True)
    check_api_route()
    check_profile_route()
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
