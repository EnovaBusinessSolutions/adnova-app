'use strict';

const crypto = require('crypto');
const express = require('express');
const router = express.Router();

const OAuthClient = require('./models/OAuthClient');
const OAuthCode = require('./models/OAuthCode');
const OAuthToken = require('./models/OAuthToken');

const APP_URL = (process.env.APP_URL || 'https://adray.ai').replace(/\/$/, '');
const CODE_LIFETIME_MS = 10 * 60 * 1000;
const ACCESS_TOKEN_LIFETIME_MS = 60 * 60 * 1000;
const REFRESH_TOKEN_LIFETIME_MS = 30 * 24 * 60 * 60 * 1000;

function generateToken() {
  return crypto.randomBytes(32).toString('hex');
}

function generateCode() {
  return crypto.randomBytes(24).toString('base64url');
}

function verifyPkce(codeVerifier, codeChallenge, method) {
  if (!codeChallenge) return true;
  if (method === 'S256') {
    const hash = crypto.createHash('sha256').update(codeVerifier).digest('base64url');
    return hash === codeChallenge;
  }
  return codeVerifier === codeChallenge;
}

/**
 * GET /oauth/authorize
 * Shows consent screen or redirects with authorization code.
 * Expects the user to already be logged into Adray (session-based).
 */
router.get('/authorize', async (req, res) => {
  try {
    const {
      client_id,
      redirect_uri,
      response_type,
      scope,
      state,
      code_challenge,
      code_challenge_method,
    } = req.query;

    if (response_type !== 'code') {
      return res.status(400).json({
        error: 'unsupported_response_type',
        error_description: 'Only response_type=code is supported.',
      });
    }

    if (!client_id || !redirect_uri) {
      return res.status(400).json({
        error: 'invalid_request',
        error_description: 'client_id and redirect_uri are required.',
      });
    }

    const client = await OAuthClient.findOne({ clientId: client_id, active: true });
    if (!client) {
      return res.status(400).json({
        error: 'invalid_client',
        error_description: 'Unknown client_id.',
      });
    }

    if (client.redirectUris.length > 0 && !client.redirectUris.includes(redirect_uri)) {
      return res.status(400).json({
        error: 'invalid_redirect_uri',
        error_description: 'redirect_uri not registered for this client.',
      });
    }

    const userId = req.user?._id || req.session?.passport?.user;
    if (!userId) {
      const returnUrl = `${APP_URL}/oauth/authorize?${new URLSearchParams(req.query).toString()}`;
      return res.redirect(`${APP_URL}/login?returnTo=${encodeURIComponent(returnUrl)}`);
    }

    const requestedScopes = scope
      ? scope.split(/[\s,]+/).filter(Boolean)
      : client.scopes;

    const code = generateCode();
    await OAuthCode.create({
      code,
      userId,
      clientId: client_id,
      redirectUri: redirect_uri,
      scopes: requestedScopes,
      codeChallenge: code_challenge || null,
      codeChallengeMethod: code_challenge_method || null,
      expiresAt: new Date(Date.now() + CODE_LIFETIME_MS),
    });

    const url = new URL(redirect_uri);
    url.searchParams.set('code', code);
    if (state) url.searchParams.set('state', state);

    return res.redirect(url.toString());
  } catch (err) {
    console.error('[oauth/authorize] error:', err);
    return res.status(500).json({ error: 'server_error' });
  }
});

/**
 * POST /oauth/token
 * Exchange authorization code for tokens, or refresh an access token.
 */
