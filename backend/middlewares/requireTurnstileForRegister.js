'use strict';

const { verifyTurnstile } = require('../services/turnstile');

/** true si el registro no debe exigir Cloudflare Turnstile (p. ej. staging). */
function isTurnstileRegisterSkipped() {
  const v = String(process.env.TURNSTILE_SKIP_REGISTRATION || '').trim().toLowerCase();
  return v === '1' || v === 'true' || v === 'yes';
}

async function requireTurnstileForRegister(req, res, next) {
  if (isTurnstileRegisterSkipped()) return next();

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
}

module.exports = requireTurnstileForRegister;
module.exports.isTurnstileRegisterSkipped = isTurnstileRegisterSkipped;
