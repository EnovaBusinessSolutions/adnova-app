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

function brandMarkSvg(size = 28) {
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
        <td valign="middle">
          <div style="
            width:38px;
            height:38px;
            border-radius:14px;
            background:
              radial-gradient(circle at 30% 20%, rgba(181,92,255,0.22), transparent 55%),
              linear-gradient(180deg, rgba(28,23,45,0.98) 0%, rgba(14,14,24,0.98) 100%);
            border:1px solid rgba(255,255,255,0.10);
            box-shadow:
              inset 0 1px 0 rgba(255,255,255,0.05),
              0 8px 24px rgba(0,0,0,0.24);
            display:flex;
            align-items:center;
            justify-content:center;
          ">
            ${brandMarkSvg(18)}
          </div>
        </td>
        <td width="12"></td>
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

function heroIcon(icon = 'spark') {
  const map = {
    spark: `
      <svg width="38" height="38" viewBox="0 0 24 24" fill="none" aria-hidden="true" xmlns="http://www.w3.org/2000/svg">
        <path d="M12 2.75L13.94 8.06L19.25 10L13.94 11.94L12 17.25L10.06 11.94L4.75 10L10.06 8.06L12 2.75Z" fill="#B55CFF"/>
      </svg>
    `,
    mail: `
      <svg width="38" height="38" viewBox="0 0 24 24" fill="none" aria-hidden="true" xmlns="http://www.w3.org/2000/svg">
        <path d="M3.75 7.5L10.94 12.533C11.576 12.978 11.894 13.2 12.231 13.286C12.567 13.372 12.933 13.372 13.269 13.286C13.606 13.2 13.924 12.978 14.56 12.533L21.75 7.5" stroke="#C4B5FD" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>
        <path d="M6.45 19.5H17.55C19.23 19.5 20.07 19.5 20.712 19.173C21.276 18.886 21.714 18.448 22.001 17.884C22.328 17.242 22.328 16.402 22.328 14.722V9.278C22.328 7.598 22.328 6.758 22.001 6.116C21.714 5.552 21.276 5.114 20.712 4.827C20.07 4.5 19.23 4.5 17.55 4.5H6.45C4.77 4.5 3.93 4.5 3.288 4.827C2.724 5.114 2.286 5.552 1.999 6.116C1.672 6.758 1.672 7.598 1.672 9.278V14.722C1.672 16.402 1.672 17.242 1.999 17.884C2.286 18.448 2.724 18.886 3.288 19.173C3.93 19.5 4.77 19.5 6.45 19.5Z" stroke="#C4B5FD" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>
      </svg>
    `,
    reset: `
      <svg width="38" height="38" viewBox="0 0 24 24" fill="none" aria-hidden="true" xmlns="http://www.w3.org/2000/svg">
        <path d="M20 11A8 8 0 1 0 17.657 16.657" stroke="#C4B5FD" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>
        <path d="M20 5V11H14" stroke="#C4B5FD" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>
      </svg>
    `,
    audit: `
      <svg width="38" height="38" viewBox="0 0 24 24" fill="none" aria-hidden="true" xmlns="http://www.w3.org/2000/svg">
        <path d="M9 12L11 14L15.5 9.5" stroke="#4FE3C1" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"/>
        <path d="M20.25 12C20.25 16.5563 16.5563 20.25 12 20.25C7.44365 20.25 3.75 16.5563 3.75 12C3.75 7.44365 7.44365 3.75 12 3.75C16.5563 3.75 20.25 7.44365 20.25 12Z" stroke="#C4B5FD" stroke-width="1.8"/>
      </svg>
    `,
    calendar: `
      <svg width="38" height="38" viewBox="0 0 24 24" fill="none" aria-hidden="true" xmlns="http://www.w3.org/2000/svg">
        <path d="M8 2.75V6" stroke="#C4B5FD" stroke-width="1.8" stroke-linecap="round"/>
        <path d="M16 2.75V6" stroke="#C4B5FD" stroke-width="1.8" stroke-linecap="round"/>
        <path d="M3.75 9H20.25" stroke="#C4B5FD" stroke-width="1.8" stroke-linecap="round"/>
        <path d="M6.45 21.25H17.55C19.23 21.25 20.07 21.25 20.712 20.923C21.276 20.636 21.714 20.198 22.001 19.634C22.328 18.992 22.328 18.152 22.328 16.472V8.95C22.328 7.27 22.328 6.43 22.001 5.788C21.714 5.224 21.276 4.786 20.712 4.499C20.07 4.172 19.23 4.172 17.55 4.172H6.45C4.77 4.172 3.93 4.172 3.288 4.499C2.724 4.786 2.286 5.224 1.999 5.788C1.672 6.43 1.672 7.27 1.672 8.95V16.472C1.672 18.152 1.672 18.992 1.999 19.634C2.286 20.198 2.724 20.636 3.288 20.923C3.93 21.25 4.77 21.25 6.45 21.25Z" stroke="#C4B5FD" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>
      </svg>
    `,
  };

  return `
    <div style="margin:0 0 18px 0;">
      <div style="
        width:74px;
        height:74px;
        border-radius:22px;
        margin:0 auto;
        background:
          radial-gradient(circle at top left, rgba(181,92,255,0.22), transparent 38%),
          radial-gradient(circle at bottom right, rgba(79,227,193,0.10), transparent 34%),
          linear-gradient(180deg, rgba(22,19,34,0.96) 0%, rgba(10,11,18,0.98) 100%);
        border:1px solid rgba(255,255,255,.08);
        box-shadow:
          inset 0 1px 0 rgba(255,255,255,.04),
          0 14px 36px rgba(0,0,0,.28);
        display:flex;
        align-items:center;
        justify-content:center;
      ">
        ${map[icon] || map.spark}
      </div>
    </div>
  `;
}

function sectionKicker(text) {
  return `
    <div style="
      margin:0 0 10px 0;
      font-size:11px;
      line-height:1.2;
      font-weight:800;
      letter-spacing:.18em;
      text-transform:uppercase;
      color:#C4B5FD;
      text-align:center;
    ">
      ${escapeHtml(text)}
    </div>
  `;
}

function titleBlock(text) {
  return `
    <div class="hero-title" style="
      margin:0 0 14px 0;
      font-size:34px;
      line-height:1.10;
      font-weight:900;
      letter-spacing:-.04em;
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
  marginBottom = 18,
  align = 'left',
} = {}) {
  return `
    <div style="
      margin:0 0 ${marginBottom}px 0;
      padding:20px 20px 18px 20px;
      border-radius:20px;
      background:linear-gradient(180deg, rgba(20,18,32,0.94) 0%, rgba(11,11,18,0.98) 100%);
      border:1px solid rgba(255,255,255,0.08);
      box-shadow:inset 0 1px 0 rgba(255,255,255,0.03);
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
          ? `<div style="margin:0 0 10px 0;font-size:20px;line-height:1.25;font-weight:800;color:#ffffff;">
              ${escapeHtml(title)}
            </div>`
          : ''
      }
      ${bodyHtml}
    </div>
  `.trim();
}

function buildBulletList(items = [], bulletColor = '#8B5CF6') {
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
      border:1px solid rgba(181,92,255,0.20);
      box-shadow:0 0 0 1px rgba(181,92,255,0.06) inset;
      word-break:break-all;
    ">
      <a href="${safe}" style="color:#C4B5FD;text-decoration:none;font-size:12px;line-height:20px;font-weight:700;">
        ${safe}
      </a>
    </div>
  `;
}

