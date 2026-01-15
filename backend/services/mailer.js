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

function makeRefId() {
  return crypto.randomUUID ? crypto.randomUUID() : crypto.randomBytes(16).toString('hex');
}

/**
 * =========================
 * Config loader por remitente
 * =========================
 * - default => SMTP_*
 * - cesar   => SMTP_CESAR_*
 */
function loadSmtpConfig(prefix = 'SMTP') {
  const host = safeTrim(process.env[`${prefix}_HOST`] || process.env.SMTP_HOST || 'smtp.gmail.com');

  const portRaw = safeTrim(process.env[`${prefix}_PORT`] || process.env.SMTP_PORT || '587');
  const portNum = Number.parseInt(portRaw, 10);
  const port = Number.isFinite(portNum) ? portNum : 587;

  const user = safeTrim(process.env[`${prefix}_USER`]);
  const pass = safeTrim(process.env[`${prefix}_PASS`]);

  // From (si no, cae al user)
  const from = safeTrim(process.env[`${prefix}_FROM`] || user);

  // Nombre visible
  const fromName = safeTrim(process.env[`${prefix}_FROM_NAME`] || 'Adray');

  // Debug nodemailer (solo durante QA)
  const debug = toBool(process.env[`${prefix}_DEBUG`] || process.env.SMTP_DEBUG || process.env.NODEMAILER_DEBUG);

  // Permite forzar secure si quieres (opcional). Si no, se infiere por puerto.
  const secureEnv = safeTrim(process.env[`${prefix}_SECURE`]);
  const secure = secureEnv ? toBool(secureEnv) : port === 465;

  const has = !!(host && port && user && pass && from);

  return {
    prefix,
    host,
    port,
    user,
    pass,
    from,
    fromName,
    debug,
    secure,
    has,
  };
}

// ✅ Configs
const CFG_DEFAULT = loadSmtpConfig('SMTP');
const CFG_CESAR = loadSmtpConfig('SMTP_CESAR');

// ✅ Backward-compatible exports (lo que ya usas hoy)
const HAS_SMTP = CFG_DEFAULT.has;
const FROM = CFG_DEFAULT.from;

// ✅ New (para que emailService pueda validar si César está listo)
const HAS_SMTP_CESAR = CFG_CESAR.has;
const FROM_CESAR = CFG_CESAR.from;
const FROM_NAME_CESAR = CFG_CESAR.fromName;

// Transporters cache por key (default/cesar)
const transporters = new Map(); // key -> { transporter, logged }

/**
 * Log config SOLO 1 vez por transporter (sin pass).
 */
function logConfigOnce(cfg, key) {
  const entry = transporters.get(key);
  if (entry?.logged) return;
  if (entry) entry.logged = true;

  console.log(
    `[mailer] ${cfg.prefix} => host=${cfg.host} port=${cfg.port} secure=${cfg.secure} user=${cfg.user || '∅'} from=${cfg.from || '∅'} debug=${cfg.debug}`
  );
}

function getConfigByKey(fromKey = 'default') {
  const k = String(fromKey || 'default').toLowerCase();
  if (k === 'cesar') return CFG_CESAR;
  return CFG_DEFAULT;
}

function getTransporter(fromKey = 'default') {
  const key = String(fromKey || 'default').toLowerCase();
  const cfg = getConfigByKey(key);

  if (!cfg.has) return null;

  if (transporters.has(key) && transporters.get(key)?.transporter) {
    return transporters.get(key).transporter;
  }

  const entry = { transporter: null, logged: false };
  transporters.set(key, entry);

  entry.transporter = nodemailer.createTransport({
    host: cfg.host,
    port: cfg.port,
    secure: cfg.secure, // 465 true, 587 false
    auth: { user: cfg.user, pass: cfg.pass },

    // Pool estable
    pool: true,
    maxConnections: 3,
    maxMessages: 50,

    // En 587 fuerza STARTTLS
    requireTLS: !cfg.secure,

    tls: {
      rejectUnauthorized: true,
      servername: cfg.host,
      minVersion: 'TLSv1.2',
    },

    // Debug opcional
    logger: cfg.debug,
    debug: cfg.debug,

    connectionTimeout: 20_000,
    greetingTimeout: 20_000,
    socketTimeout: 30_000,
  });

  logConfigOnce(cfg, key);

  return entry.transporter;
}

