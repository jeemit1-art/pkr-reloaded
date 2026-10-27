#!/usr/bin/env python3
"""Operator-only guarded Cloudflare D1 historical settlement reclassification.

Default: read-only report. No production writes occur without --apply, matching
--expected-count and --expected-cents, a full private D1 export and successful
independent in-memory restore comparison.

Run only from a reviewed checkout with npx wrangler authenticated to the OWNER's
production Cloudflare account. Never commit exports or print player identities.
"""
import argparse
import json
import os
import re
import sqlite3
import subprocess
import sys
import tempfile
from pathlib import Path

ROOT=Path(__file__).resolve().parents[1]
EXPECTED_ACCOUNT="4b4794b983d6966f4207d2ff4fd8c991"
EXPECTED_DATABASE="e21a4823-ef28-496a-9f49-fa3e04dc73bf"
TARGET="DB"

class GuardError(RuntimeError):
    pass

def run(*args):
    cmd=["npx","--no-install","wrangler","d1",*args]
    done=subprocess.run(cmd,cwd=ROOT,text=True,capture_output=True)
    if done.returncode:
        raise GuardError("Wrangler operation failed: "+ " ".join(cmd[:4])+
                         " (exit "+str(done.returncode)+"). Review Wrangler login and target.")
    return done.stdout

def parse_json(output):
    # Wrangler can emit a version/banner before its JSON output.
    for marker in ("[", "{"):
        i=output.find(marker)
        if i>=0:
            try:
                value=json.loads(output[i:])
                return value if isinstance(value,list) else [value]
            except (ValueError,TypeError):
                pass
    raise GuardError("Remote D1 response could not be interpreted as JSON.")

def select_aggregate():
    sql=("SELECT COUNT(*) AS legacy_count,"
         "COALESCE(SUM(amount),0) AS legacy_cents "
         "FROM settlement_transfers WHERE status='legacy'")
    response=parse_json(run("execute",TARGET,"--config","wrangler.toml",
                            "--remote","--json","--command",sql))
    for result in response:
        rows=result.get("results") if isinstance(result,dict) else None
        if isinstance(rows,list) and len(rows)==1:
            row=rows[0]
            return int(row["legacy_count"]),int(row["legacy_cents"])
    raise GuardError("Unable to read a single production legacy count/amount result.")

def inspect_target():
    config=(ROOT/"wrangler.toml").read_text(encoding="utf-8")
    for expected in (
      'name = "pkr-reloaded-worker"',
      'database_id = "'+EXPECTED_DATABASE+'"',
      'account_id = "'+EXPECTED_ACCOUNT+'"',
      'FRONTEND_URL = "https://mypkr.app"',
      'PKR_ENV = "production"',
    ):
        if expected not in config:
            raise GuardError("Refusing to use unverified production Worker/D1 binding.")
    return True

def restore_and_verify(export_path,expected):
    raw=export_path.read_text(encoding="utf-8")
    if len(raw)<4000:
        raise GuardError("Refusing suspiciously small or empty D1 export.")
    db=sqlite3.connect(":memory:")
    db.execute("PRAGMA foreign_keys=ON")
    try:
        db.executescript(raw)
        count,cents=db.execute(
           "SELECT COUNT(*),COALESCE(SUM(amount),0) FROM settlement_transfers WHERE status='legacy'"
        ).fetchone()
        if (count,cents)!=expected:
            raise GuardError("Independently restored export does not match live legacy totals.")
        integrity=db.execute("PRAGMA quick_check").fetchone()[0]
        if integrity!="ok" or db.execute("PRAGMA foreign_key_check").fetchall():
            raise GuardError("Independent D1 export restore failed integrity verification.")
    finally:
        db.close()

def main():
    ap=argparse.ArgumentParser(description="Read-only D1 legacy audit unless explicitly authorised")
    ap.add_argument("--apply",action="store_true",help="Allow owner-approved reclassification")
    ap.add_argument("--expected-count",type=int)
    ap.add_argument("--expected-cents",type=int)
    ap.add_argument("--private-backup-dir",type=Path)
    args=ap.parse_args()
    inspect_target()
    before=select_aggregate()
    print("Production legacy records:",before[0])
    print("Production legacy aggregate AUD cents:",before[1])
    if not args.apply:
        print("READ-ONLY. No remote transaction statuses were changed.")
        return
    if not (args.expected_count is not None and args.expected_cents is not None):
        raise GuardError("Pass both expected count and amount from the independent read-only check.")
    if (args.expected_count,args.expected_cents)!=before:
        raise GuardError("Legacy records changed since review: aborting without any writes.")
    if before[0]==0:
        print("All historical records are already free of 'legacy' status. No writes.")
        return
    if not args.private_backup_dir or not args.private_backup_dir.is_dir():
        raise GuardError("--private-backup-dir must be an existing operator-controlled directory.")
    backupdir=args.private_backup_dir.resolve()
    if backupdir.is_relative_to(ROOT):
        raise GuardError("Do not place production backups under the public repository.")
    export=backupdir/"pkr-production-d1-pre-legacy-paid.sql"
    if export.exists():
        raise GuardError("Refusing to overwrite an existing production D1 backup.")
    old_umask=os.umask(0o077)
    try:
        run("export",TARGET,"--config","wrangler.toml","--remote","--output",str(export))
    finally:
        os.umask(old_umask)
    if not export.exists():
        raise GuardError("No D1 export found, aborting.")
    export.chmod(0o600)
    restore_and_verify(export,before)
    if select_aggregate()!=before:
        raise GuardError("Concurrent live settlement changes: aborting.")
    # The added schema migration is non-destructive and must be performed before
    # any historical paid update, so that trigger rows create a durable audit.
    run("execute",TARGET,"--config","wrangler.toml","--remote","--file",
        "migrations/20261027_settlement_v2.sql")
    run("execute",TARGET,"--config","wrangler.toml","--remote","--file",
        "migrations/20261027_owner_mark_legacy_paid.sql")
    after=select_aggregate()
    if after!=(0,0):
        raise GuardError("Post-update verification failed. Stop further deployments; consult D1 export.")
    print("SUCCESS: all",before[0],"formerly legacy transfer(s), amount",
          before[1],"cents administratively marked paid.")
    print("Sensitive D1 export stored privately at:",export)
    print("This is an owner-directed record update, not evidence of recipient acknowledgement.")

if __name__=="__main__":
    try:
        main()
    except (GuardError,sqlite3.Error,OSError,ValueError) as e:
        print("STOP:",e,file=sys.stderr)
        sys.exit(1)
