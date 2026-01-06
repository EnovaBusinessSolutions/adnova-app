/* public/js/login.js */
document.addEventListener('DOMContentLoaded', () => {
  // -------- helpers --------
  const $  = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

  function showInlineMessage(text, ok = false) {
    // Si existe un contenedor de mensaje, úsalo. Si no, fallback a alert.
    const box = $('#login-msg') || $('#msg') || $('.login-msg') || $('.success-message');
    if (box) {
      box.textContent = text;
      box.style.display = 'block';
      box.style.marginTop = '12px';
      box.style.fontSize = '13px';
      box.style.lineHeight = '18px';
      box.style.color = ok ? '#b286e0ff' : '#f87171';
      return;
    }
    alert(text);
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

  // -------- banner: verified=1 --------
  try {
    const params = new URLSearchParams(window.location.search);
    if (params.get('verified') === '1') {
      // Inserta un banner simple arriba del formulario (si existe contenedor)
      const container = $('.login-container') || $('main') || document.body;
      const banner = document.createElement('div');
      banner.style.maxWidth = '520px';
      banner.style.margin = '0 auto 14px auto';
      banner.style.padding = '12px 14px';
      banner.style.borderRadius = '12px';
      banner.style.background = 'rgba(178,134,224,.12)';
      banner.style.border = '1px solid rgba(178,134,224,.35)';
      banner.style.color = '#EAE4F2';
      banner.style.fontSize = '13px';
      banner.style.lineHeight = '18px';
      banner.innerHTML = '✅ <b>Correo verificado</b>. Ya puedes iniciar sesión.';
      // Intenta insertarlo arriba del form si existe
      const formCandidate =
        document.getElementById('loginForm') ||
        document.getElementById('login-form') ||
        $('form');
      if (formCandidate && formCandidate.parentElement) {
        formCandidate.parentElement.insertBefore(banner, formCandidate);
      } else {
        container.prepend(banner);
      }
    }
  } catch (_) {
    /* noop */
  }

  // -------- DOM refs (robusto) --------
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
      const targetId = btn.dataset.target;
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

  // Si no hay form, avisamos en consola (esto explicaría el submit nativo / GET)
  if (!form) {
    console.error('[login.js] No se encontró el formulario de login. Revisa el id (loginForm/login-form) o el HTML.');
    return;
  }

  // Blindaje por si el submit nativo se ejecuta
  try {
    form.setAttribute('method', 'post');
    form.setAttribute('action', '/api/login');
    form.setAttribute('novalidate', 'novalidate');
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

  const submitButton = form.querySelector('button[type="submit"]') || $('button[type="submit"]', form);
  const originalText = submitButton?.innerText || 'Iniciar sesión';

  let inFlight = false;

  async function doLogin(e) {
    if (e) e.preventDefault();
    if (inFlight) return;
    inFlight = true;

    const email = getEmail();
    const password = getPassword();

    if (!email || !password) {
      showInlineMessage('Ingresa tu correo y contraseña.', false);
      inFlight = false;
      return;
    }

    setSubmitting(true, submitButton, originalText);

    try {
      const res = await fetch('/api/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        cache: 'no-store',
        body: JSON.stringify({ email, password }),
      });

      let data = {};
      try { data = await res.json(); } catch { /* no JSON */ }

      // ✅ Mensajes claros según status
      if (res.status === 404) {
        console.error('[login.js] 404 en /api/login. Esto suele indicar método/ruta mal montada o que el submit nativo está corriendo.');
        showInlineMessage('⚠️ No se encontró el endpoint de login (404). Revisa el despliegue o el método de la petición.', false);
        return;
      }
      if (res.status === 405) {
        showInlineMessage('⚠️ Método no permitido. El login debe enviarse por POST.', false);
        return;
      }

      if (res.ok && data.success) {
        // ✅ Usa redirect del backend si viene
        if (data.redirect) {
          window.location.href = data.redirect;
          return;
        }
        // Fallback: espera sesión y redirige
        await waitForSessionAndRedirect();
        return;
      }

      // 401/403 suelen ser credenciales o bloqueo
      const msg = data.message || (res.status === 401
        ? 'Correo o contraseña incorrectos.'
        : `No se pudo iniciar sesión (HTTP ${res.status}).`);

      showInlineMessage(msg, false);
    } catch (err) {
      console.error('[login.js] Login error:', err);
      showInlineMessage('❌ Error al conectar con el servidor.', false);
    } finally {
      setSubmitting(false, submitButton, originalText);
      inFlight = false;
    }
  }

  // Intercepta submit
  form.addEventListener('submit', doLogin);

  // Y también intercepta click del botón (blindaje extra)
  if (submitButton) {
    submitButton.addEventListener('click', (e) => {
      // si por algo el submit no se engancha, aquí lo forzamos
      doLogin(e);
    });
  }

  // Espera a que la sesión esté lista y redirige según onboarding
  async function waitForSessionAndRedirect() {
    let attempts = 0;
    let user = null;

    while (attempts < 10) {
      try {
        const resUser = await fetch('/api/session', { credentials: 'include', cache: 'no-store' });
        if (resUser.ok) {
          const sessionData = await resUser.json();
          if (sessionData.authenticated) {
            user = sessionData.user;
            break;
          }
        }
      } catch {
        // noop
      }
      await new Promise(r => setTimeout(r, 250));
      attempts++;
    }

    if (user) {
      if (user._id)   sessionStorage.setItem('userId', user._id);
      if (user.shop)  sessionStorage.setItem('shop', user.shop);
      if (user.email) sessionStorage.setItem('email', user.email);

      const redirectUrl = user.onboardingComplete ? '/dashboard' : '/onboarding';
      window.location.href = redirectUrl;
    } else {
      showInlineMessage('⚠️ No se pudo establecer sesión. Intenta iniciar sesión de nuevo.', false);
    }
  }

  // Sync ojo al cargar (mejor dentro del DOMContentLoaded)
  (function syncEyeOnLoad() {
    const input = document.getElementById('password');
    const btn = document.querySelector('.toggle-password[data-target="password"]');
    if (!input || !btn) return;
    const isHidden = (input.type === 'password');
    btn.classList.toggle('eye-visible', isHidden);
    btn.classList.toggle('eye-hidden', !isHidden);
  })();
});
