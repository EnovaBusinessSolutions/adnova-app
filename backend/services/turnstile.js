'use strict';

const TURNSTILE_SECRET = process.env.TURNSTILE_SECRET_KEY;
const TURNSTILE_BYPASS = /^(1|true|yes|on)$/i.test(String(process.env.TURNSTILE_BYPASS || '').trim());

async function verifyTurnstile(token, remoteip) {
  if (TURNSTILE_BYPASS) {
    return {
      ok: true,
      data: { success: true, bypass: true },
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
