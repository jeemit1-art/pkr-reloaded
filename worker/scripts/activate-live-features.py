#!/usr/bin/env python3
"""Controlled live PKR Worker/feature activation. No D1 writes or migrations.

Run from the audited production release in an already authenticated Codespace.
A failed check stops before writes, except when a later deployment/flag step fails.
Never blindly rerun after a partially completed operation.
"""
import json
import os
import re
import secrets
import subprocess
import sys
import urllib.error
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
WORKER = ROOT / "worker"
BRANCH = "release/pkr-production-20261025-rc2"
BASE = "277a3de3a0e65fa7db6e49b137433c6db0e310cd"
DB = "e21a4823-ef28-496a-9f49-fa3e04dc73bf"
KV = "35132989116243c6b9a79f7a8151e328"
# Fixed release boundary: user-audited active games/hands were created before 1 Oct.
LEGACY_HAND_CUTOFF_UNIX = 1790812800
URL = "https://pkr-reloaded-worker.jeemit1.workers.dev"
FLAGS = ("PKR_INTEGRITY_REVISIONS", "PKR_INTEGRITY_STACKS", "PKR_PHONE_MEMBERS_V1")
OPTIONAL = ("game_player_revisions","game_financial_audit","hand_stack_baselines",
            "game_rsvp_arrivals","game_rsvp_guests","group_phone_contacts",
            "verified_phone_identities","group_phone_invites",
            "phone_verification_limits","game_rsvp_member_links")

class Stop(Exception):
    pass

def command(*args, cwd=ROOT):
    result = subprocess.run(args, cwd=str(cwd), capture_output=True, text=True)
    if result.returncode:
        raise Stop("Command failed: " + " ".join(args[:3]) +
                   " (exit " + str(result.returncode) + ")")
    return result.stdout.strip()

def git(*args):
    return command("git", *args)

def release_check():
    if git("branch", "--show-current") != BRANCH:
        raise Stop("Checkout the audited release branch before activation")
    if git("status", "--porcelain", "--untracked-files=no"):
        raise Stop("Tracked files modified. Inspect changes; nothing applied")
    if git("rev-parse", "HEAD") != git("rev-parse", "origin/" + BRANCH):
        raise Stop("Codespaces branch is not at latest origin. Fetch and pull --ff-only")
    if subprocess.run(["git","merge-base","--is-ancestor",BASE,"HEAD"],
                      cwd=ROOT).returncode:
        raise Stop("Current release does not contain verified frontend/Worker commit")
    config = (WORKER / "wrangler.toml").read_text()
    for value in ('name = "pkr-reloaded-worker"',
                  'binding = "DB"',
                  'account_id = "4b4794b983d6966f4207d2ff4fd8c991"',
                  'database_id = "' + DB + '"',
                  'id = "' + KV + '"',
                  'FRONTEND_URL = "https://mypkr.app"'):
        if value not in config: raise Stop("Production Worker/D1/KV binding mismatch")
    source = (WORKER / "src/routes/phone-members.ts").read_text()
    if "router.post('/phone-invites/:token/request-approval'" not in source:
        raise Stop("Private WhatsApp invitation/approval code missing")
    if any(x in source for x in ("twilioVerify","sendWhatsappOtp",
                                 "checkWhatsappOtp","verifyProviderReady")):
        raise Stop("Unreviewed OTP-provider integration found in source")
    print("Correct audited release and Worker identity: PASS", flush=True)

