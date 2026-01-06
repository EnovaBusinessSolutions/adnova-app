// backend/services/mailer.js
'use strict';

const nodemailer = require('nodemailer');
const crypto = require('crypto');

const SMTP_HOST = process.env.SMTP_HOST || 'smtp.gmail.com';

// ✅ Recomendación por defecto: 587 (STARTTLS)
// (465 también funciona, pero 587 suele ser más estable en Workspace/Gmail)
const SMTP_PORT = Number(process.env.SMTP_PORT || 587);

const SMTP_USER = process.env.SMTP_USER;
const SMTP_PASS = process.env.SMTP_PASS;

// Si no defines SMTP_FROM, usamos SMTP_USER
const FROM = (process.env.SMTP_FROM || SMTP_USER || '').trim();

// Opcional: nombre visible del remitente
const FROM_NAME = (process.env.SMTP_FROM_NAME || 'Adray').trim();

// ✅ Detecta si realmente hay SMTP
const HAS_SMTP = !!(SMTP_HOST && SMTP_PORT && SMTP_USER && SMTP_PASS && FROM);

let transporter = null;

function getTransporter() {
  if (!HAS_SMTP) return null;
  if (transporter) return transporter;

  const secure = SMTP_PORT === 465; // 465 SSL, 587 STARTTLS

  transporter = nodemailer.createTransport({
    host: SMTP_HOST,
    port: SMTP_PORT,
    secure,

    auth: { user: SMTP_USER, pass: SMTP_PASS },

    pool: true,
    maxConnections: 5,
    maxMessages: 100,

    // ✅ En 587 fuerza STARTTLS (más estable)
    requireTLS: !secure,

    tls: {
      rejectUnauthorized: true,
      servername: SMTP_HOST, // ayuda en algunos entornos
    },

    connectionTimeout: 20_000,
    greetingTimeout: 20_000,
    socketTimeout: 30_000,
  });

  return transporter;
}

async function sendMail({ to, subject, text, html, headers = {} }) {
  const tx = getTransporter();

  // ✅ Si no hay SMTP, no truena tu app
  if (!tx) {
    console.warn('✉️ SMTP no configurado (sendMail omitido). Revisa SMTP_* en env.');
    return { ok: false, skipped: true };
  }

  const info = await tx.sendMail({
    from: `"${FROM_NAME}" <${FROM}>`,
    to,
    subject,
    text,
    html,
    replyTo: FROM,
    headers: { 'X-Entity-Ref-ID': crypto.randomUUID(), ...headers },
  });

  return { ok: true, messageId: info?.messageId, info };
}

async function verify() {
  const tx = getTransporter();
  if (!tx) {
    const err = new Error('SMTP_NOT_CONFIGURED');
    err.code = 'SMTP_NOT_CONFIGURED';
    throw err;
  }
  await tx.verify();
  return {
    ok: true,
    host: SMTP_HOST,
    port: SMTP_PORT,
    user: SMTP_USER,
    from: FROM,
  };
}

module.exports = {
  HAS_SMTP,
  FROM,
  sendMail,
  verify,
};
