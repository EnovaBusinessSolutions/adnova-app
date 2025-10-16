// public/plans/cancel.js
(() => {
  // Usa prod cuando abras el HTML en localhost/Live Server
  const here = location.origin;
  const probablyLocal = /127\.0\.0\.1|localhost/i.test(here);
  const API_BASE = probablyLocal ? 'https://ai.adnova.digital' : here;

  // Helpers
  const $ = (id) => document.getElementById(id);
  const statusBadge   = $('statusBadge');
  const sessInfo      = $('sessInfo');
  const reasonInfo    = $('reasonInfo');
  const sessionIdInfo = $('sessionIdInfo');
  const hint          = $('hint');

  const qp = new URLSearchParams(location.search);
  const sessionId = qp.get('session_id') || qp.get('session') || '';
  const rawReason = (qp.get('reason') || '').toLowerCase().trim();

  // Mapea motivos comunes a un texto amigable
  const reasonMap = {
    canceled: 'El usuario canceló en Stripe',
    user_canceled: 'El usuario canceló en Stripe',
    abandoned: 'Cerraste la ventana del pago',
    payment_failed: 'El pago no pudo completarse',
    default: 'Compra cancelada por el usuario',
  };
  const humanReason = reasonMap[rawReason] || reasonMap.default;

  if (sessionId) {
    sessionIdInfo.textContent = sessionId;
  }

  reasonInfo.textContent = humanReason;

  async function getSession() {
    try {
      const r = await fetch(`${API_BASE}/api/session`, { credentials: 'include' });
      if (!r.ok) throw new Error(`${r.status} ${r.statusText}`);
      return await r.json();
    } catch (e) {
      return { authenticated: false, error: e.message };
    }
  }

  (async () => {
    const me = await getSession();

    if (me?.authenticated) {
      const email = me?.user?.email || 'sesión activa';
      sessInfo.textContent = email;
      statusBadge.textContent = 'Pago cancelado';
      hint.textContent =
        'Si cambiaste de opinión, puedes volver a elegir un plan y completar el pago.';
    } else {
      sessInfo.textContent = '— Sin sesión —';
      statusBadge.textContent = 'Pago cancelado';
      hint.textContent =
        'Inicia sesión si deseas volver a intentar el pago o revisar tu estado desde el dashboard.';
    }
  })();
})();
