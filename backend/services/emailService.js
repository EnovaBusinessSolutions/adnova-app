// backend/services/emailService.js
'use strict';

const { sendMail, verify, HAS_SMTP, FROM } = require('./mailer');

const {
  welcomeEmail,
  resetPasswordEmail,
  verifyEmail,
  auditReadyEmail,
  dailyFollowupCallEmail,
  getEmailInlineAttachments,
} = require('./emailTemplates');

const APP_URL = (process.env.APP_URL || 'https://adray.ai').replace(/\/$/, '');
const DEBUG_EMAIL = process.env.DEBUG_EMAIL === 'true';

/**
 * =========================
 * Analytics: trackEvent (safe)
 * =========================
 * Tracks email events only if the service exists and only with userId.
 */
let trackEvent = null;
try {
  trackEvent = require('./trackEvent')?.trackEvent;
} catch (_) {
  trackEvent = null;
}

async function trackEmailEventSafe({
  name,
  userId,
  dedupeKey,
  props,
}) {
  try {
    if (!trackEvent) return;
    if (!userId) return;

    await trackEvent({
      name,
      userId,
      dedupeKey,
      props: props || {},
    });
  } catch (e) {
    // Never break email flow because of analytics
    if (DEBUG_EMAIL) {
      console.warn('[emailService] trackEvent failed (ignored):', e?.message || e);
    }
  }
}

/**
 * =========================
 * Normalizers / helpers
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
  if (!e) return 'there';

  const local = e.split('@')[0] || 'there';
  const pretty = local.replace(/[._-]+/g, ' ').replace(/\s+/g, ' ').trim();
  return pretty ? pretty.charAt(0).toUpperCase() + pretty.slice(1) : 'there';
}

/**
 * =========================
 * In-memory dedupe (anti-spam)
 * =========================
 * Note: prevents duplicates in the SAME process.
 * For 100% dedupe in cluster/replicas, we can later make it persistent in Mongo.
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
 * Reset Password URL (E2E)
 * =========================
 * Allows token -> URL
 * Example: /reset-password?token=...
 */
const RESET_PASSWORD_PATH = process.env.RESET_PASSWORD_PATH || '/reset-password';

function buildResetPasswordUrl(token) {
  const t = String(token || '').trim();
  if (!t) return null;
  return `${APP_URL}${RESET_PASSWORD_PATH}?token=${encodeURIComponent(t)}`;
}

/**
 * =========================
 * Send: Verify Email
 * =========================
 * E2E signature:
 *   sendVerifyEmail({ userId, toEmail, token, name })
 */
