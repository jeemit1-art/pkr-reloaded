#!/usr/bin/env node
// Read-only static safety check. No Cloudflare requests or changes.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const prod = readFileSync(resolve(root, 'wrangler.toml'), 'utf8');
const stage = readFileSync(resolve(root, 'wrangler.staging.toml'), 'utf8');

function quoted(source, key) {
  assert.match(key, /^[A-Z_a-z]+$/, 'Invalid key name');
  const match = source.match(new RegExp('^\\s*' + key + '\\s*=\\s*"([^"]+)"\\s*$', 'm'));
  assert.ok(match, 'Missing key: ' + key);
  return match[1];
}
const checks = [
  ['worker name', quoted(stage, 'name') === 'pkr-reloaded-worker-staging'],
  ['staging D1 name', quoted(stage, 'database_name') === 'pkr-reloaded-db-staging'],
  ['staging D1 ID', quoted(stage, 'database_id') === '03577857-fc94-49ed-bd1b-5cd658aa0978'],
  ['staging KV ID', quoted(stage, 'id') === '9e86adbcfb5d4817a32dfd4482d3dbf9'],
  ['same account', quoted(stage, 'account_id') === quoted(prod, 'account_id')],
  ['distinct Worker', quoted(stage, 'name') !== quoted(prod, 'name')],
  ['distinct D1', quoted(stage, 'database_id') !== quoted(prod, 'database_id')],
  ['distinct KV', quoted(stage, 'id') !== quoted(prod, 'id')],
  ['staging label', quoted(stage, 'PKR_ENV') === 'staging'],
  ['distinct frontend origin', quoted(stage, 'FRONTEND_URL') !== quoted(prod, 'FRONTEND_URL')],
  ['staging frontend origin', (() => {
    const host = new URL(quoted(stage, 'FRONTEND_URL')).hostname;
    return host.startsWith('staging.') || (host.endsWith('.vercel.app') && host.includes('-git-'));
  })()],
  ['no cron triggers', !/^\s*\[triggers\]\s*$/m.test(stage)],
  ['no production routes', !/^\s*(routes?|zone_id)\s*=/m.test(stage)],
  ['staging Google OAuth client ID differs from production', quoted(stage, 'GOOGLE_CLIENT_ID') !== quoted(prod, 'GOOGLE_CLIENT_ID')],
  ['staging Google OAuth client ID is well formed', quoted(stage, 'GOOGLE_CLIENT_ID').endsWith('.apps.googleusercontent.com')],
  ['no secrets in config', !/^\s*(JWT_SECRET|GOOGLE_CLIENT_SECRET|STRIPE_SECRET_KEY|STRIPE_WEBHOOK_SECRET|VAPID_PRIVATE_KEY|ANTHROPIC_API_KEY)\s*=/m.test(stage)],
];
const failed=checks.filter(([,good])=>!good);
for(const [label,good] of checks) console.log((good?'PASS':'FAIL')+' '+label);
if(failed.length){console.error('Unsafe staging configuration. Do not deploy.');process.exitCode=1;}
else console.log('All staging bindings are independent. No Cloudflare operations performed.');
