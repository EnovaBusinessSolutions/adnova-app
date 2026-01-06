// backend/services/mailer.js
'use strict';

const nodemailer = require('nodemailer');
const crypto = require('crypto');

function clean(v) {
  return String(v || '').trim();
}

/**
 * Gmail App Password a veces se copia con espacios (ej: "abcd efgh ijkl mnop").
 * Esto lo normaliza a "abcdefghijklmnop".
 */
function cleanPass(v) {
  return clean(v).replace(/\s+/g, '');
}

function safeId() {
  // Node 18+ tiene crypto.randomUUID(). Si no, fallback.
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  return crypto.randomBytes(16).toString('hex');
}

const SMTP_HOST = clean(process.env.SMTP_HOST || 'smtp.gmail.com');
const SMTP_PORT = Number(process.env.SMTP_PORT || 587);

const SMTP_USER = clean(process.env.SMTP_USER);
const SMTP_PASS = cleanPass(process.env.SMTP_PASS);

// Si no defines SMTP_FROM, usamos SMTP_USER
const FROM = clean(process.env.SMTP_FROM || SMTP_USER);

// Nombre visible del remitente
const FROM_NAME = clean(process.env.SMTP_FROM_NAME || 'Adray');

// Debug nodemailer (útil en Render cuando algo falla)
const DEBUG_EMAIL = String(process.env.DEBUG_EMAIL || '').toLowerCase() === 'true';
const NODE_ENV = String(process.env.NODE_ENV || '').toLowerCase();

/**
 * Permite override por ENV:
 * SMTP_SECURE=true/false
 * SMTP_REQUIRE_TLS=true/false
 */
function envBool(name) {
  const v = String(process.env[name] || '').trim().toLowerCase();
  if (!v) return null;
  if (['1', 'true', 'yes', 'y', 'on'].includes(v)) return true;
  if (['0', 'false', 'no', 'n', 'off'].includes(v)) return false;
  return null;
}

// Defaults correctos:
// - 465 => secure true (SSL)
// - 587 => secure false + STARTTLS (requireTLS true)
const envSecure = envBool('SMTP_SECURE');
const secure = envSecure !== null ? envSecure : SMTP_PORT === 465;

const envRequireTLS = envBool('SMTP_REQUIRE_TLS');
const requireTLS = envRequireTLS !== null ? envRequireTLS : !secure;

// Detecta si realmente hay SMTP
const HAS_SMTP = !!(SMTP_HOST && SMTP_PORT && SMTP_USER && SMTP_PASS && FROM);

let transporter = null;

function buildTransporter() {
  const tx = nodemailer.createTransport({
    host: SMTP_HOST,
    port: SMTP_PORT,
    secure, // 465 => true, 587 => false

    auth: { user: SMTP_USER, pass: SMTP_PASS },

    pool: true,
    maxConnections: 5,
    maxMessages: 100,

    // STARTTLS en 587
    requireTLS,

    tls: {
      // Gmail/Workspace soporta TLS moderno. Forzamos 1.2 mínimo.
      minVersion: 'TLSv1.2',
      rejectUnauthorized: true,
      servername: SMTP_HOST,
    },

    connectionTimeout: 20_000,
    greetingTimeout: 20_000,
    socketTimeout: 30_000,

    // Debug nodemailer
    logger: DEBUG_EMAIL,
    debug: DEBUG_EMAIL,
  });

  return tx;
}

function getTransporter() {
  if (!HAS_SMTP) return null;
  if (transporter) return transporter;
  transporter = buildTransporter();
  return transporter;
}

/**
 * Envía un correo.
 * - NO revienta tu app si falla.
 * - Devuelve info útil para logs (code/response/command).
 */
async function sendMail({ to, subject, text, html, headers = {} }) {
  const tx = getTransporter();

  if (!tx) {
    console.warn('✉️ SMTP no configurado (sendMail omitido). Revisa SMTP_* en env.');
    return { ok: false, skipped: true, reason: 'SMTP_NOT_CONFIGURED' };
  }

  try {
    const info = await tx.sendMail({
      from: `"${FROM_NAME}" <${FROM}>`,
      to,
      subject,
      text,
      html,
      replyTo: FROM,
      headers: { 'X-Entity-Ref-ID': safeId(), ...headers },
    });

    if (DEBUG_EMAIL) {
      console.log('[mailer] sendMail OK:', {
        to,
        messageId: info?.messageId,
        response: info?.response,
      });
    }

    return { ok: true, messageId: info?.messageId, response: info?.response, info };
  } catch (err) {
    // Importante: Gmail 535 = credenciales/app password incorrectos o bloqueo de cuenta
    const out = {
      ok: false,
      error: err?.message || 'SENDMAIL_FAILED',
      code: err?.code,
      command: err?.command,
      response: err?.response,
      responseCode: err?.responseCode,
    };

    console.error('[mailer] sendMail ERROR:', out);

    // Si se queda “atorado” por un transporter en mal estado, lo reseteamos
    // para que el siguiente intento reconstruya configuración.
    transporter = null;

    return out;
  }
}

async function verify() {
  const tx = getTransporter();
  if (!tx) {
    const err = new Error('SMTP_NOT_CONFIGURED');
    err.code = 'SMTP_NOT_CONFIGURED';
    throw err;
  }

  try {
    await tx.verify();

    const result = {
      ok: true,
      host: SMTP_HOST,
      port: SMTP_PORT,
      secure,
      requireTLS,
      user: SMTP_USER,
      from: FROM,
      env: NODE_ENV,
    };

    if (DEBUG_EMAIL) console.log('[mailer] verify OK:', result);

    return result;
  } catch (err) {
    const out = {
      ok: false,
      error: err?.message || 'SMTP_VERIFY_FAILED',
      code: err?.code,
      command: err?.command,
      response: err?.response,
      responseCode: err?.responseCode,
      host: SMTP_HOST,
      port: SMTP_PORT,
      secure,
      requireTLS,
      user: SMTP_USER,
      from: FROM,
      env: NODE_ENV,
    };

    console.error('[mailer] verify ERROR:', out);

    transporter = null; // fuerza rebuild al siguiente intento

    throw err;
  }
}

module.exports = {
  HAS_SMTP,
  FROM,
  sendMail,
  verify,
};
