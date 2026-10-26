#!/usr/bin/env python3
"""Safeguarded one-shot PKR push backend production release, 26 Oct 2026.

Run only in the authenticated user's GitHub Codespace with pre-existing clean
release worktree at the pinned, reviewed commit. Private DB dumps never leave
this machine. This script never invokes D1 Time Travel restore or deletes data.
"""
import json
import os
import re
import sqlite3
import tempfile
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path

RELEASE = Path('/workspaces/pkr-push-release-20261026')
WORKER = RELEASE / 'worker'
SHA = '19b79ce600207198ff51dcf374e036910919599d'
ACCOUNT = '4b4794b983d6966f4207d2ff4fd8c991'
DB_ID = 'e21a4823-ef28-496a-9f49-fa3e04dc73bf'
KV_ID = '35132989116243c6b9a79f7a8151e328'
PREVIOUS_VERSION = '45b13a82-6de7-4517-a887-ba550ea1d766'
API = 'https://pkr-reloaded-worker.jeemit1.workers.dev'
WRANGLER = ['npx', '--no-install', 'wrangler']
PHASE = 'initialisation'
MIGRATED = False
DEPLOYED = False
FLAG = False

# Only count critical relationships and financial totals. Do not display
# private player names, email addresses, individual game data, or phone numbers.
BASELINE_SQL = '''SELECT
 (SELECT COUNT(*) FROM users) AS users,
 (SELECT COUNT(*) FROM events) AS events,
 (SELECT COUNT(*) FROM event_members) AS members,
 (SELECT COUNT(*) FROM games) AS games,
 (SELECT COUNT(*) FROM game_players) AS players,
 (SELECT COALESCE(SUM(buy_in_total),0) FROM game_players) AS buyins,
 (SELECT COALESCE(SUM(cashout),0) FROM game_players) AS cashouts,
 (SELECT COALESCE(SUM(net),0) FROM game_players) AS net,
 (SELECT COUNT(*) FROM settlements) AS settlements,
 (SELECT COUNT(*) FROM settlement_transfers) AS transfers,
 (SELECT COALESCE(SUM(amount),0) FROM settlement_transfers) AS transfer_amount,
 (SELECT COUNT(*) FROM push_subscriptions) AS legacy_push,
 (SELECT COUNT(*) FROM group_phone_contacts) AS contacts,
 (SELECT COUNT(*) FROM group_phone_invites) AS invitations,
 (SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='push_room_subscriptions') AS push_v2_table,
 (SELECT COUNT(*) FROM games WHERE status='active') AS active_games,
 (SELECT COUNT(*) FROM games g WHERE g.status='active' AND (
    g.scheduled_at >= unixepoch()-604800
    OR g.created_at >= unixepoch()-604800
    OR EXISTS(SELECT 1 FROM game_players p
              WHERE p.game_id=g.id AND p.created_at>=unixepoch()-604800)
    OR EXISTS(SELECT 1 FROM game_rsvps r
              WHERE r.game_id=g.id AND r.created_at>=unixepoch()-604800)
    OR EXISTS(SELECT 1 FROM hands h
              WHERE h.game_id=g.id AND h.created_at>=unixepoch()-604800)
    OR EXISTS(SELECT 1 FROM hand_actions a JOIN hands h ON h.id=a.hand_id
              WHERE h.game_id=g.id AND a.created_at>=unixepoch()-604800)
    OR EXISTS(SELECT 1 FROM tournament_rebuys t
              WHERE t.game_id=g.id AND t.created_at>=unixepoch()-604800)
 )) AS recent_active_games
'''

def run(*args, input_text=None, show=False, cwd=WORKER):
    cmd = [str(x) for x in args]
    result = subprocess.run(cmd, cwd=str(cwd), input=input_text,
                            capture_output=True, text=True)
    if result.returncode:
        # Hide any secret input; command arguments never include secret values.
        raise RuntimeError('Command failed: ' + ' '.join(cmd[:4]) +
                           '\n' + result.stderr[-1800:] + '\n' + result.stdout[-1800:])
    if show and result.stdout.strip():
        print(result.stdout.strip(), flush=True)
    return result.stdout.strip()

