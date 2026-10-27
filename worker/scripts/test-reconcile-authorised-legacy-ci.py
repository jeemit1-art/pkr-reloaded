#!/usr/bin/env python3
"""Offline proof of the exact-batch update/audit; no remote access."""
import importlib.util
import sqlite3
from pathlib import Path
spec=importlib.util.spec_from_file_location('legacy_ci',Path(__file__).with_name('reconcile-authorised-legacy-ci.py'))
m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)

def db():
    c=sqlite3.connect(':memory:')
    c.executescript('''CREATE TABLE settlement_transfers(id TEXT PRIMARY KEY,game_id TEXT,from_user TEXT,to_user TEXT,amount INTEGER,status TEXT,paid_at INTEGER,last_reminded_at INTEGER);
CREATE TABLE settlement_confirmation_events(id TEXT PRIMARY KEY,game_id TEXT,transfer_id TEXT,actor_id TEXT,action TEXT,previous_status TEXT,new_status TEXT,created_at INTEGER);''')
    c.executemany('INSERT INTO settlement_transfers VALUES(?,?,?,?,?,?,NULL,NULL)',[
        ('a','g','p','r',7523000,'legacy'),('b','g','p','r',500,'legacy'),('live','g','p','r',100,'owed')])
    c.commit();return c

def rows(c):
    names=['id','game_id','from_user','to_user','amount']
    return [dict(zip(names,r)) for r in c.execute("SELECT id,game_id,from_user,to_user,amount FROM settlement_transfers WHERE status='legacy' ORDER BY id")]

c=db();r=rows(c)
for count,amount in [(3,7523500),(2,7523501)]:
    try:m.guarded_sql(r,count,amount)
    except m.GuardError:pass
    else:raise AssertionError('Mismatch accepted')
a,b,d=m.guarded_sql(r,2,7523500)
c.execute(a);c.execute(b)
assert c.execute("SELECT COUNT(*) FROM settlement_transfers WHERE status='paid'").fetchone()[0]==2
assert c.execute('SELECT COUNT(*) FROM settlement_confirmation_events').fetchone()[0]==2
assert c.execute("SELECT status,amount FROM settlement_transfers WHERE id='live'").fetchone()==('owed',100)
c.execute(b)
assert c.execute('SELECT COUNT(*) FROM settlement_confirmation_events').fetchone()[0]==2
c.execute(d);c.close()

# Concurrent identity, amount, status and inventory changes must cause zero writes.
for change in ["UPDATE settlement_transfers SET to_user='other' WHERE id='a'",
               "UPDATE settlement_transfers SET amount=amount+1 WHERE id='a'",
               "UPDATE settlement_transfers SET status='owed' WHERE id='a'",
               "INSERT INTO settlement_transfers VALUES('new','g','p','r',5,'legacy',NULL,NULL)"]:
    c=db();a,b,d=m.guarded_sql(rows(c),2,7523500);c.execute(change);c.execute(a);c.execute(b)
    assert c.execute('SELECT COUNT(*) FROM settlement_confirmation_events').fetchone()[0]==0
    assert c.execute("SELECT COUNT(*) FROM settlement_transfers WHERE status='paid'").fetchone()[0]==0
    c.close()

# Any audit insert failure rolls back ALL payment status changes in the UPDATE.
c=db();a,b,d=m.guarded_sql(rows(c),2,7523500);c.execute(a)
c.execute("CREATE TRIGGER reject_audit BEFORE INSERT ON settlement_confirmation_events WHEN NEW.transfer_id='b' BEGIN SELECT RAISE(ABORT,'synthetic audit failure'); END")
try:c.execute(b)
except sqlite3.IntegrityError:pass
else:raise AssertionError('Audit failure ignored')
assert c.execute("SELECT COUNT(*) FROM settlement_transfers WHERE status='legacy'").fetchone()[0]==2
assert c.execute('SELECT COUNT(*) FROM settlement_confirmation_events').fetchone()[0]==0
print('PASS: exact count/amount, idempotency, concurrent-change refusal, unrelated records, atomic audit rollback')
