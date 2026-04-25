// backend/__tests__/workspaces/emailService.test.js
'use strict';

describe('emailService.renderInvitationHtml', () => {
  test('renderiza HTML con escape de inputs', () => {
    // Asegurarse de cargar el módulo sin RESEND_API_KEY.
    delete process.env.RESEND_API_KEY;
    jest.resetModules();
    // eslint-disable-next-line global-require
    const { renderInvitationHtml } = require('../../services/emailService');

    const html = renderInvitationHtml({
      inviterName: '<script>alert(1)</script>',
      workspaceName: 'My WS & co',
      role: 'ADMIN',
      acceptUrl: 'https://adray.ai/invitations/abc',
      expiresAtFormatted: '30 de abril de 2026',
    });

    expect(html).toContain('Acepta');
    expect(html).toContain('https://adray.ai/invitations/abc');
    // El script debe estar escapado.
    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).toContain('&lt;script&gt;');
    // Ampersand escapado.
    expect(html).toContain('My WS &amp; co');
  });
});

describe('emailService.sendWorkspaceInvitationEmail (sin API key)', () => {
  test('skip si RESEND_API_KEY no está', async () => {
    delete process.env.RESEND_API_KEY;
    jest.resetModules();
    // eslint-disable-next-line global-require
    const { sendWorkspaceInvitationEmail } = require('../../services/emailService');

    const result = await sendWorkspaceInvitationEmail({
      toEmail: 'a@b.com',
      inviterName: 'Inviter',
      workspaceName: 'WS',
      role: 'MEMBER',
      acceptUrl: 'https://x.y/z',
      expiresAt: new Date(),
    });

    expect(result.sent).toBe(false);
    expect(result.skipped).toBe(true);
    expect(result.reason).toBe('NO_API_KEY');
  });
});
