#!/usr/bin/env python3
"""One-off owner-approved hiding of two accidental HISTORICAL roster names.

Only changes a room-scoped Cloudflare KV presentation list, not saved games,
buy-ins, cash-outs, player accounts, rankings, memberships or settlements.
Runs only for a reviewed main commit tagged [archive-test-players].
"""
import importlib.util
import json
import os
import re
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

ROOT=Path(__file__).resolve().parents[1]
ROOM_NAME="friday night poker"
TARGETS=frozenset(("test","test1"))
ACCOUNT="4b4794b983d6966f4207d2ff4fd8c991"
KV_NAMESPACE="35132989116243c6b9a79f7a8151e328"
PREFIX="room-historical-hidden:v1:"
SAFE_ID=re.compile(r"^[a-zA-Z0-9_-]{1,128}$")

class Stop(RuntimeError):
    pass

def release_tools():
    script=ROOT/"scripts"/"deploy-settlement-v2-production.py"
    spec=importlib.util.spec_from_file_location("pkr_release_readonly",script)
    if not spec or not spec.loader:raise Stop("D1 release utility unavailable.")
    module=importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module

def verify_config(release):
    config=(ROOT/"wrangler.toml").read_text()
    if ('id = "'+KV_NAMESPACE+'"') not in config:
        raise Stop("Wrong KV namespace; no archive change attempted.")
    release.verify_target()

def plan_archive(query):
    rooms=query(
        "SELECT e.id FROM events e WHERE LOWER(TRIM(e.name))='"
        +ROOM_NAME+"' AND EXISTS("
        " SELECT 1 FROM games g JOIN game_players gp ON gp.game_id=g.id"
        " WHERE g.event_id=e.id AND LOWER(TRIM(gp.display_name))='test'"
        ") AND EXISTS("
        " SELECT 1 FROM games g JOIN game_players gp ON gp.game_id=g.id"
        " WHERE g.event_id=e.id AND LOWER(TRIM(gp.display_name))='test1'"
        ")"
    )
    if len(rooms)!=1:
        raise Stop("Expected one uniquely matched Friday Night Poker room. No change.")
    room_id=rooms[0].get("id")
    if not isinstance(room_id,str) or not SAFE_ID.fullmatch(room_id):
        raise Stop("Invalid scoped room identifier.")
    names=",".join("'"+name+"'" for name in sorted(TARGETS))
    stats=query(
        "SELECT LOWER(TRIM(gp.display_name)) AS name,COUNT(*) AS n,"
        " COUNT(DISTINCT gp.game_id) AS games "
        "FROM game_players gp JOIN games g ON g.id=gp.game_id "
        "WHERE g.event_id='"+room_id+"' AND LOWER(TRIM(gp.display_name)) IN ("+names+") "
        "GROUP BY LOWER(TRIM(gp.display_name))"
    )
    if {x.get("name") for x in stats}!=TARGETS or any(
        int(x.get("n",0))!=1 or int(x.get("games",0))!=1 for x in stats
    ):
        raise Stop("Historical test entries did not match the two single-game records.")
    approved=query(
        "SELECT COUNT(*) AS n FROM event_members em "
        "JOIN users u ON u.id=em.user_id "
        "WHERE em.event_id='"+room_id+"' AND LOWER(TRIM(u.name)) IN ("+names+")"
    )
    if len(approved)!=1 or int(approved[0].get("n",0))!=0:
        raise Stop("A requested test name is a current room member.")
    return room_id

def kv_call(method,key,token,body=None):
    url=("https://api.cloudflare.com/client/v4/accounts/"+ACCOUNT+
         "/storage/kv/namespaces/"+KV_NAMESPACE+"/values/"+
         urllib.parse.quote(key,safe=""))
    payload=None if body is None else body.encode("utf-8")
    req=urllib.request.Request(url,data=payload,headers={
        "Authorization":"Bearer "+token,
        "Content-Type":"application/json"
    },method=method)
    try:
        with urllib.request.urlopen(req,timeout=25) as res:
            return res.read().decode("utf-8")
    except urllib.error.HTTPError as exc:
        if method=="GET" and exc.code==404:return None
        raise Stop("Cloudflare KV operation failed (HTTP "+str(exc.code)+").") from None
    except (urllib.error.URLError,TimeoutError):
        raise Stop("Cloudflare KV endpoint unavailable.") from None

def read_names(key,token):
    raw=kv_call("GET",key,token)
    if raw is None:return []
    try:
        obj=json.loads(raw)
        names=obj["names"]
        if not isinstance(names,list) or len(names)>250 or any(
            not isinstance(x,str) or not x or len(x)>100 for x in names
        ):raise ValueError()
        return sorted(set(x.strip().lower() for x in names))
    except (KeyError,TypeError,ValueError):
        raise Stop("Archived player KV list invalid. Not overwriting it.") from None

def apply(query,kv_get,kv_put,before_after):
    room_id=plan_archive(query)
    key=PREFIX+room_id
    previous=kv_get(key)
    combined=sorted(set(previous)|TARGETS)
    if len(combined)>250:raise Stop("Too many historical players archived.")
    before=before_after()
    if combined!=previous:
        kv_put(key,json.dumps({"names":combined},separators=(",",":")))
    after=before_after()
    if before!=after:raise Stop("Financial records changed while archiving: investigate.")
    if set(TARGETS).difference(combined):raise Stop("Requested entries were not archived.")
    return {"archived":len(TARGETS),"already_archived":all(x in previous for x in TARGETS),
            "financial_aggregates_unchanged":True}

def main():
    release=release_tools()
    verify_config(release)
    token=os.environ.get("CLOUDFLARE_API_TOKEN")
    if not token:raise Stop("No production KV token.")
    key_written=[]
    def write(key,value):
        kv_call("PUT",key,token,value)
        key_written.append(key)
    result=apply(release.remote_query,
       lambda key:read_names(key,token),write,
       lambda:(release.aggregate("game_players"),release.aggregate("settlement_transfers")))
    if key_written:
        key=key_written[0]
        for attempt in range(5):
            if TARGETS.issubset(set(read_names(key,token))):break
            time.sleep(2)
        else:raise Stop("KV write not visible during control-plane verification.")
    print("PASS: exactly 2 accidental historical display names hidden in Friday Night Poker.")
    print("PASS: original game, player, membership, money and settlement rows not changed.")
    print("Host may restore an archived name using Members > Archived historical players.")

if __name__=="__main__":
    try:main()
    except (Stop,OSError,ValueError) as exc:
        print("Historical-player archive STOPPED:",str(exc),file=sys.stderr)
        sys.exit(1)

