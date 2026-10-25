#!/usr/bin/env node
// Fail closed BEFORE changing the staging Worker if OAuth/session secrets are
// missing. Never print secret values or touch the production Worker.
import { execFileSync } from 'node:child_process';
const required = ['GOOGLE_CLIENT_SECRET', 'JWT_SECRET'];
let items;
try {
  const raw = execFileSync(process.platform === 'win32' ? 'npx.cmd' : 'npx',
    ['wrangler', 'secret', 'list', '--config', 'wrangler.staging.toml'], {
      cwd: process.cwd(), encoding: 'utf8',
      stdio: ['ignore','pipe','pipe'], timeout: 45000
    });
  items = JSON.parse(raw);
} catch {
  console.error('STAGING DEPLOY BLOCKED: Could not verify staging Worker secret names.');
  process.exit(1);
}
if (!Array.isArray(items)) {
  console.error('STAGING DEPLOY BLOCKED: Invalid secret-list response.');
  process.exit(1);
}
const found = new Set(items.map(x=>x.name));
const missing = required.filter(x=>!found.has(x));
if(missing.length) {
  console.error('STAGING DEPLOY BLOCKED: Missing required staging secrets: '+missing.join(', '));
  console.error('Set them on pkr-reloaded-worker-staging before triggering an isolated staging deployment.');
  process.exit(1);
}
console.log('PASS: Staging OAuth and session secret names exist (values not accessed).');
