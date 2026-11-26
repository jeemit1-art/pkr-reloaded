#!/usr/bin/env python3
"""Exercise additive club-engagement migration only in disposable SQLite.
Never connects to Cloudflare, Vercel or production data.
"""
from pathlib import Path
import sqlite3

root = Path(__file__).resolve().parents[1]
db = sqlite3.connect(":memory:")
db.execute("PRAGMA foreign_keys=ON")
db.executescript((root/"schema.sql").read_text())
db.executescript((root/"migrations"/"20261126_club_planning.sql").read_text())
for uid in ("host","alice","bob"):
    db.execute(
        "INSERT INTO users(id,google_sub,email,name) VALUES(?,?,?,?)",
        (uid, "google-"+uid, uid+"@example.invalid", uid.title()))
db.execute("INSERT INTO events(id,name,host_id) VALUES('room','Demo Room','host')")
db.execute(
    "INSERT INTO games(id,event_id,scheduled_at,status) VALUES('game','room',1800000000,'scheduled')")
db.execute(
    "INSERT INTO room_date_polls(id,event_id,title,options_json,closes_at,created_by) "
    "VALUES('poll','room','Choose a date','[1800000001,1800000002]',1790000000,'host')")
db.execute(
    "INSERT INTO room_date_poll_votes(poll_id,user_id,option_index) VALUES('poll','alice',1)")
db.execute(
    "UPDATE room_date_poll_votes SET option_index=0 WHERE poll_id='poll' AND user_id='alice'")
assert db.execute("SELECT COUNT(*) FROM room_date_poll_votes").fetchone()[0]==1
try:
    db.execute(
        "INSERT INTO room_date_polls(id,event_id,title,options_json,closes_at,created_by) "
        "VALUES('p2','room','Another date','[1800000001,1800000002]',1790000000,'host')")
    raise AssertionError("Open poll uniqueness not enforced")
except sqlite3.IntegrityError:
    pass
db.execute("UPDATE room_date_polls SET status='closed' WHERE id='poll'")
db.execute(
    "INSERT INTO room_date_polls(id,event_id,title,options_json,closes_at,created_by) "
    "VALUES('p2','room','Another date','[1800000001,1800000002]',1790000000,'host')")
for uid in ("alice","bob"):
    db.execute("INSERT INTO game_waitlist(game_id,user_id) VALUES('game',?)",(uid,))
db.execute("UPDATE game_waitlist SET status='offered' WHERE game_id='game' AND user_id='alice'")
try:
    db.execute("UPDATE game_waitlist SET status='offered' WHERE game_id='game' AND user_id='bob'")
    raise AssertionError("Concurrent active offers were not constrained")
except sqlite3.IntegrityError:
    pass
db.execute("UPDATE game_waitlist SET status='claimed' WHERE user_id='alice'")
db.execute("UPDATE game_waitlist SET status='offered' WHERE user_id='bob'")
db.execute(
    "INSERT INTO game_member_requests(id,game_id,user_id,kind) "
    "VALUES('request1','game','alice','buyin')")
try:
    db.execute(
        "INSERT INTO game_member_requests(id,game_id,user_id,kind) "
        "VALUES('request2','game','alice','buyin')")
    raise AssertionError("Duplicate pending financial request not blocked")
except sqlite3.IntegrityError:
    pass
db.execute("UPDATE game_member_requests SET status='approved' WHERE id='request1'")
db.execute(
    "INSERT INTO game_member_requests(id,game_id,user_id,kind) "
    "VALUES('request2','game','alice','buyin')")
db.execute(
    "INSERT INTO room_league_seasons(id,event_id,name,starts_at,ends_at,created_by) "
    "VALUES('season','room','Spring League',1790000000,1800000000,'host')")
try:
    db.execute(
        "INSERT INTO room_league_seasons(id,event_id,name,starts_at,ends_at,created_by) "
        "VALUES('bad','room','Invalid',1800000000,1790000000,'host')")
    raise AssertionError("Reverse season date constraints not enforced")
except sqlite3.IntegrityError:
    pass
assert db.execute("PRAGMA foreign_key_check").fetchall()==[]
assert db.execute("SELECT COUNT(*) FROM games").fetchone()[0]==1
assert db.execute("SELECT COUNT(*) FROM settlement_transfers").fetchone()[0]==0
print("PASS additive club polls/votes, waitlist offer exclusivity, request dedup, season constraints")
print("PASS existing game and settlement records unchanged; disposable in-memory database only")