def wrangler(*parts, input_text=None, show=False):
    return run(*WRANGLER, *parts, input_text=input_text, show=show)

def json_from_output(output):
    decoder = json.JSONDecoder()
    for i, ch in enumerate(output):
        if ch not in '[{':
            continue
        try:
            value, _ = decoder.raw_decode(output[i:])
            if isinstance(value, (list, dict)):
                return value
        except ValueError:
            continue
    raise RuntimeError('Cannot parse Wrangler JSON output')

def database_baseline():
    output = wrangler('d1', 'execute', 'DB', '--config', 'wrangler.toml',
                      '--remote', '--json', '--command', BASELINE_SQL)
    payload = json_from_output(output)
    if isinstance(payload, dict):
        payload = [payload]
    for block in payload:
        if isinstance(block, dict) and block.get('success') is not False and isinstance(block.get('results'), list):
            rows = block['results']
            if len(rows) == 1 and isinstance(rows[0], dict):
                return rows[0]
    raise RuntimeError('Remote database baseline not returned')

def check_health():
    body = run('curl', '--fail', '--silent', '--show-error', '--max-time', '20', API+'/health')
    j = json.loads(body)
    if j.get('ok') is not True or j.get('environment') != 'production' or j.get('service') != 'pkr-reloaded-worker':
        raise RuntimeError('Production Worker identity does not match')

def status(path, method='GET'):
    cmd = ['curl', '--silent', '--show-error', '--max-time', '20', '-o', '/dev/null', '-w', '%{http_code}', '-X', method]
    if method == 'POST':
        cmd.extend(['-H', 'Content-Type: application/json', '--data-binary', '{}'])
    return int(run(*cmd, API+path))

def checkpoint(name):
    global PHASE
    PHASE = name
    print('\n== ' + name + ' ==', flush=True)

