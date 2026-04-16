'use strict';

const crypto = require('crypto');
const express = require('express');
const router = express.Router();

const OAuthClient = require('./models/OAuthClient');
const OAuthCode = require('./models/OAuthCode');
const OAuthToken = require('./models/OAuthToken');

const APP_URL = (process.env.APP_URL || 'https://adray.ai').replace(/\/$/, '');
const CODE_LIFETIME_MS = 10 * 60 * 1000;

const SCOPE_LABELS = {
  'read:ads_performance': 'Ver rendimiento de campañas publicitarias (Meta Ads, Google Ads)',
  'read:shopify_orders': 'Ver ingresos y productos de tu tienda Shopify',
};

const CLIENT_DISPLAY_NAMES = {
  'claude-connector': 'Claude (Anthropic)',
  'chatgpt-connector': 'ChatGPT (OpenAI)',
  'gemini-connector': 'Gemini (Google)',
};

function renderConsentPage({ clientName, scopes, query }) {
  const scopeItems = scopes
    .map((s) => `<li>${SCOPE_LABELS[s] || s}</li>`)
    .join('');
  const hiddenFields = Object.entries(query)
    .map(([k, v]) => `<input type="hidden" name="${k}" value="${String(v).replace(/"/g, '&quot;')}">`)
    .join('\n        ');

  return `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Autorizar acceso — Adray.ai</title>
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background: #f5f5f5;
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 24px;
    }
    .card {
      background: #fff;
      border-radius: 12px;
      box-shadow: 0 4px 24px rgba(0,0,0,0.08);
      padding: 40px;
      max-width: 440px;
      width: 100%;
    }
    .logo { font-size: 22px; font-weight: 700; color: #1a1a1a; margin-bottom: 8px; }
    .subtitle { font-size: 14px; color: #666; margin-bottom: 28px; }
    h2 { font-size: 18px; font-weight: 600; color: #1a1a1a; margin-bottom: 6px; }
    .client { font-size: 15px; color: #444; margin-bottom: 24px; }
    .client strong { color: #1a1a1a; }
    .permissions-title { font-size: 13px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.05em; color: #888; margin-bottom: 10px; }
    ul { list-style: none; margin-bottom: 32px; }
    ul li {
      font-size: 14px; color: #444;
      padding: 10px 12px;
      background: #f9f9f9;
      border-radius: 8px;
      margin-bottom: 6px;
    }
    ul li::before { content: "✓  "; color: #22c55e; font-weight: 700; }
    .actions { display: flex; gap: 12px; }
    button {
      flex: 1;
      padding: 12px;
      border-radius: 8px;
      font-size: 15px;
      font-weight: 600;
      border: none;
      cursor: pointer;
      transition: opacity 0.15s;
    }
    button:hover { opacity: 0.85; }
    .btn-allow { background: #1a1a1a; color: #fff; }
    .btn-deny { background: #f0f0f0; color: #444; }
    .footer { margin-top: 20px; font-size: 12px; color: #aaa; text-align: center; }
  </style>
</head>
<body>
  <div class="card">
    <div class="logo">Adray.ai</div>
    <div class="subtitle">Solicitud de acceso a tus datos de marketing</div>
    <h2>Autorizar conexión</h2>
    <p class="client"><strong>${clientName}</strong> quiere acceder a tu cuenta de Adray.ai.</p>
    <div class="permissions-title">Permisos solicitados</div>
    <ul>${scopeItems}</ul>
    <div class="actions">
      <form method="POST" action="/oauth/authorize" style="flex:1">
        ${hiddenFields}
        <button type="submit" name="_action" value="allow" class="btn-allow">Autorizar</button>
      </form>
      <form method="POST" action="/oauth/authorize" style="flex:1">
        ${hiddenFields}
        <button type="submit" name="_action" value="deny" class="btn-deny">Cancelar</button>
      </form>
    </div>
    <div class="footer">Solo lectura — no se realizarán cambios en tus cuentas.</div>
  </div>
</body>
</html>`;
}
const ACCESS_TOKEN_LIFETIME_MS = 60 * 60 * 1000;
const REFRESH_TOKEN_LIFETIME_MS = 180 * 24 * 60 * 60 * 1000;
const TOKEN_EXCHANGE_GRANTS = new Set([
  'urn:ietf:params:oauth:grant-type:token-exchange',
  'token_exchange',
]);
const DEFAULT_CHATGPT_REDIRECT_PATTERNS = ['https://chat.openai.com/aip/*/oauth/callback'];

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

function parseScopes(scopeValue) {
  if (!scopeValue) return null;
  const parsed = String(scopeValue)
    .split(/[\s,]+/)
    .map((s) => s.trim())
    .filter(Boolean);
  return parsed.length ? parsed : null;
}

