// backend/services/emailService.js
'use strict';

const { sendMail, verify, HAS_SMTP, FROM } = require('./mailer');

const {
  welcomeEmail,
  resetPasswordEmail,
  verifyEmail,
  auditReadyEmail,
} = require('./emailTemplates');

const APP_URL = (process.env.APP_URL || 'https://adray.ai').replace(/\/$/, '');
const DEBUG_EMAIL = process.env.DEBUG_EMAIL === 'true';

/**
 * =========================
 * Normalizadores / helpers
 * =========================
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
  if (!e) return 'Usuario';

  const local = e.split('@')[0] || 'Usuario';
  const pretty = local.replace(/[._-]+/g, ' ').replace(/\s+/g, ' ').trim();
  return pretty ? pretty.charAt(0).toUpperCase() + pretty.slice(1) : 'Usuario';
}

/**
 * =========================
 * Dedupe (anti-spam) in-memory
 * =========================
 * Nota: Esto evita duplicados por triggers repetidos dentro del MISMO proceso.
 * Para dedupe 100% a nivel cluster/replicas, luego lo hacemos persistente en Mongo.
 */
const _dedupe = new Map(); // key -> expiresAt (ms)
const DEDUPE_TTL_MS = Number(process.env.EMAIL_DEDUPE_TTL_MS || 10 * 60 * 1000); // 10 min

function _gcDedupe(now = Date.now()) {
  for (const [k, exp] of _dedupe.entries()) {
    if (exp <= now) _dedupe.delete(k);
  }
}

function shouldSendOnce(key, ttlMs = DEDUPE_TTL_MS) {
  if (!key) return true;
  const now = Date.now();
  _gcDedupe(now);

  const exp = _dedupe.get(key);
  if (exp && exp > now) return false;

  _dedupe.set(key, now + ttlMs);
  return true;
}

/**
 * =========================
 * Verify Email URL
 * =========================
 */
const VERIFY_PATH = process.env.VERIFY_EMAIL_PATH || '/api/auth/verify-email';

function buildVerifyUrl(token) {
  const t = String(token || '').trim();
  if (!t) return null;
  return `${APP_URL}${VERIFY_PATH}?token=${encodeURIComponent(t)}`;
}

/**
 * =========================
 * Send: Verify Email
 * =========================
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
      supportEmail: 'support@adray.ai',
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
 * =========================
 * Send: Welcome
 * =========================
 * Firma E2E:
 *   sendWelcomeEmail({ toEmail, name })
 * Retro-compat:
 *   sendWelcomeEmail('email@dominio.com')
 */
async function sendWelcomeEmail(input) {
  if (!HAS_SMTP) {
    if (DEBUG_EMAIL) console.warn('[emailService] SMTP no configurado. Omitiendo welcome.');
    return fail('SMTP_NOT_CONFIGURED', { skipped: true });
  }

  const toEmail = typeof input === 'string' ? input : input?.toEmail;
  const name = typeof input === 'string' ? undefined : input?.name;

  const to = normEmail(toEmail);
  if (!to) return fail('MISSING_TO_EMAIL');

  const finalName = safeName(name, to);

  try {
    const html = welcomeEmail({
      name: finalName,
      email: to,
      brand: 'Adray',
      supportEmail: 'support@adray.ai',
    });

    const info = await sendMail({
      to,
      subject: `¡Bienvenido a Adray, ${finalName}!`,
      text:
        `¡Bienvenido a Adray, ${finalName}!\n\n` +
        `¡Felicidades, ${finalName}! 🎉\n` +
        `Te has registrado exitosamente en Adray, tu Inteligencia Artificial experta en Marketing.\n` +
        `Ya puedes iniciar sesión y comenzar a optimizar tus campañas.\n` +
        `¡No olvides conectar tu onboarding!\n\n` +
        `— Equipo Adray\n` +
        `Soporte: support@adray.ai`,
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
 * =========================
 * Send: Audit Ready (Panel / Onboarding)
 * =========================
 * ✅ Firma E2E:
 *   sendAuditReadyEmail({ toEmail, name, origin, jobId, dedupeKey })
 *
 * - origin: 'onboarding' | 'panel'
 * - jobId:  id del job de auditoría (si existe)
 * - dedupeKey: si quieres controlar el anti-duplicado manualmente
 */
async function sendAuditReadyEmail({ toEmail, name, origin = 'panel', jobId, dedupeKey } = {}) {
  if (!HAS_SMTP) {
    if (DEBUG_EMAIL) console.warn('[emailService] SMTP no configurado. Omitiendo audit-ready.');
    return fail('SMTP_NOT_CONFIGURED', { skipped: true });
  }

  const to = normEmail(toEmail);
  if (!to) return fail('MISSING_TO_EMAIL');

  const finalName = safeName(name, to);
  const loginUrl = `${APP_URL}/login`;

  // ✅ Anti-duplicado: 1 correo por job/origen (especialmente onboarding)
  const key =
    String(dedupeKey || '').trim() ||
    `audit_ready:${to}:${String(origin || 'panel').toLowerCase()}:${String(jobId || 'nojob')}`;

  if (!shouldSendOnce(key)) {
    if (DEBUG_EMAIL) console.log('[emailService] audit-ready skipped by dedupe:', { to, key });
    return ok({ to, skipped: true, reason: 'DEDUPED', dedupeKey: key });
  }

  try {
    const html = auditReadyEmail({
      name: finalName,
      email: to,
      brand: 'Adray',
      supportEmail: 'support@adray.ai',
      loginUrl,
    });

    const info = await sendMail({
      to,
      subject: '¡Tienes una auditoría disponible!',
      text:
        `Auditoría lista:\n\n` +
        `Hola ${finalName},\n\n` +
        `Tu auditoría está lista. Adray analizó tus cuentas y preparó un reporte con puntos clave para mejorar tu rendimiento.\n\n` +
        `Consulta en tu panel de Adray. Dando clic aquí: ${loginUrl}\n\n` +
        `— Equipo Adray\n` +
        `Soporte: support@adray.ai`,
      html,
    });

    if (DEBUG_EMAIL) console.log('[emailService] audit-ready sent:', { to, messageId: info?.messageId, key });
    return ok({ to, messageId: info?.messageId, response: info?.response, dedupeKey: key });
  } catch (err) {
    console.error('[emailService] sendAuditReadyEmail error:', err?.message || err);
    return fail(err, { to, dedupeKey: key });
  }
}

/**
 * =========================
 * Send: Reset Password
 * =========================
 * Firma:
 *   sendResetPasswordEmail({ toEmail, resetUrl, name })
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
      supportEmail: 'support@adray.ai',
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
 * =========================
 * /__mail helpers
 * =========================
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
  sendAuditReadyEmail, // ✅ con dedupeKey/jobId/origin
  sendResetPasswordEmail,
  verifySMTP,
  sendTestEmail,
  buildVerifyUrl,
};
