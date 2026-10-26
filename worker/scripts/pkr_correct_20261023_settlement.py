#!/usr/bin/env python3
"""Guarded, one-time PKR historical settlement correction.

Default is read-only. --apply requires a fresh private SQL export, exact game
and player fingerprints, and SQLite trigger-enforced atomic changes. This
script must run from the worker directory with authenticated Wrangler.
Neither the repository nor the private backup is modified by the correction.
"""
from __future__ import annotations
import argparse
import datetime as dt
import json
import os
from pathlib import Path
import sqlite3
import subprocess
import sys
import tomllib
import uuid

EXPECTED_ACCOUNT = "4b4794b983d6966f4207d2ff4fd8c991"
EXPECTED_D1 = "e21a4823-ef28-496a-9f49-fa3e04dc73bf"
EXPECTED_WORKER = "pkr-reloaded-worker"
ORIGINAL_BACKUP = Path.home() / "PKR-private-backups/push-prod-20261026T053737Z/verified-restore.sqlite"

def stop(reason: str):
    raise SystemExit("STOP: " + reason)

def quote(value):
    if value is None:
        return "NULL"
    if isinstance(value, bool):
        return "1" if value else "0"
    if isinstance(value, int):
        return str(value)
    text = str(value)
    if "\x00" in text:
        stop("Null byte in SQL input")
    return "'" + text.replace("'", "''") + "'"

def command(args, *, private=False):
    run = subprocess.run(args, text=True, capture_output=True, check=False)
    if run.returncode:
        # Never expose a signed D1 SQL export URL or a private SQL statement.
        stop("Wrangler command failed; see private backup and inspect remote D1. "
             + ("Export failed" if private else f"exit={run.returncode}"))
    return run.stdout

def wrangler(*args, private=False):
    return command(["npx", "--no-install", "wrangler", *args, "--config",
                    "wrangler.toml"], private=private)

def rows(sql):
    raw = wrangler("d1", "execute", "DB", "--remote", "--json",
                   "--command", sql)
    try:
        payload = json.loads(raw)
        blocks = payload if isinstance(payload, list) else [payload]
        if not blocks or not all(block.get("success") for block in blocks):
            stop("Remote D1 SQL query failed")
        return [row for block in blocks for row in block.get("results", [])]
    except (ValueError, TypeError, KeyError) as err:
        stop("Unable to parse Wrangler D1 --json response: " + str(err))

def row(sql):
    found = rows(sql)
    if len(found) != 1:
        stop(f"Expected exactly one row; found {len(found)}")
    return found[0]

