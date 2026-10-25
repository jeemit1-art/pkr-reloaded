#!/usr/bin/env python3
"""Synthetic SQLite verification for isolated RSVP migration; never uses remote D1."""
import sqlite3
from pathlib import Path

root = Path(__file__).resolve().parents[1]
migration = (root / "migrations/20261025_staging_rsvp_board.sql").read_text()
conn = sqlite3.connect(":memory:")
conn.execute("PRAGMA foreign_keys = ON")
conn.executescript("""
CREATE TABLE games(id TEXT PRIMARY KEY);
INSERT INTO games(id) VALUES ('fixture');
""")
conn.executescript(migration)
conn.executescript(migration)
def add(ident, name, status, arrival, seat):
    conn.execute(
        "INSERT INTO game_rsvp_guests"
        "(id,game_id,display_name,status,arrival_option,seat_number,edit_token_hash)"
        " VALUES(?,?,?,?,?,?,?)",
        (ident, "fixture", name, status, arrival, seat, "hash-"+ident)
    )
def blocked(fn):
    try:
        fn()
    except sqlite3.IntegrityError:
        return
    raise AssertionError("Constraint should have rejected unsafe RSVP")

add("a","Fictional Alice","yes","19:00",1)
blocked(lambda:add("b","Fictional Bob","yes","20:00",1))
blocked(lambda:add("c","fictional alice","yes","20:00",2))
blocked(lambda:add("d","Fictional Cara","no","not-coming",3))
blocked(lambda:add("e","Fictional Dan","yes","19:00",16))
add("f","Fictional Fred","no","not-coming",None)
add("g","Fictional Gia","yes","late",None)
conn.execute("UPDATE game_rsvp_guests SET status='no',arrival_option='not-coming',seat_number=NULL WHERE id='a'")
add("h","Fictional Harry","yes","20:00",1)
assert conn.execute("SELECT COUNT(*) FROM game_rsvp_guests").fetchone()[0] == 4
assert conn.execute("SELECT COUNT(*) FROM game_rsvp_guests WHERE seat_number=1").fetchone()[0] == 1
print("PASS: idempotent migration, no duplicate names, unique reserved seats, safe not-coming and seat release")
