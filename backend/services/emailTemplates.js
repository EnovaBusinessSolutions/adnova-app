// backend/services/emailTemplates.js
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

  const guess = String(fallbackEmail || '').split('@')[0] || 'hola';
  return guess.charAt(0).toUpperCase() + guess.slice(1);
}

function safeUrl(url = '') {
  const s = String(url || '').trim();
  if (!s) return '#';
  return s;
}

/**
 * ✅ Wrapper base (Adray)
 * - Ahora permite "badgeText" (tipo: Bienvenida / Verificación / Recuperación)
 * - Baja sutilmente el “glow” para que no se vea tan agresivo.
 */
function wrapEmail({ title, preheader, contentHtml, footerHtml, badgeText }) {
  const year = new Date().getFullYear();
  const safeTitle = escapeHtml(title);
  const safePreheader = escapeHtml(preheader || '');
  const badge = escapeHtml(badgeText || 'Notificación');

  return `<!doctype html>
<html lang="es">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <meta name="x-apple-disable-message-reformatting">
  <title>${safeTitle}</title>
  <style>
    :root { color-scheme: dark; }
    @media screen and (max-width:600px){
      .card{width:100%!important}
      .px{padding-left:18px!important;padding-right:18px!important}
      .btn{display:block!important;width:100%!important}
      .h1{font-size:24px!important}
    }
  </style>
</head>
<body style="margin:0;padding:0;background:#0d081c;color:#fff;font-family:Inter,Arial,Helvetica,sans-serif;">
  <!-- Preheader (oculto) -->
  <span style="display:none!important;visibility:hidden;opacity:0;color:transparent;height:0;width:0;overflow:hidden;">
    ${safePreheader}
  </span>

  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#0d081c;">
    <tr>
      <td align="center" style="padding:46px 10px;">
        <table role="presentation" cellpadding="0" cellspacing="0" width="560" class="card"
          style="max-width:560px;background:#151026;border-radius:16px;
          box-shadow:0 0 16px rgba(109,61,252,.18);
          border:1px solid rgba(255,255,255,.10);overflow:hidden;">

          <!-- top bar -->
          <tr>
            <td style="padding:16px 22px;background:#110c22;border-bottom:1px solid rgba(255,255,255,.08);">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
                <tr>
                  <td style="font-size:12px;letter-spacing:.22em;font-weight:900;color:#EDEBFF;">
                    ADRAY
                  </td>
                  <td align="right" style="font-size:12px;color:rgba(255,255,255,.58);">
                    ${badge}
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <tr>
            <td class="px" style="padding:0 44px 34px;">
              ${contentHtml}
            </td>
          </tr>

          <tr>
            <td style="background:#100c1e;padding:18px 28px;border-radius:0 0 16px 16px;text-align:center;font-size:12px;line-height:18px;color:#777;">
              ${
                footerHtml ||
                `© ${year} Adray · <a href="https://adray.ai/politica.html" style="color:#777;text-decoration:underline">Política de privacidad</a>`
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

/**
 * ✅ Correo de verificación
 */
function verifyEmail({
  verifyUrl,
  name,
  email,
  brand = 'Adray',
  supportEmail = 'contact@adray.ai',
  privacyUrl = 'https://adray.ai/politica.html',
} = {}) {
  const url = safeUrl(verifyUrl);
  const safeVerifyUrl = escapeHtml(url);
  const displayName = safeName(name, email);

  const contentHtml = `
    <div style="padding-top:26px;">
      <div class="h1" style="margin:0 0 12px;font-size:26px;color:#EDEBFF;font-weight:900;letter-spacing:-.02em">
        Confirma tu correo
      </div>

      <p style="margin:0 0 12px;font-size:15px;line-height:23px;color:#EAE4F2;">
        Hola <strong style="color:#FFFFFF">${escapeHtml(displayName)}</strong>,
      </p>

      <p style="margin:0 0 18px;font-size:15px;line-height:23px;color:#EAE4F2;">
        Para activar tu cuenta en <strong style="color:#FFFFFF">${escapeHtml(brand)}</strong>, confirma que este correo te pertenece.
      </p>

      <table role="presentation" cellpadding="0" cellspacing="0" align="center" style="margin:14px auto 16px;">
        <tr><td align="center">
          <a href="${safeVerifyUrl}" class="btn"
            style="background:linear-gradient(90deg,#B55CFF,#9D5BFF);
                   border-radius:999px;
                   padding:13px 20px;
                   font-size:14px;
                   font-weight:900;
                   color:#0b0b0d;
                   text-decoration:none;
                   display:inline-block;">
            Verificar mi correo
          </a>
        </td></tr>
      </table>

      <p style="margin:0 0 10px;font-size:12px;line-height:19px;color:#BDB2C9;">
        Si el botón no funciona, copia y pega este enlace en tu navegador:
      </p>

      <div style="margin:0 0 14px;background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.08);border-radius:12px;padding:12px;word-break:break-all;">
        <a href="${safeVerifyUrl}" style="color:#9AA4FF;text-decoration:underline;font-size:12px;line-height:18px;">
          ${safeVerifyUrl}
        </a>
      </div>

      <p style="margin:14px 0 0;font-size:12px;line-height:18px;color:#9b90aa;">
        Si no fuiste tú, puedes ignorar este correo.
      </p>

      <p style="margin:10px 0 0;font-size:12px;line-height:18px;color:#9b90aa;">
        Soporte: <a href="mailto:${escapeHtml(supportEmail)}" style="color:#9b90aa;text-decoration:underline">${escapeHtml(supportEmail)}</a>
      </p>
    </div>
  `;

  const year = new Date().getFullYear();
  const footer = `© ${year} ${escapeHtml(brand)} · <a href="${escapeHtml(
    privacyUrl
  )}" style="color:#777;text-decoration:underline">Política de privacidad</a>`;

  return wrapEmail({
    title: `Verifica tu correo en ${brand}`,
    preheader: `Confirma tu correo para activar tu cuenta en ${brand}.`,
    contentHtml,
    footerHtml: footer,
    badgeText: 'Verificación',
  });
}

