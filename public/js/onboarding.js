// public/js/onboarding.js
import { apiFetch } from './apiFetch.saas.js';

document.addEventListener('DOMContentLoaded', async () => {
  const qs = new URL(location.href).searchParams;

  // --- LEE TEMPRANO EL PARAM DE GOOGLE PARA EVITAR DOBLE REFRESH ---
  const _googleParam = (qs.get('google') || '').toLowerCase();
  const _hasGoogleParam = ['connected', 'ok', 'error', 'fail'].includes(_googleParam);

  // -------------------------------------------------
  // Session token (embebido Shopify -> SAAS)
  // -------------------------------------------------
  const sessionToken = qs.get('sessionToken');
  if (sessionToken) sessionStorage.setItem('sessionToken', sessionToken);

  // Parámetros potenciales de Shopify embebido
  const shopFromQuery = qs.get('shop');
  const hostFromQuery = qs.get('host'); // compat (no se usa)

  // -------------------------------------------------
  // PIXELS (SAFE) — NO ROMPE FLUJO
  // -------------------------------------------------
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
        // GA4 (evento recomendado)
        px.gtag('event', 'generate_lead', { source });

        // Meta Pixel (evento estándar)
        px.fbq('track', 'Lead');

        // Clarity
        px.clarityEvent('lead');
      });
    }
  };

  // Onboarding Step 1 "begin" (una vez por sesión)
  px.once('px_onboarding_step1_begin', () => {
    px.gtag('event', 'tutorial_begin', { step: 1, page: 'onboarding' });
    px.fbq('trackCustom', 'OnboardingBegin', { step: 1 });
    px.clarityEvent('onboarding_begin');
  });

  // -------------------------------------------------
  // DOM
  // -------------------------------------------------
  const connectShopifyBtn = document.getElementById('connect-shopify-btn');
  const connectGoogleBtn  = document.getElementById('connect-google-btn');
  const connectMetaBtn    = document.getElementById('connect-meta-btn');
  const continueBtn       = document.getElementById('continue-btn');

  const flagShopify = document.getElementById('shopifyConnectedFlag'); // "true"/"false"
  const flagGoogle  = document.getElementById('googleConnectedFlag');  // "true"/"false"

  const domainStep  = document.getElementById('shopify-domain-step');
  const domainInput = document.getElementById('shop-domain-input');
  const domainSend  = document.getElementById('shop-domain-send');

  // (Sección demo GA – no afecta el nuevo flujo)
  const gaPanel = document.getElementById('ga-edit-test');
  const gaBtn   = document.getElementById('ga-create-demo-btn');
  const gaIn    = document.getElementById('ga-property-id');
  const gaOut   = document.getElementById('ga-demo-output');

  // Meta
  const metaObjectiveStep  = document.getElementById('meta-objective-step');
  const saveMetaObjective  = document.getElementById('save-meta-objective-btn');
  const META_STATUS_URL    = '/api/meta/accounts/status';
  const META_OBJECTIVE_URL = '/api/meta/accounts/objective';

  // Google
  const googleObjectiveStep  = document.getElementById('google-objective-step');
  const saveGoogleObjective  = document.getElementById('save-google-objective-btn');
  const GOOGLE_STATUS_URL    = '/auth/google/status';
  const GOOGLE_OBJECTIVE_URL = '/auth/google/objective';

  // Contenedores estado/selector
  const gaStatusBox     = document.getElementById('ga-ads-status');
  const gaAccountsMount = document.getElementById('ga-ads-accounts');

  // -------------------------------------------------
  // UX: Step UI + Mobile Progress (sin tocar lógica)
  // -------------------------------------------------
  const STEP_TOTAL = 4;
  const CURRENT_STEP = 1; // este archivo es para onboarding.html (step 1)

  function ensureMobileProgressUI() {
    try {
      // Si ya existe, no duplicamos
      if (document.getElementById('adnova-mobile-progress')) return;

      const main = document.querySelector('.main-content');
      if (!main) return;

      // Insertar al top del panel derecho
      const wrap = document.createElement('div');
      wrap.id = 'adnova-mobile-progress';
      wrap.setAttribute('aria-hidden', 'false');
      wrap.innerHTML = `
        <div class="amp-row">
          <div class="amp-left">
            <span class="amp-step">Paso ${CURRENT_STEP} de ${STEP_TOTAL}</span>
            <span class="amp-sub">Onboarding</span>
          </div>
          <div class="amp-right">
            <span class="amp-mini" id="amp-mini-state">Conecta al menos una cuenta</span>
          </div>
        </div>
        <div class="amp-bar" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${Math.round((CURRENT_STEP / STEP_TOTAL) * 100)}">
          <div class="amp-fill" id="amp-fill" style="width:${Math.round((CURRENT_STEP / STEP_TOTAL) * 100)}%"></div>
        </div>
      `;

      // Lo ponemos antes del primer panel visible
      main.insertBefore(wrap, main.firstChild);

      // CSS inline (safe) para no depender de onboarding.css si cambia
      if (!document.getElementById('adnova-mobile-progress-style')) {
        const st = document.createElement('style');
        st.id = 'adnova-mobile-progress-style';
        st.textContent = `
          #adnova-mobile-progress{display:none;margin:-6px 0 14px 0}
          #adnova-mobile-progress .amp-row{display:flex;align-items:flex-end;justify-content:space-between;gap:10px;margin-bottom:10px}
          #adnova-mobile-progress .amp-step{display:block;font-weight:800;color:#e9ddff;font-size:1.05rem;letter-spacing:.2px}
          #adnova-mobile-progress .amp-sub{display:block;color:#b6a7e8;font-size:.85rem;margin-top:2px}
          #adnova-mobile-progress .amp-mini{color:#b6a7e8;font-size:.82rem;opacity:.9;text-align:right;display:block;max-width:170px}
          #adnova-mobile-progress .amp-bar{height:8px;border-radius:999px;background:rgba(255,255,255,.08);overflow:hidden}
          #adnova-mobile-progress .amp-fill{height:100%;background:linear-gradient(90deg,#A96BFF 0%,#9333ea 100%);border-radius:999px;transition:width .25s ease}
          @media (max-width: 600px){
            #adnova-mobile-progress{display:block}
          }
        `;
        document.head.appendChild(st);
      }
    } catch {}
  }

  function setMobileMiniState(text) {
    try {
      const el = document.getElementById('amp-mini-state');
      if (el) el.textContent = text || '';
    } catch {}
  }

  function syncSidebarSteps({ step = CURRENT_STEP, completed = false } = {}) {
    try {
      const nodes = document.querySelectorAll('.steps .step[data-step]');
      if (!nodes?.length) return;

      nodes.forEach((n) => {
        const s = Number(n.getAttribute('data-step') || 0);
        n.classList.toggle('active', s === step);
        // "completed" solo marcamos el paso actual si ya cumplió condición de avance
        // (en step1: cuando ya puede continuar)
        if (completed) {
          n.classList.toggle('completed', s < step || (s === step && step === 1));
        } else {
          // conservador: no tocamos completed de pasos futuros
          if (s === 1) n.classList.remove('completed');
        }
      });
    } catch {}
  }

  // Inicializar UI de progreso
  ensureMobileProgressUI();
  syncSidebarSteps({ step: CURRENT_STEP, completed: false });

  // --- GUARD ANTI-DUPLICADO PARA ensureGoogleAccountsUI ---
  let GA_ENSURE_INFLIGHT = null;

  // --- GUARD ANTI-DUPLICADO PARA selection ---
  const GOOGLE_SELECTION_LOCK = {
    inflight: false,
    pendingEmitSelectionSaved: false, // 👈 cola para emitir cuando termine inflight
    lastReqId: null,
    lastIdsKey: null,
  };

  // -------------------------------------------------
  // Utils UI
  // -------------------------------------------------
  const show = (el) => {
    if (!el) return;
    el.classList.remove('hidden');
    el.style.display = '';
    el.setAttribute('aria-hidden', 'false');
  };
  const hide = (el) => {
    if (!el) return;
    el.classList.add('hidden');
    el.style.display = 'none';
    el.setAttribute('aria-hidden', 'true');
  };

  const setBtnConnected = (btn) => {
    if (!btn) return;
    btn.textContent = 'Conectado';
    btn.classList.add('connected');
    btn.style.pointerEvents = 'none';
    if ('disabled' in btn) btn.disabled = true;
  };
  const disableBtnWhileConnecting = (btn) => {
    if (!btn) return;
    btn.style.pointerEvents = 'none';
    if ('disabled' in btn) btn.disabled = true;
  };
  const enableBtn = (btn) => {
    if (!btn) return;
    btn.style.pointerEvents = 'auto';
    if ('disabled' in btn) btn.disabled = false;
  };

  const setStatus = (html) => {
    if (!gaStatusBox) return;
    gaStatusBox.innerHTML = html || '';
    if (html) show(gaStatusBox);
    else hide(gaStatusBox);

    // UX: si hay status importante en móvil, llevamos el scroll a él
    try {
      if (html && window.matchMedia?.('(max-width: 600px)')?.matches) {
        gaStatusBox.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    } catch {}
  };

  const openGoogleCloseMeta = () => { show(googleObjectiveStep); hide(metaObjectiveStep); };
  const openMetaCloseGoogle = () => { show(metaObjectiveStep);  hide(googleObjectiveStep); };

  // -------------------------------------------------
  // Estado de conectividad (sessionStorage + flags)
  // -------------------------------------------------
  function getConnectivityState() {
    const shopConnected =
      flagShopify?.textContent.trim() === 'true' ||
      sessionStorage.getItem('shopifyConnected') === 'true';

    const googleConnected = sessionStorage.getItem('googleConnected') === 'true';
    const metaConnected   = sessionStorage.getItem('metaConnected') === 'true';

    const anyConnected = !!(shopConnected || googleConnected || metaConnected);
    return { shopConnected, googleConnected, metaConnected, anyConnected };
  }

  function habilitarContinue() {
    if (!continueBtn) return;
    const { anyConnected } = getConnectivityState();

    continueBtn.disabled = !anyConnected;
    continueBtn.classList.toggle('btn-continue--disabled', !anyConnected);
    continueBtn.classList.toggle('btn-continue--enabled',  anyConnected);
    continueBtn.style.pointerEvents = anyConnected ? 'auto' : 'none';
    continueBtn.style.opacity       = anyConnected ? '1'    : '0.6';

    // UX: mini estado en móvil
    setMobileMiniState(anyConnected ? 'Listo para continuar' : 'Conecta al menos una cuenta');

    // UX: marcar step1 “listo” (sin cambiar navegación)
    syncSidebarSteps({ step: CURRENT_STEP, completed: anyConnected });
  }

  // -------------------------------------------------
  // Dispatcher único (anti-duplicados + respeta inflight)
  // -------------------------------------------------
  let _selSavedDebounceT = null;
  let _selSavedLastAt = 0;

  function dispatchAccountsSelectionSaved(reason = '') {
    // Si Google está guardando selección, encolamos y salimos
    if (GOOGLE_SELECTION_LOCK.inflight) {
      GOOGLE_SELECTION_LOCK.pendingEmitSelectionSaved = true;
      return;
    }

    // Debounce + throttle ligero (evita doble disparo por flows distintos)
    const now = Date.now();
    if (now - _selSavedLastAt < 250) return;

    if (_selSavedDebounceT) return;
    _selSavedDebounceT = setTimeout(() => {
      _selSavedDebounceT = null;
      _selSavedLastAt = Date.now();
      try {
        window.dispatchEvent(new CustomEvent('adnova:accounts-selection-saved', {
          detail: { reason: reason || null, ts: _selSavedLastAt }
        }));
      } catch {}
    }, 0);
  }

  // Reacciona si otro script dispara este evento (ej. modal)
  window.addEventListener('adnova:accounts-selection-saved', habilitarContinue);

  // Nota: "storage" no dispara en la misma pestaña; lo dejamos por compat multi-tab.
  window.addEventListener('storage', (e) => {
    if (!e) return;
    if (e.key === 'metaConnected' || e.key === 'googleConnected' || e.key === 'shopifyConnected') {
      habilitarContinue();
    }
  });

  // -------------------------------------------------
  // Shopify
  // -------------------------------------------------
  const pintarShopifyConectado = async () => {
    if (connectShopifyBtn) setBtnConnected(connectShopifyBtn);

    const shop =
      shopFromQuery ||
      domainInput?.value?.trim().toLowerCase() ||
      sessionStorage.getItem('shop');

    if (!shop) {
      sessionStorage.setItem('shopifyConnected', 'true');
      habilitarContinue();
      if (domainStep) domainStep.classList.add('step--hidden');
      dispatchAccountsSelectionSaved('shopify-connected');

      // ✅ Tracking (safe)
      px.once('px_shopify_connected', () => {
        px.gtag('event', 'connect_platform', { platform: 'shopify' });
        px.fbq('trackCustom', 'ConnectShopifySuccess');
        px.clarityEvent('connect_shopify_success');
      });
      px.leadOnce('shopify');

      return;
    }

    try {
      const resp = await apiFetch(`/api/shopConnection/me?shop=${encodeURIComponent(shop)}`);
      if (resp?.shop && resp?.accessToken) {
        sessionStorage.setItem('shop', resp.shop);
        sessionStorage.setItem('accessToken', resp.accessToken);
      }
      sessionStorage.setItem('shopifyConnected', 'true');
      habilitarContinue();
      if (domainStep) domainStep.classList.add('step--hidden');
      dispatchAccountsSelectionSaved('shopify-connected');

      // ✅ Tracking (safe)
      px.once('px_shopify_connected', () => {
        px.gtag('event', 'connect_platform', { platform: 'shopify' });
        px.fbq('trackCustom', 'ConnectShopifySuccess');
        px.clarityEvent('connect_shopify_success');
      });
      px.leadOnce('shopify');
    } catch (err) {
      console.error('Error obteniendo shop/accessToken:', err);
    }
  };

  if (flagShopify?.textContent.trim() === 'true') await pintarShopifyConectado();

  connectShopifyBtn?.addEventListener('click', () => {
    // ✅ Tracking (safe) — intento de conexión
    px.gtag('event', 'connect_platform_click', { platform: 'shopify' });
    px.fbq('trackCustom', 'ConnectShopifyClick');
    px.clarityEvent('connect_shopify_click');

    if (domainStep) domainStep.classList.remove('step--hidden');

    const prefill =
      shopFromQuery ||
      sessionStorage.getItem('shop') ||
      sessionStorage.getItem('shopDomain');

    if (domainInput && prefill && !domainInput.value) {
      domainInput.value = prefill;
    }
    domainInput?.focus();
  });

  domainSend?.addEventListener('click', async () => {
    const shop = domainInput?.value?.trim().toLowerCase();
    if (!shop || !shop.endsWith('.myshopify.com')) {
      return alert('Dominio inválido. Usa el formato mitienda.myshopify.com');
    }

    sessionStorage.setItem('shopDomain', shop);

    try {
      const data = await apiFetch('/api/saas/shopify/match', {
        method: 'POST',
        body: JSON.stringify({ shop }),
      });

      if (data.ok) {
        if (data.shop)        sessionStorage.setItem('shop', data.shop);
        if (data.accessToken) sessionStorage.setItem('accessToken', data.accessToken);

        await pintarShopifyConectado();
        domainStep?.classList.add('step--hidden');
      } else {
        alert(data.error || 'No se pudo vincular la tienda.');
      }
    } catch (err) {
      console.error(err);
      alert('Error al conectar con el servidor.');
    }
  });

  // -------------------------------------------------
  // Meta
  // -------------------------------------------------
  const markMetaConnected = (objective = null) => {
    setBtnConnected(connectMetaBtn);
    sessionStorage.setItem('metaConnected', 'true');
    if (objective) sessionStorage.setItem('metaObjective', objective);
    habilitarContinue();
    dispatchAccountsSelectionSaved('meta-connected');

    // ✅ Tracking (safe)
    px.once('px_meta_connected', () => {
      px.gtag('event', 'connect_platform', { platform: 'meta' });
      px.fbq('trackCustom', 'ConnectMetaSuccess');
      px.clarityEvent('connect_meta_success');
    });
    px.leadOnce('meta');
  };

  async function fetchMetaStatus() {
    try {
      const r = await apiFetch(META_STATUS_URL);
      if (r && r.ok !== false) {
        return { connected: !!r.connected, objective: r.objective ?? null };
      }
      return { connected: false, objective: null };
    } catch {
      try {
        const s = await apiFetch('/api/session');
        return {
          connected: !!(s?.authenticated && s?.user?.metaConnected),
          objective: s?.user?.metaObjective || null,
        };
      } catch {
        return { connected: false, objective: null };
      }
    }
  }

  async function refreshMetaUI() {
    const st = await fetchMetaStatus();
    if (st.connected && !st.objective) {
      openMetaCloseGoogle();
    } else if (st.connected && st.objective) {
      hide(metaObjectiveStep);
      markMetaConnected(st.objective);
    }
    return st;
  }

  connectMetaBtn?.addEventListener('click', () => {
    // ✅ Tracking (safe) — intento de conexión
    px.gtag('event', 'connect_platform_click', { platform: 'meta' });
    px.fbq('trackCustom', 'ConnectMetaClick');
    px.clarityEvent('connect_meta_click');

    localStorage.setItem('meta_connecting', '1');
    disableBtnWhileConnecting(connectMetaBtn);
    if (connectMetaBtn.tagName !== 'A') window.location.href = '/auth/meta/login';
  });

  saveMetaObjective?.addEventListener('click', async () => {
    const selected = (document.querySelector('input[name="metaObjective"]:checked') || {}).value;
    if (!selected) return alert('Selecciona un objetivo');
    try {
      const r = await apiFetch(META_OBJECTIVE_URL, {
        method: 'POST',
        body: JSON.stringify({ objective: selected }),
      });
      if (!r?.ok) throw new Error(r?.error || 'No se pudo guardar el objetivo');
      hide(metaObjectiveStep);

      // ✅ Tracking (safe)
      px.gtag('event', 'select_objective', { platform: 'meta', objective: selected });
      px.fbq('trackCustom', 'SelectObjectiveMeta', { objective: selected });
      px.clarityEvent('select_objective_meta');

      markMetaConnected(selected);
    } catch (e) {
      console.error(e);
      alert('No se pudo guardar el objetivo. Inténtalo nuevamente.');
    }
  });

  async function pollMetaUntilConnected(maxTries = 30, delayMs = 2000) {
    for (let i = 0; i < maxTries; i++) {
      const st = await fetchMetaStatus();
      if (st.connected) {
        localStorage.removeItem('meta_connecting');
        if (!st.objective) openMetaCloseGoogle();
        else { hide(metaObjectiveStep); markMetaConnected(st.objective); }
        return;
      }
      await new Promise((r) => setTimeout(r, delayMs));
    }
    localStorage.removeItem('meta_connecting');
    enableBtn(connectMetaBtn);
  }

  // -------------------------------------------------
  // Google — cuentas + self-test
  // -------------------------------------------------
  const markGoogleConnected = (objective = null) => {
    setBtnConnected(connectGoogleBtn);
    sessionStorage.setItem('googleConnected', 'true');
    if (objective) sessionStorage.setItem('googleObjective', objective);
    habilitarContinue();
    dispatchAccountsSelectionSaved('google-connected');

    // ✅ Tracking (safe)
    px.once('px_google_connected', () => {
      px.gtag('event', 'connect_platform', { platform: 'google' });
      px.fbq('trackCustom', 'ConnectGoogleSuccess');
      px.clarityEvent('connect_google_success');
    });
    px.leadOnce('google');
  };

  function ackGoogleAdsSelection({ reqId, ok, error, ids }) {
    try {
      window.dispatchEvent(new CustomEvent('adnova:google-ads-selection-saved', {
        detail: {
          reqId: reqId || null,
          ok: !!ok,
          error: error || null,
          accountIds: Array.isArray(ids) ? ids : null,
        }
      }));
    } catch (e) {
      console.warn('ACK dispatch failed', e);
    }
  }

  async function runGoogleSelfTest(optionalCid = null) {
    try {
      const url = optionalCid
        ? `/api/google/ads/insights/selftest?customer_id=${encodeURIComponent(optionalCid)}`
        : `/api/google/ads/insights/selftest`;
      const r = await apiFetch(url);
      if (r?.ok) {
        setStatus('');
        return true;
      }
      setStatus('No pudimos validar el acceso a tu cuenta de Google Ads. Revisa que tu usuario tenga permisos en esa cuenta e inténtalo nuevamente.');
      return false;
    } catch (e) {
      console.error('runGoogleSelfTest error:', e);
      setStatus('Ocurrió un error al validar tu cuenta de Google Ads. Intenta nuevamente.');
      return false;
    }
  }

  async function ensureGoogleAccountsUI() {
    if (GA_ENSURE_INFLIGHT) return GA_ENSURE_INFLIGHT;

    GA_ENSURE_INFLIGHT = (async () => {
      try {
        setStatus('');
        hide(gaAccountsMount);

        const res = await apiFetch('/api/google/ads/insights/accounts');

        if (!res || res.ok === false) {
          setStatus('No pudimos cargar tus cuentas de Google Ads. Intenta nuevamente.');
          return { ok: false, accounts: [], defaultCustomerId: null, requiredSelection: false };
        }

        const accounts = Array.isArray(res.accounts) ? res.accounts : [];
        const defaultCustomerId = res.defaultCustomerId || null;
        const requiredSelection = !!res.requiredSelection;

        if (accounts.length === 0) {
          setStatus(
            'No encontramos cuentas de Google Ads accesibles para este usuario. ' +
            'Asegúrate de que la cuenta de Google que conectaste tenga permisos en al menos una cuenta de Google Ads.'
          );
          return { ok: true, accounts, defaultCustomerId, requiredSelection };
        }

        if (requiredSelection) {
          setStatus('Selecciona 1 cuenta de Google Ads para continuar.');
          show(gaAccountsMount);

          window.dispatchEvent(new CustomEvent('googleAccountsLoaded', {
            detail: { accounts, defaultCustomerId, requiredSelection, mountEl: gaAccountsMount }
          }));

          return { ok: true, accounts, defaultCustomerId, requiredSelection };
        }

        setStatus('');
        hide(gaAccountsMount);

        window.dispatchEvent(new CustomEvent('googleAccountsLoaded', {
          detail: { accounts, defaultCustomerId, requiredSelection, mountEl: gaAccountsMount }
        }));

        const cid = defaultCustomerId || accounts[0]?.id || null;
        if (!cid) {
          setStatus('No encontramos un ID de cuenta válido para Google Ads.');
          return { ok: false, accounts, defaultCustomerId: null, requiredSelection };
        }

        const ok = await runGoogleSelfTest(cid);
        if (ok) {
          setStatus('');
          markGoogleConnected(sessionStorage.getItem('googleObjective') || null);
          return { ok: true, accounts, defaultCustomerId, requiredSelection };
        }

        setStatus(
          'No pudimos validar el acceso a tu cuenta de Google Ads. ' +
          'Verifica que tu usuario tenga permisos y vuelve a intentar.'
        );
        return { ok: false, accounts, defaultCustomerId, requiredSelection };
      } catch (e) {
        console.error('ensureGoogleAccountsUI error:', e);
        setStatus('No pudimos cargar tus cuentas de Google Ads. Intenta nuevamente.');
        hide(gaAccountsMount);
        return { ok: false, accounts: [], defaultCustomerId: null, requiredSelection: false };
      }
    })();

    const result = await GA_ENSURE_INFLIGHT;
    GA_ENSURE_INFLIGHT = null;
    return result;
  }

  // Evento disparado desde onboardingInlineSelect.js cuando el usuario elige cuentas
  window.addEventListener('googleAccountsSelected', async (ev) => {
    const reqId = ev?.detail?.reqId || null;

    try {
      const ids = (ev?.detail?.accountIds || []).map(String).filter(Boolean);
      if (!ids.length) {
        ackGoogleAdsSelection({ reqId, ok: false, error: 'EMPTY_SELECTION', ids: [] });
        return;
      }

      const idsKey = ids.slice().sort().join(',');

      // Si ya estamos procesando exactamente lo mismo, no duplicamos
      if (GOOGLE_SELECTION_LOCK.inflight && GOOGLE_SELECTION_LOCK.lastIdsKey === idsKey) {
        ackGoogleAdsSelection({ reqId, ok: true, error: null, ids });
        return;
      }

      // Si recibimos el mismo reqId otra vez, ignore
      if (reqId && GOOGLE_SELECTION_LOCK.lastReqId === reqId) {
        ackGoogleAdsSelection({ reqId, ok: true, error: null, ids });
        return;
      }

      GOOGLE_SELECTION_LOCK.inflight = true;
      GOOGLE_SELECTION_LOCK.lastReqId = reqId || null;
      GOOGLE_SELECTION_LOCK.lastIdsKey = idsKey;

      const save = await apiFetch('/api/google/ads/insights/accounts/selection', {
        method: 'POST',
        body: JSON.stringify({ accountIds: ids }),
      });

      if (!save?.ok) {
        const msg = save?.error || 'NO_SE_PUDO_GUARDAR_SELECCION';
        ackGoogleAdsSelection({ reqId, ok: false, error: msg, ids });
        alert(save?.error || 'No se pudo guardar la selección.');
        return;
      }

      // ✅ Persistido: ACK al modal
      ackGoogleAdsSelection({ reqId, ok: true, error: null, ids });

      // ✅ Tracking (safe) — selección guardada
      px.gtag('event', 'google_ads_account_selected', { count: ids.length });
      px.fbq('trackCustom', 'GoogleAdsAccountSelected', { count: ids.length });
      px.clarityEvent('google_ads_account_selected');

      // ✅ Aviso global: “selección guardada” (SIN duplicar)
      dispatchAccountsSelectionSaved('google-selection-persisted');

      // Self-test para marcar Google como realmente conectado
      setStatus('');
      const ok = await runGoogleSelfTest(ids[0]);
      if (ok) {
        markGoogleConnected(sessionStorage.getItem('googleObjective') || null);
        setStatus('');
      } else {
        // Persistido pero no validado: NO marcamos googleConnected
      }
    } catch (e) {
      console.error('save selection error:', e);
      ackGoogleAdsSelection({
        reqId,
        ok: false,
        error: e?.message || 'SAVE_SELECTION_ERROR',
        ids: (ev?.detail?.accountIds || []).map(String),
      });
      alert('Error al guardar la selección. Intenta nuevamente.');
    } finally {
      GOOGLE_SELECTION_LOCK.inflight = false;

      // Si alguien quiso emitir el evento mientras estábamos guardando, lo emitimos ahora
      if (GOOGLE_SELECTION_LOCK.pendingEmitSelectionSaved) {
        GOOGLE_SELECTION_LOCK.pendingEmitSelectionSaved = false;
        dispatchAccountsSelectionSaved('queued-after-google-selection');
      }
    }
  });

  async function fetchGoogleStatus() {
    try {
      const st = await apiFetch(GOOGLE_STATUS_URL);
      if (st && typeof st.connected === 'boolean') {
        return { connected: !!st.connected, objective: st.objective ?? null };
      }
      return { connected: false, objective: null };
    } catch {
      try {
        const s = await apiFetch('/api/session');
        return {
          connected: !!(s?.authenticated && s?.user?.googleConnected),
          objective: s?.user?.googleObjective || null,
        };
      } catch {
        return { connected: false, objective: null };
      }
    }
  }

  async function refreshGoogleUI() {
    const st = await fetchGoogleStatus();

    if (st.connected && !st.objective) {
      openGoogleCloseMeta();
    } else if (st.connected && st.objective) {
      hide(googleObjectiveStep);
    }

    if (st.connected) {
      await ensureGoogleAccountsUI();
    }
    return st;
  }

  connectGoogleBtn?.addEventListener('click', () => {
    // ✅ Tracking (safe) — intento de conexión
    px.gtag('event', 'connect_platform_click', { platform: 'google' });
    px.fbq('trackCustom', 'ConnectGoogleClick');
    px.clarityEvent('connect_google_click');

    localStorage.setItem('google_connecting', '1');
    disableBtnWhileConnecting(connectGoogleBtn);
    window.location.href = '/auth/google/connect';
  });

  saveGoogleObjective?.addEventListener('click', async () => {
    const selected = (document.querySelector('input[name="googleObjective"]:checked') || {}).value;
    if (!selected) return alert('Selecciona un objetivo');
    try {
      const r = await apiFetch(GOOGLE_OBJECTIVE_URL, {
        method: 'POST',
        body: JSON.stringify({ objective: selected }),
      });
      if (r?.ok === false) throw new Error(r?.error || 'No se pudo guardar el objetivo');

      hide(googleObjectiveStep);
      sessionStorage.setItem('googleObjective', selected);

      // ✅ Tracking (safe)
      px.gtag('event', 'select_objective', { platform: 'google', objective: selected });
      px.fbq('trackCustom', 'SelectObjectiveGoogle', { objective: selected });
      px.clarityEvent('select_objective_google');

      await ensureGoogleAccountsUI();
    } catch (e) {
      console.error(e);
      alert('No se pudo guardar el objetivo. Inténtalo nuevamente.');
    }
  });

  async function pollGoogleUntilConnected(maxTries = 30, delayMs = 2000) {
    for (let i = 0; i < maxTries; i++) {
      const st = await fetchGoogleStatus();
      if (st.connected) {
        localStorage.removeItem('google_connecting');
        if (!st.objective) openGoogleCloseMeta();
        else { hide(googleObjectiveStep); }
        await ensureGoogleAccountsUI();
        return;
      }
      await new Promise((r) => setTimeout(r, delayMs));
    }
    localStorage.removeItem('google_connecting');
    enableBtn(connectGoogleBtn);
  }

  // -------------------------------------------------
  // Sesión (demo GA) + limpieza de estado si cambia usuario
  // -------------------------------------------------
  try {
    const prevUserId = sessionStorage.getItem('userId');
    const sess = await apiFetch('/api/session');
    if (sess?.authenticated && sess?.user) {
      const currentId = String(sess.user._id);

      if (prevUserId && prevUserId !== currentId) {
        [
          'shopifyConnected',
          'googleConnected',
          'metaConnected',
          'shop',
          'accessToken',
          'metaObjective',
          'googleObjective'
        ].forEach((k) => sessionStorage.removeItem(k));
      }

      sessionStorage.setItem('userId',  currentId);
      sessionStorage.setItem('email',   sess.user.email);

      if (sess.user.googleConnected) {
        gaPanel?.classList?.remove('hidden');
        sessionStorage.setItem('googleOAuth', 'true');
      } else {
        gaPanel?.classList?.add('hidden');
      }
    }
  } catch (err) {
    console.warn('No se pudo obtener /api/session:', err);
  }

  // Ping de salud (silencioso)
  try { await apiFetch('/api/saas/ping'); } catch {}

  // -------------------------------------------------
  // Shopify domain helper (autoprefill si venimos con ?shop= o guardado)
  // -------------------------------------------------
  const savedShop = sessionStorage.getItem('shopDomain');
  if (shopFromQuery || savedShop) {
    domainStep?.classList.remove('step--hidden');
    if (domainInput) {
      domainInput.value = shopFromQuery || savedShop;
      domainInput.focus();
    }
    if (savedShop) sessionStorage.removeItem('shopDomain');
  }

  // -------------------------------------------------
  // Refrescar UIs + habilitar continuar
  // -------------------------------------------------
  await Promise.allSettled([
    _hasGoogleParam ? Promise.resolve() : refreshGoogleUI(),
    refreshMetaUI()
  ]);
  habilitarContinue();

  // -------------------------------------------------
  // Manejo de retorno por query (?meta|?google)
  // -------------------------------------------------
  const metaParam   = (qs.get('meta')   || '').toLowerCase();
  const googleParam = _googleParam;

  if (metaParam === 'error' || metaParam === 'fail') {
    localStorage.removeItem('meta_connecting');
    enableBtn(connectMetaBtn);
  } else if (metaParam === 'connected' || metaParam === 'ok') {
    localStorage.removeItem('meta_connecting');
    await refreshMetaUI();
  }

  if (googleParam === 'error' || googleParam === 'fail') {
    localStorage.removeItem('google_connecting');
    enableBtn(connectGoogleBtn);
  } else if (googleParam === 'connected' || googleParam === 'ok') {
    localStorage.removeItem('google_connecting');
    await refreshGoogleUI();
  }

  // Polling si quedaron “conectando…”
  if (localStorage.getItem('meta_connecting') === '1' &&
      sessionStorage.getItem('metaConnected') !== 'true') {
    pollMetaUntilConnected();
  }
  if (localStorage.getItem('google_connecting') === '1' &&
      sessionStorage.getItem('googleConnected') !== 'true') {
    pollGoogleUntilConnected();
  }

  // -------------------------------------------------
  // Continuar → siguiente paso (anti doble click + feedback)
  // -------------------------------------------------
  continueBtn?.addEventListener('click', () => {
    const { anyConnected } = getConnectivityState();
    if (!anyConnected) {
      alert('⚠️ Conecta al menos una plataforma (Shopify, Google o Meta) para continuar.');
      return;
    }

    // Anti double-click (safe)
    if (continueBtn.dataset.busy === '1') return;
    continueBtn.dataset.busy = '1';
    try {
      continueBtn.style.opacity = '0.9';
      continueBtn.textContent = 'Continuando…';
      continueBtn.disabled = true;
      continueBtn.style.pointerEvents = 'none';
    } catch {}

    // ✅ Tracking (safe) — Step1 completo
    px.gtag('event', 'onboarding_step_complete', { step: 1, page: 'onboarding' });
    px.fbq('trackCustom', 'OnboardingStepComplete', { step: 1 });
    px.clarityEvent('onboarding_step1_complete');

    // Si aún no se marcó Lead por conexión, lo marcamos aquí
    px.leadOnce('continue_step1');

    window.location.href = '/onboarding2.html#step=2';
  });

  // -------------------------------------------------
  // DEMO GA
  // -------------------------------------------------
  gaBtn?.addEventListener('click', async () => {
    const raw = gaIn?.value?.trim();
    if (!raw) return alert('Ingresa el GA4 Property ID.');
    const propertyId = raw.startsWith('properties/') ? raw : `properties/${raw}`;
    if (gaOut) gaOut.textContent = 'Ejecutando…';

    gaBtn.disabled = true;
    try {
      const r = await fetch('/auth/google/ga/demo-create-conversion', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ propertyId }),
      });
      const data = await r.json();
      if (gaOut) gaOut.textContent = JSON.stringify(data, null, 2);
      if (data.ok) alert('✅ Conversión creada: ' + (data.created?.name || ''));
      else alert('❌ ' + (data.error?.message || data.error || 'Error'));
    } catch (e) {
      if (gaOut) gaOut.textContent = e.message;
      alert('❌ Error: ' + e.message);
    } finally {
      gaBtn.disabled = false;
    }
  });
});
