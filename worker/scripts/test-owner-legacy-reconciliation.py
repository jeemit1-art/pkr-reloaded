#!/usr/bin/env python3
"""Dry-run ALL-legacy-to-paid request against an empty disposable SQLite DB.

This NEVER uses Wrangler, remote Cloudflare, production credentials or data.
The test ensures original money/results survive, while reclassification audit
is complete and idempotent (the owner instructs PKR to mark legacy paid).
"""
import sqlite3
from pathlib import Path

root=Path(__file__).resolve().parents[1]
schema=(root/"staging.schema.sql").read_text(encoding="utf-8")
original=schema.split("-- Settlement V2 isolated staging fixture.",1)[0]
additive=(root/"migrations/20261027_settlement_v2.sql").read_text(encoding="utf-8")
reclassification=(root/"migrations/20261027_owner_mark_legacy_paid.sql").read_text(encoding="utf-8")
db=sqlite3.connect(":memory:")
db.execute("PRAGMA foreign_keys=ON")
db.executescript(original)
db.execute("INSERT INTO users(id,google_sub,email,name) VALUES('owner','g-sub','owner@invalid.test','Owner')")
db.execute("INSERT INTO events(id,name,host_id) VALUES('room','Synthetic Room','owner')")
db.execute("INSERT INTO games(id,event_id,scheduled_at,status) VALUES('g1','room',1,'settled')")
rows=[
 ("legacy-1","g1","payer-1","receiver-1","Payer A","Receiver A",7523400,"legacy",None),
 ("legacy-2","g1","payer-2","receiver-2","Payer B","Receiver B",100,"legacy",None),
 ("other-owed","g1","payer-3","receiver-3","Payer C","Receiver C",7500,"owed",None),
 ("other-paid","g1","payer-4","receiver-4","Payer D","Receiver D",300,"paid",123456789),
]
db.executemany("""
 INSERT INTO settlement_transfers
 (id,game_id,from_user,to_user,from_name,to_name,amount,status,paid_at)
 VALUES(?,?,?,?,?,?,?,?,?)
""",rows)
db.executescript(additive)
before=db.execute("""
 SELECT id,game_id,from_user,to_user,from_name,to_name,amount
 FROM settlement_transfers ORDER BY id
""").fetchall()
db.executescript(reclassification)
after=db.execute("""
 SELECT id,game_id,from_user,to_user,from_name,to_name,amount
 FROM settlement_transfers ORDER BY id
""").fetchall()
assert before==after,"Financial and participant details were unexpectedly changed"
assert db.execute("SELECT COUNT(*) FROM settlement_transfers WHERE status='legacy'").fetchone()[0]==0
assert db.execute("SELECT SUM(amount) FROM settlement_transfers WHERE status='paid'").fetchone()[0]==7523800
assert db.execute("SELECT paid_at FROM settlement_transfers WHERE id='other-paid'").fetchone()[0]==123456789
assert db.execute("SELECT status FROM settlement_transfers WHERE id='other-owed'").fetchone()[0]=='owed'
audit=db.execute("""
 SELECT a.transfer_id,a.previous_status,a.new_status,a.action,t.amount
 FROM settlement_confirmation_events a
 JOIN settlement_transfers t ON t.id=a.transfer_id
 ORDER BY a.transfer_id
""").fetchall()
assert len(audit)==2,audit
assert sum(x[4] for x in audit)==7523500,audit
assert all(x[1]=='legacy' and x[2]=='paid' and 'without_recipient_confirmation' in x[3] for x in audit)
db.executescript(reclassification)
assert db.execute("SELECT COUNT(*) FROM settlement_confirmation_events").fetchone()[0]==2,"Duplicate audit on retry"
assert db.execute("PRAGMA foreign_key_check").fetchall()==[],"Broken foreign keys"
print("PASS: $75,235 synthetic legacy balances administratively marked paid, "
      "two audit rows, all other transfers intact; safe idempotent retry. "
      "NO production D1 connection.")
