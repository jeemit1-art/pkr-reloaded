#!/usr/bin/env python3
"""Purely synthetic, offline regression of read-only PKR financial exception inventory."""
from pathlib import Path
import sqlite3

sql = Path(__file__).with_name("settlement-exceptions-readonly.sql").read_text("utf-8")
# Do not allow a real-data write pathway in this reporting script.
statements = [part.strip() for part in sql.split(";") if part.strip()]
assert len(statements) == 1, "Inventory must contain precisely one SELECT statement"
assert statements[0].split("WITH settled_players AS (", 1)[-1] != statements[0]
db = sqlite3.connect(":memory:")
db.executescript("""
CREATE TABLE events (id TEXT PRIMARY KEY, buy_in INTEGER);
CREATE TABLE games (id TEXT PRIMARY KEY, event_id TEXT, status TEXT);
CREATE TABLE game_players (
 game_id TEXT, user_id TEXT, net INTEGER, cashout INTEGER,
 buy_ins INTEGER, buy_in_total INTEGER
);
CREATE TABLE settlement_transfers (game_id TEXT, amount INTEGER);
CREATE TABLE game_player_revisions (game_id TEXT, user_id TEXT);
INSERT INTO events VALUES ('e1',5000);
INSERT INTO games VALUES ('g1','e1','settled');
INSERT INTO games VALUES ('g2','e1','settled');
INSERT INTO games VALUES ('g3','e1','settled');
INSERT INTO games VALUES ('g4','e1','active');
-- A valid legacy parcel: zero total means use 2 x 5000, not zero.
INSERT INTO game_players VALUES ('g1','alice',5000,15000,2,0);
INSERT INTO game_players VALUES ('g1','bob',-5000,0,1,5000);
-- A genuine net-component difference on a settled game.
INSERT INTO game_players VALUES ('g2','carol',500,6000,1,5000);
-- Incomplete saved player: distinguish from calculation mismatch.
INSERT INTO game_players VALUES ('g2','dana',NULL,NULL,1,5000);
-- Active game: do not count as a settled exception.
INSERT INTO game_players VALUES ('g4','eli',999,10000,1,5000);
INSERT INTO game_player_revisions VALUES ('g1','alice');
INSERT INTO game_player_revisions VALUES ('g1','bob');
INSERT INTO game_player_revisions VALUES ('g2','carol');
INSERT INTO settlement_transfers VALUES ('g1',5000);
INSERT INTO settlement_transfers VALUES ('g2',0);
""")
db.execute("PRAGMA query_only=ON")
def inventory():
    cursor = db.execute(sql)
    row = cursor.fetchone()
    assert row is not None and cursor.fetchone() is None
    names = [item[0] for item in cursor.description]
    assert len(names) == 8 and all(type(value) is int for value in row)
    return dict(zip(names, row))

expected = {
 "settled_player_records":4,
 "settled_incomplete_players":1,
 "settled_effective_net_exceptions":1,
 "settled_nonzero_net_games":1,
 "settled_nonzero_games_with_incomplete_players":1,
 "settled_games_without_transfer_rows":1,
 "missing_player_revision_records":2,
 "nonpositive_transfer_rows":1,
}
actual = inventory()
assert actual == expected, (actual,expected)
# Enforce the reporting-only contract, with SQLite itself blocking writes.
assert db.execute("PRAGMA query_only").fetchone()[0] == 1
db.close()
print("PASS synthetic settlement exception audit: read-only, effective buy-in, incomplete records, game balance and aggregate counts")
