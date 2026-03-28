'use strict';

const OAuthToken = require('./models/OAuthToken');

async function resolveOAuthUser(req) {
  const authHeader = req.headers?.authorization || '';
  if (!authHeader.startsWith('Bearer ')) return null;

  const token = authHeader.slice(7).trim();
  if (!token) return null;

  const record = await OAuthToken.findOne({
    accessToken: token,
    accessTokenExpiresAt: { $gt: new Date() },
    revoked: { $ne: true },
  })
    .select('userId scopes clientId')
    .lean();

  if (!record?.userId) return null;

  return {
    userId: record.userId,
    scopes: Array.isArray(record.scopes) ? record.scopes : [],
    clientId: record.clientId || null,
  };
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
