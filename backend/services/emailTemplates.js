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

function brandMarkSvg(size = 22) {
  return `
    <svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" aria-hidden="true" xmlns="http://www.w3.org/2000/svg">
      <path d="M12 2.75L13.94 8.06L19.25 10L13.94 11.94L12 17.25L10.06 11.94L4.75 10L10.06 8.06L12 2.75Z" fill="#B55CFF"/>
    </svg>
  `;
}

function brandWordmark() {
  return `
    <table role="presentation" cellpadding="0" cellspacing="0" border="0">
      <tr>
        <td valign="middle" style="padding-right:10px;">
          ${brandMarkSvg(18)}
        </td>
        <td valign="middle">
          <div style="
            font-size:13px;
            line-height:13px;
            letter-spacing:.20em;
            font-weight:900;
            color:#F8F7FF;
            text-transform:uppercase;
          ">
            ADRAY
          </div>
        </td>
      </tr>
    </table>
  `;
}

function sectionKicker(text, align = 'center', color = '#C4B5FD', marginBottom = 10) {
  if (!text) return '';
  return `
    <div style="
      margin:0 0 ${marginBottom}px 0;
      font-size:11px;
      line-height:1.2;
      font-weight:800;
      letter-spacing:.18em;
      text-transform:uppercase;
      color:${color};
      text-align:${align};
    ">
      ${escapeHtml(text)}
    </div>
  `;
}

function titleBlock(text) {
  return `
    <div class="hero-title" style="
      margin:0 0 14px 0;
      font-size:42px;
      line-height:1.02;
      font-weight:900;
      letter-spacing:-.05em;
      color:#FFFFFF;
      text-align:center;
    ">
      ${escapeHtml(text)}
    </div>
  `;
}

function textBlock(text, marginBottom = 14, align = 'center', color = '#D7E0F3', size = 15, line = 26) {
  return `
    <p class="hero-copy" style="
      margin:0 0 ${marginBottom}px 0;
      font-size:${size}px;
      line-height:${line}px;
      color:${color};
      text-align:${align};
    ">
      ${text}
    </p>
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
        background:linear-gradient(180deg, rgba(20,18,32,0.94) 0%, rgba(11,11,18,0.98) 100%);
        border:1px solid rgba(181,92,255,.20);
        color:#F3F4F6;
        font-size:13px;
        line-height:18px;
        font-weight:700;
        letter-spacing:-.01em;
        word-break:break-word;
        overflow-wrap:anywhere;
        text-align:center;
        box-shadow:0 0 0 1px rgba(181,92,255,0.05) inset;
      ">
        ${escapeHtml(text)}
      </div>
    </div>
  `;
}

function buildSectionCard({
  eyebrow = '',
  eyebrowColor = '#C4B5FD',
  title = '',
  bodyHtml = '',
  marginBottom = 16,
  align = 'left',
  compact = false,
} = {}) {
  return `
    <div style="
      margin:0 0 ${marginBottom}px 0;
      padding:${compact ? '18px 18px 16px 18px' : '22px 22px 20px 22px'};
      border-radius:22px;
      background:linear-gradient(180deg, rgba(16,14,27,0.94) 0%, rgba(10,10,17,0.98) 100%);
      border:1px solid rgba(255,255,255,0.07);
      box-shadow:
        inset 0 1px 0 rgba(255,255,255,0.03),
        0 10px 30px rgba(0,0,0,0.18);
      text-align:${align};
    ">
      ${
        eyebrow
          ? `<div style="margin:0 0 8px 0;font-size:11px;line-height:1.2;font-weight:800;letter-spacing:0.16em;text-transform:uppercase;color:${eyebrowColor};">
              ${escapeHtml(eyebrow)}
            </div>`
          : ''
      }
      ${
        title
          ? `<div style="margin:0 0 10px 0;font-size:22px;line-height:1.18;font-weight:850;color:#ffffff;">
              ${escapeHtml(title)}
            </div>`
          : ''
      }
      ${bodyHtml}
    </div>
  `.trim();
}

