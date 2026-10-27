#!/usr/bin/env python3
"""Guarded Settlement V2 push prerequisites; credentials remain inside CI.

--prepare: verify existing private-membership schema, backup, add push table.
--activate: after the new Worker is live, enable only its required push gates.
No subscriber identities are inferred or copied from legacy name-only records.
"""
import argparse
import importlib.util
import json
import sys
import time
from pathlib import Path

HERE=Path(__file__).resolve().parent
EXPECTED_RELEASE='settlement-v2-github-20261028'
MEMBERSHIP_COLUMNS={
 'event_members':{'event_id','user_id','role'},
 'group_phone_contacts':{'id','event_id','display_name','phone_lookup','phone_cipher','user_id'},
 'group_phone_invites':{'id','event_id','contact_id','token_hash','role','expires_at','consumed_at'},
 'verified_phone_identities':{'phone_lookup','user_id','verified_at'},
 'phone_verification_limits':{'rate_key','window_start','attempts'},
 'game_rsvp_member_links':{'game_id','user_id','rsvp_id'},
 'game_rsvp_guests':{'id','game_id'},
 'settlement_transfers':{'id','game_id','from_user','to_user','amount','status','paid_at','created_at','last_reminded_at','reminder_count'},
}
PUSH_COLUMNS={'event_id','endpoint','user_id','p256dh','auth_key','created_at'}


def module():
 spec=importlib.util.spec_from_file_location('pkr_release',HERE/'deploy-settlement-v2-production.py')
 result=importlib.util.module_from_spec(spec);spec.loader.exec_module(result)
 return result


def check_columns(release,table,expected):
 # Table identifiers are constants above, not user-supplied input.
 rows=release.remote_query("SELECT name FROM pragma_table_info('"+table+"')")
 if not expected.issubset({r['name'] for r in rows}):
  raise release.Stop('Required schema is missing from '+table+'. No feature flags changed.')


def preflight(release):
 release.verify_target()
 release.preflight_secrets()
 if 'PKR_CONTACT_KEY' not in release.secret_names():
  raise release.Stop('PKR_CONTACT_KEY is missing; private membership must be configured before enabling financial push.')
 for table,columns in MEMBERSHIP_COLUMNS.items():
  check_columns(release,table,columns)
 print('Authenticated membership and settlement schema prerequisites: PASS',flush=True)


def health(release):
 raw=release.command('curl','-fsS','--max-time','20','-H','Cache-Control: no-cache',release.HOST+'/health')
 value=json.loads(raw)
 if value.get('service')!=release.WORKER or value.get('environment')!='production':
  raise release.Stop('Wrong Worker identity during activation.')
 return value


def main():
 parser=argparse.ArgumentParser(description=__doc__)
 group=parser.add_mutually_exclusive_group(required=True)
 group.add_argument('--prepare',action='store_true')
 group.add_argument('--activate',action='store_true')
 args=parser.parse_args();release=module();preflight(release)
 if args.prepare:
  before=release.preflight_backup()
  if {t:release.aggregate(t) for t in before}!=before:
   raise release.Stop('Financial data changed during backup. No push migration applied.')
  release.wrangler('d1','execute','DB','--config','wrangler.toml','--remote','--yes',
                   '--file','migrations/20261026_push_rooms.sql')
  check_columns(release,'push_room_subscriptions',PUSH_COLUMNS)
  if {t:release.aggregate(t) for t in before}!=before:
   raise release.Stop('Financial data changed during push migration; review before continuing.')
  print('Additive authenticated push schema: PASS. No subscriptions or payments rewritten.',flush=True)
  return
 check_columns(release,'push_room_subscriptions',PUSH_COLUMNS)
 if health(release).get('release')!=EXPECTED_RELEASE:
  raise release.Stop('Reviewed Worker has not reached production. No push flags changed.')
 for flag in ('PKR_PHONE_MEMBERS_V1','PKR_PUSH_ROOMS_V2'):
  release.wrangler('secret','put',flag,'--config','wrangler.toml',stdin='1\n')
 for attempt in range(12):
  try:
   value=health(release)
   flags=value.get('features',{})
   if value.get('release')==EXPECTED_RELEASE and all(flags.get(k) is True for k in
       ('settlement_v2','push_rooms_v2','phone_members_v1')):
    print('Settlement V2 and both authenticated-push feature gates: VERIFIED LIVE.',flush=True)
    print('Device push opt-in and signed-in payer/recipient acceptance tests still required.',flush=True)
    return
  except Exception:
   pass
  time.sleep(5)
 raise release.Stop('Could not verify all live feature gates. Review deployment state; do not assume activation succeeded.')


if __name__=='__main__':
 try:
  main()
 except Exception as exc:
  # Only named guard errors are safe to display. Never dump HTTP/SQL bodies.
  print('STOP:',str(exc) if type(exc).__name__=='Stop' else 'Push prerequisite check failed; no automatic bypass.',file=sys.stderr)
  sys.exit(1)
