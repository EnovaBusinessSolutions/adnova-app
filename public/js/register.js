/* public/js/register.js */
document.addEventListener('DOMContentLoaded', () => {
  const form = document.getElementById('register-form');
  const msg  = document.getElementById('register-msg');

  if (!form) return;

  // ---------------- Turnstile (explicit) ----------------
  function getTurnstileSiteKey() {
    const meta = document.querySelector('meta[name="turnstile-site-key"]');
    const metaKey = (meta?.getAttribute('content') || '').trim();
    if (metaKey) return metaKey;

    const bodyKey = (document.body?.dataset?.turnstileSitekey || '').trim();
    if (bodyKey) return bodyKey;

    const globalKey = (window.TURNSTILE_SITE_KEY || '').trim();
    if (globalKey) return globalKey;

    return '';
  }

  function ensureTurnstileScriptLoaded() {
    return new Promise((resolve, reject) => {
      try {
        if (window.turnstile && typeof window.turnstile.render === 'function') return resolve();

        const existing = document.querySelector('script[src*="challenges.cloudflare.com/turnstile/v0/api.js"]');
        if (existing) {
          let tries = 0;
          const t = setInterval(() => {
            tries++;
            if (window.turnstile && typeof window.turnstile.render === 'function') {
              clearInterval(t);
              resolve();
            }
            if (tries > 40) { // ~4s
              clearInterval(t);
              reject(new Error('Turnstile script no expuso window.turnstile a tiempo.'));
            }
          }, 100);
          return;
        }

        // fallback (por si alguien elimina el script del HTML)
        const s = document.createElement('script');
        s.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
        s.async = true;
        s.defer = true;
        s.onload = () => resolve();
        s.onerror = () => reject(new Error('No se pudo cargar Turnstile.'));
        document.head.appendChild(s);
      } catch (e) {
        reject(e);
      }
    });
  }

  let TS_WIDGET_ID = null;

  async function renderTurnstile() {
    const siteKey = getTurnstileSiteKey();
    if (!siteKey) {
      showMessage('⚠️ Falta configurar el Site Key de Turnstile.', false);
      return;
    }

    const slot = document.getElementById('cf-turnstile-slot');
    if (!slot) {
      showMessage('⚠️ No se encontró el contenedor del captcha (#cf-turnstile-slot).', false);
      return;
    }

    // Evita dobles renders
    if (TS_WIDGET_ID != null) return;

    try {
      await ensureTurnstileScriptLoaded();

      // Limpia el slot por seguridad (si quedó algo)
      slot.innerHTML = '';

      TS_WIDGET_ID = window.turnstile.render(slot, {
        sitekey: siteKey,
        size: 'normal',     // ✅ clave para evitar 400020
        theme: 'auto',
        appearance: 'always',
        callback: () => {},
        'expired-callback': () => { resetTurnstile(); },
        'error-callback':   () => { resetTurnstile(); },
      });
    } catch (err) {
      console.error('[register.js] Turnstile render error:', err);
      showMessage('No se pudo cargar la verificación de seguridad. Recarga la página.', false);
    }
  }

  function getTurnstileToken() {
    try {
      if (TS_WIDGET_ID != null && window.turnstile?.getResponse) {
        return (window.turnstile.getResponse(TS_WIDGET_ID) || '').trim();
      }
    } catch (_) {}
    // fallback por si CF cambia algo (o si se renderizó de otra forma)
    const el = document.querySelector('input[name="cf-turnstile-response"]');
    return (el?.value || '').trim();
  }

  function resetTurnstile() {
    try {
      if (TS_WIDGET_ID != null) window.turnstile?.reset?.(TS_WIDGET_ID);
      else window.turnstile?.reset?.();
    } catch (_) {}
  }

  // Render inmediato (si falla, backend decide si captcha es obligatorio)
  renderTurnstile();

  // ---------------- submit ----------------
  form.addEventListener('submit', async (e) => {
    e.preventDefault();

    const name     = (document.getElementById('name')?.value || '').trim();
    const email    = (document.getElementById('email')?.value || '').trim();
    const password = document.getElementById('password')?.value || '';
    const confirm  = document.getElementById('confirm')?.value || '';

    if (!name) return showMessage('Por favor ingresa tu nombre.', false);
    if (!email) return showMessage('Por favor ingresa tu correo.', false);
    if (!password) return showMessage('Por favor ingresa una contraseña.', false);
    if (password !== confirm) return showMessage('Las contraseñas no coinciden.', false);

    const turnstileToken = getTurnstileToken();

    try {
      showMessage('Creando cuenta…', true);

      const res = await fetch('/api/register', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({
          name,
          email,
          password,
          ...(turnstileToken ? { turnstileToken } : {}),
        }),
      });

      const data = await res.json().catch(() => ({}));
      const success = Boolean(data?.success ?? data?.ok);

      if (res.ok && success) {
        // TRACKING (sin PII)
        try {
          window.gtag?.('event', 'sign_up', { method: 'email' });
          window.fbq?.('track', 'CompleteRegistration');
          window.clarity?.('event', 'complete_registration');
        } catch (_) {}

        showMessage('Cuenta creada. Revisa tu correo para verificar tu cuenta…', true);
        resetTurnstile(); // token consumido
        setTimeout(() => (window.location.href = '/confirmation.html'), 1500);
        return;
      }

      // Si Turnstile falló/expiró
      const isTurnstileFail =
        data?.code === 'TURNSTILE_FAILED' ||
        data?.code === 'TURNSTILE_REQUIRED_OR_FAILED' ||
        (Array.isArray(data?.errorCodes) && data.errorCodes.length > 0) ||
        res.status === 400;

      if (isTurnstileFail) resetTurnstile();

      const errMsg =
        data?.message ||
        data?.error ||
        (res.status === 409 ? 'Este correo ya está registrado.' : 'Hubo un problema al crear tu cuenta.');

      showMessage(errMsg, false);
    } catch (err) {
      console.error('[register.js] Error:', err);
      resetTurnstile();
      showMessage('Error al conectar con el servidor.', false);
    }
  });

  // ---------------- UI helpers ----------------
  function showMessage(text, ok) {
    if (!msg) return;
    msg.textContent = text;
    msg.style.color = ok ? '#b286e0ff' : '#f87171';
  }

  document.querySelectorAll('.toggle-password').forEach((btn) => {
    btn.addEventListener('click', () => {
      const targetId = btn.dataset.target;
      const input = document.getElementById(targetId);
      if (!input) return;

      const visible = input.type === 'text';
      input.type = visible ? 'password' : 'text';

      btn.classList.toggle('eye-visible', !visible);
      btn.classList.toggle('eye-hidden', visible);

      input.classList.add('form-input');
    });
  });
});
