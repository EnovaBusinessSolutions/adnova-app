/* public/js/register.js — registro sin Cloudflare Turnstile */
document.addEventListener('DOMContentLoaded', () => {
  const form = document.getElementById('register-form');
  const msg = document.getElementById('register-msg');

  if (!form) return;

  form.addEventListener('submit', async (e) => {
    e.preventDefault();

    const name = (document.getElementById('name')?.value || '').trim();
    const email = (document.getElementById('email')?.value || '').trim();
    const password = document.getElementById('password')?.value || '';
    const confirm = document.getElementById('confirm')?.value || '';

    if (!name) return showMessage('Por favor ingresa tu nombre.', false);
    if (!email) return showMessage('Por favor ingresa tu correo.', false);
    if (!password) return showMessage('Por favor ingresa una contraseña.', false);
    if (password !== confirm) return showMessage('Las contraseñas no coinciden.', false);

    try {
      showMessage('Creando cuenta…', true);

      const res = await fetch('/api/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, email, password }),
      });

      const data = await res.json().catch(() => ({}));
      const success = Boolean(data?.success ?? data?.ok);

      if (res.ok && success) {
        try {
          window.gtag?.('event', 'sign_up', { method: 'email' });
          window.fbq?.('track', 'CompleteRegistration');
          window.clarity?.('event', 'complete_registration');
        } catch (_) {}

        showMessage('Cuenta creada. Revisa tu correo para verificar tu cuenta…', true);
        setTimeout(() => (window.location.href = '/confirmation.html'), 1500);
        return;
      }

      const errMsg =
        data?.message ||
        data?.error ||
        (res.status === 409 ? 'Este correo ya está registrado.' : 'Hubo un problema al crear tu cuenta.');

      showMessage(errMsg, false);
    } catch (err) {
      console.error('[register.js] Error:', err);
      showMessage('Error al conectar con el servidor.', false);
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
