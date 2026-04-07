// public/js/recover.js — recuperación sin Cloudflare Turnstile
document.addEventListener('DOMContentLoaded', () => {
  const form = document.getElementById('recoverForm');
  const emailI = document.getElementById('email');
  const messageEl = document.getElementById('message');

  if (!form) return;

  form.addEventListener('submit', async (e) => {
    e.preventDefault();

    const email = (emailI?.value || '').trim().toLowerCase();
    if (!email) {
      alert('Ingresa tu correo.');
      return;
    }

    try {
      const res = await fetch('/api/forgot-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        cache: 'no-store',
        body: JSON.stringify({ email }),
      });

      await res.json().catch(() => ({}));

      alert('Si el correo existe en nuestra base, recibirás un enlace de recuperación.');
      form.reset();
      if (messageEl) messageEl.textContent = '';
    } catch (err) {
      console.error(err);
      alert('Error de red. Intenta más tarde.');
    }
  });
});