function filterAllowedScopes(requestedScopes, allowedScopes) {
  const allowed = new Set((allowedScopes || []).filter(Boolean));
  if (!requestedScopes?.length) return Array.from(allowed);
  return requestedScopes.filter((scope) => allowed.has(scope));
}

function isGrantAllowed(client, grantType) {
  const allowed = Array.isArray(client?.grantsAllowed) && client.grantsAllowed.length
    ? client.grantsAllowed
    : ['authorization_code', 'refresh_token', 'urn:ietf:params:oauth:grant-type:token-exchange'];
  return allowed.includes(grantType);
}

function normalizeRedirectUri(value) {
  const trimmed = String(value || '').trim();
  if (!trimmed) return { ok: false, reason: 'empty', value: null };
  try {
    const parsed = new URL(trimmed);
    return { ok: true, value: parsed.toString() };
  } catch {
    return { ok: false, reason: 'malformed', value: null };
  }
}

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function wildcardPatternToRegex(pattern) {
  const escaped = escapeRegex(pattern).replace(/\\\*/g, '.*');
  return new RegExp(`^${escaped}$`);
}

function isRedirectUriAllowed(client, normalizedRedirectUri) {
  const exactUris = Array.isArray(client?.redirectUris)
    ? client.redirectUris.map((u) => normalizeRedirectUri(u).value).filter(Boolean)
    : [];
  const patternUris = Array.isArray(client?.redirectUriPatterns) && client.redirectUriPatterns.length
    ? client.redirectUriPatterns
    : DEFAULT_CHATGPT_REDIRECT_PATTERNS;

  if (!exactUris.length && !patternUris.length) return true;
  if (exactUris.includes(normalizedRedirectUri)) return true;

  for (const pattern of patternUris) {
    if (!pattern || !String(pattern).trim()) continue;
    const normalizedPattern = String(pattern).trim();
    try {
      if (wildcardPatternToRegex(normalizedPattern).test(normalizedRedirectUri)) {
        return true;
      }
    } catch {
      // Ignore invalid patterns to prevent breaking all auth flows.
    }
  }
  return false;
}

function resolveAuthenticatedUserId(req) {
  if (req?.isAuthenticated?.() && req.user?._id) return req.user._id;
  if (req?.user?._id) return req.user._id;
  if (req?.session?.passport?.user) return req.session.passport.user;
  return null;
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
    const normalizedRedirect = normalizeRedirectUri(redirect_uri);
    if (!normalizedRedirect.ok) {
      console.warn('[oauth/authorize] invalid redirect_uri format', {
        clientId: client_id || null,
        reason: normalizedRedirect.reason,
      });
      return res.status(400).json({
        error: 'invalid_redirect_uri',
        error_description: 'Malformed redirect_uri.',
      });
    }

    const client = await OAuthClient.findOne({ clientId: client_id, active: true });
    if (!client) {
      console.warn('[oauth/authorize] unknown client_id', { clientId: client_id || null });
      return res.status(400).json({
        error: 'invalid_client',
        error_description: 'Unknown client_id.',
      });
    }

    if (!isRedirectUriAllowed(client, normalizedRedirect.value)) {
      console.warn('[oauth/authorize] redirect_uri not allowed', {
        clientId: client_id,
        redirectUri: normalizedRedirect.value,
      });
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

    const clientName = CLIENT_DISPLAY_NAMES[client_id] || client.name || client_id;
    return res.send(renderConsentPage({ clientName, scopes: requestedScopes, query: req.query }));
  } catch (err) {
    console.error('[oauth/authorize] error:', err);
    return res.status(500).json({ error: 'server_error' });
  }
});

/**
 * POST /oauth/authorize
 * Handles user consent form submission (allow or deny).
 */
router.post('/authorize', express.urlencoded({ extended: false }), async (req, res) => {
  try {
    const {
      _action,
      client_id,
      redirect_uri,
      response_type,
      scope,
      state,
      code_challenge,
      code_challenge_method,
    } = req.body;

    if (!client_id || !redirect_uri) {
      return res.status(400).json({ error: 'invalid_request' });
    }

    const normalizedRedirect = normalizeRedirectUri(redirect_uri);
    if (!normalizedRedirect.ok) {
      return res.status(400).json({ error: 'invalid_redirect_uri' });
    }

    // If user denied, redirect back with error
    if (_action === 'deny') {
      const url = new URL(normalizedRedirect.value);
      url.searchParams.set('error', 'access_denied');
      url.searchParams.set('error_description', 'The user denied the authorization request.');
      if (state) url.searchParams.set('state', state);
      return res.redirect(url.toString());
    }

    const userId = req.user?._id || req.session?.passport?.user;
    if (!userId) {
      return res.status(401).json({ error: 'unauthorized' });
    }

    const client = await OAuthClient.findOne({ clientId: client_id, active: true });
    if (!client || !isRedirectUriAllowed(client, normalizedRedirect.value)) {
      return res.status(400).json({ error: 'invalid_client' });
    }

    const requestedScopes = scope
      ? scope.split(/[\s,]+/).filter(Boolean)
      : client.scopes;

    const code = generateCode();
    await OAuthCode.create({
      code,
      userId,
      clientId: client_id,
      redirectUri: normalizedRedirect.value,
      scopes: requestedScopes,
      codeChallenge: code_challenge || null,
      codeChallengeMethod: code_challenge_method || null,
      expiresAt: new Date(Date.now() + CODE_LIFETIME_MS),
    });

    const url = new URL(normalizedRedirect.value);
    url.searchParams.set('code', code);
    if (state) url.searchParams.set('state', state);

    return res.redirect(url.toString());
  } catch (err) {
    console.error('[oauth/authorize POST] error:', err);
    return res.status(500).json({ error: 'server_error' });
  }
});

