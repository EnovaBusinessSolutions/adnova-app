/* public/js/register.js */
document.addEventListener('DOMContentLoaded', () => {
  /* ---------- Registro ---------- */
  const form = document.getElementById('register-form');
  const msg  = document.getElementById('register-msg');

  form.addEventListener('submit', async (e) => {
    e.preventDefault();

    const email    = document.getElementById('email').value;
    const password = document.getElementById('password').value;
    const confirm  = document.getElementById('confirm').value;

    if (password !== confirm) {
      showMessage('Las contraseñas no coinciden', false);
      return;
    }

    try {
      const res  = await fetch('/api/register', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ email, password })
      });
      const data = await res.json();

      if (data.success) {
        showMessage('Cuenta creada con éxito. Redirigiendo…', true);
        setTimeout(() => (window.location.href = '/login.html'), 1500);
      } else {
        showMessage('❌ ' + (data.message || 'Hubo un problema'), false);
      }
    } catch (err) {
      showMessage('❌ Error al conectar con el servidor', false);
    }
  });

  function showMessage(text, ok) {
    msg.textContent = text;
    msg.style.color = ok ? '#4ade80' : '#f87171';
  }

  /* ---------- Toggle contraseña ---------- */
  document.querySelectorAll('.toggle-password').forEach((btn) => {
    btn.addEventListener('click', () => {
      const targetId = btn.dataset.target;          // ← toma el id del input
      const input    = document.getElementById(targetId);
      const visible  = input.type === 'text';

      input.type = visible ? 'password' : 'text';
      btn.classList.toggle('eye-visible', !visible);
      btn.classList.toggle('eye-hidden',  visible);
    });
  });
});