async function sendVerifyEmail({ userId, toEmail, token, name } = {}) {
  if (!HAS_SMTP) {
    if (DEBUG_EMAIL) console.warn('[emailService] SMTP not configured. Skipping verifyEmail.');
    return fail('SMTP_NOT_CONFIGURED', { skipped: true });
  }

  const to = normEmail(toEmail);
  if (!to) return fail('MISSING_TO_EMAIL');
  if (!token) return fail('MISSING_VERIFY_TOKEN');

  const verifyUrl = buildVerifyUrl(token);
  if (!verifyUrl) return fail('INVALID_VERIFY_URL');

  const subject = 'Verify your email · Adray';

  try {
    const html = verifyEmail({
      verifyUrl,
      name: safeName(name, to),
      email: to,
      supportEmail: 'support@adray.ai',
      privacyUrl: `${APP_URL}/privacy`,
      brand: 'Adray',
    });

    const info = await sendMail({
      to,
      subject,
      text: `Confirm your email to activate your account: ${verifyUrl}`,
      html,
      attachments: getEmailInlineAttachments(),
    });

    if (DEBUG_EMAIL) console.log('[emailService] verify sent:', { to, messageId: info?.messageId });

    await trackEmailEventSafe({
      name: 'verify_email_sent',
      userId,
      dedupeKey: userId ? `verify_email_sent:${String(userId)}` : undefined,
      props: {
        toEmail: to,
        template: 'verify_email',
        subject,
        messageId: info?.messageId || null,
      },
    });

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
 * E2E signature:
 *   sendWelcomeEmail({ userId, toEmail, name })
 * Backward compatible:
 *   sendWelcomeEmail('email@domain.com')
 */
async function sendWelcomeEmail(input) {
  if (!HAS_SMTP) {
    if (DEBUG_EMAIL) console.warn('[emailService] SMTP not configured. Skipping welcome.');
    return fail('SMTP_NOT_CONFIGURED', { skipped: true });
  }

  const isString = typeof input === 'string';
  const userId = isString ? undefined : input?.userId;

  const toEmail = isString ? input : input?.toEmail;
  const name = isString ? undefined : input?.name;

  const to = normEmail(toEmail);
  if (!to) return fail('MISSING_TO_EMAIL');

  const finalName = safeName(name, to);
  const subject = `Welcome to Adray, ${finalName}!`;

  try {
    const html = welcomeEmail({
      name: finalName,
      email: to,
      brand: 'Adray',
      supportEmail: 'support@adray.ai',
    });

    const info = await sendMail({
      to,
      subject,
      text:
        `Welcome to Adray, ${finalName}!\n\n` +
        `Congratulations, ${finalName}!\n` +
        `You have successfully signed up for Adray, your AI workspace for marketing intelligence.\n` +
        `You can now sign in and start setting up your workspace.\n` +
        `Be sure to complete onboarding and connect your data sources.\n\n` +
        `— Adray Team\n` +
        `Support: support@adray.ai`,
      html,
      attachments: getEmailInlineAttachments(),
    });

    if (DEBUG_EMAIL) console.log('[emailService] welcome sent:', { to, messageId: info?.messageId });

    await trackEmailEventSafe({
      name: 'welcome_email_sent',
      userId,
      dedupeKey: userId ? `welcome_email_sent:${String(userId)}` : undefined,
      props: {
        toEmail: to,
        template: 'welcome_email',
        subject,
        messageId: info?.messageId || null,
      },
    });

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
 * E2E signature:
 *   sendAuditReadyEmail({ userId, toEmail, name, origin, jobId, dedupeKey })
 */
async function sendAuditReadyEmail({ userId, toEmail, name, origin = 'panel', jobId, dedupeKey } = {}) {
  if (!HAS_SMTP) {
    if (DEBUG_EMAIL) console.warn('[emailService] SMTP not configured. Skipping audit-ready.');
    return fail('SMTP_NOT_CONFIGURED', { skipped: true });
  }

  const to = normEmail(toEmail);
  if (!to) return fail('MISSING_TO_EMAIL');

  const finalName = safeName(name, to);
  const loginUrl = `${APP_URL}/login`;

  const key =
    String(dedupeKey || '').trim() ||
    `audit_ready:${to}:${String(origin || 'panel').toLowerCase()}:${String(jobId || 'nojob')}`;

  if (!shouldSendOnce(key)) {
    if (DEBUG_EMAIL) console.log('[emailService] audit-ready skipped by dedupe:', { to, key });
    return ok({ to, skipped: true, reason: 'DEDUPED', dedupeKey: key });
  }

  const subject = 'Your audit is ready';

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
      subject,
      text:
        `Your audit is ready.\n\n` +
        `Hi ${finalName},\n\n` +
        `Your audit is now available. Adray analyzed your accounts and prepared a report with key findings and opportunities.\n\n` +
        `View it in your Adray dashboard: ${loginUrl}\n\n` +
        `— Adray Team\n` +
        `Support: support@adray.ai`,
      html,
      attachments: getEmailInlineAttachments(),
    });

    if (DEBUG_EMAIL) console.log('[emailService] audit-ready sent:', { to, messageId: info?.messageId, key });

    await trackEmailEventSafe({
      name: 'audit_ready_email_sent',
      userId,
      dedupeKey: userId ? `audit_ready_email_sent:${String(userId)}:${String(jobId || 'nojob')}` : undefined,
      props: {
        toEmail: to,
        template: 'audit_ready_email',
        subject,
        messageId: info?.messageId || null,
        origin: String(origin || 'panel'),
        jobId: jobId || null,
        dedupeKey: key,
      },
    });

    return ok({ to, messageId: info?.messageId, response: info?.response, dedupeKey: key });
  } catch (err) {
    console.error('[emailService] sendAuditReadyEmail error:', err?.message || err);
    return fail(err, { to, dedupeKey: key });
  }
}

/**
 * =========================
 * Send Daily Followup Call (Cesar)
 * =========================
 */
const CESAR_FROM = process.env.CESAR_FROM || 'César · Adray AI <cesar@adray.ai>';
const CESAR_REPLY_TO = process.env.CESAR_REPLY_TO || 'cesar@adray.ai';
const CESAR_CALENDLY_URL = process.env.CESAR_CALENDLY_URL || 'https://calendly.com/adrayai/adray-calendario';

// 26h ttl to avoid daily duplicates from restarts/retries in the same process
const DAILY_DEDUPE_TTL_MS = Number(process.env.DAILY_EMAIL_DEDUPE_TTL_MS || 26 * 60 * 60 * 1000);

function todayKey(date = new Date()) {
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, '0');
  const d = String(date.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

async function sendDailyFollowupCallEmail({
  userId,
  toEmail,
  name,
  operatorName = 'César',
  calendlyUrl,
  dedupeKey,
  dateKey,
} = {}) {
  if (!HAS_SMTP) {
    if (DEBUG_EMAIL) console.warn('[emailService] SMTP not configured. Skipping daily-followup.');
    return fail('SMTP_NOT_CONFIGURED', { skipped: true });
  }

  const to = normEmail(toEmail);
  if (!to) return fail('MISSING_TO_EMAIL');

  const finalName = safeName(name, to);

  const day = String(dateKey || '').trim() || todayKey(new Date());
  const key = String(dedupeKey || '').trim() || `daily_followup_call:${to}:${day}`;

  if (!shouldSendOnce(key, DAILY_DEDUPE_TTL_MS)) {
    if (DEBUG_EMAIL) console.log('[emailService] daily-followup skipped by dedupe:', { to, key });
    return ok({ to, skipped: true, reason: 'DEDUPED', dedupeKey: key });
  }

  const url = String(calendlyUrl || CESAR_CALENDLY_URL).trim() || CESAR_CALENDLY_URL;
  const subject = 'Can we schedule a quick call to review your account?';

  try {
    const html = dailyFollowupCallEmail({
      name: finalName,
      email: to,
      operatorName,
      calendlyUrl: url,
      brand: 'Adray AI',
      websiteUrl: 'https://adray.ai',
      supportEmail: 'support@adray.ai',
    });

    const info = await sendMail({
      from: CESAR_FROM,
      replyTo: CESAR_REPLY_TO,
      to,
      subject,
      text:
        `Hi ${finalName},\n\n` +
        `I’m ${operatorName} from the Adray AI team.\n` +
        `I’d love to invite you to a quick 10-minute call to review your setup and results.\n\n` +
        `Book here: ${url}\n\n` +
        `Best,\n${operatorName}\nAdray AI\nhttps://adray.ai`,
      html,
      attachments: getEmailInlineAttachments(),
    });

    if (DEBUG_EMAIL) {
      console.log('[emailService] daily-followup sent:', {
        to,
        from: CESAR_FROM,
        messageId: info?.messageId,
        key,
      });
    }

    await trackEmailEventSafe({
      name: 'daily_followup_call_email_sent',
      userId,
      dedupeKey: userId ? `daily_followup_call_email_sent:${String(userId)}:${day}` : undefined,
      props: {
        toEmail: to,
        template: 'daily_followup_call_email',
        subject,
        messageId: info?.messageId || null,
        operatorName,
        calendlyUrl: url,
        dateKey: day,
        dedupeKey: key,
      },
    });

    return ok({ to, messageId: info?.messageId, response: info?.response, dedupeKey: key });
  } catch (err) {
    console.error('[emailService] sendDailyFollowupCallEmail error:', err?.message || err);
    return fail(err, { to, dedupeKey: key });
  }
}

/**
 * =========================
 * Send: Reset Password (E2E + backward compatible)
 * =========================
 * Modern signature:
 *   sendResetPasswordEmail({ userId, toEmail, resetUrl, name })
 *
 * Compat:
 *   sendResetPasswordEmail({ userId, toEmail, token, name }) -> builds resetUrl
 * Legacy:
 *   sendResetPasswordEmail(toEmail, resetUrl, name)
 */
async function sendResetPasswordEmail(arg1, arg2, arg3) {
  if (!HAS_SMTP) {
    if (DEBUG_EMAIL) console.warn('[emailService] SMTP not configured. Skipping reset.');
    return fail('SMTP_NOT_CONFIGURED', { skipped: true });
  }

  let userId = undefined;
  let toEmail = '';
  let resetUrl = '';
  let token = '';
  let name = '';

  if (typeof arg1 === 'object' && arg1) {
    userId = arg1.userId;
    toEmail = arg1.toEmail;
    resetUrl = arg1.resetUrl;
    token = arg1.token;
    name = arg1.name;
  } else {
    toEmail = arg1;
    resetUrl = arg2;
    name = arg3;
  }

  const to = normEmail(toEmail);
  if (!to) return fail('MISSING_TO_EMAIL');

  if (!resetUrl && token) {
    resetUrl = buildResetPasswordUrl(token);
  }

  if (!resetUrl) return fail('MISSING_RESET_URL');

  const finalName = safeName(name, to);
  const subject = 'Reset your password · Adray';

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
      subject,
      text: `Hi ${finalName}. To reset your password, visit: ${resetUrl}`,
      html,
      attachments: getEmailInlineAttachments(),
    });

    if (DEBUG_EMAIL) console.log('[emailService] reset sent:', { to, messageId: info?.messageId });

    await trackEmailEventSafe({
      name: 'reset_password_email_sent',
      userId,
      dedupeKey: userId ? `reset_password_email_sent:${String(userId)}` : undefined,
      props: {
        toEmail: to,
        template: 'reset_password_email',
        subject,
        messageId: info?.messageId || null,
      },
    });

    return ok({ to, messageId: info?.messageId, response: info?.response, resetUrl });
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
    const attachments = getEmailInlineAttachments();
    const info = await sendMail({
      to,
      subject: 'SMTP Test · Adray',
      text: 'This is a test email from /__mail/test',
      html:
        `<p>SMTP test OK — ${new Date().toISOString()}</p>` +
        `<p>From: ${FROM}</p>` +
        `<p>To: ${to}</p>` +
        (attachments.length
          ? `<p><img src="cid:adray-logo" alt="Adray" width="28" height="28" style="display:block;border:0;outline:none;text-decoration:none;"></p>`
          : `<p>Inline logo attachment not available on this server.</p>`),
      attachments,
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
  sendAuditReadyEmail,
  sendDailyFollowupCallEmail,
  sendResetPasswordEmail,
  verifySMTP,
  sendTestEmail,
  buildVerifyUrl,
  buildResetPasswordUrl,
};
