// scripts/shopify-session-smoke.js
const BASE = (process.env.SMOKE_BASE_URL || 'http://localhost:3000').replace(/\/$/, '');

async function run() {
  let passed = 0;
  console.log(`Running Shopify session smoke tests against ${BASE}`);

  // 1. No token → 401
  let r = await fetch(`${BASE}/api/secure/ping`);
  console.assert(r.status === 401, `Expected 401 without token, got ${r.status}`);
  console.log('✅ Protected route without token');
  passed++;

  // 2. Invalid token → 401 + both reauth headers
  r = await fetch(`${BASE}/api/secure/ping`, {
    headers: { Authorization: 'Bearer invalid-token' },
  });
  console.assert(r.status === 401, `Expected 401 with invalid token, got ${r.status}`);
  const retry  = r.headers.get('X-Shopify-Retry-Invalid-Session-Request');
  const reauth = r.headers.get('X-Shopify-API-Request-Failure-Reauthorize');
  console.assert(retry === '1',  `Expected Retry header = 1, got "${retry}"`);
  console.assert(reauth === '1', `Expected Reauthorize header = 1, got "${reauth}"`);
  console.log('✅ Protected route with invalid token');
  passed++;

  // 3. Fake valid-looking JWT → still 401 (wrong secret)
  const fakeJwt = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJ0ZXN0IiwiZGVzdCI6Imh0dHBzOi8vdGVzdC5teXNob3BpZnkuY29tIiwiYXVkIjoidGVzdC1rZXkiLCJpYXQiOjE3MDAwMDAwMDB9.fake';
  r = await fetch(`${BASE}/api/secure/ping`, {
    headers: { Authorization: `Bearer ${fakeJwt}` },
  });
  console.assert(r.status === 401, `Expected 401 with fake token, got ${r.status}`);
  console.log('✅ Protected route with valid token');
  passed++;

  // 4. Public config → 200
  r = await fetch(`${BASE}/api/public-config`);
  console.assert(r.status === 200, `Expected 200 on public-config, got ${r.status}`);
  console.log('✅ Allowlist route /api/public-config');
  passed++;

  // 5. Login → NOT blocked by session gate (200 or 4xx from credentials, not 401 from token gate)
  r = await fetch(`${BASE}/api/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: '{}',
  });
  console.assert(r.status !== 401, `Expected non-401 on /api/login bypass, got ${r.status}`);
  console.log('✅ Allowlist route /api/login bypass');
  passed++;

  console.log(`\n✅ All Shopify session smoke tests passed`);
}

run().catch((e) => {
  console.error('❌ Smoke test failed:', e.message);
  process.exit(1);
});