function supportLine(email) {
  const safe = escapeHtml(email || 'support@adray.ai');
  return `
    <p style="margin:12px 0 0 0;font-size:12px;line-height:20px;color:#8FA0BD;text-align:center;">
      Support:
      <a href="mailto:${safe}" style="color:#C4B5FD;text-decoration:none;font-weight:700;">${safe}</a>
    </p>
  `;
}

function footerHtml(brand = 'Adray', privacyUrl = 'https://adray.ai/privacy') {
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
  heroIconName = 'spark',
  contentHtml,
  footerHtml: customFooterHtml,
}) {
  const safeTitle = escapeHtml(title || 'Adray');
  const safePreheader = escapeHtml(preheader || '');
  const badge = escapeHtml(badgeText || 'Update');
  const eyebrow = escapeHtml(headerEyebrow || 'Adray AI');

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
      .shell-pad { padding:24px 10px !important; }
      .header-pad { padding:28px 20px 20px 20px !important; }
      .body-pad { padding:22px 16px 10px 16px !important; }
      .footer-pad { padding:16px 20px 22px 20px !important; }
      .hero-title { font-size:29px !important; line-height:1.08 !important; }
      .hero-copy { font-size:15px !important; line-height:24px !important; }
      .mobile-full a { display:block !important; width:100% !important; min-width:0 !important; box-sizing:border-box !important; }
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
          <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" class="card" style="border-collapse:separate;width:100%;max-width:700px;background:linear-gradient(180deg, rgba(17,14,28,0.98) 0%, rgba(8,9,14,1) 100%);border:1px solid rgba(255,255,255,0.08);border-radius:28px;overflow:hidden;box-shadow:0 24px 80px rgba(0,0,0,0.42);">
            <tr>
              <td style="padding:0;">
                <div class="header-pad" style="padding:22px 24px 18px 24px;border-bottom:1px solid rgba(255,255,255,0.08);background:
                  radial-gradient(circle at top left, rgba(181,92,255,0.22), transparent 36%),
                  radial-gradient(circle at top right, rgba(79,227,193,0.10), transparent 26%),
                  linear-gradient(180deg, rgba(20,17,34,0.98) 0%, rgba(14,14,24,0.94) 100%);
                ">
                  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 20px 0;">
                    <tr>
                      <td valign="middle">
                        ${brandWordmark()}
                      </td>
                      <td align="right" valign="middle" style="font-size:11px;line-height:1.2;font-weight:800;letter-spacing:0.16em;text-transform:uppercase;color:#C4B5FD;">
                        ${badge}
                      </td>
                    </tr>
                  </table>

                  <div style="text-align:center;padding:8px 0 0 0;">
                    ${heroIcon(heroIconName)}
                    <div style="margin:0 0 10px 0;font-size:11px;line-height:1.2;font-weight:800;letter-spacing:0.20em;text-transform:uppercase;color:#C4B5FD;">
                      ${eyebrow}
                    </div>
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
    ${textBlock(`Hi <strong style="color:#FFFFFF">${escapeHtml(displayName)}</strong>, confirm your email address to activate your <strong style="color:#FFFFFF">${escapeHtml(brand)}</strong> account and complete setup.`, 0, 'center', '#D3DCEF', 15, 26)}
  `;

  const contentHtml = `
    ${buildSectionCard({
      eyebrow: 'Account verification',
      bodyHtml: `
        ${textBlock(`Please verify that this email belongs to you so we can finish activating your workspace and keep your account secure.`, 16, 'left')}
        ${
          email
            ? `<div style="margin:0 0 16px 0;text-align:left;">${infoPill(email)}</div>`
            : ''
        }
        <div class="mobile-full">
          ${ctaButton(url, 'Verify my email')}
        </div>
      `,
      marginBottom: 18,
    })}

    ${buildSectionCard({
      eyebrow: 'Manual link',
      eyebrowColor: '#93C5FD',
      bodyHtml: `
        ${textBlock(`If the button does not work, copy and paste this link into your browser.`, 14, 'left', '#B9C4DC', 14, 24)}
        ${linkBox(url)}
      `,
      marginBottom: 18,
    })}

    ${buildSectionCard({
      eyebrow: 'Need help?',
      eyebrowColor: '#4FE3C1',
      bodyHtml: `
        ${textBlock(`If you did not create this account, you can safely ignore this email.`, 10, 'left', '#B9C4DC', 14, 24)}
        ${supportLine(supportEmail)}
      `,
      marginBottom: 12,
    })}
  `;

  return wrapEmail({
    title: `Verify your email · ${brand}`,
    preheader: `Confirm your email to activate your ${brand} account.`,
    badgeText: 'Verification',
    headerEyebrow: `${brand} · Verification`,
    heroTitle: 'Confirm your email',
    heroIntroHtml,
    heroIconName: 'mail',
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
    ${textBlock(`Hi <strong style="color:#FFFFFF">${escapeHtml(displayName)}</strong>, your account is ready and your workspace is waiting for you.`, 0, 'center', '#D3DCEF', 15, 26)}
  `;

  const contentHtml = `
    ${buildSectionCard({
      eyebrow: 'Welcome to Adray',
      bodyHtml: `
        ${textBlock(`We’re excited to have you here. <strong style="color:#FFFFFF">${escapeHtml(brand)}</strong> is built to help you connect your marketing data, organize your workspace, and turn performance signals into clear action.`, 14, 'left')}
        ${textBlock(`From here, your best next step is simple: sign in, complete onboarding, and connect your data sources so your account is fully activated from day one.`, 0, 'left')}
      `,
      marginBottom: 18,
    })}

    ${buildSectionCard({
      eyebrow: 'What to do next',
      eyebrowColor: '#4FE3C1',
      bodyHtml: buildBulletList(
        [
          'Sign in to your Adray workspace',
          'Complete onboarding and account setup',
          'Connect your marketing data sources',
          'Start using your workspace with confidence',
        ],
        '#4FE3C1'
      ),
      marginBottom: 18,
    })}

    ${buildSectionCard({
      eyebrow: 'Get started',
      eyebrowColor: '#C4B5FD',
      bodyHtml: `
        ${textBlock(`Everything is ready for you to begin.`, 14, 'left', '#B9C4DC', 14, 24)}
        <div class="mobile-full" style="text-align:left;">
          ${ctaButton(loginUrl, 'Go to Adray')}
        </div>
      `,
      marginBottom: 18,
    })}

    ${buildSectionCard({
      eyebrow: 'From the team',
      eyebrowColor: '#93C5FD',
      bodyHtml: `
        ${textBlock(`We’re glad you’re here.<br class="mobile-hide-br"> — The Adray team`, 10, 'left', '#DBE4FF', 14, 24)}
        ${supportLine(supportEmail)}
      `,
      marginBottom: 12,
    })}
  `;

  return wrapEmail({
    title: `Welcome to ${brand}`,
    preheader: `Your ${brand} account is ready. Sign in and complete setup.`,
    badgeText: 'Welcome',
    headerEyebrow: `${brand} · Welcome`,
    heroTitle: `Welcome to ${brand}`,
    heroIntroHtml,
    heroIconName: 'spark',
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
    ${textBlock(`Hi <strong style="color:#FFFFFF">${escapeHtml(displayName)}</strong>, we received a request to reset the password for your <strong style="color:#FFFFFF">${escapeHtml(brand)}</strong> account.`, 0, 'center', '#D3DCEF', 15, 26)}
  `;

  const contentHtml = `
    ${buildSectionCard({
      eyebrow: 'Password recovery',
      bodyHtml: `
        ${textBlock(`Use the button below to create a new password and recover access to your account securely.`, 16, 'left')}
        <div class="mobile-full">
          ${ctaButton(url, 'Reset password')}
        </div>
      `,
      marginBottom: 18,
    })}

    ${buildSectionCard({
      eyebrow: 'Manual link',
      eyebrowColor: '#93C5FD',
      bodyHtml: `
        ${textBlock(`If the button does not work, copy and paste this link into your browser.`, 14, 'left', '#B9C4DC', 14, 24)}
        ${linkBox(url)}
      `,
      marginBottom: 18,
    })}

    ${buildSectionCard({
      eyebrow: 'Security note',
      eyebrowColor: '#F472B6',
      bodyHtml: `
        ${textBlock(`If you did not request this change, you can ignore this email. This reset link expires in 1 hour.`, 10, 'left', '#B9C4DC', 14, 24)}
        ${supportLine(supportEmail)}
      `,
      marginBottom: 12,
    })}
  `;

  return wrapEmail({
    title: `Reset password · ${brand}`,
    preheader: `Reset your password securely. This link expires in 1 hour.`,
    badgeText: 'Recovery',
    headerEyebrow: `${brand} · Recovery`,
    heroTitle: 'Reset your password',
    heroIntroHtml,
    heroIconName: 'reset',
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
    ${textBlock(`Hi <strong style="color:#FFFFFF">${escapeHtml(displayName)}</strong>, your latest audit is ready to review.`, 0, 'center', '#D3DCEF', 15, 26)}
  `;

  const contentHtml = `
    ${buildSectionCard({
      eyebrow: 'Audit ready',
      bodyHtml: `
        ${textBlock(`${escapeHtml(brand)} analyzed your connected accounts and prepared a report with key findings, opportunities, and next-step recommendations.`, 16, 'left')}
        <div class="mobile-full">
          ${ctaButton(url, 'View my audit')}
        </div>
      `,
      marginBottom: 18,
    })}

    ${buildSectionCard({
      eyebrow: 'Manual link',
      eyebrowColor: '#93C5FD',
      bodyHtml: `
        ${textBlock(`If the button does not work, copy and paste this link into your browser.`, 14, 'left', '#B9C4DC', 14, 24)}
        ${linkBox(url)}
      `,
      marginBottom: 18,
    })}

    ${buildSectionCard({
      eyebrow: 'Team',
      eyebrowColor: '#4FE3C1',
      bodyHtml: `
        ${textBlock(`— The ${escapeHtml(brand)} team`, 10, 'left', '#DBE4FF', 14, 24)}
        ${supportLine(supportEmail)}
      `,
      marginBottom: 12,
    })}
  `;

  return wrapEmail({
    title: 'Your audit is ready',
    preheader: 'Your Adray audit is ready to review.',
    badgeText: 'Audit',
    headerEyebrow: `${brand} · Audit`,
    heroTitle: 'Your audit is ready',
    heroIntroHtml,
    heroIconName: 'audit',
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
    ${textBlock(`Hi <strong style="color:#FFFFFF">${escapeHtml(displayName)}</strong>, we’d love to help you get fully set up and make sure everything is working exactly as it should.`, 0, 'center', '#D3DCEF', 15, 26)}
  `;

  const contentHtml = `
    ${buildSectionCard({
      eyebrow: 'Quick onboarding call',
      bodyHtml: `
        ${textBlock(`I’m <strong style="color:#FFFFFF">${escapeHtml(operatorName)}</strong> from the <strong style="color:#FFFFFF">${escapeHtml(brand)}</strong> team.`, 12, 'left')}
        ${textBlock(`I’d love to invite you to a quick 10-minute call to review your setup, confirm your integrations are working properly, and help you get value from Adray faster.`, 0, 'left')}
      `,
      marginBottom: 18,
    })}

    ${buildSectionCard({
      eyebrow: 'What we’ll cover',
      eyebrowColor: '#4FE3C1',
      bodyHtml: buildBulletList(
        [
          'Review your current setup',
          'Confirm everything is connected correctly',
          'Show you how to get the most from the dashboard',
          'Walk through your first audit results',
          'Help you get value faster from the start',
        ],
        '#4FE3C1'
      ),
      marginBottom: 18,
    })}

    ${buildSectionCard({
      eyebrow: 'Book your call',
      eyebrowColor: '#C4B5FD',
      bodyHtml: `
        ${textBlock(`Choose a time that works best for you.`, 14, 'left', '#B9C4DC', 14, 24)}
        <div class="mobile-full" style="text-align:left;">
          ${ctaButton(safeCalendly, 'Schedule a 10-minute call')}
        </div>
      `,
      marginBottom: 18,
    })}

    ${buildSectionCard({
      eyebrow: 'Manual link',
      eyebrowColor: '#93C5FD',
      bodyHtml: `
        ${textBlock(`If the button does not work, copy and paste this link into your browser.`, 14, 'left', '#B9C4DC', 14, 24)}
        ${linkBox(safeCalendly)}
      `,
      marginBottom: 18,
    })}

    ${buildSectionCard({
      eyebrow: 'Contact',
      eyebrowColor: '#F472B6',
      bodyHtml: `
        ${textBlock(`If you already booked, feel free to ignore this email.`, 12, 'left', '#B9C4DC', 14, 24)}
        <p style="margin:0;font-size:13px;line-height:22px;color:#DBE4FF;text-align:left;">
          Best,<br>
          <strong style="color:#FFFFFF">${escapeHtml(operatorName)}</strong><br>
          Account Manager · ${escapeHtml(brand)}<br>
          <a href="${escapeHtml(safeWebsite)}" style="color:#C4B5FD;text-decoration:none;font-weight:700;">${escapeHtml(safeWebsite)}</a>
        </p>
        ${supportLine(supportEmail)}
      `,
      marginBottom: 12,
    })}
  `;

  return wrapEmail({
    title: 'Let’s do a quick onboarding call',
    preheader: 'Book a quick 10-minute call to review setup and get started faster.',
    badgeText: 'Follow-up',
    headerEyebrow: `${brand} · Follow-up`,
    heroTitle: 'Let’s do a quick onboarding call',
    heroIntroHtml,
    heroIconName: 'calendar',
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