/**
 * ✅ Bienvenida
 * - Ahora acepta name/email/brand/supportEmail (E2E)
 * - Retrocompatible: si solo mandas loginUrl, no se rompe.
 */
function welcomeEmail({
  name,
  email,
  brand = 'Adray',
  supportEmail = 'support@adray.ai',
} = {}) {
  const displayName = safeName(name, email);

  const contentHtml = `
    <div style="padding-top:28px;">
      <div class="h1" style="margin:0 0 14px;font-size:26px;color:#EDEBFF;font-weight:900;letter-spacing:-.02em">
        ¡Bienvenido a ${escapeHtml(brand)}, ${escapeHtml(displayName)}!
      </div>

      <p style="margin:0 0 10px;font-size:15px;line-height:23px;color:#EAE4F2;">
        ¡Felicidades, <strong style="color:#FFFFFF">${escapeHtml(displayName)}</strong>! 🎉
      </p>

      <p style="margin:0 0 10px;font-size:15px;line-height:23px;color:#EAE4F2;">
        Te has registrado exitosamente en <strong style="color:#FFFFFF">${escapeHtml(
          brand
        )}</strong>, tu Inteligencia Artificial experta en Marketing.
      </p>

      <p style="margin:0 0 10px;font-size:15px;line-height:23px;color:#EAE4F2;">
        Ya puedes iniciar sesión y comenzar a optimizar tus campañas.
      </p>

      <p style="margin:0 0 18px;font-size:15px;line-height:23px;color:#EAE4F2;">
        ¡No olvides conectar tu onboarding!
      </p>

      <p style="margin:0 0 6px;font-size:13px;line-height:20px;color:#BDB2C9;">
        — Equipo Adray
      </p>

      <p style="margin:0;font-size:13px;line-height:20px;color:#BDB2C9;">
        Soporte: <a href="mailto:${escapeHtml(
          supportEmail
        )}" style="color:#BDB2C9;text-decoration:underline">${escapeHtml(supportEmail)}</a>
      </p>
    </div>
  `;

  return wrapEmail({
    title: `¡Bienvenido a ${brand}!`,
    preheader: `Te registraste exitosamente en ${brand}.`,
    contentHtml,
    badgeText: 'Bienvenida',
  });
}


/**
 * ✅ Reset password
 * - Acepta name/email/brand/supportEmail (sin romper llamadas viejas)
 */
function resetPasswordEmail({
  resetUrl,
  name,
  email,
  brand = 'Adray',
  supportEmail = 'contact@adray.ai',
} = {}) {
  const url = safeUrl(resetUrl);
  const safeResetUrl = escapeHtml(url);
  const displayName = safeName(name, email);

  const contentHtml = `
    <div style="padding-top:34px;">
      <h1 class="h1" style="margin:0 0 14px;font-size:26px;color:#EDEBFF;font-weight:900;letter-spacing:-.02em">
        Restablecer contraseña
      </h1>

      <p style="margin:0 0 10px;font-size:15px;line-height:23px;color:#EAE4F2;">
        Hola <strong style="color:#FFFFFF">${escapeHtml(displayName)}</strong>,
      </p>

      <p style="margin:0 0 18px;font-size:15px;line-height:23px;color:#EAE4F2;">
        Recibimos una solicitud para restablecer tu contraseña en ${escapeHtml(brand)}.
      </p>

      <table role="presentation" cellpadding="0" cellspacing="0" align="center" style="margin:14px auto 10px;">
        <tr><td>
          <a href="${safeResetUrl}" class="btn"
            style="background:linear-gradient(90deg,#B55CFF,#9D5BFF);
                   border-radius:12px;
                   padding:13px 18px;
                   font-size:14px;
                   font-weight:900;
                   color:#0b0b0d;
                   text-decoration:none;
                   display:inline-block;">
            Restablecer contraseña
          </a>
        </td></tr>
      </table>

      <p style="margin:18px 0 0;font-size:12px;line-height:19px;color:#BDB2C9;">
        Si no solicitaste este cambio, ignora este correo. Este enlace expira en 1 hora.
      </p>

      <p style="margin:10px 0 0;font-size:12px;line-height:18px;color:#9b90aa;">
        Soporte: <a href="mailto:${escapeHtml(supportEmail)}" style="color:#9b90aa;text-decoration:underline">${escapeHtml(supportEmail)}</a>
      </p>
    </div>
  `;

  return wrapEmail({
    title: `Restablecer contraseña · ${brand}`,
    preheader: `Enlace para restablecer tu contraseña (expira en 1 hora).`,
    contentHtml,
    badgeText: 'Recuperación',
  });
}

module.exports = {
  welcomeEmail,
  resetPasswordEmail,
  verifyEmail,
};
