// public/js/onboarding4.js
document.addEventListener('DOMContentLoaded', () => {
  const btn = document.getElementById('go-to-dashboard-final');

  const px = {
    gtag: (...args) => { try { window.gtag?.(...args); } catch {} },
    fbq:  (...args) => { try { window.fbq?.(...args); } catch {} },
    clarityEvent: (name) => { try { window.clarity?.('event', name); } catch {} },
    once: (key, fn) => {
      try {
        if (sessionStorage.getItem(key) === '1') return;
        fn?.();
        sessionStorage.setItem(key, '1');
      } catch {}
    },
    leadOnce: (source = 'unknown') => {
      px.once('px_lead_tracked', () => {
        px.gtag('event', 'generate_lead', { source });
        px.fbq('track', 'Lead');
        px.clarityEvent('lead');
      });
    }
  };

  btn?.addEventListener('click', async () => {
    // ✅ Tracking (safe) — intento de completar onboarding
    px.gtag('event', 'onboarding_finish_click', { step: 4 });
    px.fbq('trackCustom', 'OnboardingFinishClick', { step: 4 });
    px.clarityEvent('onboarding_finish_click');

    btn.disabled = true;

    try {
      const res = await fetch('/api/complete-onboarding', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' }
      });

      if (!res.ok) {
        throw new Error('El servidor devolvió un error');
      }

      // ✅ Tracking (safe) — onboarding completado (una vez por sesión)
      px.once('px_onboarding_complete', () => {
        // GA4 recomendado
        px.gtag('event', 'tutorial_complete', { step: 4, page: 'onboarding4' });

        // Meta Pixel custom
        px.fbq('trackCustom', 'CompleteOnboarding', { step: 4 });

        // Clarity
        px.clarityEvent('onboarding_complete');
      });

      // Fallback: si no se marcó Lead antes, lo marcamos aquí
      px.leadOnce('onboarding4_complete');

      window.location.href = '/dashboard';
    } catch (err) {
      console.error('Error marcando onboarding como completo:', err);
      alert('No se pudo completar el onboarding, intenta de nuevo.');
      btn.disabled = false;
    }
  });
});
