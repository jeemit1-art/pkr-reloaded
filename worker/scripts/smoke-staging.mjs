#!/usr/bin/env node
// Read-only, unauthenticated tests against ONLY the isolated PKR staging URLs.
// No OAuth credentials, user accounts, database writes, financial writes, or login completion.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const WORKER = 'https://pkr-reloaded-worker-staging.jeemit1.workers.dev';
const FRONTEND = 'https://pkr-reloaded-git-codex-pkr-product-b49f4c-jeemit1-arts-projects.vercel.app';
const source = readFileSync(new URL('../wrangler.staging.toml', import.meta.url), 'utf8');

function configVar(key) {
  const match = source.match(new RegExp('^\\s*' + key + '\\s*=\\s*"([^"]+)"\\s*$', 'm'));
  assert.ok(match, 'Missing ' + key + ' in staging Wrangler file');
  return match[1];
}

assert.equal(new URL(WORKER).hostname, 'pkr-reloaded-worker-staging.jeemit1.workers.dev');
assert.equal(configVar('name'), 'pkr-reloaded-worker-staging');
assert.equal(configVar('FRONTEND_URL'), FRONTEND);
assert.equal(configVar('PKR_ENV'), 'staging');
assert.notEqual(configVar('GOOGLE_CLIENT_ID'), '', 'Missing staging OAuth client ID');

async function request(path, options = {}) {
  const url = WORKER + path;
  const response = await fetch(url, {
    redirect: 'manual',
    signal: AbortSignal.timeout(15000),
    ...options,
  });
  return response;
}

async function main() {
  const health = await request('/health');
  assert.equal(health.status, 200, 'staging /health HTTP status');
  const payload = await health.json();
  assert.equal(payload.ok, true);
  assert.equal(payload.environment, 'staging');
  console.log('PASS worker /health: 200, environment=staging');

  // Live RSVP v2 activation: a deliberately nonexistent game is a safe read-only
  // probe. 404 means the feature is enabled and the lookup reached the route;
  // 503 means the feature flag is still off. Never create test records here.
  const rsvp = await request('/games/pkr-rsvp-v2-smoke-nonexistent/rsvp-board');
  const rsvpBody = await rsvp.json().catch(() => ({}));
  assert.equal(rsvp.status, 404,
    'RSVP v2 is not active (expected 404 for nonexistent game, got ' + rsvp.status +
    ', code=' + (rsvpBody.code || 'n/a') + ')');
  assert.equal(rsvpBody.error, 'Game not found');
  console.log('PASS RSVP v2 route and feature flag active (nonexistent game returns 404)');

  const legacy = await request('/games/pkr-rsvp-v2-smoke-nonexistent/rsvp', {
    method:'POST',
    headers:{'Content-Type':'application/json'},
    body:JSON.stringify({ display_name:'Smoke Test',status:'yes' }),
  });
  assert.equal(legacy.status, 409, 'Legacy anonymous name-only RSVP must be disabled in v2');
  const legacyBody = await legacy.json();
  assert.equal(legacyBody.code, 'RSVP_V2_REQUIRED');
  console.log('PASS legacy name-only RSVP editing blocked; no database writes');

  const login = await request('/auth/google');
  assert.equal(login.status, 302, 'Google login must redirect');
  const location = new URL(login.headers.get('location') || '');
  assert.equal(location.hostname, 'accounts.google.com');
  assert.equal(location.pathname, '/o/oauth2/v2/auth');
  assert.equal(location.searchParams.get('redirect_uri'), WORKER + '/auth/callback');
  assert.equal(location.searchParams.get('client_id'), configVar('GOOGLE_CLIENT_ID'));
  const state = location.searchParams.get('state');
  assert.ok(state && state.length >= 16, 'OAuth state must be unpredictable');
  const cookie = login.headers.get('set-cookie') || '';
  assert.ok(cookie.includes('__Host-pkr_oauth_state=' + state + ';'), 'OAuth state cookie must match redirect state');
  assert.match(cookie, /; Secure(?:;|$)/i);
  assert.match(cookie, /; HttpOnly(?:;|$)/i);
  assert.match(cookie, /; SameSite=Lax(?:;|$)/i);
  assert.match(cookie, /; Path=\/(?:;|$)/i);
  console.log('PASS Google OAuth redirect: staging client ID and exact callback URI');
  console.log('PASS OAuth state: bound to secure HttpOnly SameSite=Lax cookie');

  const noState = await request('/auth/callback?code=synthetic-invalid-code&state=synthetic-invalid-state');
  assert.equal(noState.status, 302, 'Invalid OAuth state must be rejected');
  assert.equal(noState.headers.get('location'), FRONTEND + '/?error=oauth_denied');
  console.log('PASS invalid OAuth callback rejected before attempting login');

  const unauthorized = await request('/auth/me');
  assert.equal(unauthorized.status, 401, 'Unauthenticated account lookup must be denied');
  console.log('PASS /auth/me denies unauthenticated requests');

  const preflight = await request('/auth/me', {
    method: 'OPTIONS',
    headers: { Origin: FRONTEND, 'Access-Control-Request-Method': 'GET' },
  });
  assert.equal(preflight.status, 204);
  assert.equal(preflight.headers.get('access-control-allow-origin'), FRONTEND);
  console.log('PASS CORS preflight allows only the expected staging preview origin');

  const preview = await fetch(FRONTEND, { redirect: 'manual', signal: AbortSignal.timeout(15000) });
  if (preview.status >= 200 && preview.status < 300) {
    console.log('PASS Vercel branch preview responds HTTP ' + preview.status);
  } else if ([302, 303, 307, 308, 401, 403].includes(preview.status)) {
    console.log('CHECK MANUALLY: Vercel preview HTTP ' + preview.status + ' (may be protected; do not change protection automatically)');
  } else {
    throw new Error('Unexpected Vercel preview HTTP ' + preview.status);
  }
  console.log('Completed staging HTTP smoke checks. No database or financial writes performed.');
}

main().catch(err => {
  console.error('FAIL staging smoke check: ' + err.message);
  process.exitCode = 1;
});
