'use strict';

const TURNSTILE_SECRET = process.env.TURNSTILE_SECRET_KEY;
const TURNSTILE_BYPASS = /^(1|true|yes|on)$/i.test(String(process.env.TURNSTILE_BYPASS || '').trim());
const PUBLIC_URL = String(process.env.APP_URL || process.env.RENDER_EXTERNAL_URL || '').trim().toLowerCase();
const TURNSTILE_STAGING_AUTO_BYPASS = /staging/i.test(PUBLIC_URL) || /onrender\.com/i.test(PUBLIC_URL);

async function verifyTurnstile(token, remoteip) {
  if (TURNSTILE_BYPASS || TURNSTILE_STAGING_AUTO_BYPASS) {
    return {
      ok: true,
      data: { success: true, bypass: true, stagingBypass: TURNSTILE_STAGING_AUTO_BYPASS },
    };
  }

  if (!TURNSTILE_SECRET) {
    return {
      ok: false,
      data: { 'error-codes': ['missing-input-secret'] },
    };
  }

  if (!token) return { ok: false, data: { 'error-codes': ['missing-input-response'] } };

  const body = new URLSearchParams();
  body.append('secret', TURNSTILE_SECRET);
  body.append('response', token);
  if (remoteip) body.append('remoteip', remoteip);

  const resp = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });

  const data = await resp.json();
  return { ok: !!data.success, data };
}

module.exports = { verifyTurnstile };
