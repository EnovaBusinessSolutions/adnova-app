/* public/js/register.js */
document.addEventListener('DOMContentLoaded', () => {
  const form = document.getElementById('register-form');
  const msg  = document.getElementById('register-msg');

  if (!form) return;

  form.addEventListener('submit', async (e) => {
    e.preventDefault();

    const name     = (document.getElementById('name')?.value || '').trim();
    const email    = (document.getElementById('email')?.value || '').trim();
    const password = document.getElementById('password')?.value || '';
    const confirm  = document.getElementById('confirm')?.value || '';

    if (!name) {
      showMessage('Por favor ingresa tu nombre.', false);
      return;
    }
    if (!email) {
      showMessage('Por favor ingresa tu correo.', false);
      return;
    }
    if (!password) {
      showMessage('Por favor ingresa una contraseña.', false);
      return;
    }
    if (password !== confirm) {
      showMessage('Las contraseñas no coinciden', false);
      return;
    }

    try {
      showMessage('Creando cuenta…', true);

      const res = await fetch('/api/register', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ name, email, password }),
      });

      const data = await res.json().catch(() => ({}));

      // ✅ Compat: algunos backends responden {success:true}, otros {ok:true}
      const success = Boolean(data?.success ?? data?.ok);

      if (res.ok && success) {
        // ✅ TRACKING: registro completado (sin enviar PII)
        try {
          // GA4 (evento recomendado)
          window.gtag?.('event', 'sign_up', { method: 'email' });

          // Meta Pixel (evento estándar)
          window.fbq?.('track', 'CompleteRegistration');

          // Clarity (evento custom)
          window.clarity?.('event', 'complete_registration');
        } catch (_) {
          // no-op: nunca bloqueamos el flujo por tracking
        }

        // ✅ Mensaje coherente con el nuevo flujo (verificación de correo)
        showMessage('Cuenta creada. Revisa tu correo para verificar tu cuenta…', true);

        // Si tu confirmation.html es “verifica tu correo”, perfecto.
        setTimeout(() => (window.location.href = '/confirmation.html'), 1500);
        return;
      }

      // Si el backend manda errores estilo {message} o {error}
      const errMsg =
        data?.message ||
        data?.error ||
        (res.status === 409 ? 'Este correo ya está registrado.' : 'Hubo un problema al crear tu cuenta.');

      showMessage(errMsg, false);
    } catch (err) {
      showMessage('Error al conectar con el servidor', false);
    }
  });

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
