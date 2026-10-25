#!/usr/bin/env python3
"""Offline synthetic 11-game history audit, no Cloudflare credentials or writes."""
import importlib.util
import json
import sqlite3
from pathlib import Path

source=Path(__file__).with_name("activate-live-features.py")
spec=importlib.util.spec_from_file_location("pkr_activation",source)
assert spec and spec.loader
a=importlib.util.module_from_spec(spec)
spec.loader.exec_module(a)

assert a.LEGACY_HAND_CUTOFF_UNIX == 1790812800
hands=(source.parents[1]/"src"/"routes"/"hands.ts").read_text()
assert "LEGACY_HAND_CUTOFF_UNIX=1790812800" in hands

db=sqlite3.connect(":memory:")
db.row_factory=sqlite3.Row
db.executescript("""
CREATE TABLE games(id TEXT PRIMARY KEY,status TEXT NOT NULL,created_at INTEGER);
CREATE TABLE game_players(game_id TEXT,user_id TEXT,created_at INTEGER);
CREATE TABLE hands(id TEXT PRIMARY KEY,game_id TEXT,created_at INTEGER,voided INTEGER);
CREATE TABLE hand_actions(hand_id TEXT,game_id TEXT,created_at INTEGER);
CREATE TABLE hand_results(hand_id TEXT);
CREATE TABLE game_player_revisions(game_id TEXT,user_id TEXT,revision INTEGER);
CREATE TABLE game_financial_audit(game_id TEXT,changed_at INTEGER);
CREATE TABLE group_phone_contacts(id TEXT);
""")
for name in a.OPTIONAL:
    if name not in ("game_player_revisions","game_financial_audit",
                    "group_phone_contacts"):
        db.execute('CREATE TABLE "'+name+'" (id TEXT)')

OLD=1775000000
for i in range(11):
    db.execute("INSERT INTO games(id,status,created_at) VALUES(?,?,?)",
               (f"historic-{i}","active",OLD))
for i,n in enumerate((2,23)):
    hand=f"old-hand-{i}"
    db.execute("INSERT INTO hands VALUES(?,?,?,0)",(hand,f"historic-{i}",OLD))
    db.executemany("INSERT INTO hand_actions VALUES(?,?,?)",
                   [(hand,f"historic-{i}",OLD)]*n)
for i in range(5):
    db.execute("INSERT INTO game_players VALUES(?,?,?)",("historic-0",f"p{i}",OLD))
    db.execute("INSERT INTO game_player_revisions VALUES(?,?,0)",("historic-0",f"p{i}"))

saved_command=a.command

def fake_wrangle(*cmd,cwd=None):
    assert cmd[:6]==("npx","--no-install","wrangler","d1","execute","DB")
    query=cmd[cmd.index("--command")+1]
    row=db.execute(query).fetchone()
    return json.dumps([{"results":[dict(row)],"success":True}])

a.command=fake_wrangle
try:
    result=a.query_control()
    assert result["optional_count"]==10,result
    assert result["active_games"]==11,result
    assert result["legacy_unfinished_hands"]==2,result
    assert result["missing_revisions"]==0,result
    assert not any(result[x] for x in (
        "recent_active_games","recent_hands","recent_actions",
        "recent_players","recent_financial_edits")),result
    a.confirm_safe_activity(result)

    # Future actions must stop release, even against an old game.
    db.execute("INSERT INTO hand_actions VALUES(?,?,?)",
               ("old-hand-0","historic-0",1792000000))
    try:
        a.confirm_safe_activity(a.query_control())
        raise AssertionError("Recent hand action incorrectly authorised")
    except a.Stop:
        pass
    db.execute("DELETE FROM hand_actions WHERE created_at=1792000000")

    # A newly active game must stop the rollout.
    db.execute("INSERT INTO games VALUES('new','active',1792000000)")
    try:
        a.confirm_safe_activity(a.query_control())
        raise AssertionError("New active game incorrectly authorised")
    except a.Stop:
        pass
    db.execute("DELETE FROM games WHERE id='new'")

    # An unexpected third historical hand must stop for review.
    db.execute("INSERT INTO hands VALUES('old-extra','historic-5',?,0)",(OLD,))
    db.execute("INSERT INTO hand_actions VALUES('old-extra','historic-5',?)",(OLD,))
    try:
        a.confirm_safe_activity(a.query_control())
        raise AssertionError("Unexpected legacy hand incorrectly authorised")
    except a.Stop:
        pass
    print("PASS: 11 historical games, 2 old hands accepted; new activity rejected.")
    print("PASS: only in-memory SQLite used; no production data accessed.")
finally:
    a.command=saved_command
    db.close()
