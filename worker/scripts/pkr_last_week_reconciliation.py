#!/usr/bin/env python3
"""Read-only reconciliation of the October 2026 PKR game; no data writes."""
from __future__ import annotations
import json
import sqlite3
from collections import defaultdict
from datetime import datetime, timedelta, timezone
from pathlib import Path

DB = Path.home() / 'PKR-private-backups' / 'push-prod-20261026T053737Z' / 'verified-restore.sqlite'
if not DB.is_file():
    raise SystemExit('STOP: Verified private backup not found. No records changed: ' + str(DB))

conn = sqlite3.connect(DB.as_uri() + '?mode=ro', uri=True)
conn.row_factory = sqlite3.Row
conn.execute('PRAGMA query_only=ON')

candidates = conn.execute('''
SELECT g.id, g.scheduled_at, g.variance, e.name AS room,
       COUNT(*) AS players,
       SUM(CASE WHEN p.buy_in_total>0 THEN p.buy_in_total ELSE p.buy_ins*e.buy_in END) AS in_cents,
       SUM(COALESCE(p.cashout,0)) AS out_cents,
       SUM(COALESCE(p.net,0)) AS net_cents
FROM games AS g
JOIN events AS e ON e.id=g.event_id
JOIN game_players AS p ON p.game_id=g.id
WHERE g.status='settled' AND g.scheduled_at >= unixepoch('2026-09-01')
GROUP BY g.id
HAVING COUNT(*) BETWEEN 12 AND 14
ORDER BY g.scheduled_at DESC LIMIT 20
''').fetchall()

money = lambda value: ('-' if (value or 0) < 0 else '') + f'${abs(value or 0)/100:,.2f}'
print('READ-ONLY AUDIT - production backup, not live D1')
print('Backup:', DB.name, '| exists and opened read-only')
if not candidates:
    raise SystemExit('No matching 13-player settled game in this backup. No records changed.')

matches = [r for r in candidates if r['players']==13 and r['in_cents']==600000 and r['out_cents']==597500 and r['net_cents']==-2500]
print('Matching game candidates:')
for r in candidates:
    dt=datetime.fromtimestamp(r['scheduled_at'], timezone(timedelta(hours=10))).strftime('%d %b %Y %I:%M %p AEST')
    print(f"  {dt} | {r['room']} | players={r['players']} | in={money(r['in_cents'])} out={money(r['out_cents'])} net={money(r['net_cents'])}")
if len(matches)!=1:
    raise SystemExit(f'STOP: found {len(matches)} exact screenshot matches; identify game before any correction. No records changed.')

match = matches[0]
print('\nExact screenshot match located; game ID:',match['id'])
players = conn.execute('''
SELECT p.display_name,p.buy_ins,p.buy_in_total,p.cashout,p.net,e.buy_in AS default_buyin
FROM game_players p JOIN games g ON g.id=p.game_id JOIN events e ON e.id=g.event_id
WHERE p.game_id=? ORDER BY p.display_name COLLATE NOCASE
''',(match['id'],)).fetchall()
transfers = conn.execute('''
SELECT from_name,to_name,amount,status,paid_at FROM settlement_transfers
WHERE game_id=? ORDER BY created_at,id
''',(match['id'],)).fetchall()
settle = conn.execute('SELECT payload_json,created_at FROM settlements WHERE game_id=?',(match['id'],)).fetchone()
snapshot = json.loads(settle['payload_json']) if settle else {}
snapshot_rows = {x.get('display_name','').strip().casefold(): x for x in snapshot.get('results',[]) if isinstance(x,dict)}

paid, received = defaultdict(int),defaultdict(int)
for t in transfers:
    paid[(t['from_name'] or '').casefold()] += t['amount']
    received[(t['to_name'] or '').casefold()] += t['amount']

print('\nPlayer                 Buy-ins  Cash-out      Net Transfer-net   Unmatched Snapshot-out')
print('-'*93)
for p in players:
    key=p['display_name'].strip().casefold()
    buyin=p['buy_in_total'] if p['buy_in_total']>0 else p['buy_ins']*p['default_buyin']
    cashout=p['cashout'] or 0
    net=p['net'] or 0
    transfer_net=received[key]-paid[key]
    unmatched=net-transfer_net
    snap=snapshot_rows.get(key,{})
    snap_cash=snap.get('cashout')
    snap_str='n/a' if not isinstance(snap_cash,int) else money(snap_cash)
    print(f"{p['display_name'][:22]:22} {money(buyin):>8} {money(cashout):>9} {money(net):>9} {money(transfer_net):>12} {money(unmatched):>11} {snap_str:>12}")
print('-'*93)
print('Bank variance (cash-outs minus buy-ins):',money(match['out_cents']-match['in_cents']))
print('Stored player net total:',money(match['net_cents']))
print('Stored game variance field:',match['variance'])
print('Total settlement transfers:',money(sum(t['amount'] for t in transfers)))
print('Settlement snapshot net sum:',money(sum(int(x.get('net') or 0) for x in snapshot_rows.values())))
print('Snapshot differs from live DB cash-out for:', ', '.join(p['display_name'] for p in players if p['display_name'].casefold() in snapshot_rows and snapshot_rows[p['display_name'].casefold()].get('cashout') != p['cashout']) or '(none)')
print('Transfer statuses:')
for status in sorted(set(t['status'] for t in transfers)):
    selected=[t for t in transfers if t['status']==status]
    print(' ',status, 'count=',len(selected),'total=',money(sum(t['amount'] for t in selected)))
print('READ-ONLY COMPLETE - zero database writes; no payout corrected')
print('IMPORTANT: A missing $25 cash-out cannot be assigned to a person solely from a balanced transfer list.')
