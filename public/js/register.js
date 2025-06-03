// public/js/register.js

document.addEventListener('DOMContentLoaded', function () {
  const form = document.getElementById('registerForm');
  if (!form) return;

  form.addEventListener('submit', async function (e) {
    e.preventDefault();
    const email = document.getElementById('email').value;
    const password = document.getElementById('password').value;
    const submitBtn = form.querySelector('button[type="submit"]');
    const origText = submitBtn.innerText;
    submitBtn.innerText = 'Procesando...';
    submitBtn.disabled = true;

    try {
      const res = await fetch('/api/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password })
      });
      const data = await res.json();
      if (data.success) {
        alert('✅ Usuario registrado. Por favor, inicia sesión.');
        window.location.href = 'index.html';
      } else {
        alert(data.message || 'Error al registrar');
      }
    } catch (err) {
      console.error('Error al registrar:', err);
      alert('❌ Error de red');
    } finally {
      submitBtn.innerText = origText;
      submitBtn.disabled = false;
    }
  });
});
