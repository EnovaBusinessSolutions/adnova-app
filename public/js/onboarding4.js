document.addEventListener('DOMContentLoaded', () => {
  const btn = document.getElementById('go-to-dashboard-final');
  btn?.addEventListener('click', async () => {
    btn.disabled = true;
    const shop = sessionStorage.getItem('shop');
    if (shop) {
      try {
        await fetch('/api/onboarding-complete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ shop })
      });
        // Solo redirige si fue exitoso
        window.location.href = '/dashboard.html';
      } catch (err) {
        console.error('Error marcando onboarding como completo:', err);
        btn.disabled = false;
        alert('No se pudo completar el onboarding, intenta de nuevo.');
      }
    } else {
      window.location.href = '/dashboard.html';
    }
  });
});