function buildBulletList(items = [], bulletColor = '#4FE3C1') {
  if (!Array.isArray(items) || !items.length) return '';

  return `
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="border-collapse:collapse;">
      ${items
        .map(
          (item) => `
        <tr>
          <td valign="top" style="width:18px;padding:0 0 10px 0;font-size:14px;line-height:24px;color:${bulletColor};">•</td>
          <td valign="top" style="padding:0 0 10px 0;font-size:14px;line-height:24px;color:#DBE4FF;">
            ${escapeHtml(item)}
          </td>
        </tr>
      `
        )
        .join('')}
    </table>
  `.trim();
}

function ctaButton(url, label) {
  return `
    <div style="padding:4px 0 0 0;text-align:center;">
      <a href="${escapeHtml(safeUrl(url))}"
         style="
           display:inline-block;
           padding:14px 24px;
           border-radius:16px;
           background:linear-gradient(135deg, #8B5CF6 0%, #B55CFF 48%, #4FE3C1 100%);
           color:#FFFFFF !important;
           text-decoration:none;
           font-size:14px;
           line-height:20px;
           font-weight:800;
           box-shadow:0 12px 30px rgba(101,66,214,0.34);
           border:1px solid rgba(255,255,255,.08);
           min-width:220px;
           text-align:center;
         ">
        ${escapeHtml(label)}
      </a>
    </div>
  `;
}

function linkBox(url) {
  const safe = escapeHtml(safeUrl(url));
  return `
    <div style="
      margin:0;
      padding:16px 16px 14px 16px;
      border-radius:18px;
      background:linear-gradient(180deg, rgba(12,12,18,0.98) 0%, rgba(7,8,13,1) 100%);
      border:1px solid rgba(181,92,255,0.18);
      box-shadow:0 0 0 1px rgba(181,92,255,0.05) inset;
      word-break:break-all;
    ">
      <a href="${safe}" style="color:#C4B5FD;text-decoration:none;font-size:12px;line-height:20px;font-weight:700;">
        ${safe}
      </a>
    </div>
  `;
}

function supportLine(email, align = 'center') {
  const safe = escapeHtml(email || 'support@adray.ai');
  return `
    <p style="margin:12px 0 0 0;font-size:12px;line-height:20px;color:#8FA0BD;text-align:${align};">
      Support:
      <a href="mailto:${safe}" style="color:#C4B5FD;text-decoration:none;font-weight:700;">${safe}</a>
    </p>
  `;
}

function footerHtml(brand = 'Adray, Inc.', privacyUrl = 'https://adray.ai/privacy') {
  const year = new Date().getFullYear();
  return `© ${year} ${escapeHtml(brand)} · <a href="${escapeHtml(
    privacyUrl
  )}" style="color:#C4B5FD;text-decoration:none;font-weight:700;">Privacy Policy</a>`;
}

