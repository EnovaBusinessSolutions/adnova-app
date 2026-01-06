// backend/services/mailer.js
'use strict';

const nodemailer = require('nodemailer');
const crypto = require('crypto');

function toBool(v) {
  if (v === true) return true;
  if (v === false) return false;
  const s = String(v || '').trim().toLowerCase();
  return s === '1' || s === 'true' || s === 'yes' || s === 'y' || s === 'on';
}

function safeTrim(v) {
  return (v == null ? '' : String(v)).trim();
}

const SMTP_HOST = safeTrim(process.env.SMTP_HOST || 'smtp.gmail.com');

// ✅ default recomendado: 587 (STARTTLS). Si quieres 465, pon SMTP_PORT=465.
const SMTP_PORT_RAW = safeTrim(process.env.SMTP_PORT || '587');
const SMTP_PORT = Number.parseInt(SMTP_PORT_RAW, 10);
const PORT = Number.isFinite(SMTP_PORT) ? SMTP_PORT : 587;

const SMTP_USER = safeTrim(process.env.SMTP_USER);
const SMTP_PASS = safeTrim(process.env.SMTP_PASS);

// From (si no, cae al user)
const FROM = safeTrim(process.env.SMTP_FROM || SMTP_USER);

// Nombre visible
const FROM_NAME = safeTrim(process.env.SMTP_FROM_NAME || 'Adray');

// Debug nodemailer (solo durante QA)
const SMTP_DEBUG = toBool(process.env.SMTP_DEBUG || process.env.NODEMAILER_DEBUG);

// Permite forzar secure si quieres (opcional). Si no, se infiere por puerto.
const SMTP_SECURE_ENV = safeTrim(process.env.SMTP_SECURE);
const SMTP_SECURE =
  SMTP_SECURE_ENV ? toBool(SMTP_SECURE_ENV) : PORT === 465;

// ✅ Detecta si realmente hay SMTP
const HAS_SMTP = !!(SMTP_HOST && PORT && SMTP_USER && SMTP_PASS && FROM);

let transporter = null;

function logConfigOnce() {
  // No imprimas PASS
  console.log(
    `[mailer] SMTP config => host=${SMTP_HOST} port=${PORT} secure=${SMTP_SECURE} user=${SMTP_USER || '∅'} from=${FROM || '∅'} debug=${SMTP_DEBUG}`
  );
}

function getTransporter() {
  if (!HAS_SMTP) return null;
  if (transporter) return transporter;

  logConfigOnce();

  transporter = nodemailer.createTransport({
    host: SMTP_HOST,
    port: PORT,
    secure: SMTP_SECURE, // 465 true, 587 false

    auth: { user: SMTP_USER, pass: SMTP_PASS },

    // Pool estable
    pool: true,
    maxConnections: 3,
    maxMessages: 50,

    // En 587 fuerza STARTTLS
    requireTLS: !SMTP_SECURE,

    tls: {
      rejectUnauthorized: true,
      servername: SMTP_HOST,
      minVersion: 'TLSv1.2',
    },

    // Debug opcional
    logger: SMTP_DEBUG,
    debug: SMTP_DEBUG,

    connectionTimeout: 20_000,
    greetingTimeout: 20_000,
    socketTimeout: 30_000,
  });

  return transporter;
}

function makeRefId() {
  // Node 16+ tiene crypto.randomUUID; si no, fallback
  return crypto.randomUUID ? crypto.randomUUID() : crypto.randomBytes(16).toString('hex');
}

async function sendMail({ to, subject, text, html, headers = {} }) {
  const tx = getTransporter();

  if (!tx) {
    console.warn('[mailer] SMTP no configurado (sendMail omitido). Revisa SMTP_* en env.');
    return { ok: false, skipped: true, code: 'SMTP_NOT_CONFIGURED' };
  }

  try {
    const info = await tx.sendMail({
      from: `"${FROM_NAME}" <${FROM}>`,
      to,
      subject,
      text,
      html,
      replyTo: FROM,
      headers: { 'X-Entity-Ref-ID': makeRefId(), ...headers },
    });

    return { ok: true, messageId: info?.messageId || null };
  } catch (err) {
    // ✅ devuelve error útil sin reventar la app
    const safe = {
      ok: false,
      code: err?.code || 'SMTP_SEND_FAILED',
      command: err?.command,
      responseCode: err?.responseCode,
      response: err?.response,
      message: err?.message,
    };
    console.error('[mailer] sendMail ERROR:', safe);
    return safe;
  }
}

async function verify() {
  const tx = getTransporter();
  if (!tx) {
    return { ok: false, verified: false, code: 'SMTP_NOT_CONFIGURED' };
  }

  try {
    await tx.verify();
    return {
      ok: true,
      verified: true,
      host: SMTP_HOST,
      port: PORT,
      secure: SMTP_SECURE,
      user: SMTP_USER,
      from: FROM,
    };
  } catch (err) {
    const safe = {
      ok: false,
      verified: false,
      code: err?.code || 'SMTP_VERIFY_FAILED',
      responseCode: err?.responseCode,
      response: err?.response,
      message: err?.message,
    };
    console.error('[mailer] verify ERROR:', safe);
    return safe;
  }
}

module.exports = {
  HAS_SMTP,
  FROM,
  sendMail,
  verify,
};
