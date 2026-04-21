'use strict';

const crypto = require('crypto');

describe('OAuth Token Generation', () => {
  test('generates unique tokens', () => {
    const tokens = new Set();
    for (let i = 0; i < 100; i++) {
      tokens.add(crypto.randomBytes(32).toString('hex'));
    }
    expect(tokens.size).toBe(100);
  });

  test('generates unique authorization codes', () => {
    const codes = new Set();
    for (let i = 0; i < 100; i++) {
      codes.add(crypto.randomBytes(24).toString('base64url'));
    }
    expect(codes.size).toBe(100);
  });
});

describe('PKCE Verification', () => {
  function verifyPkce(codeVerifier, codeChallenge, method) {
    if (!codeChallenge) return true;
    if (method === 'S256') {
      const hash = crypto.createHash('sha256').update(codeVerifier).digest('base64url');
      return hash === codeChallenge;
    }
    return codeVerifier === codeChallenge;
  }

  test('S256 challenge matches', () => {
    const verifier = crypto.randomBytes(32).toString('base64url');
    const challenge = crypto.createHash('sha256').update(verifier).digest('base64url');
    expect(verifyPkce(verifier, challenge, 'S256')).toBe(true);
  });

  test('S256 challenge fails with wrong verifier', () => {
    const verifier = crypto.randomBytes(32).toString('base64url');
    const wrongVerifier = crypto.randomBytes(32).toString('base64url');
    const challenge = crypto.createHash('sha256').update(verifier).digest('base64url');
    expect(verifyPkce(wrongVerifier, challenge, 'S256')).toBe(false);
  });

  test('plain method matches', () => {
    const verifier = 'my_plain_verifier';
    expect(verifyPkce(verifier, verifier, 'plain')).toBe(true);
  });

  test('no challenge always passes', () => {
    expect(verifyPkce('anything', null, 'S256')).toBe(true);
  });
});

describe('OAuth Scopes', () => {
  const VALID_SCOPES = ['read:ads_performance', 'read:shopify_orders'];

  test('Phase 1 scopes are defined', () => {
    expect(VALID_SCOPES).toContain('read:ads_performance');
    expect(VALID_SCOPES).toContain('read:shopify_orders');
  });

  test('scope string parsing', () => {
    const scopeStr = 'read:ads_performance read:shopify_orders';
    const parsed = scopeStr.split(/[\s,]+/).filter(Boolean);
    expect(parsed).toEqual(VALID_SCOPES);
  });
});
