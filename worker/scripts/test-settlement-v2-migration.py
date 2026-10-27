#!/usr/bin/env python3
"""Disposable SQLite verification of additive settlement V2 migration only."""
import sqlite3
from pathlib import Path

root=Path(__file__).resolve().parents[1]
schema=(root/"staging.schema.sql").read_text(encoding="utf-8")
base=schema.split("-- Settlement V2 isolated staging fixture.",1)[0]
migration=(root/"migrations/20261027_settlement_v2.sql").read_text(encoding="utf-8")
db=sqlite3.connect(":memory:")
db.execute("PRAGMA foreign_keys=ON")
db.executescript(base)
db.execute("INSERT INTO users(id,google_sub,email,name) VALUES('owner','g-sub','owner@invalid.test','Owner')")
db.execute("INSERT INTO events(id,name,host_id) VALUES('room','Synthetic Room','owner')")
db.execute("INSERT INTO games(id,event_id,scheduled_at,status) VALUES('g1','room',1,'settled')")
db.execute(
  "INSERT INTO settlement_transfers(id,game_id,from_user,to_user,amount,status) VALUES(?,?,?,?,?,?)",
  ("historic","g1","payer","receiver",7523500,"legacy")
)
db.execute(
  "INSERT INTO settlement_transfers(id,game_id,from_user,to_user,amount,status) VALUES(?,?,?,?,?,?)",
  ("current","g1","payer","receiver",7500,"owed")
)
before=db.execute(
  "SELECT id,game_id,amount,status,paid_at FROM settlement_transfers ORDER BY id"
).fetchall()
db.executescript(migration)
db.executescript(migration)  # retrying the migration must be harmless
after=db.execute(
  "SELECT id,game_id,amount,status,paid_at FROM settlement_transfers ORDER BY id"
).fetchall()
assert after==before, "Migration must never alter historical results or statuses"
db.execute("INSERT INTO settlement_notification_settings(game_id,enabled,reminders_enabled) VALUES('g1',1,1)")
db.execute(
  "INSERT INTO settlement_confirmation_events(id,game_id,transfer_id,actor_id,action) VALUES(?,?,?,?,?)",
  ("audit1","g1","current","owner","recipient_received")
)
assert db.execute("PRAGMA foreign_key_check").fetchall()==[], "Migration introduced broken foreign keys"
assert db.execute("SELECT COUNT(*) FROM settlement_confirmation_events").fetchone()[0]==1
assert db.execute("SELECT reminders_enabled FROM settlement_notification_settings WHERE game_id='g1'").fetchone()[0]==1
print("PASS additive settlement V2 migration idempotent; historical $75,235 remains unmodified and auditable")
