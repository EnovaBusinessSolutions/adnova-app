// public/js/onboarding4.js
document.addEventListener('DOMContentLoaded', () => {
  const btn = document.getElementById('go-to-dashboard-final');

  btn?.addEventListener('click', async () => {
    btn.disabled = true;

    /* -------------------------------------------------
     * 1) No necesitas enviar el dominio; el backend
     *    usa   req.user   desde la sesión.
     * 2) Llama al endpoint correcto.
     * -------------------------------------------------*/
    try {
      const res = await fetch('/api/complete-onboarding', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' }
      });

      if (!res.ok) {
        throw new Error('El servidor devolvió un error');
      }

      // ✅ Todo bien → al nuevo dashboard
      window.location.href = '/dashboard';
    } catch (err) {
      console.error('Error marcando onboarding como completo:', err);
      alert('No se pudo completar el onboarding, intenta de nuevo.');
      btn.disabled = false;
    }
  });
});
