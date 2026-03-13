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
  }).lean();

  if (!record?.userId) return null;

  return record.userId;
}

function requireOAuth() {
  return async (req, res, next) => {
    try {
      const userId = await resolveOAuthUser(req);
      if (!userId) {
        return res.status(401).json({
          error: true,
          error_code: 'UNAUTHORIZED',
          error_message: 'Valid OAuth bearer token required.',
          resolution: 'Authenticate via OAuth at /oauth/authorize',
          timestamp: new Date().toISOString(),
        });
      }
      req._mcpUserId = userId;
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
