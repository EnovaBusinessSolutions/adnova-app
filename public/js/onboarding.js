// public/js/onboarding.js
import { apiFetch } from './apiFetch.saas.js';

document.addEventListener('DOMContentLoaded', async () => {
  const qs = new URL(location.href).searchParams;

  // -------------------------------------------------
  // Session token (embebido Shopify -> SAAS)
  // -------------------------------------------------
  const sessionToken = qs.get('sessionToken');
  if (sessionToken) sessionStorage.setItem('sessionToken', sessionToken);

  // Parámetros potenciales de Shopify embebido
  const shopFromQuery = qs.get('shop');
  const hostFromQuery = qs.get('host');

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

  // NUEVO: contenedores de estado/selector
  const gaStatusBox      = document.getElementById('ga-ads-status');
  const gaAccountsMount  = document.getElementById('ga-ads-accounts');

  // NUEVO: panel MCC (ids del HTML nuevo — sin detalles técnicos)
  const mccHelpPanel     = document.getElementById('google-mcc-help');
  const mccStatusPill    = document.getElementById('mcc-status-pill');
  const mccReasonEl      = document.getElementById('mcc-help-reason');
  const mccRetryBtn      = document.getElementById('mcc-retry-btn');
  const mccVerifyBtn     = document.getElementById('mcc-verify-btn');

  // -------------------------------------------------
  // Utils UI
  // -------------------------------------------------
  const show = (el) => { if (!el) return; el.classList.remove('hidden'); el.style.display = ''; el.setAttribute('aria-hidden','false'); };
  const hide = (el) => { if (!el) return; el.classList.add('hidden');  el.style.display = 'none'; el.setAttribute('aria-hidden','true'); };

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
    if (html) show(gaStatusBox); else hide(gaStatusBox);
  };

  // Pill de estado del panel MCC
  function setMccPill(kind = 'warn', text = 'Revisión requerida') {
    if (!mccStatusPill) return;
    mccStatusPill.classList.remove('pill--ok','pill--warn','pill--error');
    mccStatusPill.classList.add(kind === 'ok' ? 'pill--ok' : kind === 'error' ? 'pill--error' : 'pill--warn');
    mccStatusPill.textContent = text;
  }
  function setMccReason(text) {
    if (mccReasonEl) mccReasonEl.textContent = text || '';
  }
  // (No-op: ya no mostramos detalles técnicos)
  function setMccLog(_) {}

  const openGoogleCloseMeta = () => { show(googleObjectiveStep); hide(metaObjectiveStep); };
  const openMetaCloseGoogle = () => { show(metaObjectiveStep);  hide(googleObjectiveStep); };

  // -------------------------------------------------
  // Estado de conectividad (basado en sessionStorage + flags)
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

  // Reacciona si otro script (onboardingInlineSelect.js) ajusta sessionStorage
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
      return habilitarContinue();
    }

    try {
      const resp = await apiFetch(`/api/shopConnection/me?shop=${encodeURIComponent(shop)}`);
      if (resp?.shop && resp?.accessToken) {
        sessionStorage.setItem('shop', resp.shop);
        sessionStorage.setItem('accessToken', resp.accessToken);
      }
      sessionStorage.setItem('shopifyConnected', 'true');
      habilitarContinue();
    } catch (err) {
      console.error('Error obteniendo shop/accessToken:', err);
    }
  };

  if (flagShopify?.textContent.trim() === 'true') await pintarShopifyConectado();

  connectShopifyBtn?.addEventListener('click', () => {
    let shop = shopFromQuery;
    let host = hostFromQuery;

    if (!shop || !host) {
      shop = prompt('Ingresa tu dominio (ej: mitienda.myshopify.com):');
      if (!shop?.endsWith('.myshopify.com')) return alert('Dominio inválido');
      host = btoa(`${shop}/admin`);
    }
    location.href = `/connector?shop=${encodeURIComponent(shop)}&host=${encodeURIComponent(host)}`;
  });

  domainSend?.addEventListener('click', async () => {
    const shop = domainInput?.value?.trim().toLowerCase();
    if (!shop || !shop.endsWith('.myshopify.com')) return alert('Dominio inválido');
    try {
      const data = await apiFetch('/api/saas/shopify/match', {
        method: 'POST',
        body: JSON.stringify({ shop }),
      });
      if (data.ok) {
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
    if (connectMetaBtn.tagName !== 'A') {
      window.location.href = '/auth/meta/login';
    }
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
  // Google — flujo cuentas + self-test + fallback MCC
  // -------------------------------------------------
  const markGoogleConnected = (objective = null) => {
    setBtnConnected(connectGoogleBtn);
    sessionStorage.setItem('googleConnected', 'true');
    if (objective) sessionStorage.setItem('googleObjective', objective);
    habilitarContinue();
    window.dispatchEvent(new CustomEvent('adnova:accounts-selection-saved'));
  };

 // Carga cuentas y dispara evento para que onboardingInlineSelect.js pinte la UI
async function ensureGoogleAccountsUI() {
  try {
    setStatus('Buscando tus cuentas de Google Ads…');
    hide(mccHelpPanel);
    setMccLog(null);
    // 👇 No mostramos el mount todavía; solo si se requiere selección
    hide(gaAccountsMount);

    const res = await apiFetch('/api/google/ads/insights/accounts');

    // Error de discovery → mostramos panel MCC
    if (res?.ok === false && res?.error === 'DISCOVERY_ERROR') {
      setStatus('Tuvimos un problema al descubrir tus cuentas.');
      show(mccHelpPanel);
      setMccPill('warn', 'Revisión requerida');
      setMccReason('Si ya aceptaste la invitación de administrador, pulsa “Ya acepté, verificar”.');
      setMccLog(res.apiLog || res.reason || res);
      return { ok: false, accounts: [] };
    }

    const accounts = Array.isArray(res?.accounts) ? res.accounts : [];
    const defaultCustomerId = res?.defaultCustomerId || null;
    const requiredSelection = !!res?.requiredSelection;

    // Sin cuentas todavía
    if (accounts.length === 0) {
      setStatus('No encontramos cuentas accesibles todavía. Si acabas de conectar, intenta nuevamente en un minuto.');
      hide(gaAccountsMount);
      return { ok: true, accounts, defaultCustomerId, requiredSelection };
    }

    // Si hay >3 cuentas → mostrar mensaje + inline selector/modal
    if (requiredSelection) {
      setStatus('Selecciona hasta 3 cuentas para continuar.');
      show(gaAccountsMount);

      // Notifica al otro script para que renderice el selector
      window.dispatchEvent(new CustomEvent('googleAccountsLoaded', {
        detail: {
          accounts,
          defaultCustomerId,
          requiredSelection,
          mountEl: gaAccountsMount
        }
      }));

      return { ok: true, accounts, defaultCustomerId, requiredSelection };
    }

    // 1–2 cuentas → UX limpia (como antes): sin banners ni selector
    setStatus('');
    hide(gaAccountsMount);

    // Consideramos conectado y habilitamos continuar
    markGoogleConnected(sessionStorage.getItem('googleObjective') || null);

    // Igual notificamos por si algún listener necesita los datos (no pinta UI)
    window.dispatchEvent(new CustomEvent('googleAccountsLoaded', {
      detail: {
        accounts,
        defaultCustomerId,
        requiredSelection,
        mountEl: gaAccountsMount
      }
    }));

    return { ok: true, accounts, defaultCustomerId, requiredSelection };
  } catch (e) {
    console.error('ensureGoogleAccountsUI error:', e);
    setStatus('No pudimos cargar tus cuentas. Intenta nuevamente.');
    hide(gaAccountsMount);
    return { ok: false, accounts: [] };
  }
}

  // Self-test: intenta un GAQL mínimo; en error muestra panel MCC
  async function runGoogleSelfTest(optionalCid = null) {
    try {
      const url = optionalCid
        ? `/api/google/ads/insights/selftest?customer_id=${encodeURIComponent(optionalCid)}`
        : `/api/google/ads/insights/selftest`;
      const r = await apiFetch(url);
      if (r?.ok) {
        setStatus('Conexión validada correctamente.');
        setMccPill('ok','Validado');
        setMccReason('');
        hide(mccHelpPanel);
        return true;
      }
      show(mccHelpPanel);
      setMccPill('warn','Revisión requerida');
      setMccReason('Necesitamos que aceptes la invitación de administrador (si ya la enviamos) o que verifiques el acceso y reintentes.');
      setMccLog(r?.apiLog || r?.detail || r);
      return false;
    } catch (e) {
      show(mccHelpPanel);
      setMccPill('error','Error');
      setMccReason('No pudimos ejecutar la verificación. Intenta nuevamente.');
      setMccLog(e?.message || String(e));
      return false;
    }
  }

  // Escucha selección desde onboardingInlineSelect.js y guarda en backend
  window.addEventListener('googleAccountsSelected', async (ev) => {
    try {
      const ids = (ev?.detail?.accountIds || []).map(String);
      if (!ids.length) return;

      const save = await apiFetch('/api/google/ads/insights/accounts/selection', {
        method: 'POST',
        body: JSON.stringify({ accountIds: ids }),
      });

      if (save?.ok) {
        sessionStorage.setItem('googleConnected', 'true');
        markGoogleConnected(sessionStorage.getItem('googleObjective') || null);
        setStatus('Selección guardada. Listo para continuar.');
        // Autoverificación rápida
        await runGoogleSelfTest(ids[0]);
        window.dispatchEvent(new CustomEvent('adnova:accounts-selection-saved'));
      } else {
        alert(save?.error || 'No se pudo guardar la selección.');
      }
    } catch (e) {
      console.error('save selection error:', e);
      alert('Error al guardar la selección. Intenta nuevamente.');
    }
  });

  // Botones del panel MCC
  mccRetryBtn?.addEventListener('click', async () => {
    setStatus('Reintentando…');
    await ensureGoogleAccountsUI();
  });
  mccVerifyBtn?.addEventListener('click', async () => {
    setStatus('Verificando acceso…');
    await ensureGoogleAccountsUI(); // por si ya aceptaron
    await runGoogleSelfTest();
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
      markGoogleConnected(st.objective);
    }
    if (st.connected) {
      await ensureGoogleAccountsUI();
    }
    return st;
  }

  connectGoogleBtn?.addEventListener('click', () => {
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
      markGoogleConnected(selected);
      await ensureGoogleAccountsUI();
      await runGoogleSelfTest();
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
        else { hide(googleObjectiveStep); markGoogleConnected(st.objective); }
        await ensureGoogleAccountsUI();
        return;
      }
      await new Promise((r) => setTimeout(r, delayMs));
    }
    localStorage.removeItem('google_connecting');
    enableBtn(connectGoogleBtn);
  }

  // -------------------------------------------------
  // Sesión (para tu sección demo GA)
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
  // Shopify domain helper (si viene por query o guardado)
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
  // Refrescar UIs de Google/Meta, habilitar continuar
  // -------------------------------------------------
  await Promise.allSettled([ refreshGoogleUI(), refreshMetaUI() ]);
  habilitarContinue();

  // -------------------------------------------------
  // Manejo de retorno por query (?meta|?google)
  // -------------------------------------------------
  const metaParam   = (qs.get('meta')   || '').toLowerCase();
  const googleParam = (qs.get('google') || '').toLowerCase();

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

  // Si quedaron “conectando…” activos, hacemos polling
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
  // DEMO GA (sin cambios en lógica)
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
