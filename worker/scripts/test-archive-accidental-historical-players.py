#!/usr/bin/env python3
"""Offline-only tests: no Cloudflare credentials, D1 writes or real players."""
import importlib.util
from pathlib import Path

script=Path(__file__).with_name("archive-accidental-historical-players.py")
spec=importlib.util.spec_from_file_location("pkr_archive_test",script)
mod=importlib.util.module_from_spec(spec)
spec.loader.exec_module(mod)

def fake_query(sql):
    if "SELECT e.id FROM events e" in sql:return [{"id":"synthetic-room"}]
    if "FROM game_players gp JOIN games g" in sql:
        assert "LOWER(TRIM(gp.display_name)) IN ('test','test1')" in sql
        return [{"name":"test","n":1,"games":1},{"name":"test1","n":1,"games":1}]
    if "JOIN users u ON u.id=em.user_id" in sql:return [{"n":0}]
    raise AssertionError("Unexpected SQL")

def read_apply(seed=()):
    store={mod.PREFIX+"synthetic-room":sorted(seed)}
    written=[]
    before=("440 results", "0 change")
    def get(key):return store.get(key,[])
    def put(key,value):
        import json
        store[key]=json.loads(value)["names"]
        written.append(key)
    result=mod.apply(fake_query,get,put,lambda:before)
    return result,written,store
r,w,_=read_apply()
assert r["archived"]==2 and r["financial_aggregates_unchanged"]
assert len(w)==1
r,w,st=read_apply(["other-player","test"])
assert len(w)==1 and st[mod.PREFIX+"synthetic-room"]==["other-player","test","test1"]
r,w,_=read_apply(["test","test1"])
assert r["already_archived"] is True and w==[]

def fail_query(q):
    if "SELECT e.id FROM events e" in q:
        return [{"id":"one-room"},{"id":"other-room"}]
    return fake_query(q)
try: mod.plan_archive(fail_query);assert False
except mod.Stop:pass

def fail_member(q):
    if "JOIN users u ON u.id=em.user_id" in q:return [{"n":1}]
    return fake_query(q)
try: mod.plan_archive(fail_member);assert False
except mod.Stop:pass

def fail_missing(q):
    if "FROM game_players gp JOIN games g" in q:
        return [{"name":"test","n":1,"games":1}]
    return fake_query(q)
try: mod.plan_archive(fail_missing);assert False
except mod.Stop:pass

print("PASS: exactly two historical names, idempotent KV-only archive, no cross-room/approved member operations.")

