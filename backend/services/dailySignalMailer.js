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

function buildHowToUsePrompt() {
  return [
    'Analyze this 60-day marketing dataset and act as a senior performance marketer.',
    'What’s working, what’s not, and why? Break it down by channel, campaign, and audience.',
    'Identify the top drivers of performance (top ~20%) and the biggest inefficiencies or wasted spend.',
    'Recommend exactly how to reallocate budget to maximize ROI over the next 30 days (include % shifts).',
    'Highlight what I should scale immediately (campaigns, audiences, creatives) and any risks to watch.',
    'Provide a clear, prioritized 2-week action plan to improve results.',
    'Keep the output concise, structured, and focused on actionable insights.',
  ].join('\n');
}

function buildBulletList(items = [], bulletColor = '#8b5cf6') {
  if (!Array.isArray(items) || !items.length) {
    return '';
  }

  return `
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="border-collapse:collapse;">
      ${items.map((item) => `
        <tr>
          <td valign="top" style="width:18px;padding:0 0 10px 0;font-size:14px;line-height:24px;color:${bulletColor};">•</td>
          <td valign="top" style="padding:0 0 10px 0;font-size:14px;line-height:24px;color:#dbe4ff;">
            ${escapeHtml(item)}
          </td>
        </tr>
      `).join('')}
    </table>
  `.trim();
}

