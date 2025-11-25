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
  const hostFromQuery = qs.get('host'); // (ya no lo usamos, pero lo dejamos por compatibilidad)

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

  // --- GUARD ANTI-DUPLICADO PARA ensureGoogleAccountsUI ---
  let GA_ENSURE_INFLIGHT = null;

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
  };

  const openGoogleCloseMeta = () => { show(googleObjectiveStep); hide(metaObjectiveStep); };
  const openMetaCloseGoogle = () => { show(metaObjectiveStep);  hide(googleObjectiveStep); };

  // -------------------------------------------------
  // Estado de conectividad (sessionStorage + flags)
  // -------------------------------------------------
  function getConnectivityState() {
    const shopConnected =
      flagShopify?.textContent.trim() === 'true' ||
      sessionStorage.getItem('shopifyConnected') === 'true' ||
      (!!sessionStorage.getItem('shop') && !!sessionStorage.getItem('accessToken'));

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
  }

  // Reacciona si otro script ajusta sessionStorage
  window.addEventListener('adnova:accounts-selection-saved', habilitarContinue);
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
    } catch (err) {
      console.error('Error obteniendo shop/accessToken:', err);
    }
  };

  // Si el servidor ya marcó que Shopify está conectado
  if (flagShopify?.textContent.trim() === 'true') await pintarShopifyConectado();

  // Click en "Conectar" → mostrar el paso de dominio (sin redirigir)
  connectShopifyBtn?.addEventListener('click', () => {
    if (domainStep) domainStep.classList.remove('step--hidden');

    // Prefill con lo que sepamos
    const prefill =
      shopFromQuery ||
      sessionStorage.getItem('shop') ||
      sessionStorage.getItem('shopDomain');

    if (domainInput && prefill && !domainInput.value) {
      domainInput.value = prefill;
    }
    domainInput?.focus();
  });

  // Enviar dominio → hace match y marca conectado
  domainSend?.addEventListener('click', async () => {
    const shop = domainInput?.value?.trim().toLowerCase();
    if (!shop || !shop.endsWith('.myshopify.com')) {
      return alert('Dominio inválido. Usa el formato mitienda.myshopify.com');
    }

    // Guardamos por si se recarga la página
    sessionStorage.setItem('shopDomain', shop);

    try {
      const data = await apiFetch('/api/saas/shopify/match', {
        method: 'POST',
        body: JSON.stringify({ shop }),
      });

      if (data.ok) {
        // Si el backend devolviera shop/accessToken, también los guardamos
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
    window.dispatchEvent(new CustomEvent('adnova:accounts-selection-saved'));
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
  // Google — cuentas + self-test (sin MCC)
  // -------------------------------------------------
  const markGoogleConnected = (objective = null) => {
    setBtnConnected(connectGoogleBtn);
    sessionStorage.setItem('googleConnected', 'true');
    if (objective) sessionStorage.setItem('googleObjective', objective);
    habilitarContinue();
    window.dispatchEvent(new CustomEvent('adnova:accounts-selection-saved'));
  };

  async function runGoogleSelfTest(optionalCid = null) {
    try {
      const url = optionalCid
        ? `/api/google/ads/insights/selftest?customer_id=${encodeURIComponent(optionalCid)}`
        : `/api/google/ads/insights/selftest`;
      const r = await apiFetch(url);
      if (r?.ok) {
        // Todo bien: pudimos leer impresiones/clics aunque sean 0.
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
        setStatus('Buscando tus cuentas de Google Ads…');
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
          // Más de 3 cuentas: abrimos selector (ASM)
          setStatus('Selecciona hasta 3 cuentas de Google Ads para continuar.');
          show(gaAccountsMount);

          window.dispatchEvent(new CustomEvent('googleAccountsLoaded', {
            detail: { accounts, defaultCustomerId, requiredSelection, mountEl: gaAccountsMount }
          }));

          return { ok: true, accounts, defaultCustomerId, requiredSelection };
        }

        // Si no requiere selección, usamos la cuenta por defecto y hacemos self-test
        setStatus('Verificando acceso…');
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

        // Self-test falló
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
    try {
      const ids = (ev?.detail?.accountIds || []).map(String);
      if (!ids.length) return;

      const save = await apiFetch('/api/google/ads/insights/accounts/selection', {
        method: 'POST',
        body: JSON.stringify({ accountIds: ids }),
      });

      if (save?.ok) {
        setStatus('Verificando acceso…');
        const ok = await runGoogleSelfTest(ids[0]);

        if (ok) {
          markGoogleConnected(sessionStorage.getItem('googleObjective') || null);
          setStatus('');
        } else {
          setStatus(
            'No pudimos validar el acceso a esa cuenta de Google Ads. ' +
            'Revisa permisos e inténtalo nuevamente.'
          );
        }

        window.dispatchEvent(new CustomEvent('adnova:accounts-selection-saved'));
      } else {
        alert(save?.error || 'No se pudo guardar la selección.');
      }
    } catch (e) {
      console.error('save selection error:', e);
      alert('Error al guardar la selección. Intenta nuevamente.');
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
    localStorage.setItem('google_connecting', '1');
    disableBtnWhileConnecting(connectGoogleBtn);
    // El backend ya pone returnTo=/onboarding?google=connected por defecto
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
  // Sesión (demo GA)
  // -------------------------------------------------
  try {
    const sess = await apiFetch('/api/session');
    if (sess?.authenticated && sess?.user) {
      sessionStorage.setItem('userId',  sess.user._id);
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
  // Continuar → siguiente paso
  // -------------------------------------------------
  continueBtn?.addEventListener('click', () => {
    const { anyConnected } = getConnectivityState();
    if (!anyConnected) {
      alert('⚠️ Conecta al menos una plataforma (Shopify, Google o Meta) para continuar.');
      return;
    }
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