def fingerprint(args):
    game = row("SELECT id,event_id,status,results_token,variance,scheduled_at "
               f"FROM games WHERE id={quote(args.game_id)}")
    if game["status"] != "settled" or game["variance"] is not None:
        stop("Game is not the expected unadjusted, settled historical game")
    event = row("SELECT id,buy_in,name FROM events WHERE id="
                + quote(game["event_id"]))
    ps = rows("SELECT user_id,display_name,buy_ins,buy_in_total,cashout,net "
              "FROM game_players WHERE game_id=" + quote(args.game_id)
              + " ORDER BY user_id")
    transfers = rows(
        "SELECT id,from_user,to_user,from_name,to_name,amount,status,paid_at,"
        "reminder_count,last_reminded_at,created_at FROM settlement_transfers "
        "WHERE game_id=" + quote(args.game_id) + " ORDER BY id")
    settlement = row(
        "SELECT id,idempotency_key,payload_json,created_at FROM settlements "
        "WHERE game_id=" + quote(args.game_id))
    try:
        payload = json.loads(settlement["payload_json"])
    except (ValueError, TypeError):
        stop("Saved settlement JSON is invalid")
    payer = [p for p in ps if p["display_name"].casefold() == args.payer.casefold()]
    winner = [p for p in ps if p["display_name"].casefold() == args.winner.casefold()]
    if len(ps) != 13 or len(payer) != 1 or len(winner) != 1:
        stop("Expected exactly 13 players and one matching payer and winner")
    payer, winner = payer[0], winner[0]
    if payer["user_id"] == winner["user_id"]:
        stop("Payer and winner cannot be identical")
    if (payer["buy_ins"], payer["buy_in_total"], payer["cashout"], payer["net"]) != (
        15, 95000, 91000, -4000):
        stop("Payer's original figures no longer match the audited record")
    if (winner["buy_ins"], winner["buy_in_total"], winner["cashout"], winner["net"]) != (
        12, 32500, 55500, 23000):
        stop("Winner's original figures no longer match the audited record")
    totals_in = sum(p["buy_in_total"] if p["buy_in_total"] > 0
                    else p["buy_ins"] * event["buy_in"] for p in ps)
    totals_out = sum(p["cashout"] or 0 for p in ps)
    net_sum = sum(p["net"] or 0 for p in ps)
    if (totals_in, totals_out, net_sum) != (600000, 597500, -2500):
        stop("Original game totals changed; automatic correction refused")
    if (len(transfers), sum(t["amount"] for t in transfers)) != (12, 270000):
        stop("Existing settlement transfers differ from verified audit")
    if (sum(t["amount"] for t in transfers if t["from_user"] == payer["user_id"]),
        sum(t["amount"] for t in transfers if t["to_user"] == winner["user_id"])) != (1500, 23000):
        stop("Payer/receiver transfer allocations differ from verified audit")
    if not isinstance(payload.get("results"), list) or not isinstance(payload.get("transfers"), list):
        stop("Saved settlement snapshot lacks results or transfers arrays")
    if len(payload["results"]) != 13 or len(payload["transfers"]) != 12:
        stop("Snapshot entry counts differ from verified audit")
    snap_pay = [p for p in payload["results"] if p.get("user_id") == payer["user_id"]]
    snap_win = [p for p in payload["results"] if p.get("user_id") == winner["user_id"]]
    if len(snap_pay) != 1 or len(snap_win) != 1:
        stop("Snapshot payer or winner ID does not match DB records")
    if (snap_win[0].get("buy_ins"),snap_win[0].get("buy_in_total"),
        snap_win[0].get("cashout"),snap_win[0].get("net")) != (12,32500,55500,23000):
        stop("Snapshot winner values have been modified since initial settlement")
    if (snap_pay[0].get("buy_in_total"),snap_pay[0].get("cashout"),
        snap_pay[0].get("net")) != (95000,91000,-4000):
        stop("Snapshot payer values have been modified")
    def transfers_key(ts):
        return sorted((t["from"],t["to"],t["amount"]) for t in ts)
    original_transfers = sorted((t["from_user"],t["to_user"],t["amount"]) for t in transfers)
    if transfers_key(payload["transfers"]) != original_transfers:
        stop("Stored snapshot transfers differ from original transfer records")
    leaderboard = rows(
        "SELECT event_id,user_id,display_name,games_played,games_won,"
        "total_net,biggest_win,biggest_loss,last_played FROM leaderboard "
        "WHERE event_id=" + quote(game["event_id"]) + " AND LOWER(display_name)="
        + quote(winner["display_name"].lower()))
    if len(leaderboard) != 1:
        stop("Could not uniquely identify the existing winner leaderboard entry")
    return dict(game=game,event=event,players=ps,transfers=transfers,
                settlement=settlement,payload=payload,payer=payer,winner=winner,
                leaderboard=leaderboard[0],totals=(totals_in,totals_out,net_sum))

def old_backup_check(state):
    if not ORIGINAL_BACKUP.is_file():
        stop("Verified original Oct 26 private backup is absent: " + str(ORIGINAL_BACKUP))
    db = sqlite3.connect(ORIGINAL_BACKUP.as_uri() + "?mode=ro", uri=True)
    try:
        db.execute("PRAGMA query_only=ON")
        saved = db.execute(
            "SELECT payload_json FROM settlements WHERE game_id=?",
            (state["game"]["id"],)).fetchone()
        w = db.execute(
            "SELECT buy_ins,buy_in_total,cashout,net FROM game_players "
            "WHERE game_id=? AND user_id=?",
            (state["game"]["id"],state["winner"]["user_id"])).fetchone()
        if not saved or saved[0] != state["settlement"]["payload_json"] or w != (12,32500,55500,23000):
            stop("Live settlement differs from original protected backup; refusing repair")
    finally:
        db.close()

