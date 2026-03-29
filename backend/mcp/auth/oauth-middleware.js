'use strict';

const OAuthToken = require('./models/OAuthToken');

const CACHE_TTL_MS = Math.min(
  Math.max(Number(process.env.MCP_OAUTH_RESOLVE_CACHE_MS) || 45000, 2000),
  300000
);
const MAX_CACHE_ENTRIES = Math.min(
  Math.max(Number(process.env.MCP_OAUTH_RESOLVE_CACHE_MAX) || 5000, 100),
  50000
);

/** @type {Map<string, { value: object, expiresAt: number }>} */
const resolveCache = new Map();

function cacheSet(token, value) {
  if (resolveCache.size >= MAX_CACHE_ENTRIES) {
    const first = resolveCache.keys().next().value;
    if (first !== undefined) resolveCache.delete(first);
  }
  resolveCache.set(token, {
    value,
    expiresAt: Date.now() + CACHE_TTL_MS,
  });
}

function cacheGet(token) {
  const e = resolveCache.get(token);
  if (!e) return null;
  if (e.expiresAt <= Date.now()) {
    resolveCache.delete(token);
    return null;
  }
  return e.value;
}

async function resolveOAuthUser(req) {
  const authHeader = req.headers?.authorization || '';
  if (!authHeader.startsWith('Bearer ')) return null;

  const token = authHeader.slice(7).trim();
  if (!token) return null;

  const hit = cacheGet(token);
  if (hit) return hit;

  const record = await OAuthToken.findOne({
    accessToken: token,
    accessTokenExpiresAt: { $gt: new Date() },
    revoked: { $ne: true },
  })
    .select('userId scopes clientId')
    .lean();

  if (!record?.userId) return null;

  const value = {
    userId: record.userId,
    scopes: Array.isArray(record.scopes) ? record.scopes : [],
    clientId: record.clientId || null,
  };
  cacheSet(token, value);
  return value;
}

function requireOAuth() {
  return async (req, res, next) => {
    try {
      const oauthContext = await resolveOAuthUser(req);
      if (!oauthContext?.userId) {
        return res.status(401).json({
          error: true,
          error_code: 'UNAUTHORIZED',
          error_message: 'Valid OAuth bearer token required.',
          resolution: 'Authenticate via OAuth at /oauth/authorize',
          timestamp: new Date().toISOString(),
        });
      }
      req._mcpUserId = oauthContext.userId;
      req._mcpScopes = oauthContext.scopes;
      req._mcpClientId = oauthContext.clientId;
      next();
    } catch (err) {
      console.error('[oauth-middleware] error:', err);
      return res.status(500).json({
        error: true,
        error_code: 'INTERNAL_ERROR',
        error_message: 'Authentication check failed.',
        timestamp: new Date().toISOString(),
      });
    }
  };
}

module.exports = { resolveOAuthUser, requireOAuth };
