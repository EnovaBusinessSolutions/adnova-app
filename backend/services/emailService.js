// backend/services/emailService.js
'use strict';

const { sendMail, verify, HAS_SMTP, FROM } = require('./mailer');
const { welcomeEmail, resetPasswordEmail } = require('./emailTemplates');

const APP_URL = (process.env.APP_URL || 'https://adray.ai').replace(/\/$/, '');

async function sendWelcomeEmail(toEmail) {
  if (!HAS_SMTP) return { ok: false, skipped: true, reason: 'SMTP_NOT_CONFIGURED' };

  const html = welcomeEmail({ loginUrl: `${APP_URL}/login` });

  return sendMail({
    to: toEmail,
    subject: 'Bienvenido a Adray · Activa tu cuenta',
    text: `Tu cuenta se creó con éxito. Inicia sesión: ${APP_URL}/login`,
    html,
  });
}

async function sendResetPasswordEmail(toEmail, resetUrl) {
  if (!HAS_SMTP) return { ok: false, skipped: true, reason: 'SMTP_NOT_CONFIGURED' };

  const html = resetPasswordEmail({ resetUrl });

  return sendMail({
    to: toEmail,
    subject: 'Restablece tu contraseña · Adray',
    text: `Para restablecer tu contraseña visita: ${resetUrl}`,
    html,
  });
}

// Para endpoints /__mail/*
async function verifySMTP() {
  return verify();
}

async function sendTestEmail() {
  if (!HAS_SMTP) return { ok: false, skipped: true, reason: 'SMTP_NOT_CONFIGURED' };

  return sendMail({
    to: process.env.SMTP_USER,
    subject: 'Prueba SMTP · Adray',
    text: 'Este es un correo de prueba desde /__mail/test',
    html: `<p>Prueba SMTP OK — ${new Date().toISOString()}</p><p>From: ${FROM}</p>`,
  });
}

module.exports = {
  sendWelcomeEmail,
  sendResetPasswordEmail,
  verifySMTP,
  sendTestEmail,
};
