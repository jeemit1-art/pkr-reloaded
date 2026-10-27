#!/usr/bin/env python3
"""Read-only production settlement inventory. No player IDs, tokens or raw SQL in logs.

For the owner-authorised 326 records / 7,523,500 cents historical batch.
The production D1 aggregate can change as current games settle; this script
only reports grouped counts and cents, and will NEVER classify a transfer.
"""
import importlib.util
import sys
from pathlib import Path

EXPECTED_COUNT = 326
EXPECTED_CENTS = 7_523_500
SAFE_STATUSES = {"legacy","owed","paid","not_received","payer_claimed"}
SAFE_ACTIONS = {
    "owner_marked_legacy_paid_without_recipient_confirmation",
    "owner_marked_legacy_paid",
}


def get_release():
    path = Path(__file__).with_name("deploy-settlement-v2-production.py")
    spec = importlib.util.spec_from_file_location("pkr_release_readonly",path)
    if not spec or not spec.loader:
        raise RuntimeError("Release module could not load.")
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def numeric(record,key):
    v=record.get(key,0)
    if v is None:
        return 0
    if isinstance(v,bool) or not isinstance(v,(int,float)):
        raise RuntimeError("Unexpected D1 aggregate field.")
    if int(v)!=v:
        raise RuntimeError("Nonintegral amount in a financial aggregate.")
    return int(v)


def safe_status(value):
    return value if value in SAFE_STATUSES else "other"


def show_summary(groups, audit_groups, extras):
    by_status={s:{"n":0,"cents":0} for s in sorted(SAFE_STATUSES|{"other"})}
    for row in groups:
        label=safe_status(row.get("status"))
        by_status[label]["n"]+=numeric(row,"n")
        by_status[label]["cents"]+=numeric(row,"cents")
    count=sum(v["n"] for v in by_status.values())
    cents=sum(v["cents"] for v in by_status.values())
    legacy=by_status["legacy"]
    print("PKR READ ONLY settlement inventory (counts / aggregate cents only)")
    print("Total transfers:",count,"aggregate cents:",cents)
    for label in ("legacy","paid","owed","payer_claimed","not_received","other"):
        print("Status",label+":",by_status[label]["n"],"transfers,",by_status[label]["cents"],"cents")
    print("Legacy number of settled/non-settled games:",
          numeric(extras[0],"settled_games"),"/",numeric(extras[0],"nonsettled_games"))
    for row in audit_groups:
        label=row.get("action")
        if label in SAFE_ACTIONS:
            print("Prior audited owner action:",label,
                  "count:",numeric(row,"n"),"cents:",numeric(row,"cents"))
    print("Expected owner's historical batch: 326 transfers / 7,523,500 cents")
    print("Legacy count matches expectation:", legacy["n"]==EXPECTED_COUNT)
    print("Legacy sum matches expectation:", legacy["cents"]==EXPECTED_CENTS)
    print("Full inventory count matches expectation:",count==EXPECTED_COUNT)
    print("Full inventory cents match expectation:",cents==EXPECTED_CENTS)
    print("READ-ONLY COMPLETE. No transfers, amounts, statuses, audits or game records changed.")
    return by_status


def main():
    release=get_release()
    release.verify_target()
    release.verify_schema()
    # Aggregates only. Never select the IDs, names, players, emails, push keys,
    # notes, devices, timestamps or results tokens.
    groups=release.remote_query(
        "SELECT status, COUNT(*) AS n, COALESCE(SUM(amount),0) AS cents "
        "FROM settlement_transfers GROUP BY status ORDER BY status"
    )
    audits=release.remote_query(
        "SELECT a.action AS action, COUNT(*) AS n, COALESCE(SUM(t.amount),0) AS cents "
        "FROM settlement_confirmation_events a "
        "LEFT JOIN settlement_transfers t ON t.id=a.transfer_id "
        "WHERE a.action IN ('owner_marked_legacy_paid_without_recipient_confirmation',"
        "'owner_marked_legacy_paid') "
        "GROUP BY a.action ORDER BY a.action"
    )
    extras=release.remote_query(
        "SELECT COUNT(DISTINCT CASE WHEN g.status='settled' THEN t.game_id END) AS settled_games,"
        "COUNT(DISTINCT CASE WHEN g.status!='settled' THEN t.game_id END) AS nonsettled_games "
        "FROM settlement_transfers t JOIN games g ON g.id=t.game_id WHERE t.status='legacy'"
    )
    if len(extras)!=1:
        raise RuntimeError("Unexpected grouped D1 count.")
    show_summary(groups,audits,extras)


if __name__=="__main__":
    try:
        main()
    except Exception:
        # Cloudflare's error messages can include customer metadata.
        print("READ-ONLY AUDIT STOPPED: target, schema or grouped query unavailable. No changes made.",file=sys.stderr)
        raise SystemExit(1)