function wrapEmail({
  title,
  preheader,
  badgeText,
  headerEyebrow,
  heroTitle,
  heroIntroHtml,
  contentHtml,
  footerHtml: customFooterHtml,
}) {
  const safeTitle = escapeHtml(title || 'Adray');
  const safePreheader = escapeHtml(preheader || '');
  const eyebrow = escapeHtml(headerEyebrow || '');

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <meta name="x-apple-disable-message-reformatting">
  <meta name="color-scheme" content="dark only">
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
    @media screen and (max-width: 600px) {
      .card { width:100% !important; border-radius:24px !important; }
      .shell-pad { padding:22px 10px !important; }
      .header-pad { padding:24px 20px 18px 20px !important; }
      .body-pad { padding:20px 16px 10px 16px !important; }
      .footer-pad { padding:16px 20px 22px 20px !important; }
      .hero-title { font-size:34px !important; line-height:1.04 !important; }
      .hero-copy { font-size:15px !important; line-height:24px !important; }
      .mobile-full a { display:block !important; width:100% !important; min-width:0 !important; box-sizing:border-box !important; }
      .mobile-center { text-align:center !important; }
      .mobile-hide-br { display:none !important; }
    }
  </style>
</head>
<body style="margin:0;padding:0;background:#05070B;font-family:Inter,Arial,Helvetica,sans-serif;color:#FFFFFF;">
  <span style="display:none!important;visibility:hidden;opacity:0;color:transparent;height:0;width:0;overflow:hidden;">
    ${safePreheader}
  </span>

  <div style="width:100%;margin:0;padding:28px 10px;background:
    radial-gradient(circle at top left, rgba(181,92,255,0.10), transparent 26%),
    radial-gradient(circle at top right, rgba(79,227,193,0.08), transparent 22%),
    linear-gradient(180deg, #060608 0%, #09090D 38%, #050507 100%);
  ">
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="border-collapse:collapse;width:100%;">
      <tr>
        <td align="center" class="shell-pad">
          <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" class="card" style="border-collapse:separate;width:100%;max-width:720px;background:linear-gradient(180deg, rgba(15,12,25,0.98) 0%, rgba(8,9,14,1) 100%);border:1px solid rgba(255,255,255,0.08);border-radius:30px;overflow:hidden;box-shadow:0 24px 80px rgba(0,0,0,0.42);">
            <tr>
              <td style="padding:0;">
                <div class="header-pad" style="padding:22px 26px 18px 26px;border-bottom:1px solid rgba(255,255,255,0.08);background:
                  radial-gradient(circle at top left, rgba(181,92,255,0.20), transparent 34%),
                  radial-gradient(circle at top right, rgba(79,227,193,0.10), transparent 24%),
                  linear-gradient(180deg, rgba(18,15,31,0.98) 0%, rgba(12,12,22,0.96) 100%);
                ">
                  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 26px 0;">
                    <tr>
                      <td valign="middle">
                        ${brandWordmark()}
                      </td>
                    </tr>
                  </table>

                  <div style="text-align:center;padding:6px 0 4px 0;">
                    ${sectionKicker(eyebrow, 'center', '#C4B5FD', 12)}
                    ${titleBlock(heroTitle || title || 'Adray')}
                    ${heroIntroHtml || ''}
                  </div>
                </div>
              </td>
            </tr>

            <tr>
              <td class="body-pad" style="padding:24px 22px 10px 22px;">
                ${contentHtml}
              </td>
            </tr>

            <tr>
              <td class="footer-pad" style="padding:18px 28px 26px 28px;border-top:1px solid rgba(255,255,255,0.08);background:rgba(255,255,255,0.02);text-align:center;">
                <div style="font-size:12px;line-height:22px;color:#8FA0BD;">
                  ${customFooterHtml || footerHtml()}
                </div>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </div>
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

  const heroIntroHtml = `
    ${textBlock(`Hi <strong style="color:#FFFFFF">${escapeHtml(displayName)}</strong>, confirm your email to finish setting up your workspace.`, 0, 'center', '#D3DCEF', 16, 27)}
  `;

  const contentHtml = `
    ${buildSectionCard({
      eyebrow: 'Verify your account',
      title: 'One quick step',
      bodyHtml: `
        ${textBlock(`Confirm your email address and your Adray account will be fully activated.`, 16, 'left')}
        ${
          email
            ? `<div style="margin:0 0 16px 0;text-align:left;">${infoPill(email)}</div>`
            : ''
        }
        <div class="mobile-full mobile-center" style="text-align:left;">
          ${ctaButton(url, 'Verify email')}
        </div>
      `,
      marginBottom: 16,
    })}

    ${buildSectionCard({
      eyebrow: 'Manual link',
      eyebrowColor: '#93C5FD',
      bodyHtml: `
        ${textBlock(`If the button does not work, use this link instead.`, 12, 'left', '#B9C4DC', 14, 24)}
        ${linkBox(url)}
      `,
      marginBottom: 14,
      compact: true,
    })}

    <div style="padding:2px 2px 6px 2px;">
      ${textBlock(`If you did not create this account, you can ignore this email.`, 0, 'center', '#8FA0BD', 13, 22)}
      ${supportLine(supportEmail)}
    </div>
  `;

  return wrapEmail({
    title: `Verify your email · ${brand}`,
    preheader: `Confirm your email to activate your ${brand} account.`,
    badgeText: '',
    headerEyebrow: '',
    heroTitle: 'Confirm your email',
    heroIntroHtml,
    contentHtml,
    footerHtml: footerHtml(brand, privacyUrl),
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

  const heroIntroHtml = `
    ${textBlock(`Hi <strong style="color:#FFFFFF">${escapeHtml(displayName)}</strong> — your account is ready, and your workspace is set up.`, 0, 'center', '#D3DCEF', 16, 27)}
  `;

  const contentHtml = `
    ${buildSectionCard({
      eyebrow: 'Welcome to Adray',
      bodyHtml: `
        ${textBlock(`Adray helps you turn your marketing data into clear, actionable signals.`, 16, 'left', '#DBE4FF', 15, 25)}
        ${textBlock(`Connect your data sources, and we’ll handle the rest—normalizing, structuring, and preparing your data so it’s ready for analysis from day one.`, 0, 'left', '#D7E0F3', 15, 25)}
      `,
      marginBottom: 16,
      compact: true,
    })}

    ${buildSectionCard({
      eyebrow: 'What to do next',
      bodyHtml: `
        ${buildBulletList(
          [
            'Sign in to your AdRay workspace',
            'Complete onboarding and account setup',
            'Connect your marketing data sources',
            'Start analyzing your data with confidence',
          ],
          '#4FE3C1'
        )}
      `,
      marginBottom: 16,
      compact: true,
    })}

    ${buildSectionCard({
      eyebrow: 'You’re ready to go',
      bodyHtml: `
        ${textBlock(`Everything is set up—connect your data and start exploring your signals.`, 16, 'left', '#D7E0F3', 15, 25)}
        <div class="mobile-full mobile-center" style="text-align:left;">
          ${ctaButton(loginUrl, 'Go to AdRay')}
        </div>
      `,
      marginBottom: 16,
      compact: true,
    })}

    ${buildSectionCard({
      eyebrow: 'From the team',
      bodyHtml: `
        ${textBlock(`We’re glad you’re here.<br>— The Adray Team`, 0, 'left', '#DBE4FF', 15, 25)}
        ${supportLine(supportEmail, 'left')}
      `,
      marginBottom: 8,
      compact: true,
    })}
  `;

  return wrapEmail({
    title: `Welcome to ${brand}`,
    preheader: `Your ${brand} account is ready and your workspace is set up.`,
    badgeText: '',
    headerEyebrow: '',
    heroTitle: `Welcome to ${brand}`,
    heroIntroHtml,
    contentHtml,
    footerHtml: footerHtml(brand, privacyUrl),
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

  const heroIntroHtml = `
    ${textBlock(`Hi <strong style="color:#FFFFFF">${escapeHtml(displayName)}</strong>, we received a request to reset your password.`, 0, 'center', '#D3DCEF', 16, 27)}
  `;

  const contentHtml = `
    ${buildSectionCard({
      eyebrow: 'Password reset',
      title: 'Secure your access',
      bodyHtml: `
        ${textBlock(`Use the button below to create a new password. This link expires in 1 hour.`, 16, 'left')}
        <div class="mobile-full mobile-center" style="text-align:left;">
          ${ctaButton(url, 'Reset password')}
        </div>
      `,
      marginBottom: 16,
    })}

    ${buildSectionCard({
      eyebrow: 'Manual link',
      eyebrowColor: '#93C5FD',
      bodyHtml: `
        ${textBlock(`If the button does not work, use this link instead.`, 12, 'left', '#B9C4DC', 14, 24)}
        ${linkBox(url)}
      `,
      marginBottom: 14,
      compact: true,
    })}

    <div style="padding:2px 2px 6px 2px;">
      ${textBlock(`If you did not request this change, you can ignore this email.`, 0, 'center', '#8FA0BD', 13, 22)}
      ${supportLine(supportEmail)}
    </div>
  `;

  return wrapEmail({
    title: `Reset password · ${brand}`,
    preheader: `Reset your password securely. This link expires in 1 hour.`,
    badgeText: '',
    headerEyebrow: '',
    heroTitle: 'Reset your password',
    heroIntroHtml,
    contentHtml,
    footerHtml: footerHtml(brand, privacyUrl),
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

  const heroIntroHtml = `
    ${textBlock(`Hi <strong style="color:#FFFFFF">${escapeHtml(displayName)}</strong>, your latest audit is ready to review.`, 0, 'center', '#D3DCEF', 16, 27)}
  `;

  const contentHtml = `
    ${buildSectionCard({
      eyebrow: 'Audit ready',
      title: 'Your report is waiting',
      bodyHtml: `
        ${textBlock(`We prepared your latest findings, opportunities, and next actions inside Adray.`, 16, 'left')}
        <div class="mobile-full mobile-center" style="text-align:left;">
          ${ctaButton(url, 'View audit')}
        </div>
      `,
      marginBottom: 16,
    })}

    ${buildSectionCard({
      eyebrow: 'Manual link',
      eyebrowColor: '#93C5FD',
      bodyHtml: `
        ${textBlock(`If the button does not work, use this link instead.`, 12, 'left', '#B9C4DC', 14, 24)}
        ${linkBox(url)}
      `,
      marginBottom: 14,
      compact: true,
    })}

    <div style="padding:2px 2px 6px 2px;">
      ${textBlock(`— The Adray team`, 0, 'center', '#DBE4FF', 14, 24)}
      ${supportLine(supportEmail)}
    </div>
  `;

  return wrapEmail({
    title: 'Your audit is ready',
    preheader: 'Your Adray audit is ready to review.',
    badgeText: '',
    headerEyebrow: '',
    heroTitle: 'Your audit is ready',
    heroIntroHtml,
    contentHtml,
    footerHtml: footerHtml(brand, privacyUrl),
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

  const heroIntroHtml = `
    ${textBlock(`Hi <strong style="color:#FFFFFF">${escapeHtml(displayName)}</strong>, let’s make sure your setup is fully ready.`, 0, 'center', '#D3DCEF', 16, 27)}
  `;

  const contentHtml = `
    ${buildSectionCard({
      eyebrow: 'Quick onboarding call',
      title: '10 minutes to get aligned',
      bodyHtml: `
        ${textBlock(`I’m <strong style="color:#FFFFFF">${escapeHtml(operatorName)}</strong> from the <strong style="color:#FFFFFF">${escapeHtml(brand)}</strong> team. We can quickly review your setup, integrations, and next steps.`, 14, 'left')}
        ${buildBulletList(
          [
            'Review your current setup',
            'Confirm your integrations',
            'Show your best next step',
          ],
          '#4FE3C1'
        )}
        <div class="mobile-full mobile-center" style="text-align:left;padding-top:6px;">
          ${ctaButton(safeCalendly, 'Schedule a call')}
        </div>
      `,
      marginBottom: 16,
    })}

    ${buildSectionCard({
      eyebrow: 'Manual link',
      eyebrowColor: '#93C5FD',
      bodyHtml: `
        ${textBlock(`If the button does not work, use this link instead.`, 12, 'left', '#B9C4DC', 14, 24)}
        ${linkBox(safeCalendly)}
      `,
      marginBottom: 14,
      compact: true,
    })}

    <div style="padding:2px 2px 6px 2px;">
      <p style="margin:0;font-size:13px;line-height:22px;color:#DBE4FF;text-align:center;">
        ${escapeHtml(operatorName)} · ${escapeHtml(brand)}<br>
        <a href="${escapeHtml(safeWebsite)}" style="color:#C4B5FD;text-decoration:none;font-weight:700;">${escapeHtml(safeWebsite)}</a>
      </p>
      ${supportLine(supportEmail)}
    </div>
  `;

  return wrapEmail({
    title: 'Let’s do a quick onboarding call',
    preheader: 'Book a quick 10-minute call to review setup and get started faster.',
    badgeText: '',
    headerEyebrow: '',
    heroTitle: 'Let’s get you fully set up',
    heroIntroHtml,
    contentHtml,
    footerHtml: footerHtml(brand, privacyUrl),
  });
}

module.exports = {
  welcomeEmail,
  resetPasswordEmail,
  verifyEmail,
  auditReadyEmail,
  dailyFollowupCallEmail,
};