// public/js/recover.js
document.addEventListener('DOMContentLoaded', () => {
  const form   = document.querySelector('#recoverForm');
  const emailI = document.querySelector('#email');

  if (!form) return;

  // ✅ helper: leer token actual de Turnstile
  function getTurnstileToken() {
    const el = document.querySelector('input[name="cf-turnstile-response"]');
    return (el?.value || '').trim();
  }

  // ✅ helper: reset del widget si existe
  function resetTurnstile() {
    try { window.turnstile?.reset?.(); } catch (_) {}
  }

  form.addEventListener('submit', async (e) => {
    e.preventDefault();

    const email = (emailI?.value || '').trim();
    if (!email) {
      alert('Ingresa tu correo.');
      return;
    }

    // ✅ Turnstile obligatorio en recuperar
    const turnstileToken = getTurnstileToken();
    if (!turnstileToken) {
      alert('Por favor completa la verificación de seguridad.');
      return;
    }

    try {
      const res = await fetch('/api/forgot-password', {
        method : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body   : JSON.stringify({ email, turnstileToken }),
      });

      const data = await res.json().catch(() => ({}));

      // ✅ Si Turnstile falla o expira, reset para reintentar
      const isTurnstileFail =
        data?.code === 'TURNSTILE_FAILED' ||
        data?.code === 'TURNSTILE_REQUIRED_OR_FAILED' ||
        (Array.isArray(data?.errorCodes) && data.errorCodes.length > 0) ||
        res.status === 400;

      if (!res.ok && isTurnstileFail) {
        resetTurnstile();
        alert('No se pudo validar la verificación de seguridad. Intenta de nuevo.');
        return;
      }

      // ✅ Mensaje “seguro” (no revela si existe)
      alert('Si el correo existe en nuestra base, recibirás un enlace de recuperación.');

      form.reset();
      resetTurnstile(); // ✅ para que no quede token “consumido”
    } catch (err) {
      console.error(err);
      resetTurnstile();
      alert('Error de red. Intenta más tarde.');
    }
  });
});