/**
 * Formatea un "from" con fallback seguro.
 * - Si te pasan algo como: 'César · Adray AI <cesar@adray.ai>' lo respeta.
 * - Si te pasan solo 'cesar@adray.ai', lo envuelve con FROM_NAME del cfg.
 */
function normalizeFrom(fromOverride, cfg) {
  const raw = safeTrim(fromOverride);
  if (!raw) return `"${cfg.fromName}" <${cfg.from}>`;

  // Si ya viene en formato "Nombre <correo>"
  if (raw.includes('<') && raw.includes('>')) return raw;

  // Si viene sólo un correo
  return `"${cfg.fromName}" <${raw}>`;
}

/**
 * ✅ E2E multi-remitente:
 * sendMail({
 *   fromKey: 'default' | 'cesar',
 *   from, replyTo, to, subject, text, html,
 *   cc, bcc, attachments, headers
 * })
 */
async function sendMail({
  to,
  subject,
  text,
  html,

  // ✅ para elegir credenciales (nuevo)
  fromKey = 'default',

  // ✅ overrides opcionales
  from,
  replyTo,
  cc,
  bcc,
  attachments,

  headers = {},
} = {}) {
  const key = String(fromKey || 'default').toLowerCase();
  const cfg = getConfigByKey(key);
  const tx = getTransporter(key);

  if (!tx) {
    console.warn(`[mailer] SMTP no configurado para fromKey="${key}". Revisa env ${cfg.prefix}_*`);
    return { ok: false, skipped: true, code: 'SMTP_NOT_CONFIGURED', fromKey: key };
  }

  const finalFrom = normalizeFrom(from, cfg);
  const finalReplyTo = safeTrim(replyTo) || cfg.from;

  try {
    const info = await tx.sendMail({
      from: finalFrom,
      to,
      subject,
      text,
      html,
      replyTo: finalReplyTo,

      // opcionales
      cc: cc || undefined,
      bcc: bcc || undefined,
      attachments: attachments || undefined,

      headers: { 'X-Entity-Ref-ID': makeRefId(), ...headers },
    });

    return {
      ok: true,
      messageId: info?.messageId || null,
      response: info?.response || null,
      accepted: info?.accepted || null,
      rejected: info?.rejected || null,
      envelope: info?.envelope || null,
      fromKey: key,
    };
  } catch (err) {
    const safe = {
      ok: false,
      code: err?.code || 'SMTP_SEND_FAILED',
      command: err?.command,
      responseCode: err?.responseCode,
      response: err?.response,
      message: err?.message,
      fromKey: key,
    };
    console.error('[mailer] sendMail ERROR:', safe);
    return safe;
  }
}

/**
 * Verifica transporter por remitente
 */
async function verify(fromKey = 'default') {
  const key = String(fromKey || 'default').toLowerCase();
  const cfg = getConfigByKey(key);
  const tx = getTransporter(key);

  if (!tx) {
    return { ok: false, verified: false, code: 'SMTP_NOT_CONFIGURED', fromKey: key };
  }

  try {
    await tx.verify();
    return {
      ok: true,
      verified: true,
      host: cfg.host,
      port: cfg.port,
      secure: cfg.secure,
      user: cfg.user,
      from: cfg.from,
      fromKey: key,
    };
  } catch (err) {
    const safe = {
      ok: false,
      verified: false,
      code: err?.code || 'SMTP_VERIFY_FAILED',
      responseCode: err?.responseCode,
      response: err?.response,
      message: err?.message,
      fromKey: key,
    };
    console.error('[mailer] verify ERROR:', safe);
    return safe;
  }
}

module.exports = {
  // Backward compatible
  HAS_SMTP,
  FROM,
  sendMail,
  verify,

  // New
  HAS_SMTP_CESAR,
  FROM_CESAR,
  FROM_NAME_CESAR,
};
