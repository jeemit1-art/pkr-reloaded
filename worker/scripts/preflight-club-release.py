#!/usr/bin/env python3
"""Read-only remote D1 backup/restore rehearsal of the exact club migrations.
Private temporary files are deleted. Never prints rows, identities, SQL or credentials.
Remote writes and deploys are separate, explicitly approved steps.
"""
import importlib.util
import json
import os
import pathlib
import re
import sqlite3
import sys
import tempfile

ROOT=pathlib.Path(__file__).resolve().parents[1]
spec=importlib.util.spec_from_file_location("existing_release", ROOT/"scripts/deploy-settlement-v2-production.py")
release=importlib.util.module_from_spec(spec)
spec.loader.exec_module(release)

TARGETS={
 "staging":("wrangler.staging.toml","pkr-reloaded-db-staging","03577857-fc94-49ed-bd1b-5cd658aa0978","pkr-reloaded-worker-staging"),
 "production":("wrangler.toml","pkr-reloaded-db","e21a4823-ef28-496a-9f49-fa3e04dc73bf","pkr-reloaded-worker"),
}
MIGRATIONS=["20261126_club_planning.sql","20261126_club_extras.sql"]
NEW={"room_date_polls","room_date_poll_votes","game_waitlist","game_member_requests","room_league_seasons","room_shared_expenses","room_shared_expense_splits","room_tournament_presets","host_free_first_games"}

def main():
    target=sys.argv[1] if len(sys.argv)==2 else ""
    if target not in TARGETS:
        raise release.Stop("Explicit reviewed target required")
    config, db_name, db_id, worker=TARGETS[target]
    source=(ROOT/config).read_text()
    for marker in [f'account_id = "{release.ACCOUNT}"',f'database_id = "{db_id}"',f'database_name = "{db_name}"',f'name = "{worker}"',f'PKR_ENV = "{target}"']:
        if marker not in source: raise release.Stop("Target config mismatch")
    if not os.environ.get("CLOUDFLARE_API_TOKEN"):
        raise release.Stop("Scoped Cloudflare build token unavailable")
    if target=="staging" and TARGETS["production"][2] in source:
        raise release.Stop("Staging references production DB")
    def query(sql):
        return release.parse_d1(release.wrangler("d1","execute","DB","--config",config,"--remote","--json","--command",sql))
    def names(rows):
        return {r["name"] for r in rows}
    def summaries(conn=None):
        out={}
        for table in ["users","events","event_members","games","game_players","settlement_transfers"]:
            sql=release.aggregate_sql(table) if table in ("game_players","settlement_transfers") else 'SELECT COUNT(*) AS n FROM "'+table+'"'
            if conn is None:
                out[table]=tuple(int(v or 0) for v in query(sql)[0].values())
            else:
                out[table]=tuple(int(v or 0) for v in conn.execute(sql).fetchone())
        return out
    health=json.loads(release.command("curl","-fsS","--max-time","20",f"https://{worker}.jeemit1.workers.dev/health"))
    if health.get("environment")!=target or not health.get("ok"):
        raise release.Stop("Wrong live environment")
    before=summaries()
    if query("SELECT COUNT(*) AS n FROM sqlite_master WHERE type='table' AND UPPER(sql) LIKE 'CREATE VIRTUAL TABLE%'")[0]["n"]:
        raise release.Stop("Virtual tables prevent a safe full export")
    bookmark=release.wrangler("d1","time-travel","info","DB","--config",config)
    found=re.search(r"bookmark is\s+['\"]([0-9a-fA-F-]+)['\"]",bookmark)
    if not found: raise release.Stop("Missing recovery bookmark")
    print(target+" recovery bookmark "+found.group(1),flush=True)
    with tempfile.TemporaryDirectory(prefix="pkr-club-private-") as folder:
        backup=pathlib.Path(folder)/"export.sql"
        try:
            release.wrangler("d1","export",db_name,"--config",config,"--remote","--skip-confirmation","--output",str(backup))
        except release.Stop:
            release.DATABASE_ID=db_id
            release.export_backup_via_api(backup)
        if not backup.exists() or backup.stat().st_size<4000:
            raise release.Stop("Full export unavailable")
        os.chmod(backup,0o600)
        con=sqlite3.connect(":memory:")
        try:
            con.executescript(backup.read_text(encoding="utf-8"))
            if con.execute("PRAGMA quick_check").fetchone()[0]!="ok" or con.execute("PRAGMA foreign_key_check").fetchall():
                raise release.Stop("Independent restore failed integrity check")
            # Map field names rather than rely on provider JSON key order.
            for table in before:
                sql=release.aggregate_sql(table) if table in ("game_players","settlement_transfers") else 'SELECT COUNT(*) AS n FROM "'+table+'"'
                cur=con.execute(sql); local=dict(zip([x[0] for x in cur.description],cur.fetchone()))
                remote=query(sql)[0]
                if any(int(v or 0)!=int(remote.get(k) or 0) for k,v in local.items()):
                    raise release.Stop("Live and restored totals differ")
            original={r[0]:r[1] for r in con.execute("SELECT name,sql FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'")}
            counts={name:con.execute('SELECT COUNT(*) FROM "'+name.replace('"','""')+'"').fetchone()[0] for name in original}
            original_fin=summaries(con)
            for _ in range(2):
                for file in MIGRATIONS:
                    sql=(ROOT/"migrations"/file).read_text()
                    statements=[x.strip() for x in re.sub(r"--[^\n]*","",sql).split(";") if x.strip()]
                    if any(not re.match(r"CREATE (?:UNIQUE )?(?:TABLE|INDEX) IF NOT EXISTS\b",x,re.I) for x in statements):
                        raise release.Stop("Migration must be purely additive")
                    con.executescript(sql)
            after={r[0]:r[1] for r in con.execute("SELECT name,sql FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'")}
            if not NEW.issubset(after) or any(after.get(k)!=v for k,v in original.items()):
                raise release.Stop("Unexpected table changes")
            if any(con.execute('SELECT COUNT(*) FROM "'+name.replace('"','""')+'"').fetchone()[0]!=n for name,n in counts.items()) or summaries(con)!=original_fin:
                raise release.Stop("Migration changed existing rows")
            if con.execute("PRAGMA quick_check").fetchone()[0]!="ok" or con.execute("PRAGMA foreign_key_check").fetchall():
                raise release.Stop("Rehearsed database integrity failed")
        finally:
            con.close()
    print("PASS "+target+" full private export, independent restored DB, exact additive migrations twice, existing schema/row counts and financial totals unchanged",flush=True)

if __name__=="__main__":
    try: main()
    except (release.Stop,sqlite3.Error,OSError,ValueError,KeyError) as exc:
        print("CLUB RELEASE PREFLIGHT STOPPED: "+(str(exc) if isinstance(exc,release.Stop) else type(exc).__name__),file=sys.stderr)
        sys.exit(1)
