/* public/js/login.js */
document.addEventListener('DOMContentLoaded', () => {
  // ---------------- helpers ----------------
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

  // ✅ Asegura SIEMPRE un contenedor sutil abajo (no banner arriba)
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

    // Intenta insertarlo arriba del "¿Olvidaste...?"
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

    // ✅ Estilo sutil (pill) – éxito/error
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

  // ---------------- verified=1 (✅ sutil abajo + limpia URL) ----------------
  (function handleVerifiedNotice() {
    try {
      const params = new URLSearchParams(window.location.search);
      if (params.get('verified') !== '1') return;

      showInlineMessage('✅ Correo verificado. Ya puedes iniciar sesión.', true);

      // Auto-ocultar (súper sutil)
      setTimeout(() => {
        // Solo ocultamos si el usuario no ha disparado un error después
        const box = document.getElementById('login-msg');
        if (box && box.textContent.includes('Correo verificado')) {
          hideInlineMessage();
        }
      }, 6500);

      // Limpia la URL para que no se quede pegado el verified=1
      params.delete('verified');
      const qs = params.toString();
      const clean = window.location.pathname + (qs ? `?${qs}` : '') + window.location.hash;
      window.history.replaceState({}, document.title, clean);
    } catch (_) {
      /* noop */
    }
  })();

  // ---------------- DOM refs (robusto) ----------------
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

  // Navegación secundaria
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
      try { input.setSelectionRange(len, len); } catch { /* noop */ }
    });
  });

  if (!form) {
    console.error('[login.js] No se encontró el formulario. Revisa que exista #loginForm.');
    return;
  }

  // Evita submit nativo por si falla JS (y evita GET accidentales)
  try {
    form.setAttribute('novalidate', 'novalidate');
    // OJO: NO seteamos action/method aquí para no mandar a un endpoint incorrecto en fallback.
    // El login lo controla 100% JS.
  } catch (_) {
    /* noop */
  }

  // Captura inputs (robusto: id o name)
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

  // ✅ Fallback inteligente por si el backend no tiene /api/login (según tus logs 404)
  // Orden: primero lo que usa tu frontend hoy, luego alternativas comunes.
  const LOGIN_ENDPOINTS = [
    '/api/login',
    '/login',
    '/api/auth/login',
  ];

  let inFlight = false;

  async function postLogin(endpoint, email, password) {
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      cache: 'no-store',
      body: JSON.stringify({ email, password }),
    });

    let data = null;
    const ct = (res.headers.get('content-type') || '').toLowerCase();
    if (ct.includes('application/json')) {
      try { data = await res.json(); } catch { data = null; }
    } else {
      // si responde HTML u otra cosa, igual queremos avanzar a verificar sesión
      try { await res.text(); } catch { /* noop */ }
    }

    return { res, data };
  }

  function isSuccessPayload(data) {
    if (!data) return false;
    return data.success === true || data.ok === true || data.authenticated === true;
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

      for (const endpoint of LOGIN_ENDPOINTS) {
        const { res, data } = await postLogin(endpoint, email, password);
        lastStatus = res.status;

        // Si es 404/405, probamos el siguiente endpoint
        if (res.status === 404 || res.status === 405) {
          console.warn(`[login.js] ${endpoint} -> HTTP ${res.status}. Probando siguiente endpoint…`);
          continue;
        }

        // Si el backend devuelve redirect explícito
        if (data && data.redirect) {
          window.location.href = data.redirect;
          return;
        }

        // Éxito directo
        if (res.ok && isSuccessPayload(data)) {
          await waitForSessionAndRedirect();
          return;
        }

        // Algunos backends responden 200 sin JSON pero sí setean cookie:
        if (res.ok && !data) {
          await waitForSessionAndRedirect();
          return;
        }

        // Fallo real (401/403/400 etc)
        const msg =
          (data && (data.message || data.error)) ||
          (res.status === 401 ? 'Correo o contraseña incorrectos.' : `No se pudo iniciar sesión (HTTP ${res.status}).`);

        showInlineMessage(msg, false);
        return;
      }

      // Si llegamos aquí, todos los endpoints dieron 404/405
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

  // Intercepta submit (captura + bubbling para blindaje total)
  form.addEventListener('submit', doLogin, true);
  form.addEventListener('submit', doLogin, false);

  // Blindaje extra: click del botón
  if (submitButton) {
    submitButton.addEventListener('click', (e) => doLogin(e));
  }

  // Espera a que la sesión esté lista y redirige según onboarding
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
      } catch {
        /* noop */
      }

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

  // Sync ojo al cargar
  (function syncEyeOnLoad() {
    const input = document.getElementById('password');
    const btn = document.querySelector('.toggle-password[data-target="password"]');
    if (!input || !btn) return;
    const isHidden = input.type === 'password';
    btn.classList.toggle('eye-visible', isHidden);
    btn.classList.toggle('eye-hidden', !isHidden);
  })();
});
