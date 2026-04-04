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

function brandMarkSvg() {
  return `
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true" xmlns="http://www.w3.org/2000/svg">
      <path d="M12 2.75L13.94 8.06L19.25 10L13.94 11.94L12 17.25L10.06 11.94L4.75 10L10.06 8.06L12 2.75Z" fill="#C87CFF"/>
    </svg>
  `;
}

function brandWordmark() {
  return `
    <table role="presentation" cellpadding="0" cellspacing="0" border="0">
      <tr>
        <td valign="middle">
          <div style="
            width:32px;
            height:32px;
            border-radius:10px;
            background:#1A1426;
            border:1px solid rgba(255,255,255,.10);
            box-shadow:inset 0 1px 0 rgba(255,255,255,.05);
            display:flex;
            align-items:center;
            justify-content:center;
          ">
            ${brandMarkSvg()}
          </div>
        </td>
        <td width="10"></td>
        <td valign="middle" style="
          font-size:13px;
          line-height:13px;
          letter-spacing:.22em;
          font-weight:900;
          color:#F3EEFF;
        ">
          ADRAY
        </td>
      </tr>
    </table>
  `;
}

function heroIcon(icon = 'spark') {
  const map = {
    spark: `
      <svg width="34" height="34" viewBox="0 0 24 24" fill="none" aria-hidden="true" xmlns="http://www.w3.org/2000/svg">
        <path d="M12 2.75L13.94 8.06L19.25 10L13.94 11.94L12 17.25L10.06 11.94L4.75 10L10.06 8.06L12 2.75Z" fill="#C87CFF"/>
      </svg>
    `,
    mail: `
      <svg width="34" height="34" viewBox="0 0 24 24" fill="none" aria-hidden="true" xmlns="http://www.w3.org/2000/svg">
        <path d="M3.75 7.5L10.94 12.533C11.576 12.978 11.894 13.2 12.231 13.286C12.567 13.372 12.933 13.372 13.269 13.286C13.606 13.2 13.924 12.978 14.56 12.533L21.75 7.5" stroke="#C87CFF" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/>
        <path d="M6.45 19.5H17.55C19.23 19.5 20.07 19.5 20.712 19.173C21.276 18.886 21.714 18.448 22.001 17.884C22.328 17.242 22.328 16.402 22.328 14.722V9.278C22.328 7.598 22.328 6.758 22.001 6.116C21.714 5.552 21.276 5.114 20.712 4.827C20.07 4.5 19.23 4.5 17.55 4.5H6.45C4.77 4.5 3.93 4.5 3.288 4.827C2.724 5.114 2.286 5.552 1.999 6.116C1.672 6.758 1.672 7.598 1.672 9.278V14.722C1.672 16.402 1.672 17.242 1.999 17.884C2.286 18.448 2.724 18.886 3.288 19.173C3.93 19.5 4.77 19.5 6.45 19.5Z" stroke="#C87CFF" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/>
      </svg>
    `,
    reset: `
      <svg width="34" height="34" viewBox="0 0 24 24" fill="none" aria-hidden="true" xmlns="http://www.w3.org/2000/svg">
        <path d="M20 11A8 8 0 1 0 17.657 16.657" stroke="#C87CFF" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/>
        <path d="M20 5V11H14" stroke="#C87CFF" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/>
      </svg>
    `,
    audit: `
      <svg width="34" height="34" viewBox="0 0 24 24" fill="none" aria-hidden="true" xmlns="http://www.w3.org/2000/svg">
        <path d="M9 12L11 14L15.5 9.5" stroke="#C87CFF" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>
        <path d="M20.25 12C20.25 16.5563 16.5563 20.25 12 20.25C7.44365 20.25 3.75 16.5563 3.75 12C3.75 7.44365 7.44365 3.75 12 3.75C16.5563 3.75 20.25 7.44365 20.25 12Z" stroke="#C87CFF" stroke-width="1.7"/>
      </svg>
    `,
    calendar: `
      <svg width="34" height="34" viewBox="0 0 24 24" fill="none" aria-hidden="true" xmlns="http://www.w3.org/2000/svg">
        <path d="M8 2.75V6" stroke="#C87CFF" stroke-width="1.7" stroke-linecap="round"/>
        <path d="M16 2.75V6" stroke="#C87CFF" stroke-width="1.7" stroke-linecap="round"/>
        <path d="M3.75 9H20.25" stroke="#C87CFF" stroke-width="1.7" stroke-linecap="round"/>
        <path d="M6.45 21.25H17.55C19.23 21.25 20.07 21.25 20.712 20.923C21.276 20.636 21.714 20.198 22.001 19.634C22.328 18.992 22.328 18.152 22.328 16.472V8.95C22.328 7.27 22.328 6.43 22.001 5.788C21.714 5.224 21.276 4.786 20.712 4.499C20.07 4.172 19.23 4.172 17.55 4.172H6.45C4.77 4.172 3.93 4.172 3.288 4.499C2.724 4.786 2.286 5.224 1.999 5.788C1.672 6.43 1.672 7.27 1.672 8.95V16.472C1.672 18.152 1.672 18.992 1.999 19.634C2.286 20.198 2.724 20.636 3.288 20.923C3.93 21.25 4.77 21.25 6.45 21.25Z" stroke="#C87CFF" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/>
      </svg>
    `,
  };

  return `
    <div style="
      width:76px;
      height:76px;
      border-radius:24px;
      margin:0 auto 20px;
      background:
        radial-gradient(circle at 50% 0%, rgba(255,255,255,.08), transparent 56%),
        linear-gradient(180deg, #1B1527 0%, #120E1C 100%);
      border:1px solid rgba(255,255,255,.08);
      box-shadow:
        inset 0 1px 0 rgba(255,255,255,.04),
        0 14px 32px rgba(0,0,0,.28);
      display:flex;
      align-items:center;
      justify-content:center;
      text-align:center;
    ">
      ${map[icon] || map.spark}
    </div>
  `;
}

