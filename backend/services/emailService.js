// backend/services/emailService.js
'use strict';

const { sendMail, verify, HAS_SMTP, FROM } = require('./mailer');
const { welcomeEmail, resetPasswordEmail, verifyEmail } = require('./emailTemplates');

const APP_URL = (process.env.APP_URL || 'https://adray.ai').replace(/\/$/, '');
const DEBUG_EMAIL = process.env.DEBUG_EMAIL === 'true';

/**
 * Normaliza respuestas para que /__mail y los callers tengan un shape consistente
 */
function ok(payload = {}) {
  return { ok: true, ...payload };
}
function fail(error, extra = {}) {
  return {
    ok: false,
    error: typeof error === 'string' ? error : (error?.message || 'EMAIL_FAILED'),
    ...extra,
  };
}

function normEmail(v) {
  return String(v || '').trim().toLowerCase();
}

function safeName(v, fallbackEmail) {
  const n = String(v || '').replace(/\s+/g, ' ').trim();
  if (n) return n;
  const e = normEmail(fallbackEmail);
  return e ? e.split('@')[0] : 'Usuario';
}

/**
 * ✅ Enlace de verificación (centralizado)
 */
const VERIFY_PATH = process.env.VERIFY_EMAIL_PATH || '/api/auth/verify-email';

function buildVerifyUrl(token) {
  const t = String(token || '').trim();
  if (!t) return null;
  return `${APP_URL}${VERIFY_PATH}?token=${encodeURIComponent(t)}`;
}

/**
 * ✅ Correo de verificación (registro)
 * Firma: sendVerifyEmail({ toEmail, token, name })
 */
async function sendVerifyEmail({ toEmail, token, name } = {}) {
  if (!HAS_SMTP) {
    if (DEBUG_EMAIL) console.warn('[emailService] SMTP no configurado. Omitiendo verifyEmail.');
    return fail('SMTP_NOT_CONFIGURED', { skipped: true });
  }

  const to = normEmail(toEmail);
  if (!to) return fail('MISSING_TO_EMAIL');
  if (!token) return fail('MISSING_VERIFY_TOKEN');

  const verifyUrl = buildVerifyUrl(token);
  if (!verifyUrl) return fail('INVALID_VERIFY_URL');

  try {
    const html = verifyEmail({
      verifyUrl,
      name: safeName(name, to),
      email: to,
      supportEmail: FROM || 'contact@adray.ai',
      privacyUrl: `${APP_URL}/politica.html`,
      brand: 'Adray',
    });

    const info = await sendMail({
      to,
      subject: 'Verifica tu correo · Adray',
      text: `Confirma tu correo para activar tu cuenta: ${verifyUrl}`,
      html,
    });

    if (DEBUG_EMAIL) console.log('[emailService] verify sent:', { to, messageId: info?.messageId });
    return ok({ to, messageId: info?.messageId, response: info?.response, verifyUrl });
  } catch (err) {
    console.error('[emailService] sendVerifyEmail error:', err?.message || err);
    return fail(err, { to });
  }
}

/**
 * ✅ Bienvenida (Google login / post-verify / etc.)
 *
 * Firma E2E NUEVA:
 *   sendWelcomeEmail({ toEmail, name })
 *
 * Retro-compat:
 *   sendWelcomeEmail('email@dominio.com')
 */
async function sendWelcomeEmail(arg1, arg2) {
  if (!HAS_SMTP) {
    if (DEBUG_EMAIL) console.warn('[emailService] SMTP no configurado. Omitiendo welcome.');
    return fail('SMTP_NOT_CONFIGURED', { skipped: true });
  }

  // ✅ Soporta: sendWelcomeEmail({toEmail,name})  y  sendWelcomeEmail(toEmail, name)
  let toEmail = '';
  let name = '';

  if (typeof arg1 === 'object' && arg1) {
    toEmail = arg1.toEmail;
    name = arg1.name;
  } else {
    toEmail = arg1;
    name = arg2;
  }

  const to = normEmail(toEmail);
  if (!to) return fail('MISSING_TO_EMAIL');

  const finalName = safeName(name, to);

  try {
    const loginUrl = `${APP_URL}/login`;

    // Nota: aunque tu template no use name, no pasa nada.
    // Si lo usas, ya queda listo.
    const html = welcomeEmail({
      loginUrl,
      name: finalName,
      email: to,
      supportEmail: FROM || 'contact@adray.ai',
      brand: 'Adray',
    });

    const info = await sendMail({
      to,
      subject: 'Bienvenido a Adray',
      text: `Hola ${finalName}. Tu cuenta se creó con éxito. Inicia sesión: ${loginUrl}`,
      html,
    });

    if (DEBUG_EMAIL) console.log('[emailService] welcome sent:', { to, messageId: info?.messageId });
    return ok({ to, messageId: info?.messageId, response: info?.response });
  } catch (err) {
    console.error('[emailService] sendWelcomeEmail error:', err?.message || err);
    return fail(err, { to });
  }
}