router.post('/token', express.urlencoded({ extended: false }), async (req, res) => {
  try {
    const { grant_type, code, redirect_uri, client_id, client_secret, refresh_token, code_verifier } = req.body;

    if (grant_type === 'authorization_code') {
      if (!code || !redirect_uri || !client_id) {
        return res.status(400).json({
          error: 'invalid_request',
          error_description: 'code, redirect_uri, and client_id are required.',
        });
      }

      const client = await OAuthClient.findOne({ clientId: client_id, active: true });
      if (!client) {
        return res.status(401).json({ error: 'invalid_client' });
      }

      if (client_secret && client.clientSecret !== client_secret) {
        return res.status(401).json({ error: 'invalid_client' });
      }

      const authCode = await OAuthCode.findOne({
        code,
        clientId: client_id,
        used: false,
        expiresAt: { $gt: new Date() },
      });

      if (!authCode) {
        return res.status(400).json({ error: 'invalid_grant', error_description: 'Code expired or invalid.' });
      }

      if (authCode.redirectUri !== redirect_uri) {
        return res.status(400).json({ error: 'invalid_grant', error_description: 'redirect_uri mismatch.' });
      }

      if (authCode.codeChallenge && code_verifier) {
        if (!verifyPkce(code_verifier, authCode.codeChallenge, authCode.codeChallengeMethod)) {
          return res.status(400).json({ error: 'invalid_grant', error_description: 'PKCE verification failed.' });
        }
      } else if (authCode.codeChallenge && !code_verifier) {
        return res.status(400).json({ error: 'invalid_grant', error_description: 'code_verifier required.' });
      }

      authCode.used = true;
      await authCode.save();

      const accessToken = generateToken();
      const newRefreshToken = generateToken();
      const now = new Date();

      await OAuthToken.create({
        accessToken,
        refreshToken: newRefreshToken,
        userId: authCode.userId,
        clientId: client_id,
        scopes: authCode.scopes,
        accessTokenExpiresAt: new Date(now.getTime() + ACCESS_TOKEN_LIFETIME_MS),
        refreshTokenExpiresAt: new Date(now.getTime() + REFRESH_TOKEN_LIFETIME_MS),
      });

      return res.json({
        access_token: accessToken,
        token_type: 'Bearer',
        expires_in: Math.floor(ACCESS_TOKEN_LIFETIME_MS / 1000),
        refresh_token: newRefreshToken,
        scope: authCode.scopes.join(' '),
      });
    }

    if (grant_type === 'refresh_token') {
      if (!refresh_token || !client_id) {
        return res.status(400).json({ error: 'invalid_request' });
      }

      const existing = await OAuthToken.findOne({
        refreshToken: refresh_token,
        clientId: client_id,
        revoked: { $ne: true },
        refreshTokenExpiresAt: { $gt: new Date() },
      });

      if (!existing) {
        return res.status(400).json({ error: 'invalid_grant', error_description: 'Refresh token expired or invalid.' });
      }

      existing.revoked = true;
      await existing.save();

      const accessToken = generateToken();
      const newRefreshToken = generateToken();
      const now = new Date();

      await OAuthToken.create({
        accessToken,
        refreshToken: newRefreshToken,
        userId: existing.userId,
        clientId: client_id,
        scopes: existing.scopes,
        accessTokenExpiresAt: new Date(now.getTime() + ACCESS_TOKEN_LIFETIME_MS),
        refreshTokenExpiresAt: new Date(now.getTime() + REFRESH_TOKEN_LIFETIME_MS),
      });

      return res.json({
        access_token: accessToken,
        token_type: 'Bearer',
        expires_in: Math.floor(ACCESS_TOKEN_LIFETIME_MS / 1000),
        refresh_token: newRefreshToken,
        scope: existing.scopes.join(' '),
      });
    }

    return res.status(400).json({ error: 'unsupported_grant_type' });
  } catch (err) {
    console.error('[oauth/token] error:', err);
    return res.status(500).json({ error: 'server_error' });
  }
});

/**
 * POST /oauth/revoke
 */
router.post('/revoke', express.urlencoded({ extended: false }), async (req, res) => {
  try {
    const { token, token_type_hint } = req.body;
    if (!token) {
      return res.status(400).json({ error: 'invalid_request' });
    }

    const query =
      token_type_hint === 'refresh_token'
        ? { refreshToken: token }
        : { $or: [{ accessToken: token }, { refreshToken: token }] };

    await OAuthToken.updateMany(query, { $set: { revoked: true } });

    return res.status(200).json({ ok: true });
  } catch (err) {
    console.error('[oauth/revoke] error:', err);
    return res.status(500).json({ error: 'server_error' });
  }
});

module.exports = router;