function infoPill(text = '') {
  if (!text) return '';
  return `
    <div style="display:inline-block;max-width:100%;">
      <div style="
        display:inline-block;
        max-width:100%;
        padding:10px 16px;
        border-radius:999px;
        background:#171322;
        border:1px solid rgba(181,92,255,.14);
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
    </div>
  `;
}

function sectionKicker(text) {
  return `
    <div style="
      margin:0 0 12px;
      font-size:11px;
      line-height:16px;
      font-weight:800;
      letter-spacing:.18em;
      text-transform:uppercase;
      color:#B96DFF;
    ">
      ${escapeHtml(text)}
    </div>
  `;
}

function titleBlock(text) {
  return `
    <div class="hero-title" style="
      margin:0 0 16px;
      font-size:34px;
      line-height:1.04;
      font-weight:800;
      letter-spacing:-.05em;
      color:#FFFFFF;
    ">
      ${escapeHtml(text)}
    </div>
  `;
}

function textBlock(text, marginBottom = 14) {
  return `
    <p class="hero-copy" style="
      margin:0 0 ${marginBottom}px;
      font-size:16px;
      line-height:26px;
      color:#EAE4F2;
    ">
      ${text}
    </p>
  `;
}

function ctaButton(url, label) {
  return `
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" align="center" style="margin:18px auto 12px;">
      <tr>
        <td class="btn-wrap" align="center">
          <a href="${escapeHtml(safeUrl(url))}"
             style="
               display:inline-block;
               background:#D9CFF0;
               background-image:linear-gradient(90deg, #F2ECFF 0%, #E1D0FF 42%, #B55CFF 100%);
               border:1px solid rgba(255,255,255,.10);
               box-shadow:
                 0 12px 30px rgba(181,92,255,.16),
                 inset 0 1px 0 rgba(255,255,255,.35);
               color:#120C1A !important;
               text-decoration:none;
               font-size:14px;
               line-height:20px;
               font-weight:800;
               letter-spacing:-.01em;
               border-radius:999px;
               padding:14px 24px;
               min-width:220px;
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
      background:#171322;
      border:1px solid rgba(255,255,255,.08);
      border-radius:14px;
      padding:14px;
      word-break:break-all;
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

function footerHtml(brand = 'Adray', privacyUrl = 'https://adray.ai/privacy') {
  const year = new Date().getFullYear();
  return `© ${year} ${escapeHtml(brand)} · <a href="${escapeHtml(
    privacyUrl
  )}" style="color:#9B90AA;text-decoration:underline">Privacy Policy</a>`;
}