/**
 * Reset password
 *
 * Firma NUEVA recomendada:
 *   sendResetPasswordEmail({ toEmail, resetUrl, name })
 *
 * Retro-compat:
 *   sendResetPasswordEmail(toEmail, resetUrl)
 */
async function sendResetPasswordEmail(arg1, arg2, arg3) {
  if (!HAS_SMTP) {
    if (DEBUG_EMAIL) console.warn('[emailService] SMTP no configurado. Omitiendo reset.');
    return fail('SMTP_NOT_CONFIGURED', { skipped: true });
  }

  let toEmail = '';
  let resetUrl = '';
  let name = '';

  if (typeof arg1 === 'object' && arg1) {
    toEmail = arg1.toEmail;
    resetUrl = arg1.resetUrl;
    name = arg1.name;
  } else {
    toEmail = arg1;
    resetUrl = arg2;
    name = arg3;
  }

  const to = normEmail(toEmail);
  if (!to) return fail('MISSING_TO_EMAIL');
  if (!resetUrl) return fail('MISSING_RESET_URL');

  const finalName = safeName(name, to);

  try {
    const html = resetPasswordEmail({
      resetUrl,
      name: finalName,
      email: to,
      brand: 'Adray',
      supportEmail: FROM || 'contact@adray.ai',
    });

    const info = await sendMail({
      to,
      subject: 'Restablece tu contraseña · Adray',
      text: `Hola ${finalName}. Para restablecer tu contraseña visita: ${resetUrl}`,
      html,
    });

    if (DEBUG_EMAIL) console.log('[emailService] reset sent:', { to, messageId: info?.messageId });
    return ok({ to, messageId: info?.messageId, response: info?.response });
  } catch (err) {
    console.error('[emailService] sendResetPasswordEmail error:', err?.message || err);
    return fail(err, { to });
  }
}

/**
 * Para endpoints /__mail/*
 */
async function verifySMTP() {
  if (!HAS_SMTP) return fail('SMTP_NOT_CONFIGURED', { skipped: true });

  try {
    const out = await verify();
    return ok({ verified: true, result: out });
  } catch (err) {
    console.error('[emailService] verifySMTP error:', err?.message || err);
    return fail(err, { verified: false });
  }
}

/**
 * Email de prueba (por default se manda a SMTP_USER)
 * Puedes override con SMTP_TEST_TO en Render.
 */
async function sendTestEmail() {
  if (!HAS_SMTP) return fail('SMTP_NOT_CONFIGURED', { skipped: true });

  const to = process.env.SMTP_TEST_TO || process.env.SMTP_USER;

  try {
    const info = await sendMail({
      to,
      subject: 'Prueba SMTP · Adray',
      text: 'Este es un correo de prueba desde /__mail/test',
      html: `<p>Prueba SMTP OK — ${new Date().toISOString()}</p><p>From: ${FROM}</p><p>To: ${to}</p>`,
    });

    if (DEBUG_EMAIL) console.log('[emailService] test sent:', { to, messageId: info?.messageId });
    return ok({ to, messageId: info?.messageId, response: info?.response });
  } catch (err) {
    console.error('[emailService] sendTestEmail error:', err?.message || err);
    return fail(err, { to });
  }
}

module.exports = {
  sendVerifyEmail,
  sendWelcomeEmail,
  sendResetPasswordEmail,
  verifySMTP,
  sendTestEmail,
  buildVerifyUrl,
};
