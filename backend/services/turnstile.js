'use strict';

const TURNSTILE_SECRET = process.env.TURNSTILE_SECRET_KEY;

async function verifyTurnstile(token, remoteip) {
  if (!TURNSTILE_SECRET) throw new Error('TURNSTILE_SECRET_KEY no configurada');
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
