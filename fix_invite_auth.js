const fs = require('fs');

let fixed = 0;
let skipped = 0;

function applyFix(label, file, find, replace) {
  if (!fs.existsSync(file)) { console.warn(`⚠️  SKIP [${label}] — file not found`); skipped++; return; }
  const c = fs.readFileSync(file, 'utf8');
  if (!c.includes(find)) { console.warn(`⚠️  SKIP [${label}] — already applied?`); skipped++; return; }
  fs.writeFileSync(file, c.replace(find, replace), 'utf8');
  console.log(`✅  DONE [${label}]`);
  fixed++;
}

const INVITE = 'frontend/src/app/invite/[token]/page.tsx';
const AUTH   = 'worker/src/routes/auth.ts';

[INVITE, AUTH].forEach(f => {
  if (fs.existsSync(f) && !fs.existsSync(f + '.bak')) {
    fs.writeFileSync(f + '.bak', fs.readFileSync(f));
    console.log(`📦 Backed up: ${f}`);
  }
});

console.log('\n── Fix 1: Invite page — add returnTo to Google auth URL ──\n');
applyFix('Add returnTo to Google auth link', INVITE,
  'href={`${apiUrl}/auth/google`}',
  'href={`${apiUrl}/auth/google?returnTo=${encodeURIComponent(\`/invite/${token}\`)}`}'
);

console.log('\n── Fix 2: Worker /auth/google — pass returnTo through OAuth state ──\n');
applyFix('Pass returnTo via state', AUTH,
`auth.get('/google', async (c) => {
  const state = generateId();
  const params = new URLSearchParams({
    client_id:    c.env.GOOGLE_CLIENT_ID,
    redirect_uri: \`\${new URL(c.req.url).origin}/auth/callback\`,
    response_type:'code',
    scope:        'openid email profile',
    state,
    access_type:  'offline',
    prompt:       'select_account',
  });
  return c.redirect(\`https://accounts.google.com/o/oauth2/v2/auth?\${params}\`);
});`,
`auth.get('/google', async (c) => {
  const returnTo = c.req.query('returnTo') || '';
  const stateId = generateId();
  // Encode returnTo inside state so we get it back after OAuth round-trip
  const state = returnTo ? \`\${stateId}:\${encodeURIComponent(returnTo)}\` : stateId;
  const params = new URLSearchParams({
    client_id:    c.env.GOOGLE_CLIENT_ID,
    redirect_uri: \`\${new URL(c.req.url).origin}/auth/callback\`,
    response_type:'code',
    scope:        'openid email profile',
    state,
    access_type:  'offline',
    prompt:       'select_account',
  });
  return c.redirect(\`https://accounts.google.com/o/oauth2/v2/auth?\${params}\`);
});`
);

console.log('\n── Fix 3: Worker /auth/callback — redirect to returnTo after login ──\n');
applyFix('Use returnTo in callback redirect', AUTH,
`  // ── Store JWT under a short-lived one-time code (30s) instead of passing it in URL ──
  const loginCode = generateId();
  await c.env.KV.put(\`login_code:\${loginCode}\`, jwt, { expirationTtl: 60 });

  const cookie = [\`pkr_token=\${jwt}\`,'Path=/','HttpOnly','SameSite=None','Secure',\`Max-Age=\${60*60*24*7}\`].join('; ');
  // Pass a short-lived code — dashboard exchanges it for the real JWT
  return new Response(null, {
    status: 302,
    headers: { Location:\`\${front}/dashboard?code=\${loginCode}\`, 'Set-Cookie': cookie },
  });`,
`  // ── Store JWT under a short-lived one-time code (30s) instead of passing it in URL ──
  const loginCode = generateId();
  await c.env.KV.put(\`login_code:\${loginCode}\`, jwt, { expirationTtl: 60 });

  const cookie = [\`pkr_token=\${jwt}\`,'Path=/','HttpOnly','SameSite=None','Secure',\`Max-Age=\${60*60*24*7}\`].join('; ');

  // Extract returnTo from state if present (format: "stateId:encodedReturnTo")
  const colonIdx = (state || '').indexOf(':');
  const returnTo = colonIdx !== -1 ? decodeURIComponent(state.slice(colonIdx + 1)) : '';
  // Validate returnTo — only allow internal paths to prevent open redirect
  const safePath = returnTo.startsWith('/') && !returnTo.startsWith('//') ? returnTo : '/dashboard';
  const destination = safePath === '/dashboard'
    ? \`\${front}/dashboard?code=\${loginCode}\`
    : \`\${front}\${safePath}?code=\${loginCode}\`;

  return new Response(null, {
    status: 302,
    headers: { Location: destination, 'Set-Cookie': cookie },
  });`
);

console.log('\n' + '─'.repeat(50));
console.log(`\n✅ ${fixed} fix(es) applied, ⚠️  ${skipped} skipped.\n`);
console.log('Next steps:');
console.log("  git add 'frontend/src/app/invite/[token]/page.tsx' worker/src/routes/auth.ts");
console.log('  git commit -m "fix: preserve returnTo through Google OAuth so invite links work after login"');
console.log('  git push\n');
