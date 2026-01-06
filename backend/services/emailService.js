// backend/services/emailService.js
'use strict';

const { sendMail, verify, HAS_SMTP, FROM } = require('./mailer');
const { welcomeEmail, resetPasswordEmail } = require('./emailTemplates');

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

async function sendWelcomeEmail(toEmail) {
  if (!HAS_SMTP) {
    if (DEBUG_EMAIL) console.warn('[emailService] SMTP no configurado. Omitiendo welcome.');
    return fail('SMTP_NOT_CONFIGURED', { skipped: true });
  }

  try {
    const loginUrl = `${APP_URL}/login`;
    const html = welcomeEmail({ loginUrl });

    const info = await sendMail({
      to: toEmail,
      subject: 'Bienvenido a Adray · Activa tu cuenta',
      text: `Tu cuenta se creó con éxito. Inicia sesión: ${loginUrl}`,
      html,
    });

    if (DEBUG_EMAIL) console.log('[emailService] welcome sent:', { to: toEmail, messageId: info?.messageId });
    return ok({ to: toEmail, messageId: info?.messageId, response: info?.response });
  } catch (err) {
    console.error('[emailService] sendWelcomeEmail error:', err?.message || err);
    // Importante: no “truena” el registro, solo reporta falla
    return fail(err, { to: toEmail });
  }
}

async function sendResetPasswordEmail(toEmail, resetUrl) {
  if (!HAS_SMTP) {
    if (DEBUG_EMAIL) console.warn('[emailService] SMTP no configurado. Omitiendo reset.');
    return fail('SMTP_NOT_CONFIGURED', { skipped: true });
  }

  try {
    const html = resetPasswordEmail({ resetUrl });

    const info = await sendMail({
      to: toEmail,
      subject: 'Restablece tu contraseña · Adray',
      text: `Para restablecer tu contraseña visita: ${resetUrl}`,
      html,
    });

    if (DEBUG_EMAIL) console.log('[emailService] reset sent:', { to: toEmail, messageId: info?.messageId });
    return ok({ to: toEmail, messageId: info?.messageId, response: info?.response });
  } catch (err) {
    console.error('[emailService] sendResetPasswordEmail error:', err?.message || err);
    return fail(err, { to: toEmail });
  }
}

/**
 * Para endpoints /__mail/*
 * verify() viene desde mailer.js (transporter.verify()).
 */
async function verifySMTP() {
  if (!HAS_SMTP) return fail('SMTP_NOT_CONFIGURED', { skipped: true });

  try {
    const out = await verify();
    // verify() a veces regresa true/obj; normalizamos
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
  sendWelcomeEmail,
  sendResetPasswordEmail,
  verifySMTP,
  sendTestEmail,
};