function wrapEmail({
  title,
  preheader,
  contentHtml,
  footerHtml: customFooterHtml,
  badgeText,
}) {
  const safeTitle = escapeHtml(title);
  const safePreheader = escapeHtml(preheader || '');
  const badge = escapeHtml(badgeText || 'Update');

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <meta name="x-apple-disable-message-reformatting">
  <meta name="color-scheme" content="dark">
  <meta name="supported-color-schemes" content="dark">
  <title>${safeTitle}</title>
  <style>
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
    u + .body .gmail-blend-screen { background:#0B0814 !important; }
    u + .body .gmail-force-dark-fix { background:#0B0814 !important; }
    @media screen and (max-width: 600px) {
      .card { width:100% !important; border-radius:24px !important; }
      .px { padding-left:20px !important; padding-right:20px !important; }
      .hero-title { font-size:29px !important; line-height:1.06 !important; }
      .hero-copy { font-size:15px !important; line-height:24px !important; }
      .btn-wrap a { display:block !important; width:100% !important; min-width:0 !important; }
      .top-pad { padding-top:26px !important; }
      .mobile-hide-br { display:none !important; }
    }
  </style>
</head>
<body class="body" style="margin:0;padding:0;background:#050507;font-family:Inter,Arial,Helvetica,sans-serif;color:#FFFFFF;">
  <span style="display:none!important;visibility:hidden;opacity:0;color:transparent;height:0;width:0;overflow:hidden;">
    ${safePreheader}
  </span>

  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#050507" style="background:#050507;">
    <tr>
      <td align="center" style="padding:36px 10px;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:620px;">
          <tr>
            <td align="center">
              <table role="presentation" width="580" cellpadding="0" cellspacing="0" border="0" class="card"
                bgcolor="#0B0814"
                style="
                  width:580px;
                  max-width:580px;
                  background:#0B0814;
                  border:1px solid rgba(255,255,255,.08);
                  border-radius:28px;
                  overflow:hidden;
                  box-shadow:0 18px 50px rgba(0,0,0,.32);
                ">

                <tr>
                  <td bgcolor="#120D1D" style="background:#120D1D;padding:18px 24px;border-bottom:1px solid rgba(255,255,255,.07);">
                    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
                      <tr>
                        <td valign="middle">
                          ${brandWordmark()}
                        </td>
                        <td align="right" valign="middle" style="font-size:12px;line-height:18px;color:#A79CB6;font-weight:500;">
                          ${badge}
                        </td>
                      </tr>
                    </table>
                  </td>
                </tr>

                <tr>
                  <td class="px top-pad gmail-force-dark-fix" bgcolor="#0B0814" style="background:#0B0814;padding:0 44px 38px;">
                    ${contentHtml}
                  </td>
                </tr>

                <tr>
                  <td bgcolor="#110C1B" style="
                    background:#110C1B;
                    padding:18px 28px;
                    text-align:center;
                    font-size:12px;
                    line-height:18px;
                    color:#7F748F;
                    border-top:1px solid rgba(255,255,255,.05);
                  ">
                    ${customFooterHtml || footerHtml()}
                  </td>
                </tr>

              </table>
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
    <div style="padding-top:30px;text-align:center;">
      ${heroIcon('mail')}
      ${sectionKicker('Verification')}
      ${titleBlock('Confirm your email')}

      ${textBlock(`Hi <strong style="color:#FFFFFF">${escapeHtml(displayName)}</strong>,`, 10)}

      ${textBlock(`Welcome to <strong style="color:#FFFFFF">${escapeHtml(brand)}</strong>. Please confirm that this email address belongs to you so we can activate your account.`, 16)}

      ${
        email
          ? `<div style="margin:0 auto 18px;max-width:100%;">${infoPill(email)}</div>`
          : ''
      }

      ${ctaButton(url, 'Verify my email')}

      <p style="margin:8px 0 10px;font-size:12px;line-height:19px;color:#BDB2C9;">
        If the button does not work, copy and paste this link into your browser:
      </p>

      ${linkBox(url)}

      <p style="margin:14px 0 0;font-size:12px;line-height:18px;color:#9B90AA;">
        If this was not you, you can safely ignore this email.
      </p>

      ${supportLine(supportEmail)}
    </div>
  `;

  return wrapEmail({
    title: `Verify your email · ${brand}`,
    preheader: `Confirm your email to activate your ${brand} account.`,
    contentHtml,
    footerHtml: footerHtml(brand, privacyUrl),
    badgeText: 'Verification',
  });
}

function welcomeEmail({
  name,
  email,
  brand = 'Adray',
  supportEmail = 'support@adray.ai',
  loginUrl = 'https://adray.ai/login',
  privacyUrl = 'https://adray.ai/privacy',
} = {}) {
  const displayName = safeName(name, email);

  const contentHtml = `
    <div style="padding-top:30px;text-align:center;">
      ${heroIcon('spark')}
      ${sectionKicker('Welcome')}
      ${titleBlock(`Welcome to ${brand}`)}

      ${textBlock(`Hi <strong style="color:#FFFFFF">${escapeHtml(displayName)}</strong>, your account is now ready.`, 14)}

      ${textBlock(`We’re excited to have you here. Adray is built to help you connect your marketing data, activate your workspace faster, and turn insights into action with confidence.`, 14)}

      ${textBlock(`Your best next step is to sign in, complete onboarding, and connect your data sources so your workspace is fully set up from day one.`, 18)}

      ${ctaButton(loginUrl, 'Go to Adray')}

      <p style="margin:16px 0 0;font-size:13px;line-height:20px;color:#BDB2C9;">
        We’re glad you’re here.<br class="mobile-hide-br">
        — The Adray team
      </p>

      ${supportLine(supportEmail)}
    </div>
  `;

  return wrapEmail({
    title: `Welcome to ${brand}`,
    preheader: `Your ${brand} account is ready. Sign in and complete setup.`,
    contentHtml,
    footerHtml: footerHtml(brand, privacyUrl),
    badgeText: 'Welcome',
  });
}

function resetPasswordEmail({
  resetUrl,
  name,
  email,
  brand = 'Adray',
  supportEmail = 'support@adray.ai',
  privacyUrl = 'https://adray.ai/privacy',
} = {}) {
  const url = safeUrl(resetUrl);
  const displayName = safeName(name, email);

  const contentHtml = `
    <div style="padding-top:30px;text-align:center;">
      ${heroIcon('reset')}
      ${sectionKicker('Recovery')}
      ${titleBlock('Reset your password')}

      ${textBlock(`Hi <strong style="color:#FFFFFF">${escapeHtml(displayName)}</strong>,`, 10)}

      ${textBlock(`We received a request to reset the password for your <strong style="color:#FFFFFF">${escapeHtml(brand)}</strong> account.`, 18)}

      ${ctaButton(url, 'Reset password')}

      <p style="margin:8px 0 10px;font-size:12px;line-height:19px;color:#BDB2C9;">
        If the button does not work, copy and paste this link into your browser:
      </p>

      ${linkBox(url)}

      <p style="margin:14px 0 0;font-size:12px;line-height:18px;color:#9B90AA;">
        If you did not request this change, you can ignore this email. This link expires in 1 hour.
      </p>

      ${supportLine(supportEmail)}
    </div>
  `;

  return wrapEmail({
    title: `Reset password · ${brand}`,
    preheader: `Reset your password securely. This link expires in 1 hour.`,
    contentHtml,
    footerHtml: footerHtml(brand, privacyUrl),
    badgeText: 'Recovery',
  });
}

function auditReadyEmail({
  name,
  email,
  brand = 'Adray',
  supportEmail = 'support@adray.ai',
  loginUrl = 'https://adray.ai/login',
  privacyUrl = 'https://adray.ai/privacy',
} = {}) {
  const displayName = safeName(name, email);
  const url = safeUrl(loginUrl);

  const contentHtml = `
    <div style="padding-top:30px;text-align:center;">
      ${heroIcon('audit')}
      ${sectionKicker('Audit')}
      ${titleBlock('Your audit is ready')}

      ${textBlock(`Hi <strong style="color:#FFFFFF">${escapeHtml(displayName)}</strong>,`, 10)}

      ${textBlock(`${escapeHtml(brand)} analyzed your connected accounts and prepared a report with key findings, opportunities, and next-step recommendations.`, 18)}

      ${ctaButton(url, 'View my audit')}

      <p style="margin:8px 0 10px;font-size:12px;line-height:19px;color:#BDB2C9;">
        If the button does not work, copy and paste this link into your browser:
      </p>

      ${linkBox(url)}

      <p style="margin:16px 0 0;font-size:13px;line-height:20px;color:#BDB2C9;">
        — The ${escapeHtml(brand)} team
      </p>

      ${supportLine(supportEmail)}
    </div>
  `;

  return wrapEmail({
    title: 'Your audit is ready',
    preheader: 'Your Adray audit is ready to review.',
    contentHtml,
    footerHtml: footerHtml(brand, privacyUrl),
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
  privacyUrl = 'https://adray.ai/privacy',
} = {}) {
  const displayName = safeName(name, email);
  const safeCalendly = safeUrl(calendlyUrl);
  const safeWebsite = safeUrl(websiteUrl);

  const contentHtml = `
    <div style="padding-top:30px;text-align:center;">
      ${heroIcon('calendar')}
      ${sectionKicker('Follow-up')}
      ${titleBlock('Let’s do a quick onboarding call')}

      ${textBlock(`Hi <strong style="color:#FFFFFF">${escapeHtml(displayName)}</strong>,`, 10)}

      ${textBlock(`I’m <strong style="color:#FFFFFF">${escapeHtml(operatorName)}</strong> from the <strong style="color:#FFFFFF">${escapeHtml(brand)}</strong> team.`, 12)}

      ${textBlock(`I’d love to invite you to a quick 10-minute call to review your setup, confirm everything is working properly, and help you get real value from Adray from day one.`, 16)}

      <div style="
        margin:0 0 18px;
        text-align:left;
        background:#171322;
        border:1px solid rgba(255,255,255,.08);
        border-radius:14px;
        padding:16px 16px 12px;
      ">
        <ul style="margin:0;padding:0 0 0 18px;color:#EAE4F2;font-size:14px;line-height:22px;">
          <li style="margin:0 0 8px;">Review your current setup</li>
          <li style="margin:0 0 8px;">Confirm everything is connected correctly</li>
          <li style="margin:0 0 8px;">Show you how to get the most from the dashboard</li>
          <li style="margin:0 0 8px;">Walk through your first audit results</li>
          <li style="margin:0 0 8px;">Help you get value faster from the start</li>
        </ul>
      </div>

      ${ctaButton(safeCalendly, 'Schedule a 10-minute call')}

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
  `;

  return wrapEmail({
    title: 'Let’s do a quick onboarding call',
    preheader: 'Book a quick 10-minute call to review setup and get started faster.',
    contentHtml,
    footerHtml: footerHtml(brand, privacyUrl),
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