def correction_sql(state, args):
    g, payer, win = state["game"], state["payer"], state["winner"]
    sid, snap = state["settlement"]["id"], state["settlement"]["payload_json"]
    lb = state["leaderboard"]
    amended = json.loads(snap)
    for item in amended["results"]:
        if item["user_id"] == win["user_id"]:
            item["buy_in_total"] = 30000
            item["net"] = 25500
    transfer = {"from":payer["user_id"],"from_name":payer["display_name"],
                "to":win["user_id"],"to_name":win["display_name"],"amount":2500}
    amended["transfers"].append(transfer)
    amended["variance"] = 0
    corrected_json = json.dumps(amended,ensure_ascii=False,separators=(",",":"))
    correction_id = "repair_20261023_" + g["id"].replace("-","")
    transfer_id = "repair_payment_20261023_" + g["id"].replace("-","")
    q = quote
    audit_game = json.dumps(g,ensure_ascii=False,separators=(",",":"))
    audit_players = json.dumps(state["players"],ensure_ascii=False,separators=(",",":"))
    audit_transfers = json.dumps(state["transfers"],ensure_ascii=False,separators=(",",":"))
    before = ("trg_pkr_20261023_correction_guard")
    after = ("trg_pkr_20261023_correction_apply")
    preconditions = f"""(
      (SELECT COUNT(*) FROM games WHERE id={q(g['id'])}
         AND event_id={q(g['event_id'])} AND status='settled'
         AND results_token={q(g['results_token'])} AND variance IS NULL)=1
      AND (SELECT COUNT(*) FROM game_players WHERE game_id={q(g['id'])})=13
      AND (SELECT COUNT(*) FROM game_players WHERE game_id={q(g['id'])}
         AND user_id={q(win['user_id'])} AND display_name={q(win['display_name'])}
         AND buy_ins=12 AND buy_in_total=32500 AND cashout=55500 AND net=23000)=1
      AND (SELECT COUNT(*) FROM game_players WHERE game_id={q(g['id'])}
         AND user_id={q(payer['user_id'])} AND display_name={q(payer['display_name'])}
         AND buy_ins=15 AND buy_in_total=95000 AND cashout=91000 AND net=-4000)=1
      AND (SELECT COUNT(*) FROM settlements WHERE game_id={q(g['id'])}
         AND id={q(sid)} AND payload_json={q(snap)})=1
      AND (SELECT COUNT(*) FROM settlement_transfers WHERE game_id={q(g['id'])})=12
      AND (SELECT COALESCE(SUM(amount),0) FROM settlement_transfers
         WHERE game_id={q(g['id'])})=270000
      AND (SELECT COALESCE(SUM(amount),0) FROM settlement_transfers
         WHERE game_id={q(g['id'])} AND from_user={q(payer['user_id'])})=1500
      AND (SELECT COALESCE(SUM(amount),0) FROM settlement_transfers
         WHERE game_id={q(g['id'])} AND to_user={q(win['user_id'])})=23000
      AND (SELECT COUNT(*) FROM leaderboard WHERE event_id={q(g['event_id'])}
         AND user_id={q(lb['user_id'])}
         AND total_net={q(lb['total_net'])}
         AND biggest_win={q(lb['biggest_win'])})=1
      AND NOT EXISTS (SELECT 1 FROM settlement_transfers WHERE id={q(transfer_id)})
    )"""
    return f"""-- One-game financial correction. The INSERT fires an atomic SQLite trigger.
-- Do not rerun if an audit record exists; never UNSETTLE the historical game.
CREATE TABLE IF NOT EXISTS pkr_legacy_settlement_corrections (
  correction_id TEXT PRIMARY KEY,
  game_id TEXT NOT NULL UNIQUE REFERENCES games(id),
  original_game_json TEXT NOT NULL,
  original_players_json TEXT NOT NULL,
  original_transfers_json TEXT NOT NULL,
  original_snapshot_json TEXT NOT NULL,
  corrected_snapshot_json TEXT NOT NULL,
  reason TEXT NOT NULL,
  corrected_at INTEGER NOT NULL DEFAULT (unixepoch())
);
DROP TRIGGER IF EXISTS {before};
DROP TRIGGER IF EXISTS {after};
CREATE TRIGGER {before} BEFORE INSERT ON pkr_legacy_settlement_corrections
BEGIN
  SELECT CASE WHEN {preconditions} THEN 1
    ELSE RAISE(ABORT,'PKR historical repair precondition changed') END;
END;
CREATE TRIGGER {after} AFTER INSERT ON pkr_legacy_settlement_corrections
BEGIN
  UPDATE game_players SET buy_in_total=30000,net=25500
    WHERE game_id={q(g['id'])} AND user_id={q(win['user_id'])}
      AND buy_ins=12 AND buy_in_total=32500 AND cashout=55500 AND net=23000;
  SELECT CASE WHEN changes()=1 THEN 1 ELSE RAISE(ABORT,'Player edit failed') END;
  UPDATE settlements SET payload_json={q(corrected_json)}
    WHERE id={q(sid)} AND game_id={q(g['id'])} AND payload_json={q(snap)};
  SELECT CASE WHEN changes()=1 THEN 1 ELSE RAISE(ABORT,'Snapshot edit failed') END;
  INSERT INTO settlement_transfers(
    id,game_id,from_user,to_user,from_name,to_name,amount,status,paid_at
  ) VALUES({q(transfer_id)},{q(g['id'])},{q(payer['user_id'])},{q(win['user_id'])},
    {q(payer['display_name'])},{q(win['display_name'])},2500,'owed',NULL);
  UPDATE games SET variance=0
    WHERE id={q(g['id'])} AND status='settled' AND variance IS NULL;
  SELECT CASE WHEN changes()=1 THEN 1 ELSE RAISE(ABORT,'Game variance edit failed') END;
  UPDATE leaderboard SET total_net=total_net+2500,
    biggest_win=MAX(biggest_win,25500)
    WHERE event_id={q(g['event_id'])} AND user_id={q(lb['user_id'])}
      AND total_net={q(lb['total_net'])} AND biggest_win={q(lb['biggest_win'])};
  SELECT CASE WHEN changes()=1 THEN 1 ELSE RAISE(ABORT,'Leaderboard edit failed') END;
  SELECT CASE WHEN
    (SELECT SUM(net) FROM game_players WHERE game_id={q(g['id'])})=0
    AND (SELECT SUM(buy_in_total) FROM game_players WHERE game_id={q(g['id'])})=597500
    AND (SELECT SUM(cashout) FROM game_players WHERE game_id={q(g['id'])})=597500
    AND (SELECT COUNT(*) FROM settlement_transfers WHERE game_id={q(g['id'])})=13
    AND (SELECT SUM(amount) FROM settlement_transfers WHERE game_id={q(g['id'])})=272500
    THEN 1 ELSE RAISE(ABORT,'Final game balance failed') END;
END;
INSERT INTO pkr_legacy_settlement_corrections(
  correction_id,game_id,original_game_json,original_players_json,
  original_transfers_json,original_snapshot_json,corrected_snapshot_json,reason
) VALUES (
  {q(correction_id)},{q(g['id'])},{q(audit_game)},{q(audit_players)},
  {q(audit_transfers)},{q(snap)},{q(corrected_json)},
  'Paper scorecard dated 23 Oct 2026: 12 x $25 banks, cashout $555, net +$255. Existing transfers preserved; new $25 payer-to-winner transfer remains owed pending payment confirmation.'
);
DROP TRIGGER {before};
DROP TRIGGER {after};
"""
def verify_sqlite_rehearsal(export, statement, game_id):
    local = sqlite3.connect(":memory:")
    try:
        local.executescript(export.read_text(encoding="utf-8"))
        if local.execute("PRAGMA integrity_check").fetchone()[0]!="ok":
            stop("Fresh backup fails integrity_check")
        local.executescript(statement)
        n, b, o, net = local.execute(
            "SELECT COUNT(*),SUM(buy_in_total),SUM(cashout),SUM(net) "
            "FROM game_players WHERE game_id=?",(game_id,)).fetchone()
        transfers = local.execute(
            "SELECT COUNT(*),SUM(amount) FROM settlement_transfers "
            "WHERE game_id=?",(game_id,)).fetchone()
        audit = local.execute(
            "SELECT COUNT(*) FROM pkr_legacy_settlement_corrections WHERE game_id=?",
            (game_id,)).fetchone()[0]
        if (n,b,o,net,transfers,audit)!=(13,597500,597500,0,(13,272500),1):
            stop("Local rehearsal produced unexpected totals")
        saved=local.execute("SELECT payload_json FROM settlements WHERE game_id=?",
                            (game_id,)).fetchone()
        if not saved:
            stop("Rehearsal lost settlement snapshot")
        snap=json.loads(saved[0])
        if (sum(int(p["net"]) for p in snap["results"]),
            sum(int(t["amount"]) for t in snap["transfers"]),
            snap["variance"]) != (0,272500,0):
            stop("Rehearsal settlement JSON is not balanced")
        cash=local.execute(
          "SELECT COUNT(*) FROM settlement_transfers WHERE game_id=? "
          "AND amount=2500 AND status='owed' AND paid_at IS NULL",(game_id,)
        ).fetchone()[0]
        if cash<1:
            stop("Rehearsal new transfer lacks its correct unpaid status")
    finally:
        local.close()

