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

  const guess = String(fallbackEmail || '').split('@')[0] || 'Usuario';
  const pretty = guess.replace(/[._-]+/g, ' ').replace(/\s+/g, ' ').trim();
  const out = pretty ? pretty.charAt(0).toUpperCase() + pretty.slice(1) : 'Usuario';
  return out;
}

function safeUrl(url = '') {
  const s = String(url || '').trim();
  if (!s) return '#';
  return s;
}

/**
 * ✅ Wrapper base (Adray)
 * - Permite badgeText
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
  supportEmail = 'support@adray.ai',
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
 * ✅ Bienvenida (E2E)
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
        Te has registrado exitosamente en <strong style="color:#FFFFFF">${escapeHtml(brand)}</strong>, tu Inteligencia Artificial experta en Marketing.
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
        Soporte: <a href="mailto:${escapeHtml(supportEmail)}" style="color:#BDB2C9;text-decoration:underline">${escapeHtml(supportEmail)}</a>
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
 * ✅ Reset password (E2E / retrocompatible)
 */
function resetPasswordEmail({
  resetUrl,
  name,
  email,
  brand = 'Adray',
  supportEmail = 'support@adray.ai',
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

/**
 * ✅ Auditoría lista (BONITA + COPY exacto)
 */
function auditReadyEmail({
  name,
  email,
  brand = 'Adray',
  supportEmail = 'support@adray.ai',
  loginUrl = 'https://adray.ai/login',
} = {}) {
  const displayName = safeName(name, email);
  const safeLoginUrl = escapeHtml(safeUrl(loginUrl));

  const contentHtml = `
    <div style="padding-top:26px;">
      <div class="h1" style="margin:0 0 12px;font-size:26px;color:#EDEBFF;font-weight:900;letter-spacing:-.02em">
        ¡Tienes una auditoría disponible!
      </div>

      <p style="margin:0 0 12px;font-size:15px;line-height:23px;color:#EAE4F2;">
        Hola <strong style="color:#FFFFFF">${escapeHtml(displayName)}</strong>,
      </p>

      <p style="margin:0 0 14px;font-size:15px;line-height:23px;color:#EAE4F2;">
        Tu auditoría está lista. ${escapeHtml(brand)} analizó tus cuentas y preparó un reporte con puntos clave para mejorar tu rendimiento.
      </p>

      <table role="presentation" cellpadding="0" cellspacing="0" align="center" style="margin:14px auto 10px;">
        <tr><td align="center">
          <a href="${safeLoginUrl}" class="btn"
            style="background:linear-gradient(90deg,#B55CFF,#9D5BFF);
                   border-radius:999px;
                   padding:13px 20px;
                   font-size:14px;
                   font-weight:900;
                   color:#0b0b0d;
                   text-decoration:none;
                   display:inline-block;">
            Ver mi auditoría
          </a>
        </td></tr>
      </table>

      <p style="margin:10px 0 10px;font-size:12px;line-height:19px;color:#BDB2C9;">
        Si el botón no funciona, copia y pega este enlace:
      </p>

      <div style="margin:0 0 14px;background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.08);border-radius:12px;padding:12px;word-break:break-all;">
        <a href="${safeLoginUrl}" style="color:#9AA4FF;text-decoration:underline;font-size:12px;line-height:18px;">
          ${safeLoginUrl}
        </a>
      </div>

      <p style="margin:18px 0 0;font-size:13px;line-height:20px;color:#BDB2C9;">
        — Equipo ${escapeHtml(brand)}
      </p>

      <p style="margin:10px 0 0;font-size:12px;line-height:18px;color:#9b90aa;">
        Soporte: <a href="mailto:${escapeHtml(supportEmail)}" style="color:#9b90aa;text-decoration:underline">${escapeHtml(supportEmail)}</a>
      </p>
    </div>
  `;

  return wrapEmail({
    title: '¡Tienes una auditoría disponible!',
    preheader: 'Tu auditoría está lista. Entra a tu panel para revisarla.',
    contentHtml,
    badgeText: 'Auditoría',
  });
}

/**
 * ✅ NUEVO: Follow-up diario (correo de llamada rápida)
 * Copy basado en tu captura (+ un pequeño "si ya agendaste, ignora").
 */
function dailyFollowupCallEmail({
  name,
  email,
  operatorName = 'César',
  brand = 'Adray AI',
  supportEmail = 'support@adray.ai',
  calendlyUrl = 'https://calendly.com/adrayai/adray-calendario',
  websiteUrl = 'https://adray.ai',
} = {}) {
  const displayName = safeName(name, email);

  const safeCalendly = escapeHtml(safeUrl(calendlyUrl));
  const safeWebsite = escapeHtml(safeUrl(websiteUrl));
  const safeOperator = escapeHtml(operatorName);
  const safeBrand = escapeHtml(brand);

  const contentHtml = `
    <div style="padding-top:26px;">
      <div class="h1" style="margin:0 0 12px;font-size:26px;color:#EDEBFF;font-weight:900;letter-spacing:-.02em">
        ¿Agendamos una llamada rápida para revisar tu cuenta?
      </div>

      <p style="margin:0 0 12px;font-size:15px;line-height:23px;color:#EAE4F2;">
        Hola <strong style="color:#FFFFFF">${escapeHtml(displayName)}</strong>,
      </p>

      <p style="margin:0 0 14px;font-size:15px;line-height:23px;color:#EAE4F2;">
        Soy <strong style="color:#FFFFFF">${safeOperator}</strong>, del equipo de <strong style="color:#FFFFFF">${safeBrand}</strong> 👋<br/>
        Antes que nada, ¡bienvenido!
      </p>

      <p style="margin:0 0 12px;font-size:15px;line-height:23px;color:#EAE4F2;">
        Quería invitarte a una llamada rápida de <strong style="color:#FFFFFF">10 minutos</strong> para ayudarte a:
      </p>

      <div style="margin:0 0 14px;background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.08);border-radius:14px;padding:14px 14px 10px;">
        <ul style="margin:0;padding:0 0 0 18px;color:#EAE4F2;font-size:14px;line-height:22px;">
          <li style="margin:0 0 8px;">Revisar que tu configuración esté correcta</li>
          <li style="margin:0 0 8px;">Asegurarnos de que todo esté funcionando como debe</li>
          <li style="margin:0 0 8px;">Mostrarte cómo sacarle el máximo provecho al dashboard</li>
          <li style="margin:0 0 8px;">Revisar contigo los resultados de tu auditoría inicial</li>
          <li style="margin:0 0 8px;">Ayudarte a obtener valor real de ${safeBrand} desde el inicio</li>
        </ul>
      </div>

      <p style="margin:0 0 14px;font-size:15px;line-height:23px;color:#EAE4F2;">
        Si te parece bien, puedes agendarla aquí en el horario que mejor te funcione:
      </p>

      <table role="presentation" cellpadding="0" cellspacing="0" align="center" style="margin:14px auto 10px;">
        <tr><td align="center">
          <a href="${safeCalendly}" class="btn"
            style="background:linear-gradient(90deg,#B55CFF,#9D5BFF);
                   border-radius:999px;
                   padding:13px 20px;
                   font-size:14px;
                   font-weight:900;
                   color:#0b0b0d;
                   text-decoration:none;
                   display:inline-block;">
            Agendar llamada (10 min)
          </a>
        </td></tr>
      </table>

      <p style="margin:10px 0 10px;font-size:12px;line-height:19px;color:#BDB2C9;">
        Si el botón no funciona, copia y pega este enlace:
      </p>

      <div style="margin:0 0 14px;background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.08);border-radius:12px;padding:12px;word-break:break-all;">
        <a href="${safeCalendly}" style="color:#9AA4FF;text-decoration:underline;font-size:12px;line-height:18px;">
          ${safeCalendly}
        </a>
      </div>

      <p style="margin:14px 0 0;font-size:15px;line-height:23px;color:#EAE4F2;">
        Quedo atento y con gusto te ayudo.
      </p>

      <p style="margin:10px 0 0;font-size:12px;line-height:18px;color:#9b90aa;">
        Si ya agendaste tu llamada, puedes ignorar este correo.
      </p>

      <div style="margin-top:14px;padding-top:14px;border-top:1px solid rgba(255,255,255,.08);">
        <p style="margin:0;font-size:13px;line-height:20px;color:#BDB2C9;">
          Saludos,<br/>
          <strong style="color:#FFFFFF">${safeOperator}</strong><br/>
          Account Manager | ${safeBrand}<br/>
          <a href="${safeWebsite}" style="color:#9AA4FF;text-decoration:underline">${safeWebsite}</a>
        </p>

        <p style="margin:10px 0 0;font-size:12px;line-height:18px;color:#9b90aa;">
          Soporte: <a href="mailto:${escapeHtml(supportEmail)}" style="color:#9b90aa;text-decoration:underline">${escapeHtml(supportEmail)}</a>
        </p>
      </div>
    </div>
  `;

  return wrapEmail({
    title: '¿Agendamos una llamada rápida para revisar tu cuenta?',
    preheader: 'Agenda una llamada rápida de 10 min para revisar configuración y auditoría inicial.',
    contentHtml,
    badgeText: 'Seguimiento',
  });
}

module.exports = {
  welcomeEmail,
  resetPasswordEmail,
  verifyEmail,
  auditReadyEmail,
  dailyFollowupCallEmail, // ✅ NUEVO
};
