// public/js/onboarding2.js

function showEl(el) {
  if (!el) return;
  el.classList.remove('hidden');
  el.removeAttribute('aria-hidden');
  el.style.display = el.classList.contains('content-panel') ? 'flex' : 'block';
  el.style.visibility = 'visible';
  el.style.opacity = '1';
  if (!el.style.position) el.style.position = 'relative';
  el.style.zIndex = '3';
}

function hideEl(el) {
  if (!el) return;
  el.classList.add('hidden');
  el.setAttribute('aria-hidden', 'true');
  el.style.display = 'none';
  el.style.visibility = 'hidden';
  el.style.opacity = '0';
  el.style.zIndex = '';
}

/* ===================== INTERCOM (SAFE) ===================== */
const ic = {
  has: () => typeof window.Intercom === 'function',
  safe: (fn) => { try { fn?.(); } catch {} },
  appId: () => {
    try {
      return (document.querySelector('meta[name="intercom-app-id"]') || {}).content || '';
    } catch {
      return '';
    }
  },
  getUserId: () => {
    try {
      const v = document.body?.getAttribute('data-user-id') || '';
      // Evita mandar placeholder
      if (!v || v === 'USER_ID_REAL') return null;
      return String(v);
    } catch {
      return null;
    }
  },
  updateStep: (stepNumber, pageName) => {
    ic.safe(() => {
      if (!ic.has()) return;

      const APP_ID = ic.appId();
      const userId = ic.getUserId();

      const payload = {
        ...(APP_ID ? { app_id: APP_ID } : {}),
        page: pageName,
        step: stepNumber,
        // Campos “custom” (Intercom los acepta como metadata)
        custom_attributes: {
          onboarding_step: stepNumber,
          onboarding_page: pageName,
        },
      };

      // Si ya tienes user_id real en el HTML, lo pasamos; si no, queda como visitor
      if (userId) payload.user_id = userId;

      window.Intercom('update', payload);

      // Evento opcional (si en tu workspace lo usas para automatizaciones)
      try {
        window.Intercom('trackEvent', 'onboarding_step_view', { step: stepNumber, page: pageName });
      } catch {}
    });
  },
  track: (name, meta) => {
    ic.safe(() => {
      if (!ic.has()) return;
      try { window.Intercom('trackEvent', name, meta || {}); } catch {}
    });
  },
  shutdown: () => {
    ic.safe(() => {
      if (!ic.has()) return;
      try { window.Intercom('shutdown'); } catch {}
    });
  },
};

document.addEventListener('DOMContentLoaded', () => {
  const $root = document.getElementById('onboarding') || document;

  const s1 = document.getElementById('step1-content');
  const s2 = document.getElementById('step2-content');

  const backBtn2 = document.getElementById('back-btn-2');
  const continueBtn2 = document.getElementById('continue-btn-2');
  const goToStep2 = document.getElementById('go-to-step2');

  /* ===================== PIXELS (SAFE) ===================== */
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
  };

  // Step 2 begin (una vez por sesión)
  px.once('px_onboarding_step2_begin', () => {
    px.gtag('event', 'tutorial_progress', { step: 2, page: 'onboarding2' });
    px.fbq('trackCustom', 'OnboardingStepBegin', { step: 2 });
    px.clarityEvent('onboarding_step2_begin');
  });

  /* ===================== INTERCOM: step view ===================== */
  // (No usamos "once" aquí porque update debe correr por cada carga real de la página)
  ic.updateStep(2, 'onboarding_step_2');

  /* ===================== STEPS UI ===================== */
  // Limpia estados
  $root.querySelectorAll('.step').forEach((el) => {
    el.classList.remove('active');
    // no removemos completed globalmente porque step 1 puede venir ya “completed” en HTML
  });

  // Asegura step 1 como completado (solo visual, no rompe nada)
  const step1 = $root.querySelector('.step[data-step="1"]');
  if (step1) step1.classList.add('completed');

  // Marca step 2 activo
  $root.querySelector('.step[data-step="2"]')?.classList.add('active');

  // Vista default
  showEl(s2);
  hideEl(s1);

  // control por hash (si alguien navega directo)
  const hashWantsStep1 = location.hash && /step=1/.test(location.hash);
  if (hashWantsStep1) {
    $root.querySelectorAll('.step').forEach(el => el.classList.remove('active'));
    $root.querySelector('.step[data-step="1"]')?.classList.add('active');
    showEl(s1);
    hideEl(s2);
  } else {
    if (location.hash !== '#step=2') location.hash = '#step=2';
  }

  // Botón (por si aparece el panel step1-content aquí)
  goToStep2?.addEventListener('click', (e) => {
    e.preventDefault();
    $root.querySelectorAll('.step').forEach(el => el.classList.remove('active'));
    $root.querySelector('.step[data-step="2"]')?.classList.add('active');
    hideEl(s1);
    showEl(s2);
    if (location.hash !== '#step=2') location.hash = '#step=2';

    // Intercom: asegurar contexto step 2 (por si el usuario cayó con hash raro)
    ic.updateStep(2, 'onboarding_step_2');
  });

  /* ===================== NAV ===================== */
  backBtn2?.addEventListener('click', (e) => {
    e.preventDefault();

    // Tracking safe
    px.gtag('event', 'onboarding_back', { from_step: 2, to_step: 1, page: 'onboarding2' });
    px.fbq('trackCustom', 'OnboardingBack', { from_step: 2, to_step: 1 });
    px.clarityEvent('onboarding_back_2_to_1');

    // Intercom event
    ic.track('onboarding_back', { from_step: 2, to_step: 1, page: 'onboarding_step_2' });

    // Evita duplicados al cambiar de página
    ic.shutdown();

    window.location.href = '/onboarding.html#step=1';
  });

  // Step 2 ya NO hace detección; eso ocurre en el step 1 (modal inline).
  // Solo continuamos al step3. Agregamos anti doble-click robusto.
  let inflight = false;

  continueBtn2?.addEventListener('click', (e) => {
    e.preventDefault();
    if (!continueBtn2 || continueBtn2.disabled) return;
    if (inflight) return;

    inflight = true;
    continueBtn2.disabled = true;

    const old = continueBtn2.textContent;
    continueBtn2.textContent = 'Continuando…';

    // Tracking safe: Step 2 complete
    px.gtag('event', 'onboarding_step_complete', { step: 2, page: 'onboarding2' });
    px.fbq('trackCustom', 'OnboardingStepComplete', { step: 2 });
    px.clarityEvent('onboarding_step2_complete');

    // Intercom: completar step 2 + evento
    ic.track('onboarding_step_complete', { step: 2, page: 'onboarding_step_2' });

    // Evita duplicados al cambiar de página
    ic.shutdown();

    // Navegación
    window.location.href = '/onboarding3.html';

    // Fallback: si el navegador no navega por alguna razón, restauramos
    setTimeout(() => {
      try {
        if (document.visibilityState === 'visible') {
          inflight = false;
          continueBtn2.disabled = false;
          continueBtn2.textContent = old;

          // Re-hidrata Intercom si el usuario se quedó aquí
          ic.updateStep(2, 'onboarding_step_2');
        }
      } catch {}
    }, 4500);
  });

  // Extra safety: si cierran la pestaña o cambian de URL
  window.addEventListener('beforeunload', () => {
    ic.shutdown();
  });
});
