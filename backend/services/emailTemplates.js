'use strict';

function escapeHtml(s = '') {
  return String(s)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function safeName(name, fallbackEmail) {
  const clean = String(name || '').trim();
  if (clean.length >= 2) return clean;

  const guess = String(fallbackEmail || '').split('@')[0] || 'there';
  const pretty = guess.replace(/[._-]+/g, ' ').replace(/\s+/g, ' ').trim();
  const out = pretty ? pretty.charAt(0).toUpperCase() + pretty.slice(1) : 'there';
  return out;
}

function safeUrl(url = '') {
  const s = String(url || '').trim();
  if (!s) return '#';
  return s;
}

function brandWordmark() {
  return `
    <div style="display:inline-flex;align-items:center;gap:10px;">
      <div style="
        width:28px;
        height:28px;
        border-radius:9px;
        background:
          radial-gradient(circle at 50% 0%, rgba(255,255,255,.16), transparent 58%),
          linear-gradient(180deg, rgba(255,255,255,.07), rgba(255,255,255,.02)),
          rgba(255,255,255,.02);
        border:1px solid rgba(255,255,255,.10);
        box-shadow:
          inset 0 1px 0 rgba(255,255,255,.04),
          0 0 18px rgba(181,92,255,.14);
        position:relative;
        overflow:hidden;
      ">
        <div style="
          position:absolute;inset:0;
          background:
            conic-gradient(
              from 0deg,
              transparent 0deg,
              rgba(181,92,255,.16) 132deg,
              transparent 220deg,
              rgba(79,227,193,.08) 304deg,
              transparent 360deg
            );
          opacity:.75;
        "></div>
        <div style="
          position:absolute;inset:1px;border-radius:8px;
          background:linear-gradient(180deg, rgba(18,14,28,.96) 0%, rgba(10,10,16,.98) 100%);
        "></div>
        <div style="
          position:absolute;left:50%;top:50%;
          transform:translate(-50%,-50%);
          width:14px;height:14px;
          color:#F1ECFF;
          font-size:14px;line-height:14px;font-weight:700;
          text-align:center;
          z-index:2;
        ">✦</div>
      </div>
      <div style="
        font-size:13px;
        line-height:1;
        letter-spacing:.20em;
        font-weight:900;
        color:#F2EEFF;
      ">ADRAY</div>
    </div>
  `;
}

function infoPill(text = '') {
  if (!text) return '';
  return `
    <div style="display:inline-flex;align-items:center;justify-content:center;
      max-width:100%;
      padding:9px 14px;
      border-radius:999px;
      background:
        linear-gradient(180deg, rgba(255,255,255,.06), rgba(255,255,255,.025)),
        rgba(255,255,255,.012);
      border:1px solid rgba(181,92,255,.14);
      box-shadow:
        inset 0 1px 0 rgba(255,255,255,.04),
        0 0 0 1px rgba(255,255,255,.02);
      color:#E9DBFF;
      font-size:13px;
      line-height:18px;
      font-weight:600;
      letter-spacing:-.01em;
      word-break:break-word;
      overflow-wrap:anywhere;
      text-align:center;
    ">
      ${escapeHtml(text)}
    </div>
  `;
}

function ctaButton(url, label) {
  return `
    <table role="presentation" cellpadding="0" cellspacing="0" align="center" style="margin:18px auto 12px;">
      <tr>
        <td align="center">
          <a href="${escapeHtml(safeUrl(url))}"
             style="
               display:inline-block;
               background:
                 radial-gradient(circle at 50% 0%, rgba(255,255,255,.18), transparent 34%),
                 linear-gradient(90deg, #F8F4FF 0%, #DDCBFF 42%, #B55CFF 100%);
               border:1px solid rgba(255,255,255,.12);
               box-shadow:
                 0 16px 42px rgba(181,92,255,.18),
                 0 0 0 1px rgba(255,255,255,.10) inset,
                 inset 0 1px 0 rgba(255,255,255,.42);
               color:#100A17;
               text-decoration:none;
               font-size:14px;
               line-height:20px;
               font-weight:800;
               letter-spacing:-.01em;
               border-radius:999px;
               padding:14px 22px;
               min-width:210px;
               text-align:center;
             ">
            ${escapeHtml(label)}
          </a>
        </td>
      </tr>
    </table>
  `;
}

function linkBox(url) {
  const safe = escapeHtml(safeUrl(url));
  return `
    <div style="
      margin:0 0 16px;
      background:
        linear-gradient(180deg, rgba(255,255,255,.04), rgba(255,255,255,.02)),
        rgba(255,255,255,.015);
      border:1px solid rgba(255,255,255,.08);
      border-radius:14px;
      padding:14px 14px;
      word-break:break-all;
      box-shadow: inset 0 1px 0 rgba(255,255,255,.03);
    ">
      <a href="${safe}" style="color:#A7B0FF;text-decoration:underline;font-size:12px;line-height:18px;">
        ${safe}
      </a>
    </div>
  `;
}

function supportLine(email) {
  const safe = escapeHtml(email || 'support@adray.ai');
  return `
    <p style="margin:10px 0 0;font-size:12px;line-height:18px;color:#9B90AA;">
      Support: <a href="mailto:${safe}" style="color:#BDB2C9;text-decoration:underline">${safe}</a>
    </p>
  `;
}

function wrapEmail({
  title,
  preheader,
  contentHtml,
  footerHtml,
  badgeText,
}) {
  const year = new Date().getFullYear();
  const safeTitle = escapeHtml(title);
  const safePreheader = escapeHtml(preheader || '');
  const badge = escapeHtml(badgeText || 'Update');

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <meta name="x-apple-disable-message-reformatting">
  <meta name="color-scheme" content="dark light">
  <meta name="supported-color-schemes" content="dark light">
  <title>${safeTitle}</title>
  <style>
    :root { color-scheme: dark; }
    body, table, td, a { -webkit-text-size-adjust:100%; -ms-text-size-adjust:100%; }
    table, td { mso-table-lspace:0pt; mso-table-rspace:0pt; }
    img { -ms-interpolation-mode:bicubic; }
    a[x-apple-data-detectors] {
      color: inherit !important;
      text-decoration: none !important;
      font-size: inherit !important;
      font-family: inherit !important;
      font-weight: inherit !important;
      line-height: inherit !important;
    }
    @media screen and (max-width: 600px) {
      .card { width:100% !important; border-radius:22px !important; }
      .px { padding-left:20px !important; padding-right:20px !important; }
      .hero-title { font-size:28px !important; line-height:1.02 !important; }
      .hero-copy { font-size:15px !important; line-height:24px !important; }
      .btn-wrap a { display:block !important; width:100% !important; min-width:0 !important; }
      .stack-gap { height:10px !important; }
      .top-pad { padding-top:26px !important; }
    }
  </style>
</head>
<body style="margin:0;padding:0;background:#050507;color:#FFFFFF;font-family:Inter,Arial,Helvetica,sans-serif;">
  <span style="display:none!important;visibility:hidden;opacity:0;color:transparent;height:0;width:0;overflow:hidden;">
    ${safePreheader}
  </span>

  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="
    background:
      radial-gradient(900px 420px at 12% -6%, rgba(181,92,255,.10), transparent 58%),
      radial-gradient(760px 360px at 88% 6%, rgba(79,227,193,.07), transparent 56%),
      radial-gradient(820px 300px at 50% 100%, rgba(181,92,255,.08), transparent 62%),
      linear-gradient(180deg, #060608 0%, #09090D 38%, #050507 100%);
  ">
    <tr>
      <td align="center" style="padding:42px 10px;">
        <table role="presentation" cellpadding="0" cellspacing="0" width="580" class="card"
          style="
            width:580px;
            max-width:580px;
            background:
              linear-gradient(180deg, rgba(18,14,28,.92) 0%, rgba(10,10,16,.96) 100%);
            border-radius:28px;
            border:1px solid rgba(255,255,255,.08);
            box-shadow:
              inset 0 1px 0 rgba(255,255,255,.03),
              0 20px 60px rgba(0,0,0,.34),
              0 0 30px rgba(181,92,255,.10);
            overflow:hidden;
          ">

          <tr>
            <td style="padding:18px 24px;background:#110C22;border-bottom:1px solid rgba(255,255,255,.08);">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
                <tr>
                  <td valign="middle">
                    ${brandWordmark()}
                  </td>
                  <td align="right" valign="middle" style="font-size:12px;color:rgba(255,255,255,.58);font-weight:500;">
                    ${badge}
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <tr>
            <td class="px top-pad" style="padding:0 44px 36px;">
              ${contentHtml}
            </td>
          </tr>

          <tr>
            <td style="
              background:#100C1E;
              padding:18px 28px;
              text-align:center;
              font-size:12px;
              line-height:18px;
              color:#7F748F;
              border-top:1px solid rgba(255,255,255,.05);
            ">
              ${
                footerHtml ||
                `© ${year} Adray · <a href="https://adray.ai/privacy" style="color:#9B90AA;text-decoration:underline">Privacy Policy</a>`
              }
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

function verifyEmail({
  verifyUrl,
  name,
  email,
  brand = 'Adray',
  supportEmail = 'support@adray.ai',
  privacyUrl = 'https://adray.ai/privacy',
} = {}) {
  const url = safeUrl(verifyUrl);
  const displayName = safeName(name, email);

  const contentHtml = `
    <div style="padding-top:30px;">
      <div style="
        width:72px;height:72px;border-radius:22px;
        margin:0 auto 22px;
        display:grid;place-items:center;
        color:#C87CFF;
        background:
          radial-gradient(circle at 50% 0%, rgba(255,255,255,.12), transparent 58%),
          linear-gradient(180deg, rgba(255,255,255,.06), rgba(255,255,255,.02)),
          rgba(255,255,255,.015);
        border:1px solid rgba(255,255,255,.08);
        box-shadow:
          inset 0 1px 0 rgba(255,255,255,.05),
          0 12px 30px rgba(0,0,0,.24),
          0 0 24px rgba(181,92,255,.12);
      ">
        <div style="font-size:30px;line-height:30px;">✉</div>
      </div>

      <div style="text-align:center;">
        <div style="margin:0 0 12px;font-size:11px;line-height:16px;font-weight:700;letter-spacing:.18em;text-transform:uppercase;color:rgba(200,124,255,.78);">
          Email verification
        </div>

        <div class="hero-title" style="
          margin:0 0 16px;
          font-size:34px;
          line-height:1.02;
          font-weight:700;
          letter-spacing:-.05em;
          color:#FFFFFF;
        ">
          Confirm your email
        </div>

        <p class="hero-copy" style="margin:0 0 10px;font-size:16px;line-height:26px;color:#EAE4F2;">
          Hi <strong style="color:#FFFFFF">${escapeHtml(displayName)}</strong>,
        </p>

        <p class="hero-copy" style="margin:0 0 16px;font-size:16px;line-height:26px;color:#EAE4F2;">
          Welcome to <strong style="color:#FFFFFF">${escapeHtml(brand)}</strong>. Confirm that this email belongs to you to activate your account and continue.
        </p>

        ${
          email
            ? `<div style="margin:0 auto 18px;max-width:100%;">${infoPill(email)}</div>`
            : ''
        }

        <div class="btn-wrap">
          ${ctaButton(url, 'Verify my email')}
        </div>

        <p style="margin:8px 0 10px;font-size:12px;line-height:19px;color:#BDB2C9;">
          If the button does not work, copy and paste this link into your browser:
        </p>

        ${linkBox(url)}

        <p style="margin:14px 0 0;font-size:12px;line-height:18px;color:#9B90AA;">
          If this was not you, you can safely ignore this email.
        </p>

        ${supportLine(supportEmail)}
      </div>
    </div>
  `;

  const year = new Date().getFullYear();
  const footer = `© ${year} ${escapeHtml(brand)} · <a href="${escapeHtml(
    privacyUrl
  )}" style="color:#9B90AA;text-decoration:underline">Privacy Policy</a>`;

  return wrapEmail({
    title: `Verify your email · ${brand}`,
    preheader: `Confirm your email to activate your ${brand} account.`,
    contentHtml,
    footerHtml: footer,
    badgeText: 'Verification',
  });
}

function welcomeEmail({
  name,
  email,
  brand = 'Adray',
  supportEmail = 'support@adray.ai',
  loginUrl = 'https://adray.ai/login',
} = {}) {
  const displayName = safeName(name, email);

  const contentHtml = `
    <div style="padding-top:30px;">
      <div style="
        width:72px;height:72px;border-radius:22px;
        margin:0 auto 22px;
        display:grid;place-items:center;
        color:#C87CFF;
        background:
          radial-gradient(circle at 50% 0%, rgba(255,255,255,.12), transparent 58%),
          linear-gradient(180deg, rgba(255,255,255,.06), rgba(255,255,255,.02)),
          rgba(255,255,255,.015);
        border:1px solid rgba(255,255,255,.08);
        box-shadow:
          inset 0 1px 0 rgba(255,255,255,.05),
          0 12px 30px rgba(0,0,0,.24),
          0 0 24px rgba(181,92,255,.12);
      ">
        <div style="font-size:30px;line-height:30px;">✦</div>
      </div>

      <div style="text-align:center;">
        <div style="margin:0 0 12px;font-size:11px;line-height:16px;font-weight:700;letter-spacing:.18em;text-transform:uppercase;color:rgba(200,124,255,.78);">
          Welcome
        </div>

        <div class="hero-title" style="
          margin:0 0 16px;
          font-size:34px;
          line-height:1.02;
          font-weight:700;
          letter-spacing:-.05em;
          color:#FFFFFF;
        ">
          Welcome to ${escapeHtml(brand)}
        </div>

        <p class="hero-copy" style="margin:0 0 14px;font-size:16px;line-height:26px;color:#EAE4F2;">
          Hi <strong style="color:#FFFFFF">${escapeHtml(displayName)}</strong>, your account is now ready.
        </p>

        <p class="hero-copy" style="margin:0 0 14px;font-size:16px;line-height:26px;color:#EAE4F2;">
          You can now sign in, complete your onboarding, connect your data sources, and start getting value from Adray right away.
        </p>

        <p class="hero-copy" style="margin:0 0 18px;font-size:16px;line-height:26px;color:#EAE4F2;">
          Your best next step is to log in and finish setup so your workspace is fully activated.
        </p>

        <div class="btn-wrap">
          ${ctaButton(loginUrl, 'Go to Adray')}
        </div>

        <p style="margin:16px 0 0;font-size:13px;line-height:20px;color:#BDB2C9;">
          — The Adray team
        </p>

        ${supportLine(supportEmail)}
      </div>
    </div>
  `;

  return wrapEmail({
    title: `Welcome to ${brand}`,
    preheader: `Your ${brand} account is ready. Complete setup and get started.`,
    contentHtml,
    badgeText: 'Welcome',
  });
}

function resetPasswordEmail({
  resetUrl,
  name,
  email,
  brand = 'Adray',
  supportEmail = 'support@adray.ai',
} = {}) {
  const url = safeUrl(resetUrl);
  const displayName = safeName(name, email);

  const contentHtml = `
    <div style="padding-top:30px;">
      <div style="
        width:72px;height:72px;border-radius:22px;
        margin:0 auto 22px;
        display:grid;place-items:center;
        color:#C87CFF;
        background:
          radial-gradient(circle at 50% 0%, rgba(255,255,255,.12), transparent 58%),
          linear-gradient(180deg, rgba(255,255,255,.06), rgba(255,255,255,.02)),
          rgba(255,255,255,.015);
        border:1px solid rgba(255,255,255,.08);
        box-shadow:
          inset 0 1px 0 rgba(255,255,255,.05),
          0 12px 30px rgba(0,0,0,.24),
          0 0 24px rgba(181,92,255,.12);
      ">
        <div style="font-size:28px;line-height:28px;">⟲</div>
      </div>

      <div style="text-align:center;">
        <div style="margin:0 0 12px;font-size:11px;line-height:16px;font-weight:700;letter-spacing:.18em;text-transform:uppercase;color:rgba(200,124,255,.78);">
          Password reset
        </div>

        <div class="hero-title" style="
          margin:0 0 16px;
          font-size:34px;
          line-height:1.02;
          font-weight:700;
          letter-spacing:-.05em;
          color:#FFFFFF;
        ">
          Reset your password
        </div>

        <p class="hero-copy" style="margin:0 0 10px;font-size:16px;line-height:26px;color:#EAE4F2;">
          Hi <strong style="color:#FFFFFF">${escapeHtml(displayName)}</strong>,
        </p>

        <p class="hero-copy" style="margin:0 0 18px;font-size:16px;line-height:26px;color:#EAE4F2;">
          We received a request to reset your password for your ${escapeHtml(brand)} account.
        </p>

        <div class="btn-wrap">
          ${ctaButton(url, 'Reset password')}
        </div>

        <p style="margin:8px 0 10px;font-size:12px;line-height:19px;color:#BDB2C9;">
          If the button does not work, copy and paste this link into your browser:
        </p>

        ${linkBox(url)}

        <p style="margin:14px 0 0;font-size:12px;line-height:18px;color:#9B90AA;">
          If you did not request this change, you can ignore this email. This link expires in 1 hour.
        </p>

        ${supportLine(supportEmail)}
      </div>
    </div>
  `;

  return wrapEmail({
    title: `Reset password · ${brand}`,
    preheader: `Reset your password securely. This link expires soon.`,
    contentHtml,
    badgeText: 'Recovery',
  });
}

function auditReadyEmail({
  name,
  email,
  brand = 'Adray',
  supportEmail = 'support@adray.ai',
  loginUrl = 'https://adray.ai/login',
} = {}) {
  const displayName = safeName(name, email);
  const url = safeUrl(loginUrl);

  const contentHtml = `
    <div style="padding-top:30px;">
      <div style="
        width:72px;height:72px;border-radius:22px;
        margin:0 auto 22px;
        display:grid;place-items:center;
        color:#C87CFF;
        background:
          radial-gradient(circle at 50% 0%, rgba(255,255,255,.12), transparent 58%),
          linear-gradient(180deg, rgba(255,255,255,.06), rgba(255,255,255,.02)),
          rgba(255,255,255,.015);
        border:1px solid rgba(255,255,255,.08);
        box-shadow:
          inset 0 1px 0 rgba(255,255,255,.05),
          0 12px 30px rgba(0,0,0,.24),
          0 0 24px rgba(181,92,255,.12);
      ">
        <div style="font-size:28px;line-height:28px;">✓</div>
      </div>

      <div style="text-align:center;">
        <div style="margin:0 0 12px;font-size:11px;line-height:16px;font-weight:700;letter-spacing:.18em;text-transform:uppercase;color:rgba(200,124,255,.78);">
          Audit ready
        </div>

        <div class="hero-title" style="
          margin:0 0 16px;
          font-size:34px;
          line-height:1.02;
          font-weight:700;
          letter-spacing:-.05em;
          color:#FFFFFF;
        ">
          Your audit is ready
        </div>

        <p class="hero-copy" style="margin:0 0 10px;font-size:16px;line-height:26px;color:#EAE4F2;">
          Hi <strong style="color:#FFFFFF">${escapeHtml(displayName)}</strong>,
        </p>

        <p class="hero-copy" style="margin:0 0 18px;font-size:16px;line-height:26px;color:#EAE4F2;">
          ${escapeHtml(brand)} analyzed your connected accounts and prepared a report with key findings, opportunities, and next-step recommendations.
        </p>

        <div class="btn-wrap">
          ${ctaButton(url, 'View my audit')}
        </div>

        <p style="margin:8px 0 10px;font-size:12px;line-height:19px;color:#BDB2C9;">
          If the button does not work, copy and paste this link into your browser:
        </p>

        ${linkBox(url)}

        <p style="margin:16px 0 0;font-size:13px;line-height:20px;color:#BDB2C9;">
          — The ${escapeHtml(brand)} team
        </p>

        ${supportLine(supportEmail)}
      </div>
    </div>
  `;

  return wrapEmail({
    title: 'Your audit is ready',
    preheader: 'Your Adray audit is ready to review.',
    contentHtml,
    badgeText: 'Audit',
  });
}

function dailyFollowupCallEmail({
  name,
  email,
  operatorName = 'Cesar',
  brand = 'Adray AI',
  supportEmail = 'support@adray.ai',
  calendlyUrl = 'https://calendly.com/adrayai/adray-calendario',
  websiteUrl = 'https://adray.ai',
} = {}) {
  const displayName = safeName(name, email);
  const safeCalendly = safeUrl(calendlyUrl);
  const safeWebsite = safeUrl(websiteUrl);

  const contentHtml = `
    <div style="padding-top:30px;">
      <div style="
        width:72px;height:72px;border-radius:22px;
        margin:0 auto 22px;
        display:grid;place-items:center;
        color:#C87CFF;
        background:
          radial-gradient(circle at 50% 0%, rgba(255,255,255,.12), transparent 58%),
          linear-gradient(180deg, rgba(255,255,255,.06), rgba(255,255,255,.02)),
          rgba(255,255,255,.015);
        border:1px solid rgba(255,255,255,.08);
        box-shadow:
          inset 0 1px 0 rgba(255,255,255,.05),
          0 12px 30px rgba(0,0,0,.24),
          0 0 24px rgba(181,92,255,.12);
      ">
        <div style="font-size:28px;line-height:28px;">✦</div>
      </div>

      <div style="text-align:center;">
        <div style="margin:0 0 12px;font-size:11px;line-height:16px;font-weight:700;letter-spacing:.18em;text-transform:uppercase;color:rgba(200,124,255,.78);">
          Follow-up
        </div>

        <div class="hero-title" style="
          margin:0 0 16px;
          font-size:34px;
          line-height:1.02;
          font-weight:700;
          letter-spacing:-.05em;
          color:#FFFFFF;
        ">
          Let’s do a quick onboarding call
        </div>

        <p class="hero-copy" style="margin:0 0 10px;font-size:16px;line-height:26px;color:#EAE4F2;">
          Hi <strong style="color:#FFFFFF">${escapeHtml(displayName)}</strong>,
        </p>

        <p class="hero-copy" style="margin:0 0 12px;font-size:16px;line-height:26px;color:#EAE4F2;">
          I’m <strong style="color:#FFFFFF">${escapeHtml(operatorName)}</strong> from the <strong style="color:#FFFFFF">${escapeHtml(brand)}</strong> team.
        </p>

        <p class="hero-copy" style="margin:0 0 16px;font-size:16px;line-height:26px;color:#EAE4F2;">
          I’d love to invite you to a quick 10-minute call to review your setup, confirm everything is working properly, and help you get real value from Adray from day one.
        </p>

        <div style="
          margin:0 0 18px;
          text-align:left;
          background:
            linear-gradient(180deg, rgba(255,255,255,.04), rgba(255,255,255,.02)),
            rgba(255,255,255,.015);
          border:1px solid rgba(255,255,255,.08);
          border-radius:14px;
          padding:16px 16px 12px;
          box-shadow: inset 0 1px 0 rgba(255,255,255,.03);
        ">
          <ul style="margin:0;padding:0 0 0 18px;color:#EAE4F2;font-size:14px;line-height:22px;">
            <li style="margin:0 0 8px;">Review your current setup</li>
            <li style="margin:0 0 8px;">Confirm everything is connected correctly</li>
            <li style="margin:0 0 8px;">Show you how to get the most from the dashboard</li>
            <li style="margin:0 0 8px;">Walk through your first audit results</li>
            <li style="margin:0 0 8px;">Help you get value faster from the start</li>
          </ul>
        </div>

        <div class="btn-wrap">
          ${ctaButton(safeCalendly, 'Schedule a 10-minute call')}
        </div>

        <p style="margin:8px 0 10px;font-size:12px;line-height:19px;color:#BDB2C9;">
          If the button does not work, copy and paste this link into your browser:
        </p>

        ${linkBox(safeCalendly)}

        <p style="margin:14px 0 0;font-size:12px;line-height:18px;color:#9B90AA;">
          If you already booked, feel free to ignore this email.
        </p>

        <div style="margin-top:16px;padding-top:16px;border-top:1px solid rgba(255,255,255,.08);">
          <p style="margin:0;font-size:13px;line-height:20px;color:#BDB2C9;">
            Best,<br>
            <strong style="color:#FFFFFF">${escapeHtml(operatorName)}</strong><br>
            Account Manager · ${escapeHtml(brand)}<br>
            <a href="${escapeHtml(safeWebsite)}" style="color:#A7B0FF;text-decoration:underline">${escapeHtml(safeWebsite)}</a>
          </p>

          ${supportLine(supportEmail)}
        </div>
      </div>
    </div>
  `;

  return wrapEmail({
    title: 'Let’s do a quick onboarding call',
    preheader: 'Book a quick 10-minute call to review setup and get started faster.',
    contentHtml,
    badgeText: 'Follow-up',
  });
}

module.exports = {
  welcomeEmail,
  resetPasswordEmail,
  verifyEmail,
  auditReadyEmail,
  dailyFollowupCallEmail,
};