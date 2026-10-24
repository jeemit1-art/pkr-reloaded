#!/usr/bin/env python3
"""Only uses disposable, in-memory SQLite. Never accesses Cloudflare."""
from pathlib import Path
import sqlite3
root = Path(__file__).resolve().parents[1]
schema = (root / "staging.schema.sql").read_text(encoding="utf-8")
migration = (root / "migrations/20261024_staging_integrity.sql").read_text(
    encoding="utf-8"
)
db = sqlite3.connect(":memory:")
db.execute("PRAGMA foreign_keys=ON")
db.executescript(schema)
db.execute("INSERT INTO users(id,google_sub,email,name) VALUES(?,?,?,?)",
           ("u","synthetic-sub","synthetic@example.invalid","Test User"))
db.execute("INSERT INTO events(id,name,host_id) VALUES(?,?,?)",
           ("e","Synthetic Event","u"))
db.execute("INSERT INTO games(id,event_id,scheduled_at) VALUES(?,?,?)",
           ("g","e",123))
db.execute("INSERT INTO game_players(game_id,user_id,display_name,buy_ins,buy_in_total) "
           "VALUES(?,?,?,?,?)",("g","u","Alex",0,0))
db.execute("INSERT INTO game_players(game_id,user_id,display_name,buy_ins,buy_in_total) "
           "VALUES(?,?,?,?,?)",("g","guest","Ben",0,0))
db.execute("INSERT INTO hands(id,game_id,hand_no,mode) VALUES(?,?,?,?)",
           ("h","g",1,"full"))
db.executescript(migration)
assert db.execute("SELECT revision FROM game_player_revisions WHERE game_id='g' AND user_id='u'").fetchone()==(0,)
db.execute("UPDATE game_players SET buy_ins=1,buy_in_total=2000 WHERE game_id='g' AND user_id='u'")
assert db.execute("SELECT revision FROM game_player_revisions WHERE game_id='g' AND user_id='u'").fetchone()==(1,)
db.execute("UPDATE game_players SET buy_ins=1,buy_in_total=2000 WHERE game_id='g' AND user_id='u'")
assert db.execute("SELECT COUNT(*) FROM game_financial_audit").fetchone()[0]==1
db.execute("UPDATE game_players SET seat_number=2 WHERE game_id='g' AND user_id='u'")
assert db.execute("SELECT revision FROM game_player_revisions WHERE game_id='g' AND user_id='u'").fetchone()==(2,)
assert db.execute("SELECT COUNT(*) FROM game_financial_audit").fetchone()[0]==2
for user,name,seat,chips in [
    ("u","Alex",1,500),("guest","Ben",2,300)
]:
    db.execute("INSERT INTO hand_stack_baselines("
               "hand_id,game_id,user_id,display_name,seat_number,opening_chips,verified_by"
               ") VALUES(?,?,?,?,?,?,?)",("h","g",user,name,seat,chips,"u"))
try:
    db.execute("INSERT INTO hand_stack_baselines("
               "hand_id,game_id,user_id,display_name,seat_number,opening_chips,verified_by"
               ") VALUES(?,?,?,?,?,?,?)",("h","g","other","Charlie",1,1,"u"))
    raise AssertionError("Duplicate seat was accepted")
except sqlite3.IntegrityError:
    pass
db.executescript(migration)
assert db.execute("SELECT revision FROM game_player_revisions WHERE game_id='g' AND user_id='u'").fetchone()==(2,)
assert db.execute("SELECT COUNT(*) FROM game_financial_audit").fetchone()[0]==2
assert db.execute("SELECT COUNT(*) FROM hand_stack_baselines").fetchone()[0]==2
print("PASS: disposable SQLite migration, revisions, audited old/new changes, and verified stacks")
