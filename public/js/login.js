// public/js/login.js
document.addEventListener('DOMContentLoaded', () => {
  const form = document.getElementById('loginForm');
  const registerBtn = document.getElementById('register-btn');
  const googleBtn = document.getElementById('google-btn');

  // === OJO mostrar/ocultar contraseña (igual a register) ===
  document.querySelectorAll('.toggle-password').forEach((btn) => {
    btn.addEventListener('click', () => {
      const targetId = btn.dataset.target;
      const input = document.getElementById(targetId);
      if (!input) return;

      const visible = input.type === 'text';
      input.type = visible ? 'password' : 'text';

      btn.classList.toggle('eye-visible', !visible);
      btn.classList.toggle('eye-hidden', visible);

      // Mantén estilos consistentes y coloca el cursor al final
      input.classList.add('form-input');
      input.focus({ preventScroll: true });
      const len = input.value.length;
      try { input.setSelectionRange(len, len); } catch { /* noop */ }
    });
  });

  // Navegación secundaria
  if (registerBtn) registerBtn.addEventListener('click', () => { window.location.href = 'register.html'; });
  if (googleBtn)   googleBtn.addEventListener('click',   () => { window.location.href = '/auth/google/login'; });

  if (!form) return;

  // === Login ===
  form.addEventListener('submit', async function (e) {
    e.preventDefault();

    const emailEl = document.getElementById('email');
    const passEl  = document.getElementById('password');
    const email = emailEl?.value.trim();
    const password = passEl?.value ?? '';

    if (!email || !password) {
      alert('Ingresa tu correo y contraseña.');
      return;
    }

    const submitButton = form.querySelector('button[type="submit"]');
    const originalText = submitButton.innerText;
    submitButton.innerText = 'Procesando…';
    submitButton.disabled = true;

    try {
      const res = await fetch('/api/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ email, password })
      });

      let data = {};
      try { data = await res.json(); } catch { /* puede no venir JSON válido en errores */ }

      if (res.ok && data.success) {
        await waitForSessionAndRedirect();
      } else {
        alert(data.message || `Credenciales incorrectas (HTTP ${res.status})`);
      }
    } catch (err) {
      console.error('Login error:', err);
      alert('❌ Error al conectar con el servidor');
    } finally {
      submitButton.innerText = originalText;
      submitButton.disabled = false;
    }
  });

  // Espera a que la sesión esté lista y redirige según onboarding
  async function waitForSessionAndRedirect() {
    let attempts = 0;
    let user = null;

    while (attempts < 8) {
      try {
        const resUser = await fetch('/api/session', { credentials: 'include' });
        if (resUser.ok) {
          const sessionData = await resUser.json();
          if (sessionData.authenticated) {
            user = sessionData.user;
            break;
          }
        }
      } catch {
        console.warn('Esperando a que la sesión esté disponible…');
      }
      await new Promise(r => setTimeout(r, 250));
      attempts++;
    }

    if (user) {
      if (user._id)   sessionStorage.setItem('userId', user._id);
      if (user.shop)  sessionStorage.setItem('shop', user.shop);
      if (user.email) sessionStorage.setItem('email', user.email);

      console.log('[LOGIN] sessionStorage:', user._id, user.shop, user.email);
      const redirectUrl = user.onboardingComplete ? '/dashboard' : '/onboarding';
      window.location.href = redirectUrl;
    } else {
      alert('⚠️ No se pudo establecer sesión. Intenta iniciar sesión de nuevo.');
    }
  }
});

// Asegurar que el ojo coincide con el tipo del input al cargar
(function syncEyeOnLoad() {
  const input = document.getElementById('password');
  const btn = document.querySelector('.toggle-password[data-target="password"]');
  if (!input || !btn) return;
  // ojo tachado (eye-visible) cuando está oculto (password)
  const isHidden = (input.type === 'password');
  btn.classList.toggle('eye-visible', isHidden);
  btn.classList.toggle('eye-hidden', !isHidden);
})();

