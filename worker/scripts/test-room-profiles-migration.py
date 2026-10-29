#!/usr/bin/env python3
"""Room profile migration rehearsal in disposable SQLite. No Cloudflare calls."""
import sqlite3
from pathlib import Path

root = Path(__file__).resolve().parents[1]
schema = (root / "staging.schema.sql").read_text(encoding="utf-8")
migration = (root / "migrations/20261029_room_player_profiles.sql").read_text(encoding="utf-8")
db = sqlite3.connect(":memory:")
db.execute("PRAGMA foreign_keys=ON")
db.executescript(schema)
db.executescript(migration)
db.executescript(migration)  # Idempotent, not destructive.
db.execute("INSERT INTO users(id,google_sub,email,name) VALUES(?,?,?,?)",
           ("host","synthetic-sub","test@example.invalid","Test Host"))
for room in ("r1","r2"):
    db.execute("INSERT INTO events(id,name,host_id,buy_in) VALUES(?,?,?,?)",
               (room,"Synthetic Room "+room,"host",2500))
    db.execute("INSERT INTO event_members(event_id,user_id,role) VALUES(?,?,?)",
               (room,"host","host"))
db.execute("INSERT INTO games(id,event_id,scheduled_at,status) VALUES(?,?,?,?)",
           ("game","r1",123456,"settled"))
db.execute("INSERT INTO game_players(game_id,user_id,display_name,buy_ins,buy_in_total,cashout,net) "
           "VALUES(?,?,?,?,?,?,?)",("game","host","Test Host",2,5000,11000,6000))
before = db.execute("SELECT buy_ins,buy_in_total,cashout,net FROM game_players WHERE game_id='game'").fetchone()
db.execute("INSERT INTO room_player_profiles(event_id,profile_key,screen_name,avatar_emoji,phone_cipher,preferred_contact,private_notes,updated_by) "
           "VALUES(?,?,?,?,?,?,?,?)",("r1","member:host","Ace","♠️","synthetic-encrypted-mobile-data","whatsapp","Private note","host"))
db.execute("INSERT INTO room_player_profiles(event_id,profile_key,screen_name,updated_by) "
           "VALUES(?,?,?,?)",("r2","member:host","Different room alias","host"))
db.execute("INSERT INTO room_player_profiles(event_id,profile_key,screen_name,updated_by) "
           "VALUES(?,?,?,?) ON CONFLICT(event_id,profile_key) DO UPDATE SET screen_name=excluded.screen_name",
           ("r1","member:host","Updated Ace","host"))
assert db.execute("SELECT screen_name,phone_cipher FROM room_player_profiles WHERE event_id='r1' AND profile_key='member:host'").fetchone()==("Updated Ace","synthetic-encrypted-mobile-data")
assert db.execute("SELECT screen_name FROM room_player_profiles WHERE event_id='r2' AND profile_key='member:host'").fetchone()==("Different room alias",)
assert db.execute("SELECT buy_ins,buy_in_total,cashout,net FROM game_players WHERE game_id='game'").fetchone()==before, "Profile change modified financial record"
db.execute("DELETE FROM events WHERE id='r2'")
assert db.execute("SELECT COUNT(*) FROM room_player_profiles WHERE event_id='r2'").fetchone()[0]==0, "Room profile not removed on room deletion"
assert db.execute("SELECT COUNT(*) FROM room_player_profiles WHERE event_id='r1'").fetchone()[0]==1, "Profile leaked between rooms"
# Exercise the SAME migration rehearsal and schema guard used by production CI.
import importlib.util
spec = importlib.util.spec_from_file_location("pkr_release", root / "scripts/deploy-settlement-v2-production.py")
release = importlib.util.module_from_spec(spec)
spec.loader.exec_module(release)
assert release.rehearse_profile_migration(db) is True
original_query = release.remote_query
try:
    release.remote_query = lambda sql: []
    assert release.profile_schema_state() is False
    release.remote_query = lambda sql: [{"name": "profile_key"}]
    try:
        release.profile_schema_state()
        raise AssertionError("Partial production schema was not rejected")
    except release.Stop:
        pass
    release.remote_query = lambda sql: [{"name": name} for name in sorted(release.PROFILE_COLUMNS)]
    assert release.profile_schema_state() is True
finally:
    release.remote_query = original_query
print("PASS: additive profiles migration, idempotence, room isolation and unchanged financial ledger (in-memory)")
