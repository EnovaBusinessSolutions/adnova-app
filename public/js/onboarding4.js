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
  // Intercom (SAFE) — E2E step 4
  // -----------------------------
  const intercom = {
    has: () => typeof window.Intercom === 'function',
    update: (extra = {}) => {
      try {
        if (!intercom.has()) return false;

        const userId = document.body?.dataset?.userId || null;

        // OJO: esto NO autentica. Solo añade contexto a Intercom.
        // Si ya tienes identity verification en backend (/api/session) eso es aparte.
        const payload = {
          ...(window.intercomSettings || {}),
          app_id: window.intercomSettings?.app_id || 'sqexnuzh',
          user_id: userId || undefined,
          page: 'onboarding_step_4',
          step: 4,
          custom_attributes: {
            ...(window.intercomSettings?.custom_attributes || {}),
            onboarding_step: 4,
            onboarding_page: 'onboarding_step_4',
          },
          ...extra,
        };

        window.Intercom('update', payload);
        return true;
      } catch {
        return false;
      }
    },
    track: (eventName, meta = {}) => {
      try {
        if (!intercom.has()) return false;
        window.Intercom('trackEvent', String(eventName), meta || {});
        return true;
      } catch {
        return false;
      }
    },
    once: (key, fn) => px.once(`ic_${key}`, fn),
  };

  // Al entrar al Step 4 (una vez por sesión)
  intercom.once('onboarding4_enter', () => {
    // refresca datos/contexto
    intercom.update({ last_seen_step: 4 });

    // evento de entrada
    intercom.track('onboarding_step_view', {
      step: 4,
      page: 'onboarding4',
      ts: Date.now(),
    });
  });

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

    // ✅ Intercom — click
    intercom.track('onboarding_finish_click', {
      step: 4,
      page: 'onboarding4',
      ts: Date.now(),
    });

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

      // ✅ Intercom — onboarding completado
      intercom.once('onboarding_complete', () => {
        intercom.update({ onboarding_complete: true, last_seen_step: 4 });
        intercom.track('onboarding_complete', {
          step: 4,
          page: 'onboarding4',
          ok: true,
          ts: Date.now(),
        });
      });

      // Fallback: si no se marcó Lead antes, lo marcamos aquí
      px.leadOnce('onboarding4_complete');

    } catch (err) {
      if (String(err?.message) === 'NO_AUTH') {
        console.warn('[onboarding4] Sesión no válida. Redirigiendo a login.');

        // ✅ Intercom — sesión inválida (si alcanzó a cargar)
        intercom.track('onboarding_complete_failed', {
          step: 4,
          page: 'onboarding4',
          reason: 'no_auth',
          ts: Date.now(),
        });
      } else {
        console.warn('[onboarding4] Error marcando onboarding como completo:', err);

        // ✅ Intercom — error genérico
        intercom.track('onboarding_complete_failed', {
          step: 4,
          page: 'onboarding4',
          reason: 'unknown_error',
          message: String(err?.message || 'unknown'),
          ts: Date.now(),
        });
      }
    } finally {
      // E2E: siempre avanzamos
      go(shouldRedirectTo);

      // safety fallback si algo bloquea navegación
      setTimeout(() => {
        inflight = false;
        setBtnLoading(false);
      }, 2500);
    }
  });
});
