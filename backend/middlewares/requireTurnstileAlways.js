'use strict';

const { verifyTurnstile } = require('../services/turnstile');

module.exports = async function requireTurnstileAlways(req, res, next) {
  const token =
    req.body?.turnstileToken ||
    req.body?.['cf-turnstile-response'] ||
    req.headers?.['x-turnstile-token'];

  const { ok, data } = await verifyTurnstile(token, req.ip);
  if (!ok) {
    return res.status(400).json({
      ok: false,
      code: 'TURNSTILE_FAILED',
      errorCodes: data?.['error-codes'] || [],
    });
  }
  next();
};
