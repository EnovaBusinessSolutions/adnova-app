/* public/js/login.js */
document.addEventListener('DOMContentLoaded', () => {
  // ---------------- helpers ----------------
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

  // ---------- Turnstile (risk-based) ----------
  function getTurnstileSiteKey() {
    // 1) <meta name="turnstile-site-key" content="...">
    const meta = document.querySelector('meta[name="turnstile-site-key"]');
    const metaKey = (meta?.getAttribute('content') || '').trim();
    if (metaKey) return metaKey;

    // 2) <body data-turnstile-sitekey="...">
    const bodyKey = (document.body?.dataset?.turnstileSitekey || '').trim();
    if (bodyKey) return bodyKey;

    // 3) global (si lo inyectaste)
    const globalKey = (window.TURNSTILE_SITE_KEY || '').trim();
    if (globalKey) return globalKey;

    return '';
  }

  function ensureTurnstileScriptLoaded() {
    return new Promise((resolve, reject) => {
      try {
        // Si ya existe turnstile, listo
        if (window.turnstile && typeof window.turnstile.render === 'function') return resolve();

        // Si el script ya está en el DOM, esperamos a que cargue
        const existing = document.querySelector('script[src*="challenges.cloudflare.com/turnstile/v0/api.js"]');
        if (existing) {
          // Puede tardar un poco en exponer window.turnstile
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

        // Insertamos script lazy
        const s = document.createElement('script');
        s.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js';
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

  function getTurnstileToken() {
    const el = document.querySelector('input[name="cf-turnstile-response"]');
    return (el?.value || '').trim();
  }

  function resetTurnstile() {
    try { window.turnstile?.reset?.(); } catch (_) {}
  }

  // Crea contenedor sutil debajo del form (solo se muestra cuando haga falta)
  function ensureCaptchaBox() {
    let box = document.getElementById('turnstile-wrap');
    if (box) return box;

    const container = $('.login-container') || document.body;
    const form = document.getElementById('loginForm') || document.getElementById('login-form') || $('form');

    box = document.createElement('div');
    box.id = 'turnstile-wrap';
    box.style.display = 'none';
    box.style.marginTop = '12px';
    box.style.marginBottom = '8px';
    box.style.justifyContent = 'center';
    box.style.alignItems = 'center';

    // Insertar antes del botón submit si se puede
    const submitBtn = form?.querySelector('button[type="submit"]');
    if (form && submitBtn && submitBtn.parentElement) {
      submitBtn.parentElement.insertBefore(box, submitBtn);
    } else if (form) {
      form.appendChild(box);
    } else {
      container.appendChild(box);
    }

    return box;
  }

  async function showCaptcha() {
    const siteKey = getTurnstileSiteKey();
    if (!siteKey) {
      showInlineMessage('⚠️ Falta configurar el Site Key de Turnstile en login.html.', false);
      return;
    }

    const wrap = ensureCaptchaBox();
    wrap.style.display = 'flex';

    // Si ya tiene widget, no re-render
    if (wrap.dataset.rendered === '1') return;

    // Placeholder del widget
    const slot = document.createElement('div');
    slot.id = 'cf-turnstile-slot';
    slot.className = 'cf-turnstile';
    wrap.appendChild(slot);

    try {
      await ensureTurnstileScriptLoaded();

      // render programático (más control)
      window.turnstile.render('#cf-turnstile-slot', {
        sitekey: siteKey,
        theme: 'auto',
        callback: () => {
          // cuando el usuario completa, ocultamos mensajes de “falta captcha”
          // (no mostramos nada, solo dejamos listo el token)
        },
        'expired-callback': () => {
          resetTurnstile();
        },
        'error-callback': () => {
          resetTurnstile();
        },
      });

      wrap.dataset.rendered = '1';
    } catch (err) {
      console.error('[login.js] Turnstile render error:', err);
      showInlineMessage('No se pudo cargar la verificación de seguridad. Intenta recargar la página.', false);
    }
  }

  function hideCaptcha() {
    const wrap = document.getElementById('turnstile-wrap');
    if (!wrap) return;
    // No lo destruimos, solo lo escondemos para que quede “listo” si vuelve a pedirlo
    wrap.style.display = 'none';
  }

  // ---------------- msg box ----------------
  function ensureMsgBox() {
    let box =
      document.getElementById('login-msg') ||
      $('#login-msg') ||
      $('#msg') ||
      $('.login-msg') ||
      $('.success-message');

    if (box) return box;

    const container = $('.login-container') || document.body;
    box = document.createElement('div');
    box.id = 'login-msg';
    box.className = 'login-msg';
    box.setAttribute('aria-live', 'polite');
    box.style.display = 'none';

    const anchor = container.querySelector('.forgot-password');
    if (anchor && anchor.parentElement) {
      anchor.parentElement.insertBefore(box, anchor);
    } else {
      container.appendChild(box);
    }
    return box;
  }

  function showInlineMessage(text, ok = false) {
    const box = ensureMsgBox();
    box.textContent = text;
    box.style.display = 'block';

    box.style.marginTop = '12px';
    box.style.fontSize = '12.5px';
    box.style.lineHeight = '16px';
    box.style.textAlign = 'center';
    box.style.padding = '10px 12px';
    box.style.borderRadius = '12px';
    box.style.background = ok ? 'rgba(178,134,224,.10)' : 'rgba(248,113,113,.10)';
    box.style.border = ok ? '1px solid rgba(178,134,224,.25)' : '1px solid rgba(248,113,113,.25)';
    box.style.color = ok ? 'rgba(234,228,242,.92)' : 'rgba(248,113,113,.95)';
  }

  function hideInlineMessage() {
    const box =
      document.getElementById('login-msg') ||
      $('#login-msg') ||
      $('#msg') ||
      $('.login-msg') ||
      $('.success-message');
    if (!box) return;
    box.textContent = '';
    box.style.display = 'none';
  }

  function setSubmitting(isSubmitting, button, originalText) {
    if (!button) return;
    if (isSubmitting) {
      button.disabled = true;
      button.innerText = 'Procesando…';
    } else {
      button.disabled = false;
      button.innerText = originalText || 'Iniciar sesión';
    }
  }

  // ---------------- verified=1 notice ----------------
  (function handleVerifiedNotice() {
    try {
      const params = new URLSearchParams(window.location.search);
      if (params.get('verified') !== '1') return;

      showInlineMessage('✅ Correo verificado. Ya puedes iniciar sesión.', true);

      setTimeout(() => {
        const box = document.getElementById('login-msg');
        if (box && box.textContent.includes('Correo verificado')) {
          hideInlineMessage();
        }
      }, 6500);

      params.delete('verified');
      const qs = params.toString();
      const clean = window.location.pathname + (qs ? `?${qs}` : '') + window.location.hash;
      window.history.replaceState({}, document.title, clean);
    } catch (_) {}
  })();

  // ---------------- DOM refs ----------------
  const form =
    document.getElementById('loginForm') ||
    document.getElementById('login-form') ||
    $('form');

  const registerBtn =
    document.getElementById('register-btn') ||
    document.getElementById('registerBtn') ||
    $('#register');

  const googleBtn =
    document.getElementById('google-btn') ||
    document.getElementById('googleBtn') ||
    $('#google');

  if (registerBtn) registerBtn.addEventListener('click', () => (window.location.href = '/register.html'));
  if (googleBtn) googleBtn.addEventListener('click', () => (window.location.href = '/auth/google/login'));

  // Mostrar/ocultar contraseña
  $$('.toggle-password').forEach((btn) => {
    btn.addEventListener('click', () => {
      const targetId = btn.dataset.target || 'password';
      const input = document.getElementById(targetId) || $(`#${CSS.escape(targetId)}`);
      if (!input) return;

      const visible = input.type === 'text';
      input.type = visible ? 'password' : 'text';

      btn.classList.toggle('eye-visible', !visible);
      btn.classList.toggle('eye-hidden', visible);

      input.classList.add('form-input');
      input.focus({ preventScroll: true });
      const len = input.value.length;
      try { input.setSelectionRange(len, len); } catch {}
    });
  });

  if (!form) {
    console.error('[login.js] No se encontró el formulario. Revisa que exista #loginForm.');
    return;
  }

  try {
    form.setAttribute('novalidate', 'novalidate');
  } catch (_) {}

  const getEmail = () => {
    const el = document.getElementById('email') || $('[name="email"]') || $('#correo');
    return (el?.value || '').trim().toLowerCase();
  };

  const getPassword = () => {
    const el = document.getElementById('password') || $('[name="password"]') || $('#contrasena');
    return el?.value ?? '';
  };

  const submitButton =
    form.querySelector('button[type="submit"]') ||
    $('button[type="submit"]', form);

  const originalText = submitButton?.innerText || 'Iniciar sesión';

  const LOGIN_ENDPOINTS = [
    '/api/login',
    '/login',
    '/api/auth/login',
  ];

  let inFlight = false;

  async function postLogin(endpoint, email, password, turnstileToken) {
    const payload = { email, password };

    // ✅ Solo enviar token si existe (risk-based)
    if (turnstileToken) payload.turnstileToken = turnstileToken;

    const res = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      cache: 'no-store',
      body: JSON.stringify(payload),
    });

    let data = null;
    const ct = (res.headers.get('content-type') || '').toLowerCase();
    if (ct.includes('application/json')) {
      try { data = await res.json(); } catch { data = null; }
    } else {
      try { await res.text(); } catch {}
    }

    return { res, data };
  }

  function isSuccessPayload(data) {
    if (!data) return false;
    return data.success === true || data.ok === true || data.authenticated === true;
  }

  function backendWantsCaptcha(res, data) {
    // ✅ Señales típicas que pondremos desde backend
    if (data?.requiresCaptcha === true) return true;
    if (data?.code === 'TURNSTILE_REQUIRED_OR_FAILED') return true;
    if (data?.code === 'TURNSTILE_FAILED') return true;

    // A veces backend manda errorCodes
    if (Array.isArray(data?.errorCodes) && data.errorCodes.length > 0) return true;

    // En algunos casos podría responder 429 (rate limit) y pedir captcha
    if (res?.status === 429 && data?.requiresCaptcha) return true;

    return false;
  }

  async function doLogin(e) {
    if (e) {
      e.preventDefault();
      e.stopPropagation();
    }
    if (inFlight) return;
    inFlight = true;
    hideInlineMessage();

    const email = getEmail();
    const password = getPassword();

    if (!email || !password) {
      showInlineMessage('Ingresa tu correo y contraseña.', false);
      inFlight = false;
      return;
    }

    setSubmitting(true, submitButton, originalText);

    try {
      let lastStatus = null;

      // Si el captcha está visible, intentamos mandar token
      const hasCaptchaVisible = document.getElementById('turnstile-wrap')?.style?.display !== 'none';
      const tokenIfAny = hasCaptchaVisible ? getTurnstileToken() : '';

      for (const endpoint of LOGIN_ENDPOINTS) {
        const { res, data } = await postLogin(endpoint, email, password, tokenIfAny || undefined);
        lastStatus = res.status;

        if (res.status === 404 || res.status === 405) {
          console.warn(`[login.js] ${endpoint} -> HTTP ${res.status}. Probando siguiente endpoint…`);
          continue;
        }

        if (data && data.redirect) {
          hideCaptcha();
          window.location.href = data.redirect;
          return;
        }

        if (res.ok && isSuccessPayload(data)) {
          hideCaptcha();
          await waitForSessionAndRedirect();
          return;
        }

        if (res.ok && !data) {
          hideCaptcha();
          await waitForSessionAndRedirect();
          return;
        }

        // ✅ Si backend pide captcha, lo mostramos y salimos (reintento manual)
        if (backendWantsCaptcha(res, data)) {
          await showCaptcha();
          resetTurnstile(); // en caso de token consumido/expirado
          showInlineMessage('Verificación requerida. Completa el captcha para continuar.', false);
          return;
        }

        // Fallo real
        const msg =
          (data && (data.message || data.error)) ||
          (res.status === 401 ? 'Correo o contraseña incorrectos.' : `No se pudo iniciar sesión (HTTP ${res.status}).`);

        showInlineMessage(msg, false);
        return;
      }

      console.error('[login.js] Ningún endpoint de login respondió. Revisa backend (rutas) y deploy.');
      showInlineMessage(
        `⚠️ No se encontró el endpoint de login. El servidor respondió ${lastStatus ?? '—'}. Revisa backend/rutas.`,
        false
      );
    } catch (err) {
      console.error('[login.js] Login error:', err);
      showInlineMessage('❌ Error al conectar con el servidor.', false);
    } finally {
      setSubmitting(false, submitButton, originalText);
      inFlight = false;
    }
  }

  form.addEventListener('submit', doLogin, true);
  form.addEventListener('submit', doLogin, false);

  if (submitButton) {
    submitButton.addEventListener('click', (e) => doLogin(e));
  }

  async function waitForSessionAndRedirect() {
    let attempts = 0;
    let user = null;

    while (attempts < 12) {
      try {
        const resUser = await fetch('/api/session', {
          credentials: 'include',
          cache: 'no-store',
        });

        if (resUser.ok) {
          const sessionData = await resUser.json();

          if (sessionData && (sessionData.authenticated || sessionData.ok)) {
            user = sessionData.user || sessionData.data?.user || sessionData.data || null;
            break;
          }
        }
      } catch {}

      await new Promise((r) => setTimeout(r, 250));
      attempts++;
    }

    if (user) {
      if (user._id) sessionStorage.setItem('userId', user._id);
      if (user.shop) sessionStorage.setItem('shop', user.shop);
      if (user.email) sessionStorage.setItem('email', user.email);

      const redirectUrl = user.onboardingComplete ? '/dashboard' : '/onboarding';
      window.location.href = redirectUrl;
      return;
    }

    showInlineMessage('⚠️ Iniciaste sesión, pero no se pudo confirmar la sesión en /api/session. Intenta de nuevo.', false);
  }

  (function syncEyeOnLoad() {
    const input = document.getElementById('password');
    const btn = document.querySelector('.toggle-password[data-target="password"]');
    if (!input || !btn) return;
    const isHidden = input.type === 'password';
    btn.classList.toggle('eye-visible', isHidden);
    btn.classList.toggle('eye-hidden', !isHidden);
  })();
});
