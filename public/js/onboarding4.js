// public/js/onboarding4.js
document.addEventListener('DOMContentLoaded', () => {
  const btn = document.getElementById('go-to-dashboard-final');
  if (!btn) return;

  // -----------------------------
  // Pixels (SAFE)
  // -----------------------------
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

  // -----------------------------
  // Helpers
  // -----------------------------
  const DASHBOARD_URL = '/dashboard';
  const LOGIN_URL = '/login';

  let inflight = false;

  const safeJson = async (res) => {
    try { return await res.json(); } catch { return null; }
  };

  const setBtnLoading = (loading) => {
    if (!btn) return;
    if (loading) {
      btn.disabled = true;
      btn.dataset._oldText = btn.textContent || '';
      btn.textContent = 'Entrando…';
      btn.style.pointerEvents = 'none';
      btn.style.opacity = '0.95';
    } else {
      btn.disabled = false;
      btn.textContent = btn.dataset._oldText || 'Comenzar';
      btn.style.pointerEvents = 'auto';
      btn.style.opacity = '1';
    }
  };

  const go = (url) => { window.location.href = url; };

  // -----------------------------
  // Click
  // -----------------------------
  btn.addEventListener('click', async () => {
    if (inflight) return;
    inflight = true;

    // ✅ Tracking (safe) — intento de finalizar
    px.gtag('event', 'onboarding_finish_click', { step: 4 });
    px.fbq('trackCustom', 'OnboardingFinishClick', { step: 4 });
    px.clarityEvent('onboarding_finish_click');

    setBtnLoading(true);

    // Siempre redirigimos al dashboard al final (E2E),
    // aunque el endpoint falle / no exista, para no frenar al usuario.
    let shouldRedirectTo = DASHBOARD_URL;

    try {
      const res = await fetch('/api/complete-onboarding', {
        method: 'POST',
        credentials: 'include', // ✅ IMPORTANTÍSIMO si usas cookies de sesión
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json',
        },
        body: JSON.stringify({ source: 'onboarding4' }),
      });

      // Si expiró sesión, muchos backends responden 401/403
      if (res.status === 401 || res.status === 403) {
        shouldRedirectTo = LOGIN_URL;
        throw new Error('NO_AUTH');
      }

      // 404: el endpoint no existe aún → no bloqueamos
      if (res.status === 404) {
        console.warn('[onboarding4] /api/complete-onboarding no existe (404). Continuando al dashboard…');
      } else if (!res.ok) {
        // Otros errores HTTP
        const j = await safeJson(res);
        console.warn('[onboarding4] complete-onboarding error:', res.status, j);
      } else {
        // OK: opcionalmente valida body {ok:true}
        const j = await safeJson(res);
        if (j && j.ok === false) {
          console.warn('[onboarding4] complete-onboarding respondió ok:false:', j);
        }
      }

      // ✅ Tracking (safe) — onboarding completado (una vez por sesión)
      px.once('px_onboarding_complete', () => {
        px.gtag('event', 'tutorial_complete', { step: 4, page: 'onboarding4' });
        px.fbq('trackCustom', 'CompleteOnboarding', { step: 4 });
        px.clarityEvent('onboarding_complete');
      });

      // Fallback: si no se marcó Lead antes, lo marcamos aquí
      px.leadOnce('onboarding4_complete');

    } catch (err) {
      // Solo mostramos alerta si fue un error “real” distinto a NO_AUTH/404 silencioso
      if (String(err?.message) === 'NO_AUTH') {
        // Si no hay auth, lo más correcto es mandar a login
        console.warn('[onboarding4] Sesión no válida. Redirigiendo a login.');
      } else {
        console.warn('[onboarding4] Error marcando onboarding como completo:', err);
        // No frenamos al usuario; solo re-habilitamos si NO vamos a redirigir
        // (pero aquí sí redirigimos igual, así que no alertamos).
      }
    } finally {
      // E2E: siempre avanzamos
      go(shouldRedirectTo);
      // no tiene caso re-habilitar porque ya redirigimos,
      // pero por seguridad si algo bloquea la navegación:
      setTimeout(() => {
        inflight = false;
        setBtnLoading(false);
      }, 2500);
    }
  });
});