def query_control():
    names = ",".join("'" + t + "'" for t in OPTIONAL)
    sql = ("SELECT "
           "(SELECT COUNT(*) FROM sqlite_master WHERE type='table' "
           "AND name IN (" + names + ")) AS optional_count,"
           "(SELECT COUNT(*) FROM games WHERE status='active') AS active_games,"
           "(SELECT COUNT(*) FROM group_phone_contacts) AS contacts,"
           "(SELECT COUNT(*) FROM game_players gp LEFT JOIN game_player_revisions r "
           "ON r.game_id=gp.game_id AND r.user_id=gp.user_id "
           "WHERE r.revision IS NULL) AS missing_revisions,"
           f"(SELECT COUNT(*) FROM games g WHERE g.status='active' AND g.created_at>={LEGACY_HAND_CUTOFF_UNIX}) AS recent_active_games,"
           f"(SELECT COUNT(*) FROM hands h JOIN games g ON g.id=h.game_id WHERE g.status='active' AND h.created_at>={LEGACY_HAND_CUTOFF_UNIX}) AS recent_hands,"
           f"(SELECT COUNT(*) FROM hand_actions a JOIN games g ON g.id=a.game_id WHERE g.status='active' AND a.created_at>={LEGACY_HAND_CUTOFF_UNIX}) AS recent_actions,"
           f"(SELECT COUNT(*) FROM game_players p JOIN games g ON g.id=p.game_id WHERE g.status='active' AND p.created_at>={LEGACY_HAND_CUTOFF_UNIX}) AS recent_players,"
           f"(SELECT COUNT(*) FROM game_financial_audit f JOIN games g ON g.id=f.game_id WHERE g.status='active' AND f.changed_at>={LEGACY_HAND_CUTOFF_UNIX}) AS recent_financial_edits,"
           f"(SELECT COUNT(*) FROM hands h JOIN games g ON g.id=h.game_id WHERE g.status='active' AND h.voided=0 AND h.created_at<{LEGACY_HAND_CUTOFF_UNIX} "
           "AND EXISTS(SELECT 1 FROM hand_actions a WHERE a.hand_id=h.id) "
           "AND NOT EXISTS(SELECT 1 FROM hand_results r WHERE r.hand_id=h.id)) AS legacy_unfinished_hands")
    # Resolve D1 through the audited Worker binding, NOT the legacy display
    # name: the Cloudflare database was renamed without changing its UUID.
    output = command("npx","--no-install","wrangler","d1","execute",
                     "DB","--config","wrangler.toml","--remote",
                     "--json","--command",sql,cwd=WORKER)
    try: data = json.loads(output)
    except ValueError:
        at = output.find("[{")
        if at < 0: raise Stop("Remote D1 JSON unavailable; no changes made")
        try: data = json.loads(output[at:])
        except ValueError: raise Stop("Remote D1 output not parseable; no changes made")
    if isinstance(data,dict): data=[data]
    if not isinstance(data,list) or not data: raise Stop("Unexpected D1 response")
    item = data[0]
    if isinstance(item,list) and item: item=item[0]
    if not isinstance(item,dict) or item.get("success") is False:
        raise Stop("Remote D1 query was not successful")
    rows = item.get("results")
    if not isinstance(rows,list) or len(rows)!=1:
        raise Stop("Unexpected D1 control results")
    result = rows[0]
    if not isinstance(result,dict): raise Stop("Unexpected D1 control row")
    fields = ("optional_count","active_games","contacts","missing_revisions",
              "recent_active_games","recent_hands","recent_actions","recent_players",
              "recent_financial_edits","legacy_unfinished_hands")
    try: return {name:int(result[name]) for name in fields}
    except (KeyError,ValueError,TypeError): raise Stop("Invalid D1 control fields")

def confirm_safe_activity(counts):
    if counts["optional_count"] != 10:
        raise Stop("Expected all 10 optional live D1 tables; no writes made")
    if counts["missing_revisions"]:
        raise Stop("Player financial revision records missing; no writes made")
    recent = ("recent_active_games","recent_hands","recent_actions",
              "recent_players","recent_financial_edits")
    if any(counts[name] for name in recent):
        raise Stop("New or modified game activity since 1 Oct 2026. Do not activate during play.")
    # The user audited 11 historical open games, including exactly two
    # unfinished pre-cutoff hands with actions. If additional ones appear,
    # stop for another audit rather than assuming they are the same.
    if counts["legacy_unfinished_hands"] > 2 or counts["active_games"] > 11:
        raise Stop("Historical game inventory changed; review before activation")
    print("Historical active games preserved:", counts["active_games"],flush=True)
    print("Unverified pre-rollout unfinished hands preserved:",
          counts["legacy_unfinished_hands"],flush=True)


def secret_names():
    output = command("npx","--no-install","wrangler","secret","list",
                     "--config","wrangler.toml",cwd=WORKER)
    try:
        rows=json.loads(output)
        return {r["name"] for r in rows if isinstance(r,dict) and "name" in r}
    except (TypeError,ValueError):
        found=set(re.findall(r'"name"\s*:\s*"([A-Z0-9_]+)"',output))
        if not found: raise Stop("Cannot establish existing Cloudflare secret names")
        return found

def secret_put(name, value):
    # Never print secret values or include them in command-line arguments.
    result = subprocess.run(["npx","--no-install","wrangler","secret","put",
                             name,"--config","wrangler.toml"],
                            cwd=WORKER,input=value+"\n",
                            text=True,capture_output=True)
    if result.returncode:
        raise Stop("Cloudflare rejected " + name + ". Deployment may be partially activated")
    if name not in secret_names():
        raise Stop("Secret " + name + " was not confirmed in production")
    print(name + ": SET (value hidden)",flush=True)

