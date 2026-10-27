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
    summary=show_summary(groups,audits,extras)
    # A unique 8-record / 82,400-cent game would explain the discrepancy,
    # but does NOT authorise changing it. Check aggregate timing only.
    cohort=release.remote_query("""
      WITH per_game AS (
       SELECT t.game_id,COUNT(*) AS n,COALESCE(SUM(t.amount),0) AS cents,
              MAX(g.scheduled_at) AS scheduled,MAX(t.created_at) AS created
       FROM settlement_transfers t JOIN games g ON g.id=t.game_id
       WHERE t.status='legacy' GROUP BY t.game_id
      )
      SELECT
       (SELECT COUNT(*) FROM per_game WHERE n=8 AND cents=82400) AS candidate_games,
       (SELECT n FROM per_game ORDER BY scheduled DESC,game_id DESC LIMIT 1) AS latest_scheduled_count,
       (SELECT cents FROM per_game ORDER BY scheduled DESC,game_id DESC LIMIT 1) AS latest_scheduled_cents,
       (SELECT n FROM per_game ORDER BY created DESC,game_id DESC LIMIT 1) AS latest_created_count,
       (SELECT cents FROM per_game ORDER BY created DESC,game_id DESC LIMIT 1) AS latest_created_cents
    """)
    if len(cohort)!=1:
        raise RuntimeError("Cannot evaluate grouped excess cohort.")
    item=cohort[0]
    print("Extra-cohort diagnostic (READ ONLY): 8 transfers / 82,400 cents is the observed excess.")
    print("Games containing exactly this excess:",numeric(item,"candidate_games"))
    print("Most recently scheduled legacy game's count/cents:",
          numeric(item,"latest_scheduled_count"),"/",numeric(item,"latest_scheduled_cents"))
    print("Most recently inserted legacy game's count/cents:",
          numeric(item,"latest_created_count"),"/",numeric(item,"latest_created_cents"))
    print("This summary never supplies a game ID, selects players, or approves payment changes.")

    recent=release.remote_query("""
      WITH newest AS (
       SELECT id,amount,game_id,created_at
       FROM settlement_transfers WHERE status='legacy'
       ORDER BY created_at DESC,id DESC LIMIT 8
      )
      SELECT COUNT(*) AS n,COALESCE(SUM(amount),0) AS cents,
             COUNT(DISTINCT game_id) AS games,
             MIN(created_at) AS boundary,
             (SELECT COUNT(*) FROM settlement_transfers
              WHERE status='legacy'
              AND created_at=(SELECT MIN(created_at) FROM newest)) AS boundary_ties,
             (SELECT COUNT(*) FROM newest
              WHERE created_at=(SELECT MIN(created_at) FROM newest)) AS eight_at_boundary
      FROM newest
    """)
    if len(recent)!=1:
        raise RuntimeError("Could not obtain read-only eight-row timing summary.")
    latest=recent[0]
    print("Eight latest-created legacy transfers: count=",numeric(latest,"n"),
          "aggregate cents=",numeric(latest,"cents"),
          "across games=",numeric(latest,"games"))
    print("Eight latest-created sum matches the observed 82,400-cent excess:",
          numeric(latest,"cents")==82400)
    print("Created-at boundary is unambiguous:",
          numeric(latest,"boundary_ties")==numeric(latest,"eight_at_boundary"))
    by_day=release.remote_query("""
      SELECT CAST(created_at/86400 AS INTEGER) AS day_bucket,
             COUNT(*) AS n,COALESCE(SUM(amount),0) AS cents
      FROM settlement_transfers WHERE status='legacy'
      GROUP BY CAST(created_at/86400 AS INTEGER)
      ORDER BY day_bucket DESC LIMIT 8
    """)
    # Bucket dates are operational creation dates, not player identities.
    # The grouped totals help distinguish older imported records from late edits.
    print("Most recent legacy insertion-day buckets (epoch day/count/aggregate cents):")
    for rec in by_day:
        print("  ",numeric(rec,"day_bucket"),numeric(rec,"n"),numeric(rec,"cents"))


if __name__=="__main__":
    try:
        main()
    except Exception:
        # Cloudflare's error messages can include customer metadata.
        print("READ-ONLY AUDIT STOPPED: target, schema or grouped query unavailable. No changes made.",file=sys.stderr)
        raise SystemExit(1)