/**
 * POST /oauth/token
 * Exchange authorization code for tokens, or refresh an access token.
 */
router.post('/token', express.urlencoded({ extended: false }), express.json(), async (req, res) => {
  try {
    const {
      grant_type,
      code,
      redirect_uri,
      client_id,
      client_secret,
      refresh_token,
      code_verifier,
      scope,
    } = req.body;

    if (grant_type === 'authorization_code') {
      if (!code || !redirect_uri || !client_id) {
        return res.status(400).json({
          error: 'invalid_request',
          error_description: 'code, redirect_uri, and client_id are required.',
        });
      }
      const normalizedRedirect = normalizeRedirectUri(redirect_uri);
      if (!normalizedRedirect.ok) {
        return res.status(400).json({
          error: 'invalid_grant',
          error_description: 'Malformed redirect_uri.',
        });
      }

      const client = await OAuthClient.findOne({ clientId: client_id, active: true });
      if (!client) {
        return res.status(401).json({ error: 'invalid_client' });
      }
      if (!isGrantAllowed(client, 'authorization_code')) {
        return res.status(400).json({ error: 'unauthorized_client' });
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

      const normalizedAuthCodeRedirect = normalizeRedirectUri(authCode.redirectUri);
      const storedRedirect = normalizedAuthCodeRedirect.ok
        ? normalizedAuthCodeRedirect.value
        : String(authCode.redirectUri || '').trim();
      if (storedRedirect !== normalizedRedirect.value) {
        console.warn('[oauth/token] redirect_uri mismatch', {
          clientId: client_id,
          expectedRedirectUri: storedRedirect,
          receivedRedirectUri: normalizedRedirect.value,
        });
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

      const client = await OAuthClient.findOne({ clientId: client_id, active: true }).lean();
      if (!client) {
        return res.status(401).json({ error: 'invalid_client' });
      }
      if (!isGrantAllowed(client, 'refresh_token')) {
        return res.status(400).json({ error: 'unauthorized_client' });
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

    if (TOKEN_EXCHANGE_GRANTS.has(grant_type)) {
      if (!client_id) {
        return res.status(400).json({
          error: 'invalid_request',
          error_description: 'client_id is required.',
        });
      }

      const client = await OAuthClient.findOne({ clientId: client_id, active: true });
      if (!client) {
        return res.status(401).json({ error: 'invalid_client' });
      }
      if (!isGrantAllowed(client, 'urn:ietf:params:oauth:grant-type:token-exchange')) {
        return res.status(400).json({ error: 'unauthorized_client' });
      }
      if (client_secret && client.clientSecret !== client_secret) {
        return res.status(401).json({ error: 'invalid_client' });
      }

      const userId = resolveAuthenticatedUserId(req);
      if (!userId) {
        return res.status(401).json({
          error: 'invalid_grant',
          error_description: 'A valid authenticated Adray session is required for token exchange.',
        });
      }

      const requestedScopes = parseScopes(scope);
      const grantedScopes = filterAllowedScopes(requestedScopes, client.scopes);
      if (!grantedScopes.length) {
        return res.status(400).json({
          error: 'invalid_scope',
          error_description: 'No permitted scopes requested for this client.',
        });
      }

      const accessToken = generateToken();
      const newRefreshToken = generateToken();
      const now = new Date();
      await OAuthToken.create({
        accessToken,
        refreshToken: newRefreshToken,
        userId,
        clientId: client_id,
        scopes: grantedScopes,
        accessTokenExpiresAt: new Date(now.getTime() + ACCESS_TOKEN_LIFETIME_MS),
        refreshTokenExpiresAt: new Date(now.getTime() + REFRESH_TOKEN_LIFETIME_MS),
      });

      return res.json({
        access_token: accessToken,
        issued_token_type: 'urn:ietf:params:oauth:token-type:access_token',
        token_type: 'Bearer',
        expires_in: Math.floor(ACCESS_TOKEN_LIFETIME_MS / 1000),
        refresh_token: newRefreshToken,
        scope: grantedScopes.join(' '),
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