def health():
    try:
        with urllib.request.urlopen(URL + "/health",timeout=20) as response:
            data = json.load(response)
        if data.get("ok") is not True or data.get("environment")!="production":
            raise Stop("Production Worker health does not report OK")
    except (OSError,ValueError) as e:
        raise Stop("Production Worker health unavailable: " + type(e).__name__)

def assert_manual_worker():
    # The old OTP endpoint returned 503 when inactive. Its removal must be 404.
    request=urllib.request.Request(URL + "/auth/mobile/start",data=b"{}",
        method="POST",headers={"Content-Type":"application/json"})
    try:
        with urllib.request.urlopen(request,timeout=20):
            raise Stop("Unexpected mobile OTP endpoint still responds successfully")
    except urllib.error.HTTPError as e:
        if e.code!=404:
            raise Stop("Manual WhatsApp Worker not active: old OTP endpoint HTTP " + str(e.code))

def contact_secret(existing, contacts):
    if "PKR_CONTACT_KEY" in existing:
        print("Existing contact-encryption key preserved",flush=True)
        return
    if contacts:
        raise Stop("Encrypted contacts exist without key! Do not rotate/regenerate it")
    folder=Path.home()/"PKR-private-backups"
    folder.mkdir(mode=0o700,parents=True,exist_ok=True)
    os.chmod(folder,0o700)
    name="pkr-contact-key-"+datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")+".txt"
    backup=folder/name
    key=secrets.token_hex(32)
    with backup.open("x") as file:
        os.chmod(backup,0o600)
        file.write(key+"\n")
    print("Private contact key backed up at " + str(backup),flush=True)
    print("SAVE THE KEY IN A PASSWORD MANAGER before deleting this Codespace",flush=True)
    secret_put("PKR_CONTACT_KEY",key)

def main():
    os.umask(0o077)
    print("PKR PRODUCTION: CONTROLLED ALL-FEATURE ACTIVATION",flush=True)
    release_check()
    counts=query_control()
    print("Read-only D1 checks:",counts,flush=True)
    confirm_safe_activity(counts)
    old=secret_names()
    base={"JWT_SECRET","GOOGLE_CLIENT_SECRET","PKR_RSVP_V2"}
    if not base.issubset(old):
        raise Stop("Expected production OAuth/JWT/RSVP secrets not present")
    print("No post-cutoff gameplay; optional tables and revisions: PASS",flush=True)
    print("Deploying manual WhatsApp Worker with legacy-hand compatibility, no D1 changes...",flush=True)
    command("npx","--no-install","wrangler","deploy",
            "--config","wrangler.toml","--keep-vars",cwd=WORKER)
    health()
    assert_manual_worker()
    print("Production Worker code / health / no-OTP endpoint: PASS",flush=True)
    # Recheck directly before enabling flags: a game may have been opened
    # while the Worker deploy was running.
    second=query_control()
    confirm_safe_activity(second)
    if any(second[field]!=counts[field] for field in (
      "optional_count","contacts","missing_revisions","active_games",
      "legacy_unfinished_hands")):
        raise Stop("Live game inventory changed during deployment; review before activation")
    contact_secret(old,counts["contacts"])
    if "PKR_CONTACT_KEY" not in secret_names():
        raise Stop("Contact key missing; stop before phone activation")
    for flag in FLAGS:
        secret_put(flag,"1")
        health()
    after=secret_names()
    if not base.issubset(after) or not set(FLAGS).issubset(after):
        raise Stop("One or more production feature secret names are missing")
    try:
        with urllib.request.urlopen(URL+"/phone-invites/not-a-valid-token",timeout=20):
            raise Stop("Invalid private invitation unexpectedly succeeded")
    except urllib.error.HTTPError as e:
        if e.code!=404:
            raise Stop("Phone invitation gate responded HTTP "+str(e.code)+", expected 404")
    print("PRODUCTION ACTIVATION: PASS - RSVP, financial revisions, confirmed stacks, private WhatsApp membership",flush=True)
    print("No data migration, historical hand deletion, invented opening chips, messaging API or AI activation.",flush=True)
    print("Now test signed-in invite/approval/recovery and counted opening stacks on a TEST game.",flush=True)

if __name__=="__main__":
    try: main()
    except Stop as exc:
        print("STOP: "+str(exc),file=sys.stderr,flush=True)
        print("Do not blindly rerun a partial deployment. Inspect its live state first.",file=sys.stderr)
        raise SystemExit(2)