function buildSectionCard({
  eyebrow = '',
  eyebrowColor = '#c4b5fd',
  title = '',
  bodyHtml = '',
  marginBottom = 18,
} = {}) {
  return `
    <div style="margin:0 0 ${marginBottom}px 0;padding:20px 20px 18px 20px;border-radius:20px;background:linear-gradient(180deg, rgba(20,18,32,0.94) 0%, rgba(11,11,18,0.98) 100%);border:1px solid rgba(255,255,255,0.08);box-shadow:inset 0 1px 0 rgba(255,255,255,0.03);">
      ${
        eyebrow
          ? `<div style="margin:0 0 8px 0;font-size:11px;line-height:1.2;font-weight:800;letter-spacing:0.16em;text-transform:uppercase;color:${eyebrowColor};">
              ${escapeHtml(eyebrow)}
            </div>`
          : ''
      }
      ${
        title
          ? `<div style="margin:0 0 10px 0;font-size:20px;line-height:1.25;font-weight:800;color:#ffffff;">
              ${escapeHtml(title)}
            </div>`
          : ''
      }
      ${bodyHtml}
    </div>
  `.trim();
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
  const howToUsePrompt = buildHowToUsePrompt();

  const introBodyHtml = `
    <div style="font-size:15px;line-height:26px;color:#dbe4ff;">
      <p style="margin:0 0 14px 0;">
        Download the attached PDF and drop it into any AI you already use for daily work:
        <span style="color:#ffffff;font-weight:700;">ChatGPT, Claude, Gemini, Grok, Copilot or DeepSeek</span>.
      </p>
      <p style="margin:0 0 14px 0;">
        Once it is inside your AI chatbot, you can ask questions about your campaigns, spend, strategy, optimization ideas, reporting, budget allocation and next actions.
      </p>
      <p style="margin:0 0 16px 0;">
        For the best result, use the prompt below together with your Signal PDF:
      </p>
    </div>

    <div style="margin:0 0 16px 0;padding:18px 18px 16px 18px;border-radius:18px;background:linear-gradient(180deg, rgba(12,12,18,0.98) 0%, rgba(7,8,13,1) 100%);border:1px solid rgba(181,92,255,0.20);box-shadow:0 0 0 1px rgba(181,92,255,0.06) inset;">
      <div style="margin:0 0 10px 0;font-size:11px;line-height:1.2;font-weight:800;letter-spacing:0.16em;text-transform:uppercase;color:#8b5cf6;">
        Recommended Prompt
      </div>
      <div style="white-space:pre-line;font-size:14px;line-height:24px;color:#f3f4f6;">
        ${escapeHtml(howToUsePrompt)}
      </div>
    </div>

    <div style="font-size:14px;line-height:24px;color:#b9c4dc;">
      If you want a more dynamic and real-time use of your data, you can also go to
      <a href="${escapeHtml(dashboardUrl)}" style="color:#c4b5fd;text-decoration:none;font-weight:700;">Adray</a>
      and set up an MCP connector to Claude or ChatGPT.
    </div>
  `;

  const summaryBodyHtml = `
    <div style="font-size:15px;line-height:26px;color:#e7ecf7;">
      ${escapeHtml(executiveSummary || businessState || 'Your latest Adray report has been generated successfully and attached to this email.')}
    </div>
  `;

  const positivesBodyHtml = positives.length
    ? buildBulletList(positives, '#4fe3c1')
    : `<div style="font-size:14px;line-height:24px;color:#b9c4dc;">Your latest report includes refreshed channel-level positives and opportunities.</div>`;

  const actionsBodyHtml = actions.length
    ? buildBulletList(actions, '#f472b6')
    : `<div style="font-size:14px;line-height:24px;color:#b9c4dc;">Open the attached PDF to review your updated priorities and next actions.</div>`;

  const crossChannelBodyHtml = crossChannelStory
    ? `
      <div style="font-size:14px;line-height:24px;color:#dbe4ff;">
        ${escapeHtml(crossChannelStory)}
      </div>
    `
    : '';

  return `
<!doctype html>
<html lang="en">
  <head>
    <meta charSet="utf-8" />
    <meta name="viewport" content="width=device-width,initial-scale=1" />
    <title>Adray Daily Signal</title>
  </head>
  <body style="margin:0;padding:0;background:#05070b;font-family:Inter,Arial,sans-serif;color:#ffffff;">
    <div style="width:100%;margin:0;padding:28px 10px;background:
      radial-gradient(circle at top left, rgba(181,92,255,0.10), transparent 26%),
      radial-gradient(circle at top right, rgba(79,227,193,0.08), transparent 22%),
      linear-gradient(180deg, #060608 0%, #09090d 38%, #050507 100%);
    ">
      <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="border-collapse:collapse;width:100%;">
        <tr>
          <td align="center">
            <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="border-collapse:separate;width:100%;max-width:700px;background:linear-gradient(180deg, rgba(17,14,28,0.98) 0%, rgba(8,9,14,1) 100%);border:1px solid rgba(255,255,255,0.08);border-radius:28px;overflow:hidden;box-shadow:0 24px 80px rgba(0,0,0,0.42);">
              <tr>
                <td style="padding:0;">
                  <div style="padding:30px 28px 22px 28px;border-bottom:1px solid rgba(255,255,255,0.08);background:
                    radial-gradient(circle at top left, rgba(181,92,255,0.22), transparent 36%),
                    radial-gradient(circle at top right, rgba(79,227,193,0.10), transparent 26%),
                    linear-gradient(180deg, rgba(20,17,34,0.98) 0%, rgba(14,14,24,0.94) 100%);
                  ">
                    <div style="margin:0 0 10px 0;font-size:11px;line-height:1.2;font-weight:800;letter-spacing:0.20em;text-transform:uppercase;color:#c4b5fd;">
                      Adray AI · Daily Signal
                    </div>

                    <div style="margin:0 0 8px 0;font-size:34px;line-height:1.12;font-weight:900;color:#ffffff;">
                      Your updated Signal report is ready
                    </div>

                    <div style="font-size:15px;line-height:26px;color:#d3dcef;">
                      Hi ${escapeHtml(name)}, here is your refreshed daily Signal and PDF report for ${escapeHtml(formattedDate)}.
                    </div>
                  </div>
                </td>
              </tr>

              <tr>
                <td style="padding:24px 22px 10px 22px;">
                  ${buildSectionCard({
                    eyebrow: 'How to use your Signal PDF',
                    eyebrowColor: '#c4b5fd',
                    bodyHtml: introBodyHtml,
                    marginBottom: 18,
                  })}

                  ${buildSectionCard({
                    eyebrow: 'Executive Summary',
                    eyebrowColor: '#93c5fd',
                    bodyHtml: summaryBodyHtml,
                    marginBottom: 18,
                  })}

                  ${buildSectionCard({
                    eyebrow: 'Key Positives',
                    eyebrowColor: '#4fe3c1',
                    bodyHtml: positivesBodyHtml,
                    marginBottom: 18,
                  })}

                  ${buildSectionCard({
                    eyebrow: 'Priority Actions',
                    eyebrowColor: '#f472b6',
                    bodyHtml: actionsBodyHtml,
                    marginBottom: crossChannelStory ? 18 : 12,
                  })}

                  ${
                    crossChannelStory
                      ? buildSectionCard({
                          eyebrow: 'Cross-Channel Story',
                          eyebrowColor: '#c4b5fd',
                          bodyHtml: crossChannelBodyHtml,
                          marginBottom: 14,
                        })
                      : ''
                  }

                  <div style="padding:10px 0 24px 0;text-align:center;">
                    <a
                      href="${escapeHtml(dashboardUrl)}"
                      style="display:inline-block;padding:14px 24px;border-radius:16px;background:linear-gradient(135deg, #8b5cf6 0%, #b55cff 48%, #4fe3c1 100%);color:#ffffff;text-decoration:none;font-size:14px;line-height:20px;font-weight:800;box-shadow:0 12px 30px rgba(101,66,214,0.34);"
                    >
                      Open Adray
                    </a>
                  </div>
                </td>
              </tr>

              <tr>
                <td style="padding:18px 28px 26px 28px;border-top:1px solid rgba(255,255,255,0.08);background:rgba(255,255,255,0.02);">
                  <div style="font-size:12px;line-height:22px;color:#8fa0bd;">
                    This email was generated automatically by Adray AI. Your updated PDF report is attached to this message.
                  </div>
                </td>
              </tr>
            </table>
          </td>
        </tr>
      </table>
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
  const howToUsePrompt = buildHowToUsePrompt();

  return [
    `Hi ${name},`,
    '',
    `Your refreshed Adray Daily Signal report for ${formattedDate} is ready.`,
    '',
    'How to use your Signal PDF:',
    'Download the attached PDF and upload it into any AI you use for daily work: ChatGPT, Claude, Gemini, Grok, Copilot or DeepSeek.',
    'Once it is inside your AI chatbot, you can ask questions about campaigns, spend, strategy, optimization, reporting and budget allocation.',
    '',
    'Recommended prompt:',
    howToUsePrompt,
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