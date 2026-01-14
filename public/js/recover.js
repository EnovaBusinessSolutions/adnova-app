// public/js/recover.js
document.addEventListener('DOMContentLoaded', () => {
  const form   = document.getElementById('recoverForm');
  const emailI = document.getElementById('email');

  if (!form) return;

  // ---------------- Turnstile (EXPLÍCITO) ----------------
  const meta = document.querySelector('meta[name="turnstile-site-key"]');
  const SITE_KEY = (meta?.getAttribute('content') || '').trim();

  let TS_WIDGET_ID = null;

  function getTurnstileToken() {
    const el = document.querySelector('input[name="cf-turnstile-response"]');
    return (el?.value || '').trim();
  }

  function resetTurnstile() {
    try {
      if (TS_WIDGET_ID != null) window.turnstile?.reset?.(TS_WIDGET_ID);
      else window.turnstile?.reset?.();
    } catch (_) {}
  }

  function ensureTurnstileReady() {
    return new Promise((resolve, reject) => {
      try {
        if (window.turnstile && typeof window.turnstile.render === 'function') return resolve();

        const existing = document.querySelector('script[src*="challenges.cloudflare.com/turnstile/v0/api.js"]');
        if (!existing) return reject(new Error('No se encontró el script de Turnstile.'));

        let tries = 0;
        const t = setInterval(() => {
          tries++;
          if (window.turnstile && typeof window.turnstile.render === 'function') {
            clearInterval(t);
            resolve();
          }
          if (tries > 80) { // ~8s
            clearInterval(t);
            reject(new Error('Turnstile no expuso window.turnstile a tiempo.'));
          }
        }, 100);
      } catch (e) {
        reject(e);
      }
    });
  }

  async function renderTurnstile() {
    if (!SITE_KEY) {
      alert('⚠️ Falta configurar el site key de Turnstile en recuperar.html');
      return;
    }

    const slot = document.getElementById('cf-turnstile-slot');
    if (!slot) {
      console.error('[recover.js] No existe #cf-turnstile-slot en el HTML.');
      return;
    }

    // evita dobles renders
    slot.innerHTML = '';

    await ensureTurnstileReady();

    TS_WIDGET_ID = window.turnstile.render(slot, {
      sitekey: SITE_KEY,
      size: 'normal',        // ✅ clave para evitar 400020
      theme: 'auto',
      appearance: 'always',
      callback: () => {},
      'expired-callback': () => resetTurnstile(),
      'error-callback': () => resetTurnstile(),
    });
  }

  // Render al cargar
  renderTurnstile().catch((err) => {
    console.error('[recover.js] Turnstile render error:', err);
    alert('No se pudo cargar la verificación de seguridad. Recarga la página.');
  });

  // ---------------- submit ----------------
  form.addEventListener('submit', async (e) => {
    e.preventDefault();

    const email = (emailI?.value || '').trim().toLowerCase();
    if (!email) {
      alert('Ingresa tu correo.');
      return;
    }

    // ✅ Turnstile obligatorio en recuperar
    const turnstileToken = getTurnstileToken();
    if (!turnstileToken) {
      alert('Por favor completa la verificación de seguridad.');
      return;
    }

    try {
      const res = await fetch('/api/forgot-password', {
        method : 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        cache: 'no-store',
        body   : JSON.stringify({ email, turnstileToken }),
      });

      const data = await res.json().catch(() => ({}));

      // ✅ Si Turnstile falla o expira, reset para reintentar
      const isTurnstileFail =
        data?.code === 'TURNSTILE_FAILED' ||
        data?.code === 'TURNSTILE_REQUIRED_OR_FAILED' ||
        (Array.isArray(data?.errorCodes) && data.errorCodes.length > 0) ||
        res.status === 400;

      if (!res.ok && isTurnstileFail) {
        resetTurnstile();
        alert('No se pudo validar la verificación de seguridad. Intenta de nuevo.');
        return;
      }

      // ✅ Mensaje “seguro” (no revela si existe)
      alert('Si el correo existe en nuestra base, recibirás un enlace de recuperación.');

      form.reset();
      resetTurnstile(); // ✅ para que no quede token “consumido”
    } catch (err) {
      console.error(err);
      resetTurnstile();
      alert('Error de red. Intenta más tarde.');
    }
  });
});
