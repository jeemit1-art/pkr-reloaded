#!/usr/bin/env python3
"""Offline tests for guarded production V2 backup/replay helper.

No Cloudflare credentials, production API or personal records are accessed.
"""
from __future__ import annotations
import importlib.util
import sqlite3
import tempfile
from pathlib import Path

worker=Path(__file__).resolve().parents[1]
script=worker/"scripts/deploy-settlement-v2-live.py"
spec=importlib.util.spec_from_file_location("settlement_v2_release",script)
assert spec and spec.loader
release=importlib.util.module_from_spec(spec)
spec.loader.exec_module(release)

schema=(worker/"staging.schema.sql").read_text(encoding="utf-8")
base=schema.split("-- Settlement V2 isolated staging fixture.",1)[0]
migration=(worker/"migrations/20261027_settlement_v2.sql").read_text(encoding="utf-8")

con=sqlite3.connect(":memory:")
con.executescript(base)
con.execute("INSERT INTO users(id,google_sub,email,name) VALUES('owner','g','synthetic@invalid.test','Demo')")
con.execute("INSERT INTO events(id,name,host_id) VALUES('test-room','Demo','owner')")
con.execute("INSERT INTO games(id,event_id,scheduled_at,status) VALUES('g1','test-room',1,'settled')")
for row in (
    ("legacy1","g1","p1","p2",7523500,"legacy"),
    ("owed1","g1","p1","p2",7500,"owed"),
):
    con.execute(
        "INSERT INTO settlement_transfers(id,game_id,from_user,to_user,amount,status) VALUES(?,?,?,?,?,?)",
        row,
    )
con.commit()
baseline=(1,0,2,7531000,1,7523500)
assert tuple(con.execute(release.AGG_SQL).fetchone())==baseline

with tempfile.TemporaryDirectory(prefix="pkr-v2-synthetic-") as folder:
    backup=Path(folder)/"synthetic.sql"
    backup.write_text("\n".join(con.iterdump()),encoding="utf-8")
    release.verify_copy(backup,baseline,migration)
    try:
        release.verify_copy(backup,(1,0,2,1000,1,7523500),migration)
    except release.Stop as e:
        assert "differ" in str(e)
    else:
        raise AssertionError("Release backup validator accepted incorrect financial totals")
con.close()
print("PASS production V2 helper rehearses additive schema and refuses inaccurate backups")