def main():
    global MIGRATED, DEPLOYED, FLAG
    os.umask(0o077)
    checkpoint('Verify release identity and production bindings')
    if not RELEASE.is_dir() or not WORKER.is_dir():
        raise RuntimeError('Expected clean PKR release worktree is missing')
    if run('git', 'rev-parse', 'HEAD', cwd=RELEASE) != SHA:
        raise RuntimeError('STOP: release commit changed')
    remote_main = run('git', 'ls-remote', 'origin', 'refs/heads/main', cwd=RELEASE).split()[0]
    if remote_main != SHA:
        raise RuntimeError('STOP: GitHub production branch has changed; review before deployment')
    if run('git', 'status', '--porcelain', '--untracked-files=no', cwd=RELEASE):
        raise RuntimeError('STOP: tracked release files changed')
    # No need to alter the worktree or touch the user's main checkout.
    config = (WORKER/'wrangler.toml').read_text()
    for required in (
        'account_id = "' + ACCOUNT + '"',
        'name = "pkr-reloaded-worker"',
        'binding = "DB"',
        'database_id = "' + DB_ID + '"',
        'id = "' + KV_ID + '"',
        'FRONTEND_URL = "https://mypkr.app"',
        'crons = ["0 * * * *"]',
    ):
        if required not in config:
            raise RuntimeError('STOP: production config mismatch: ' + required[:40])
    check_health()
    # Staging release and V2 migration must already be configured. Do not mix staging and production resources.
    staging_config = (WORKER/'wrangler.staging.toml').read_text()
    for marker in ('name = "pkr-reloaded-worker-staging"',
                   'database_id = "03577857-fc94-49ed-bd1b-5cd658aa0978"',
                   'PKR_ENV = "staging"'):
        if marker not in staging_config:
            raise RuntimeError('STOP: isolated staging config mismatch')
    staging_names = json_from_output(wrangler('secret', 'list', '--config', 'wrangler.staging.toml'))
    staging_names = {x.get('name') for x in staging_names if isinstance(x, dict)}
    needed_stage = {'VAPID_PUBLIC_KEY', 'VAPID_PRIVATE_KEY', 'VAPID_EMAIL', 'PKR_PUSH_ROOMS_V2'}
    if needed_stage - staging_names:
        raise RuntimeError('STOP: staging VAPID/Push V2 configuration not complete')
    stage_sql = "SELECT COUNT(*) AS n FROM sqlite_master WHERE type='table' AND name='push_room_subscriptions'"
    stage_raw = json_from_output(wrangler('d1', 'execute', 'DB', '--config',
                    'wrangler.staging.toml', '--remote', '--json', '--command', stage_sql))
    stage_blocks = stage_raw if isinstance(stage_raw, list) else [stage_raw]
    if not any(isinstance(b, dict) and b.get('success') is not False and
               isinstance(b.get('results'), list) and len(b['results']) == 1 and
               int(b['results'][0].get('n', 0)) == 1 for b in stage_blocks):
        raise RuntimeError('STOP: staging push table missing')
    # Verify this installed Wrangler's D1 export behaviour without touching production.
    checkpoint('Preflight: export isolated staging D1 using installed Wrangler')
    with tempfile.TemporaryDirectory(prefix='pkr-staging-d1-export-') as scratch:
        probe = Path(scratch) / 'staging-export.sql'
        wrangler('d1', 'export', 'DB', '--config', 'wrangler.staging.toml',
                 '--remote', '--output', str(probe), input_text='y\n')
        if not probe.is_file() or probe.stat().st_size < 100:
            raise RuntimeError('STOP: staging D1 export returned no usable SQL file')
        stage_restored = sqlite3.connect(Path(scratch)/'staging-restore.sqlite')
        try:
            stage_restored.executescript(probe.read_text(encoding='utf-8'))
            if stage_restored.execute('PRAGMA quick_check').fetchone()[0] != 'ok':
                raise RuntimeError('STOP: staging SQL export could not be restored cleanly')
        finally:
            stage_restored.close()
    # Wrangler 3 supports --yes on D1 execute, unlike D1 export.
    stage_readonly = json_from_output(wrangler(
        'd1','execute','DB','--config','wrangler.staging.toml','--remote',
        '--yes','--json','--command','SELECT 1 AS ok'))
    stage_blocks = stage_readonly if isinstance(stage_readonly,list) else [stage_readonly]
    if not any(isinstance(b,dict) and b.get('results')==[{'ok':1}]
               for b in stage_blocks):
        raise RuntimeError('STOP: staging D1 execute --yes preflight failed')
    print('Staging D1 SQL export, local restore and --yes compatibility: PASS')
    if status('/phone-invites/not-a-real-token') != 404:
        raise RuntimeError('Private phone invitation gate is not available')

    names = json_from_output(wrangler('secret', 'list', '--config', 'wrangler.toml'))
    if not isinstance(names, list):
        raise RuntimeError('Unexpected production secret list')
    secret_names = {entry.get('name') for entry in names if isinstance(entry,dict)}
    required_secrets = {'GOOGLE_CLIENT_SECRET','JWT_SECRET','PKR_CONTACT_KEY',
                        'PKR_PHONE_MEMBERS_V1','PKR_RSVP_V2',
                        'VAPID_PUBLIC_KEY','VAPID_PRIVATE_KEY','VAPID_EMAIL'}
    if required_secrets - secret_names:
        raise RuntimeError('STOP: missing production secret(s): ' + ', '.join(sorted(required_secrets - secret_names)))
    if 'PKR_PUSH_ROOMS_V2' in secret_names:
        raise RuntimeError('STOP: push V2 already configured in production; inspect instead of rerunning')

    versions = wrangler('deployments', 'list', '--config', 'wrangler.toml')
    active_versions = re.findall(r'Version\(s\):\s*\(100%\)\s*([\da-f-]+)', versions)
    if not active_versions or active_versions[-1] != PREVIOUS_VERSION:
        raise RuntimeError('STOP: production Worker changed since last inspected version')

    # Resolve the currently renamed D1 database by its immutable ID.
    db_list = json_from_output(wrangler('d1', 'list', '--config', 'wrangler.toml', '--json'))
    if isinstance(db_list, dict):
        db_list = db_list.get('result', db_list.get('databases', []))
    matches = [x for x in db_list if isinstance(x, dict) and
               (x.get('uuid') == DB_ID or x.get('id') == DB_ID)]
    if len(matches) != 1 or not matches[0].get('name'):
        raise RuntimeError('STOP: production D1 database ID not found in account')
    db_name = matches[0]['name']
    print('Correct production account/Worker/D1/KV: PASS')
    print('Previous production version:', PREVIOUS_VERSION)
    print('Production database name:', db_name)

    checkpoint('Preserve private Time Travel bookmark and full export')
    target = Path.home()/'PKR-private-backups'/('push-prod-'+datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%SZ'))
    target.mkdir(parents=True, mode=0o700, exist_ok=False)
    (target/'previous-worker.txt').write_text(versions)
    (target/'bookmark.txt').write_text(wrangler('d1', 'time-travel', 'info', 'DB', '--config', 'wrangler.toml')+'\n')
    source = database_baseline()
    if int(source['push_v2_table']) != 0:
        raise RuntimeError('STOP: multi-room table already exists; review before changing anything')
    if int(source['recent_active_games']) != 0:
        raise RuntimeError('STOP: active games have activity within the last seven days; do not deploy during gameplay')
    if int(source['active_games']):
        print('Preserving', source['active_games'], 'historical unfinished games with active status.')
        print('No recently scheduled, created or recorded activity was found for those games.')
        print('Do not deploy while anyone is actually playing an older game.')
    (target/'baseline-before.json').write_text(json.dumps(source, indent=2))
    export = target/'production-before.sql'
    # Wrangler 3.114.17 does not accept --skip-confirmation on d1 export.
    # The DB binding selects the verified production database ID, independent of its display name.
    wrangler('d1', 'export', 'DB', '--config', 'wrangler.toml',
             '--remote', '--output', str(export), input_text='y\n', show=True)
    if not export.is_file() or export.stat().st_size < 100:
        raise RuntimeError('STOP: production D1 SQL export is missing or empty')
    print('Private SQL backup saved outside repository; bytes:', export.stat().st_size)

    checkpoint('Restore locally; reconcile financial totals; test migration on restored copy')
    restored = target/'verified-restore.sqlite'
    con = sqlite3.connect(restored)
    try:
        con.executescript(export.read_text(encoding='utf-8'))
        check = con.execute('PRAGMA quick_check').fetchone()
        if not check or check[0] != 'ok':
            raise RuntimeError('STOP: restored database quick_check failed')
        violations = con.execute('PRAGMA foreign_key_check').fetchall()
        if violations:
            raise RuntimeError('STOP: restored database has foreign key violations')
        con.row_factory = sqlite3.Row
        local = dict(con.execute(BASELINE_SQL).fetchone())
        if local != source:
            raise RuntimeError('STOP: restored database counts/financial totals disagree with live pre-export baseline')
        migration = WORKER/'migrations/20261026_push_rooms.sql'
        if not migration.is_file():
            raise RuntimeError('STOP: migration file not present')
        con.executescript(migration.read_text(encoding='utf-8'))
        rehearsal = dict(con.execute(BASELINE_SQL).fetchone())
        expected = dict(source)
        expected['push_v2_table'] = 1
        if rehearsal != expected:
            raise RuntimeError('STOP: rehearsal migration changed existing financial or membership records')
        if con.execute('PRAGMA quick_check').fetchone()[0] != 'ok':
            raise RuntimeError('STOP: rehearsal integrity check failed')
        if con.execute('PRAGMA foreign_key_check').fetchone():
            raise RuntimeError('STOP: rehearsal foreign keys failed')
    finally:
        con.close()
    print('Locally restored D1 backup: verified; all financial totals preserved')
    print('Additive push migration on restored copy: PASS')
    print('Private backup directory:', target)
    print('Keep this directory out of GitHub and ChatGPT and save an encrypted independent copy.')

    checkpoint('Recheck unchanged production data before first write')
    if database_baseline() != source:
        raise RuntimeError('STOP: production data changed since the backup. Obtain a fresh backup during a quiet window')
    check_health()

    checkpoint('Production D1: apply additive multi-room push migration')
    wrangler('d1', 'execute', 'DB', '--config', 'wrangler.toml', '--remote',
             '--file', str(WORKER/'migrations/20261026_push_rooms.sql'), '--yes', show=True)
    MIGRATED = True
    after_migration = database_baseline()
    expected = dict(source)
    expected['push_v2_table'] = 1
    if after_migration != expected:
        raise RuntimeError('Production baseline mismatch immediately after the additive migration; do not deploy code yet')
    print('Production D1 push table installed; all original totals unchanged')

    checkpoint('Deploy reviewed production Worker, retaining existing variables and secrets')
    wrangler('deploy', '--config', 'wrangler.toml', '--keep-vars', show=True)
    DEPLOYED = True
    check_health()
    if status('/events/test-room/subscribe-status', method='POST') != 401:
        raise RuntimeError('Expected new authenticated push status route (401) after Worker deployment')
    if status('/phone-invites/not-a-real-token') != 404:
        raise RuntimeError('Private phone membership endpoint failed post-deploy')

    checkpoint('Enable per-room push in production')
    wrangler('secret', 'put', 'PKR_PUSH_ROOMS_V2', '--config', 'wrangler.toml',
             input_text='1\n', show=True)
    FLAG = True
    latest_names = json_from_output(wrangler('secret', 'list', '--config', 'wrangler.toml'))
    if 'PKR_PUSH_ROOMS_V2' not in {x.get('name') for x in latest_names if isinstance(x, dict)}:
        raise RuntimeError('Production push flag name not found after activation')
    check_health()
    final = database_baseline()
    expected = dict(source)
    expected['push_v2_table'] = 1
    if final != expected:
        raise RuntimeError('STOP: production counts or financial totals changed during release; V2 is enabled but needs reconciliation')
    print('\nPRODUCTION PUSH RELEASE ACTIVATED')
    print(str(source['legacy_push']) + ' existing legacy device subscriptions were preserved, not migrated automatically.')
    print('Each host/player must open each room and re-enable notifications.')
    print('Perform a real-device host approval push test before declaring notification delivery verified.')
    print('Do not use Time Travel restore casually: it would overwrite live writes.')

if __name__ == '__main__':
    if len(sys.argv) != 2 or sys.argv[1] != '--apply':
        print('Usage: python3 pkr_push_production_release_20261026.py --apply')
        print('Requires the reviewed 19b79ce worktree and authenticated Cloudflare Codespace.')
        sys.exit(2)
    try:
        main()
    except Exception as e:
        print('\nSTOP: ' + str(e), file=sys.stderr)
        print('Failed during: ' + PHASE, file=sys.stderr)
        if MIGRATED or DEPLOYED or FLAG:
            print('IMPORTANT: Production may be partially updated. Do not blindly rerun.', file=sys.stderr)
            print(f'Migration applied: {MIGRATED}; Worker deployed: {DEPLOYED}; V2 flag submitted: {FLAG}', file=sys.stderr)
        else:
            print('No production database migration, Worker deployment, or push flag update was performed.', file=sys.stderr)
        sys.exit(2)
