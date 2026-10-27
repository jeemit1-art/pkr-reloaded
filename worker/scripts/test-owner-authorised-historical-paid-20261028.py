#!/usr/bin/env python3
"""Offline financial regression for 334/$76,059 owner-directed payments.

All fixture transfer IDs and amounts are synthetic; no Cloudflare credentials.
"""
import importlib.util
import sqlite3
from pathlib import Path

location=Path(__file__).with_name("record-owner-authorised-historical-paid-20261028.py")
spec=importlib.util.spec_from_file_location("pkr_owner_historical",location)
assert spec and spec.loader
m=importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)
assert m.EXPECTED_COUNT==334 and m.EXPECTED_CENTS==7605900

def db():
    c=sqlite3.connect(":memory:")
    c.executescript("""CREATE TABLE settlement_transfers (
      id TEXT PRIMARY KEY,game_id TEXT,from_user TEXT,to_user TEXT,
      amount INTEGER,status TEXT,paid_at INTEGER,last_reminded_at INTEGER
    );
    CREATE TABLE settlement_confirmation_events (
      id TEXT PRIMARY KEY,game_id TEXT,transfer_id TEXT,actor_id TEXT,
      action TEXT,previous_status TEXT,new_status TEXT,created_at INTEGER
    );""")
    rows=[(f"historical-{i:04d}","synthetic-game","payer","recipient",
           1000 if i<333 else 7605900-(333*1000),"legacy",None,None)
          for i in range(334)]
    rows.extend([("already-paid","synthetic-game","payer","recipient",5000,"paid",None,None),
                 ("still-owed","synthetic-game","payer","recipient",20000,"owed",None,None)])
    c.executemany("INSERT INTO settlement_transfers VALUES(?,?,?,?,?,?,?,?)",rows)
    c.commit()
    return c

def selected(c):
    names=["id","game_id","from_user","to_user","amount"]
    return [dict(zip(names,row)) for row in c.execute(
      "SELECT id,game_id,from_user,to_user,amount FROM settlement_transfers "
      "WHERE status='legacy' ORDER BY id")]

c=db()
rows=selected(c)
assert len(rows)==334 and sum(q["amount"] for q in rows)==7605900
for count,total in [(333,7605900),(334,7605800)]:
    try:
        m.guarded_sql(rows,count,total)
    except m.GuardError:
        pass
    else:
        raise AssertionError("Financial mismatch accepted")
trigger,update,drop=m.guarded_sql(rows,m.EXPECTED_COUNT,m.EXPECTED_CENTS)
c.execute(trigger)
c.execute(update)
assert c.execute("SELECT COUNT(*) FROM settlement_transfers WHERE status='legacy'").fetchone()[0]==0
assert c.execute("SELECT COUNT(*) FROM settlement_transfers WHERE status='paid'").fetchone()[0]==335
assert c.execute("SELECT COUNT(*) FROM settlement_confirmation_events WHERE actor_id=? AND action=?",
                 (m.ACTOR,m.ACTION)).fetchone()[0]==334
assert c.execute("SELECT COALESCE(SUM(amount),0) FROM settlement_transfers WHERE status='paid'").fetchone()[0]==7610900
assert c.execute("SELECT status,amount FROM settlement_transfers WHERE id='still-owed'").fetchone()==("owed",20000)
c.execute(update)
assert c.execute("SELECT COUNT(*) FROM settlement_confirmation_events").fetchone()[0]==334
c.execute(drop)
c.close()

for dirty in [
    "UPDATE settlement_transfers SET amount=amount+1 WHERE id='historical-0000'",
    "UPDATE settlement_transfers SET to_user='other' WHERE id='historical-0000'",
    "UPDATE settlement_transfers SET status='owed' WHERE id='historical-0000'",
    "INSERT INTO settlement_transfers VALUES('new-extra','synthetic-game','payer','recipient',1,'legacy',NULL,NULL)",
]:
    c=db()
    trig,upd,clean=m.guarded_sql(selected(c),334,7605900)
    c.execute(dirty)
    c.execute(trig)
    c.execute(upd)
    assert c.execute("SELECT COUNT(*) FROM settlement_confirmation_events").fetchone()[0]==0
    assert c.execute("SELECT COUNT(*) FROM settlement_transfers WHERE status='paid'").fetchone()[0]==1
    c.execute(clean)
    c.close()

c=db();trig,upd,clean=m.guarded_sql(selected(c),334,7605900);c.execute(trig)
c.execute("""CREATE TRIGGER deny_synthetic_audit
  BEFORE INSERT ON settlement_confirmation_events
  WHEN NEW.transfer_id='historical-0200'
  BEGIN SELECT RAISE(ABORT,'synthetic rollback'); END""")
try:
    c.execute(upd)
except sqlite3.IntegrityError:
    pass
else:
    raise AssertionError("Audit failure was not atomic")
assert c.execute("SELECT COUNT(*) FROM settlement_transfers WHERE status='legacy'").fetchone()[0]==334
assert c.execute("SELECT COUNT(*) FROM settlement_confirmation_events").fetchone()[0]==0
print("PASS: 334/$76,059 owner audit, unchanged monetary totals, concurrency guards, idempotence and rollback")
