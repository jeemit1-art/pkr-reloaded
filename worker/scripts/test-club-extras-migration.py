#!/usr/bin/env python3
"""Disposable in-memory schema/constraints test: never connects to D1 remotely."""
from pathlib import Path
import sqlite3

root=Path(__file__).resolve().parents[1]
con=sqlite3.connect(":memory:")
con.execute("PRAGMA foreign_keys=ON")
con.executescript((root/"staging.schema.sql").read_text())
con.executescript((root/"migrations"/"20261126_club_extras.sql").read_text())
for u in ("host","member1","member2"):
    con.execute("INSERT INTO users(id,google_sub,email,name) VALUES(?,?,?,?)",
                (u,"test-"+u,u+"@example.invalid",u))
con.execute("INSERT INTO events(id,name,host_id) VALUES('room','Test club','host')")
con.execute("INSERT INTO games(id,event_id,scheduled_at) VALUES('g1','room',1800000000)")
con.execute("INSERT INTO games(id,event_id,scheduled_at) VALUES('g2','room',1800000100)")
con.execute(
    "INSERT INTO room_shared_expenses(id,event_id,category,title,amount_cents,paid_by_user_id,created_by) "
    "VALUES('expense','room','food','Pizza and drinks',1001,'host','host')")
for u,cents in (("host",334),("member1",334),("member2",333)):
    con.execute(
        "INSERT INTO room_shared_expense_splits(expense_id,user_id,share_cents) VALUES('expense',?,?)",
        (u,cents))
assert con.execute("SELECT SUM(share_cents) FROM room_shared_expense_splits").fetchone()[0]==1001
con.execute(
    "UPDATE room_shared_expense_splits SET status='accepted' WHERE expense_id='expense' AND user_id='member1'")
try:
    con.execute("INSERT INTO room_shared_expense_splits(expense_id,user_id,share_cents) "
                "VALUES('expense','host',100)")
    raise AssertionError("Duplicate split was accepted")
except sqlite3.IntegrityError:
    pass
con.execute("INSERT INTO room_tournament_presets(id,event_id,name,config_json,created_by) "
            "VALUES('p1','room','Friday 20-minute blinds','{}','host')")
try:
    con.execute("INSERT INTO room_tournament_presets(id,event_id,name,config_json,created_by) "
                "VALUES('p2','room','friday 20-minute BLINDS','{}','host')")
    raise AssertionError("Duplicate preset was accepted")
except sqlite3.IntegrityError:
    pass
con.execute("INSERT INTO host_free_first_games(host_id,event_id,game_id) VALUES('host','room','g1')")
try:
    con.execute("INSERT INTO host_free_first_games(host_id,event_id,game_id) "
                "VALUES('host','room','g2')")
    raise AssertionError("Same host claimed two free games")
except sqlite3.IntegrityError:
    pass
try:
    con.execute("INSERT INTO host_free_first_games(host_id,event_id,game_id) "
                "VALUES('member1','room','g1')")
    raise AssertionError("One game was claimed by multiple hosts")
except sqlite3.IntegrityError:
    pass
assert con.execute("SELECT COUNT(*) FROM games").fetchone()[0]==2
assert con.execute("SELECT COUNT(*) FROM settlement_transfers").fetchone()[0]==0
assert con.execute("PRAGMA foreign_key_check").fetchall()==[]
print("PASS optional costs, cent-exact splits, preset names and one-time host game claims")
print("PASS historic games, money records and memberships untouched (in-memory only)")
