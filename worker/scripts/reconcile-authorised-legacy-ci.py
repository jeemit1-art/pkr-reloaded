#!/usr/bin/env python3
"""Exact owner-authorised legacy batch, with backup and atomic audit.

Default: no writes. --apply is permitted only for the fixed 326/$75,235 batch.
Never print player identifiers, SQL exports, secret values or query payloads.
"""
import argparse
import importlib.util
import sqlite3
from pathlib import Path

EXPECTED_COUNT = 326
EXPECTED_CENTS = 7523500
ACTOR = 'owner-authorised-2026-10-27'
ACTION = 'owner_marked_legacy_paid_without_recipient_confirmation'
TRIGGER = 'trg_owner_legacy_paid_ci_20261027'


class GuardError(RuntimeError):
    pass


def quoted(value):
    if not isinstance(value, str) or not value or '\x00' in value:
        raise GuardError('Unexpected settlement identity; nothing changed.')
    return "'" + value.replace("'", "''") + "'"


def guarded_sql(rows, expected_count, expected_cents):
    if len(rows) != expected_count or len({r['id'] for r in rows}) != expected_count:
        raise GuardError('Historical transfer count differs from owner authorisation.')
    if any(type(r['amount']) is not int or r['amount'] < 0 for r in rows):
        raise GuardError('Historical amounts must be nonnegative integer cents.')
    if sum(r['amount'] for r in rows) != expected_cents:
        raise GuardError('Historical total differs from owner authorisation.')
    values = ','.join('(' + ','.join([
        quoted(r['id']), quoted(r['game_id']), quoted(r['from_user']),
        quoted(r['to_user']), str(r['amount']),
    ]) + ')' for r in rows)
    ids = ','.join(quoted(r['id']) for r in rows)
    trigger = f"""CREATE TRIGGER {TRIGGER}
AFTER UPDATE OF status ON settlement_transfers
WHEN OLD.status='legacy' AND NEW.status='paid' AND OLD.id IN ({ids})
BEGIN
 INSERT INTO settlement_confirmation_events
 (id,game_id,transfer_id,actor_id,action,previous_status,new_status,created_at)
 VALUES(lower(hex(randomblob(16))),NEW.game_id,NEW.id,
 '{ACTOR}','{ACTION}',OLD.status,NEW.status,unixepoch());
END;"""
    # The eligibility snapshot is materialised once, BEFORE any row is updated.
    # One UPDATE and its audit triggers commit together, or all roll back.
    update = f"""WITH selected(id,game_id,from_user,to_user,amount) AS (VALUES {values}),
eligible AS MATERIALIZED (
 SELECT COUNT(*) AS n,COALESCE(SUM(t.amount),0) AS cents
 FROM settlement_transfers t JOIN selected s ON t.id=s.id
 AND t.game_id=s.game_id AND t.from_user=s.from_user
 AND t.to_user=s.to_user AND t.amount=s.amount
 WHERE t.status='legacy'
), inventory AS MATERIALIZED (
 SELECT COUNT(*) AS n FROM settlement_transfers WHERE status='legacy'
)
UPDATE settlement_transfers
SET status='paid',paid_at=COALESCE(paid_at,unixepoch()),last_reminded_at=NULL
WHERE status='legacy' AND id IN (SELECT id FROM selected)
 AND (SELECT n FROM eligible)={expected_count}
 AND (SELECT cents FROM eligible)={expected_cents}
 AND (SELECT n FROM inventory)={expected_count};"""
    return trigger, update, f'DROP TRIGGER IF EXISTS {TRIGGER};'


def release_module():
    path = Path(__file__).with_name('deploy-settlement-v2-production.py')
    spec = importlib.util.spec_from_file_location('pkr_production_release', path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--apply', action='store_true')
    args = parser.parse_args()
    release = release_module()
    release.verify_target()
    release.verify_schema()
    query = release.remote_query
    rows = query("SELECT id,game_id,from_user,to_user,amount FROM settlement_transfers WHERE status='legacy' ORDER BY id")
    if not rows:
        print('No legacy statuses remain. No records changed.')
        return
    trigger, update, cleanup = guarded_sql(rows, EXPECTED_COUNT, EXPECTED_CENTS)
    prior = query(f"SELECT COUNT(*) AS n FROM settlement_confirmation_events WHERE actor_id='{ACTOR}' AND action='{ACTION}'")
    if len(prior) != 1 or prior[0]['n'] != 0:
        raise GuardError('Prior owner audit already exists; review before changing further records.')
    if not args.apply:
        print('Authorised count/amount match. READ ONLY; no statuses changed.')
        return
    # Captures a Cloudflare Time Travel restore bookmark and privately exports
    # and independently restores all D1 data. No SQL artifact is uploaded.
    before = release.preflight_backup()
    if before['settlement_transfers'][2] != EXPECTED_COUNT:
        raise GuardError('Historical inventory changed during backup.')
    existing = query(f"SELECT name FROM sqlite_master WHERE type='trigger' AND name='{TRIGGER}'")
    if existing:
        raise GuardError('A previous reconciliation trigger exists; inspect before retrying.')
    query(trigger)
    try:
        query(update)
    finally:
        query(cleanup)
    audit = query(f"SELECT COUNT(*) AS n,COALESCE(SUM(t.amount),0) AS cents "
                  f"FROM settlement_confirmation_events a JOIN settlement_transfers t ON t.id=a.transfer_id "
                  f"WHERE a.actor_id='{ACTOR}' AND a.action='{ACTION}' AND t.status='paid'")
    after = {table: release.aggregate(table) for table in before}
    if len(audit) != 1 or (audit[0]['n'], audit[0]['cents']) != (EXPECTED_COUNT, EXPECTED_CENTS):
        raise GuardError('Reconciliation audit mismatch. Stop and review; do not repeat a blind update.')
    if after['settlement_transfers'] != (before['settlement_transfers'][0], before['settlement_transfers'][1], 0):
        raise GuardError('Transfer totals or remaining legacy count did not reconcile.')
    if after['game_players'] != before['game_players']:
        raise GuardError('Game-player financial totals changed; review the private backup.')
    print('PASS: 326 historical transfers totalling $75,235 administratively recorded paid; 326 audit entries.')
    print('No monetary amounts or game results changed. Owner-directed recording, NOT recipient confirmation.')


if __name__ == '__main__':
    try:
        main()
    except GuardError as exc:
        print('STOP:', exc)
        raise SystemExit(1)
    except Exception:
        # Avoid dumping remote response bodies, identifiers or credentials.
        print('STOP: Authorised legacy reconciliation did not complete. Check the failed stage; never bypass the guards.')
        raise SystemExit(1)
