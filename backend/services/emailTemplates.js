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

function wrapEmail({ title, preheader, contentHtml, footerHtml }) {
  const year = new Date().getFullYear();
  const safeTitle = escapeHtml(title);
  const safePreheader = escapeHtml(preheader || '');

  return `<!doctype html>
<html lang="es">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>${safeTitle}</title>
  <style>
    :root { color-scheme: dark; }
    @media screen and (max-width:600px){
      .card{width:100%!important}
      .px{padding-left:18px!important;padding-right:18px!important}
      .btn{display:block!important;width:100%!important}
    }
  </style>
</head>
<body style="margin:0;padding:0;background:#0d081c;color:#fff;font-family:Inter,Arial,Helvetica,sans-serif;">
  <span style="display:none!important;visibility:hidden;opacity:0;color:transparent;height:0;width:0;overflow:hidden;">
    ${safePreheader}
  </span>

  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#0d081c;">
    <tr>
      <td align="center" style="padding:46px 10px;">
        <table role="presentation" cellpadding="0" cellspacing="0" width="560" class="card"
          style="max-width:560px;background:#151026;border-radius:16px;box-shadow:0 0 20px rgba(109,61,252,.35);border:1px solid rgba(255,255,255,.08);">
          <tr>
            <td class="px" style="padding:0 44px 34px;">
              ${contentHtml}
            </td>
          </tr>
          <tr>
            <td style="background:#100c1e;padding:18px 28px;border-radius:0 0 16px 16px;text-align:center;font-size:12px;line-height:18px;color:#777;">
              ${footerHtml || `© ${year} Adray · <a href="https://adray.ai/politica.html" style="color:#777;text-decoration:underline">Política de privacidad</a>`}
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

function welcomeEmail({ loginUrl = 'https://adray.ai/login' } = {}) {
  const contentHtml = `
    <div style="padding-top:34px;">
      <h1 style="margin:0 0 18px;font-size:28px;color:#B55CFF;font-weight:800;letter-spacing:-.02em">¡Bienvenido a Adray!</h1>
      <p style="margin:0 0 16px;font-size:16px;line-height:24px;color:#EAE4F2;">
        Tu cuenta se creó con éxito.
      </p>
      <p style="margin:0 0 26px;font-size:16px;line-height:24px;color:#EAE4F2;">
        Inicia sesión para conectar tus cuentas y generar auditorías con IA.
      </p>

      <table role="presentation" cellpadding="0" cellspacing="0" align="center">
        <tr><td>
          <a href="${loginUrl}" class="btn"
            style="background:linear-gradient(90deg,#B55CFF,#9D5BFF);border-radius:10px;padding:14px 26px;font-size:16px;font-weight:800;color:#0b0b0d;text-decoration:none;display:inline-block;">
            Iniciar sesión
          </a>
        </td></tr>
      </table>

      <p style="margin:26px 0 0;font-size:13px;line-height:20px;color:#BDB2C9;">
        Si no solicitaste esta cuenta, puedes ignorar este correo.
      </p>
    </div>
  `;

  return wrapEmail({
    title: 'Bienvenido a Adray',
    preheader: 'Tu cuenta se creó con éxito. Inicia sesión para comenzar.',
    contentHtml,
  });
}

function resetPasswordEmail({ resetUrl } = {}) {
  const contentHtml = `
    <div style="padding-top:34px;">
      <h1 style="margin:0 0 18px;font-size:26px;color:#B55CFF;font-weight:800;letter-spacing:-.02em">Restablecer contraseña</h1>
      <p style="margin:0 0 16px;font-size:16px;line-height:24px;color:#EAE4F2;">
        Recibimos una solicitud para restablecer tu contraseña.
      </p>
      <p style="margin:0 0 26px;font-size:16px;line-height:24px;color:#EAE4F2;">
        Da clic en el botón para crear una nueva.
      </p>

      <table role="presentation" cellpadding="0" cellspacing="0" align="center">
        <tr><td>
          <a href="${resetUrl}" class="btn"
            style="background:linear-gradient(90deg,#B55CFF,#9D5BFF);border-radius:10px;padding:14px 26px;font-size:16px;font-weight:800;color:#0b0b0d;text-decoration:none;display:inline-block;">
            Restablecer contraseña
          </a>
        </td></tr>
      </table>

      <p style="margin:26px 0 0;font-size:13px;line-height:20px;color:#BDB2C9;">
        Si no solicitaste este cambio, ignora este correo. Este enlace expira en 1 hora.
      </p>
    </div>
  `;

  return wrapEmail({
    title: 'Restablecer contraseña',
    preheader: 'Enlace para restablecer tu contraseña (expira en 1 hora).',
    contentHtml,
  });
}

module.exports = {
  welcomeEmail,
  resetPasswordEmail,
};
