#!/usr/bin/env python3
"""Synthetic-only tests for the owner's 28 October all-historical instruction."""
import importlib.util
import sqlite3
from pathlib import Path

spec = importlib.util.spec_from_file_location('owner_paid', Path(__file__).with_name('record-owner-authorised-historical-paid-20261028.py'))
assert spec and spec.loader
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)
assert (m.EXPECTED_COUNT, m.EXPECTED_CENTS) == (334, 7605900)
assert m.ACTOR == 'owner-authorised-2026-10-28'

def database():
    c = sqlite3.connect(':memory:')
    c.executescript('''
    CREATE TABLE settlement_transfers(id TEXT PRIMARY KEY,game_id TEXT,from_user TEXT,to_user TEXT,amount INTEGER,status TEXT,paid_at INTEGER,last_reminded_at INTEGER);
    CREATE TABLE settlement_confirmation_events(id TEXT PRIMARY KEY,game_id TEXT,transfer_id TEXT,actor_id TEXT,action TEXT,previous_status TEXT,new_status TEXT,created_at INTEGER);
    ''')
    items = [(f'h{i:03}', 'g1', 'payer', 'recipient', 100, 'legacy') for i in range(333)]
    items.append(('h333', 'g2', 'payer2', 'recipient2', 7605900 - 33300, 'legacy'))
    items.extend([('owed', 'g3', 'p3', 'r3', 5000, 'owed'), ('paid', 'g3', 'p3', 'r3', 4000, 'paid')])
    c.executemany('INSERT INTO settlement_transfers VALUES(?,?,?,?,?,?,NULL,NULL)', items)
    c.commit()
    return c

def rows(c):
    keys = ('id','game_id','from_user','to_user','amount')
    return [dict(zip(keys, r)) for r in c.execute("SELECT id,game_id,from_user,to_user,amount FROM settlement_transfers WHERE status='legacy' ORDER BY id")]

c = database()
before = c.execute('SELECT COUNT(*),SUM(amount) FROM settlement_transfers').fetchone()
create, update, cleanup = m.guarded_sql(rows(c),334,7605900)
c.execute(create)
c.execute(update)
assert c.execute("SELECT COUNT(*) FROM settlement_transfers WHERE status='legacy'").fetchone()[0] == 0
assert c.execute('SELECT COUNT(*),SUM(amount) FROM settlement_transfers').fetchone() == before
assert c.execute('SELECT COUNT(*) FROM settlement_confirmation_events').fetchone()[0] == 334
assert c.execute("SELECT status,amount FROM settlement_transfers WHERE id='owed'").fetchone() == ('owed',5000)
assert c.execute("SELECT status,amount FROM settlement_transfers WHERE id='paid'").fetchone() == ('paid',4000)
assert c.execute('SELECT DISTINCT actor_id,action FROM settlement_confirmation_events').fetchall() == [(m.ACTOR,m.ACTION)]
c.execute(update)
assert c.execute('SELECT COUNT(*) FROM settlement_confirmation_events').fetchone()[0] == 334
c.execute(cleanup)
c.close()

for change in ["UPDATE settlement_transfers SET to_user='someone-else' WHERE id='h000'", "UPDATE settlement_transfers SET amount=101 WHERE id='h000'", "UPDATE settlement_transfers SET status='owed' WHERE id='h000'", "INSERT INTO settlement_transfers VALUES('new','g','p','r',10,'legacy',NULL,NULL)"]:
    c = database()
    create, update, cleanup = m.guarded_sql(rows(c),334,7605900)
    c.execute(change)
    c.execute(create)
    c.execute(update)
    assert c.execute('SELECT COUNT(*) FROM settlement_confirmation_events').fetchone()[0] == 0
    assert c.execute("SELECT COUNT(*) FROM settlement_transfers WHERE id LIKE 'h%' AND status='paid'").fetchone()[0] == 0
    c.close()

c = database()
create, update, cleanup = m.guarded_sql(rows(c),334,7605900)
c.execute(create)
c.execute("CREATE TRIGGER synthetic_audit_failure BEFORE INSERT ON settlement_confirmation_events WHEN NEW.transfer_id='h332' BEGIN SELECT RAISE(ABORT,'synthetic failure'); END")
try:
    c.execute(update)
except sqlite3.IntegrityError:
    pass
else:
    raise AssertionError('Audit failure did not stop all payment updates')
assert c.execute("SELECT COUNT(*) FROM settlement_transfers WHERE status='legacy'").fetchone()[0] == 334
assert c.execute('SELECT COUNT(*) FROM settlement_confirmation_events').fetchone()[0] == 0
c.close()
print('PASS: 334-record exact batch, per-transfer audit, repeat safety, concurrent-change refusal, atomic rollback and current payments preserved')