def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--game-id",required=True)
    parser.add_argument("--winner",required=True,help="Player whose buy-in total was over-recorded")
    parser.add_argument("--payer",required=True,help="Player whose original loss was left partially unmatched")
    parser.add_argument("--apply",action="store_true",help="Apply only after private export and local rehearsal")
    args=parser.parse_args()
    conf = tomllib.loads(Path("wrangler.toml").read_text(encoding="utf-8"))
    if (conf.get("account_id")!=EXPECTED_ACCOUNT or
        conf.get("name")!=EXPECTED_WORKER or
        not any(t.get("binding")=="DB" and t.get("database_id")==EXPECTED_D1
                for t in conf.get("d1_databases",[]))):
        stop("Not configured for the approved production Cloudflare Worker and D1")
    # A read-only production call, and a check against the stored original snapshot.
    state=fingerprint(args)
    old_backup_check(state)
    if state["winner"]["display_name"].casefold()==state["payer"]["display_name"].casefold():
        stop("Winner and payer must differ")
    print("MATCH: settled game with 13 players; original backup matches live snapshot.")
    print("Original buy-ins $6,000.00; cash-outs $5,975.00; net -$25.00.")
    print(f"WINNER {state['winner']['display_name']}: 12 banks; $325.00 -> $300.00; "
          "cash-out unchanged $555.00; profit $230.00 -> $255.00")
    print(f"PAYER {state['payer']['display_name']}: buy-ins and cash-out unchanged; "
          "existing $15.00 transfer retained; add $25.00 owed to winner.")
    print("All 12 existing transfers, statuses, original settlement and historical result URL preserved.")
    if not args.apply:
        print("READ-ONLY PLAN ONLY: no changes made. Re-run with --apply to correct.")
        return
    already=rows("SELECT correction_id FROM pkr_legacy_settlement_corrections "
                 "WHERE game_id="+quote(args.game_id)) if rows(
                    "SELECT name FROM sqlite_master WHERE type='table' "
                    "AND name='pkr_legacy_settlement_corrections'") else []
    if already:
        stop("This game already has a historical correction record; do not rerun")
    folder = Path.home()/"PKR-private-backups"/("20261023-paper-correction-"+
       dt.datetime.now(dt.timezone.utc).strftime("%Y%m%dT%H%M%SZ"))
    folder.mkdir(mode=0o700,parents=True,exist_ok=False)
    os.chmod(folder,0o700)
    private = folder/"production-before.sql"
    # Wrangler output can contain a signed private export link: do not print it.
    wrangler("d1","export","DB","--remote","--output",str(private),private=True)
    if not private.is_file() or private.stat().st_size < 5000:
        stop("Fresh production SQL export is missing or unexpectedly small")
    os.chmod(private,0o600)
    (folder/"original-state.json").write_text(
        json.dumps(state,ensure_ascii=False,indent=2),encoding="utf-8")
    os.chmod(folder/"original-state.json",0o600)
    sql=correction_sql(state,args)
    file=folder/"apply-once.sql"
    file.write_text(sql,encoding="utf-8")
    os.chmod(file,0o600)
    verify_sqlite_rehearsal(private,sql,args.game_id)
    print("Fresh independent private D1 backup and local repair rehearsal: PASS.")
    # Guard against drift after exporting; a trigger repeats these comparisons
    # atomically at write time if anything changed meanwhile.
    fingerprint(args)
    print("Applying single-game correction to production D1.")
    try:
        wrangler("d1","execute","DB","--remote","--yes","--file",str(file),private=True)
    except SystemExit:
        print("IMPORTANT: Inspect remote state and private backup before any retry.")
        raise
    summary=row("SELECT (SELECT SUM(buy_in_total) FROM game_players WHERE game_id="
                +quote(args.game_id)+") AS buyins, "
                "(SELECT SUM(cashout) FROM game_players WHERE game_id="
                +quote(args.game_id)+") AS cashouts, "
                "(SELECT SUM(net) FROM game_players WHERE game_id="
                +quote(args.game_id)+") AS net, "
                "(SELECT COUNT(*) FROM settlement_transfers WHERE game_id="
                +quote(args.game_id)+") AS transfers, "
                "(SELECT SUM(amount) FROM settlement_transfers WHERE game_id="
                +quote(args.game_id)+") AS transfer_amount, "
                "(SELECT COUNT(*) FROM pkr_legacy_settlement_corrections WHERE game_id="
                +quote(args.game_id)+") AS corrections")
    if summary != dict(buyins=597500,cashouts=597500,net=0,
                       transfers=13,transfer_amount=272500,corrections=1):
        stop("Production applied but post-check failed; review private audit before touching records")
    print("PRODUCTION PAPER SCORECARD CORRECTION APPLIED AND RECONCILED.")
    print("Historical transfers unchanged; new $25 transfer remains owed until verified paid.")
    print("Private export and original evidence are retained outside GitHub:",folder)
    print("Do not re-run the correction.")

if __name__=="__main__":
    main()
