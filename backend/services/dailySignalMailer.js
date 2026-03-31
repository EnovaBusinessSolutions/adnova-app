// backend/services/dailySignalMailer.js
'use strict';

const fs = require('fs');
const path = require('path');

let Resend = null;
try {
  ({ Resend } = require('resend'));
} catch (_) {
  Resend = null;
}

/* =========================
 * Helpers
 * ========================= */
function safeStr(v) {
  return v == null ? '' : String(v);
}

function normEmail(v = '') {
  const s = String(v || '').trim().toLowerCase();
  return s || null;
}

function normSimpleString(v = '') {
  const s = String(v || '').trim();
  return s || null;
}

function toNum(v, fallback = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function fileExists(p) {
  const abs = safeStr(p).trim();
  if (!abs) return false;
  try {
    return fs.existsSync(abs);
  } catch (_) {
    return false;
  }
}

function readFileBuffer(p) {
  return fs.readFileSync(p);
}

function formatDateForSubject(input = new Date()) {
  const d = input instanceof Date ? input : new Date(input);
  if (Number.isNaN(d.getTime())) return 'Daily Signal Report';

  return new Intl.DateTimeFormat('en-US', {
    month: 'long',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'America/Mexico_City',
  }).format(d);
}

function escapeHtml(str = '') {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function getResendClient() {
  const apiKey = normSimpleString(process.env.RESEND_API_KEY);
  if (!apiKey || !Resend) return null;

  try {
    return new Resend(apiKey);
  } catch (_) {
    return null;
  }
}

function resolveFromEmail() {
  return (
    normEmail(process.env.DAILY_SIGNAL_FROM_EMAIL) ||
    normEmail(process.env.RESEND_FROM_EMAIL) ||
    normEmail(process.env.SMTP_FROM) ||
    'signals@adray.ai'
  );
}

function resolveFromName() {
  return (
    normSimpleString(process.env.DAILY_SIGNAL_FROM_NAME) ||
    'Adray AI'
  );
}

function resolveReplyTo() {
  return (
    normEmail(process.env.DAILY_SIGNAL_REPLY_TO) ||
    normEmail(process.env.RESEND_REPLY_TO) ||
    null
  );
}

function buildFromHeader() {
  const fromEmail = resolveFromEmail();
  const fromName = resolveFromName();
  return `"${fromName}" <${fromEmail}>`;
}

function buildDefaultSubject({ reportDate = null } = {}) {
  const formatted = formatDateForSubject(reportDate || new Date());
  return `Your Daily Signal Report - ${formatted}`;
}

function extractSummary(signalPayload = null) {
  const payload = signalPayload || {};
  const summary = payload?.summary || {};

  return {
    executiveSummary: normSimpleString(summary?.executive_summary),
    businessState: normSimpleString(summary?.business_state),
    crossChannelStory: normSimpleString(summary?.cross_channel_story),
    positives: Array.isArray(summary?.positives) ? summary.positives.slice(0, 3) : [],
    actions: Array.isArray(summary?.priority_actions) ? summary.priority_actions.slice(0, 3) : [],
  };
}

function buildEmailHtml({
  user = null,
  signalPayload = null,
  reportDate = null,
  appUrl = null,
} = {}) {
  const name =
    normSimpleString(user?.name) ||
    normSimpleString(user?.email?.split?.('@')?.[0]) ||
    'there';

  const {
    executiveSummary,
    businessState,
    crossChannelStory,
    positives,
    actions,
  } = extractSummary(signalPayload);

  const formattedDate = formatDateForSubject(reportDate || new Date());
  const dashboardUrl = normSimpleString(appUrl) || normSimpleString(process.env.APP_URL) || 'https://adray.ai';

  const positivesHtml = positives.length
    ? `<ul style="margin:10px 0 0 18px;padding:0;color:#d1d5db;">
${positives.map((item) => `<li style="margin:0 0 8px 0;">${escapeHtml(item)}</li>`).join('\n')}
</ul>`
    : `<p style="margin:10px 0 0 0;color:#9ca3af;">Your latest report includes refreshed channel-level positives and opportunities.</p>`;

  const actionsHtml = actions.length
    ? `<ul style="margin:10px 0 0 18px;padding:0;color:#d1d5db;">
${actions.map((item) => `<li style="margin:0 0 8px 0;">${escapeHtml(item)}</li>`).join('\n')}
</ul>`
    : `<p style="margin:10px 0 0 0;color:#9ca3af;">Open the attached PDF to review your updated priorities and next actions.</p>`;

  return `
<!doctype html>
<html lang="en">
  <head>
    <meta charSet="utf-8" />
    <meta name="viewport" content="width=device-width,initial-scale=1" />
    <title>Adray Daily Signal</title>
  </head>
  <body style="margin:0;padding:0;background:#0b1020;font-family:Inter,Arial,sans-serif;color:#ffffff;">
    <div style="width:100%;background:#0b1020;padding:32px 12px;">
      <div style="max-width:680px;margin:0 auto;background:linear-gradient(180deg,rgba(17,24,39,1),rgba(7,11,22,1));border:1px solid rgba(255,255,255,0.08);border-radius:24px;overflow:hidden;box-shadow:0 20px 60px rgba(0,0,0,0.45);">
        <div style="padding:28px 28px 18px 28px;border-bottom:1px solid rgba(255,255,255,0.08);background:radial-gradient(circle at top left, rgba(124,58,237,0.35), transparent 38%), radial-gradient(circle at top right, rgba(59,130,246,0.22), transparent 30%);">
          <div style="font-size:12px;letter-spacing:0.18em;text-transform:uppercase;color:#c4b5fd;font-weight:800;margin-bottom:10px;">
            Adray AI · Daily Signal
          </div>
          <h1 style="margin:0;font-size:30px;line-height:1.15;font-weight:900;color:#ffffff;">
            Your updated Signal report is ready
          </h1>
          <p style="margin:14px 0 0 0;font-size:15px;line-height:1.7;color:#cbd5e1;">
            Hi ${escapeHtml(name)}, here is your refreshed daily Signal and PDF report for ${escapeHtml(formattedDate)}.
          </p>
        </div>

        <div style="padding:24px 28px;">
          <div style="background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.08);border-radius:18px;padding:18px 18px 16px 18px;margin-bottom:16px;">
            <div style="font-size:12px;letter-spacing:0.14em;text-transform:uppercase;color:#93c5fd;font-weight:800;margin-bottom:8px;">
              Executive Summary
            </div>
            <div style="font-size:15px;line-height:1.75;color:#e5e7eb;">
              ${escapeHtml(executiveSummary || businessState || 'Your latest Adray report has been generated successfully and attached to this email.')}
            </div>
          </div>

          <div style="background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.08);border-radius:18px;padding:18px 18px 16px 18px;margin-bottom:16px;">
            <div style="font-size:12px;letter-spacing:0.14em;text-transform:uppercase;color:#86efac;font-weight:800;margin-bottom:8px;">
              Key Positives
            </div>
            ${positivesHtml}
          </div>

          <div style="background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.08);border-radius:18px;padding:18px 18px 16px 18px;margin-bottom:20px;">
            <div style="font-size:12px;letter-spacing:0.14em;text-transform:uppercase;color:#f9a8d4;font-weight:800;margin-bottom:8px;">
              Priority Actions
            </div>
            ${actionsHtml}
          </div>

          ${
            crossChannelStory
              ? `
          <div style="margin-bottom:20px;">
            <div style="font-size:12px;letter-spacing:0.14em;text-transform:uppercase;color:#c4b5fd;font-weight:800;margin-bottom:8px;">
              Cross-Channel Story
            </div>
            <div style="font-size:14px;line-height:1.75;color:#cbd5e1;">
              ${escapeHtml(crossChannelStory)}
            </div>
          </div>
          `
              : ''
          }

          <div style="text-align:center;margin-top:28px;">
            <a
              href="${escapeHtml(dashboardUrl)}"
              style="display:inline-block;text-decoration:none;background:linear-gradient(90deg,#7c3aed,#3b82f6);color:#ffffff;font-weight:800;font-size:14px;padding:14px 22px;border-radius:14px;"
            >
              Open Adray
            </a>
          </div>
        </div>

        <div style="padding:18px 28px 26px 28px;border-top:1px solid rgba(255,255,255,0.08);">
          <p style="margin:0;font-size:12px;line-height:1.7;color:#94a3b8;">
            This email was generated automatically by Adray AI. Your updated PDF report is attached to this message.
          </p>
        </div>
      </div>
    </div>
  </body>
</html>
  `.trim();
}

function buildEmailText({
  user = null,
  signalPayload = null,
  reportDate = null,
  appUrl = null,
} = {}) {
  const name =
    normSimpleString(user?.name) ||
    normSimpleString(user?.email?.split?.('@')?.[0]) ||
    'there';

  const {
    executiveSummary,
    businessState,
    crossChannelStory,
    positives,
    actions,
  } = extractSummary(signalPayload);

  const formattedDate = formatDateForSubject(reportDate || new Date());
  const dashboardUrl = normSimpleString(appUrl) || normSimpleString(process.env.APP_URL) || 'https://adray.ai';

  return [
    `Hi ${name},`,
    '',
    `Your refreshed Adray Daily Signal report for ${formattedDate} is ready.`,
    '',
    executiveSummary || businessState || 'Your latest Signal + PDF has been generated successfully.',
    '',
    crossChannelStory ? `Cross-channel story: ${crossChannelStory}` : null,
    positives.length ? `Key positives: ${positives.join(' | ')}` : null,
    actions.length ? `Priority actions: ${actions.join(' | ')}` : null,
    '',
    `Open Adray: ${dashboardUrl}`,
    '',
    'Your updated PDF report is attached to this email.',
  ]
    .filter(Boolean)
    .join('\n');
}

/* =========================
 * Core send
 * ========================= */
async function sendDailySignalEmail({
  user = null,
  pdf = null,
  signalPayload = null,
  root = null,
  toEmail = null,
  subject = null,
  reportDate = null,
  appUrl = null,
  headers = {},
} = {}) {
  const client = getResendClient();
  if (!client) {
    return {
      ok: false,
      provider: 'resend',
      code: 'RESEND_NOT_CONFIGURED',
      message: 'RESEND_API_KEY missing or resend package unavailable',
    };
  }

  const recipient =
    normEmail(toEmail) ||
    normEmail(user?.dailySignalDelivery?.email) ||
    normEmail(user?.email);

  if (!recipient) {
    return {
      ok: false,
      provider: 'resend',
      code: 'DAILY_SIGNAL_EMAIL_RECIPIENT_REQUIRED',
      message: 'No recipient email available',
    };
  }

  const pdfLocalPath = normSimpleString(pdf?.localPath);
  if (!pdfLocalPath || !fileExists(pdfLocalPath)) {
    return {
      ok: false,
      provider: 'resend',
      code: 'DAILY_SIGNAL_PDF_FILE_NOT_FOUND',
      message: 'PDF file missing or unreadable',
    };
  }

  const absolutePdfPath = path.resolve(pdfLocalPath);
  const attachmentBuffer = readFileBuffer(absolutePdfPath);
  const fileName =
    normSimpleString(pdf?.fileName) ||
    `adray-daily-signal-${new Date().toISOString().slice(0, 10)}.pdf`;

  const finalSubject =
    normSimpleString(subject) ||
    buildDefaultSubject({ reportDate });

  const html = buildEmailHtml({
    user,
    signalPayload,
    reportDate,
    appUrl,
  });

  const text = buildEmailText({
    user,
    signalPayload,
    reportDate,
    appUrl,
  });

  const from = buildFromHeader();
  const replyTo = resolveReplyTo();

  try {
    const payload = {
      from,
      to: [recipient],
      subject: finalSubject,
      html,
      text,
      attachments: [
        {
          filename: fileName,
          content: attachmentBuffer,
        },
      ],
      headers: {
        'X-Adray-Email-Type': 'daily-signal',
        'X-Adray-Source': 'dailySignalMailer',
        ...headers,
      },
    };

    if (replyTo) {
      payload.reply_to = replyTo;
    }

    const response = await client.emails.send(payload);

    return {
      ok: true,
      provider: 'resend',
      to: recipient,
      from,
      subject: finalSubject,
      messageId:
        normSimpleString(response?.data?.id) ||
        normSimpleString(response?.id) ||
        null,
      response,
      email: {
        to: recipient,
        from,
        subject: finalSubject,
      },
      attachment: {
        fileName,
        localPath: absolutePdfPath,
        sizeBytes: toNum(pdf?.sizeBytes, attachmentBuffer?.length || 0),
        mimeType: normSimpleString(pdf?.mimeType) || 'application/pdf',
      },
      meta: {
        rootId: normSimpleString(root?._id),
        snapshotId: normSimpleString(root?.aiContext?.snapshotId || root?.latestSnapshotId),
        sourceFingerprint: normSimpleString(root?.aiContext?.sourceFingerprint),
        connectionFingerprint: normSimpleString(root?.aiContext?.connectionFingerprint),
      },
    };
  } catch (err) {
    return {
      ok: false,
      provider: 'resend',
      code:
        normSimpleString(err?.code) ||
        normSimpleString(err?.name) ||
        'RESEND_SEND_FAILED',
      message: err?.message || 'Failed to send daily signal email',
      error: {
        name: err?.name || null,
        message: err?.message || null,
        statusCode: err?.statusCode || err?.status || null,
      },
      to: recipient,
      subject: finalSubject,
    };
  }
}

/* =========================
 * Diagnostics
 * ========================= */
async function verifyDailySignalMailer() {
  const client = getResendClient();
  return {
    ok: !!client,
    provider: 'resend',
    configured: !!client,
    from: buildFromHeader(),
    replyTo: resolveReplyTo(),
  };
}

module.exports = {
  sendDailySignalEmail,
  verifyDailySignalMailer,
};