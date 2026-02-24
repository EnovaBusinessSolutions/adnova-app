#!/usr/bin/env node

require('dotenv').config();
const jwt = require('jsonwebtoken');

const BASE_URL = (process.env.SMOKE_BASE_URL || 'http://localhost:3000').replace(/\/$/, '');

function ok(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function hasHeader(response, name) {
  return response.headers.get(name) || response.headers.get(name.toLowerCase());
}

async function request(path, init) {
  const url = `${BASE_URL}${path}`;
  const response = await fetch(url, init);
  const text = await response.text().catch(() => '');
  return { response, text };
}

async function testProtectedWithoutToken() {
  const { response, text } = await request('/api/secure/ping');

  ok(response.status === 401, `Expected 401 for protected route without token, got ${response.status}. Body: ${text}`);
  ok(Boolean(hasHeader(response, 'X-Shopify-Retry-Invalid-Session-Request')), 'Missing X-Shopify-Retry-Invalid-Session-Request header');
  ok(Boolean(hasHeader(response, 'X-Shopify-API-Request-Failure-Reauthorize')), 'Missing X-Shopify-API-Request-Failure-Reauthorize header');
}

async function testProtectedWithInvalidToken() {
  const { response, text } = await request('/api/secure/ping', {
    headers: { Authorization: 'Bearer invalid.token.value' },
  });

  ok(response.status === 401, `Expected 401 for protected route with invalid token, got ${response.status}. Body: ${text}`);
  ok(Boolean(hasHeader(response, 'X-Shopify-Retry-Invalid-Session-Request')), 'Missing retry header on invalid token');
  ok(Boolean(hasHeader(response, 'X-Shopify-API-Request-Failure-Reauthorize')), 'Missing reauthorize header on invalid token');
}

async function testAllowlistPublicConfig() {
  const { response, text } = await request('/api/public-config');
  ok(response.status >= 200 && response.status < 300, `Expected 2xx for /api/public-config allowlist route, got ${response.status}. Body: ${text}`);
}

async function testAllowlistLoginNotBlockedByTokenGate() {
  const { response } = await request('/api/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({}),
  });

  ok(response.status !== 401, `Expected /api/login to bypass token gate (not 401), got ${response.status}`);
}

async function testProtectedWithValidToken() {
  const secret = process.env.SHOPIFY_API_SECRET;
  const apiKey = process.env.SHOPIFY_API_KEY;

  if (!secret || !apiKey) {
    console.log('ℹ️ Skipping valid-token test (missing SHOPIFY_API_SECRET/SHOPIFY_API_KEY)');
    return;
  }

  const token = jwt.sign(
    {
      aud: apiKey,
      dest: 'https://smoke-test-shop.myshopify.com',
      iss: 'https://smoke-test-shop.myshopify.com/admin',
      sub: 'smoke-user',
    },
    secret,
    { algorithm: 'HS256', expiresIn: '60s' }
  );

  const { response, text } = await request('/api/secure/ping', {
    headers: { Authorization: `Bearer ${token}` },
  });

  ok(response.status === 200, `Expected 200 for protected route with valid token, got ${response.status}. Body: ${text}`);
}

async function main() {
  const tests = [
    { name: 'Protected route without token', run: testProtectedWithoutToken },
    { name: 'Protected route with invalid token', run: testProtectedWithInvalidToken },
    { name: 'Protected route with valid token', run: testProtectedWithValidToken },
    { name: 'Allowlist route /api/public-config', run: testAllowlistPublicConfig },
    { name: 'Allowlist route /api/login bypass', run: testAllowlistLoginNotBlockedByTokenGate },
  ];

  console.log(`Running Shopify session smoke tests against ${BASE_URL}`);

  for (const test of tests) {
    try {
      await test.run();
      console.log(`✅ ${test.name}`);
    } catch (error) {
      console.error(`❌ ${test.name}`);
      console.error(`   ${error.message}`);
      process.exitCode = 1;
      return;
    }
  }

  console.log('✅ All Shopify session smoke tests passed');
}

main().catch((error) => {
  console.error('❌ Smoke test runner failed');
  console.error(error);
  process.exitCode = 1;
});
