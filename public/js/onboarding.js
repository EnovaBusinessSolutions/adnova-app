// public/js/onboarding.js
import { apiFetch } from './apiFetch.saas.js';

document.addEventListener('DOMContentLoaded', async () => {
  const qs = new URLSearchParams(location.search);

  // --- token de sesión opcional (si viene en la URL) ---
  const sessionToken = qs.get('sessionToken');
  if (sessionToken) sessionStorage.setItem('sessionToken', sessionToken);

  // --- info de Shopify opcional desde query ---
  const shopFromQuery = qs.get('shop');
  const hostFromQuery = qs.get('host');

  /* /////////////////////////////////////////////////////////////////////////
   * Selectores de la vista
   * /////////////////////////////////////////////////////////////////////// */
  const connectShopifyBtn = document.getElementById('connect-shopify-btn');
  const connectGoogleBtn  = document.getElementById('connect-google-btn');
  const connectMetaBtn    = document.getElementById('connect-meta-btn');
  const continueBtn       = document.getElementById('continue-btn');

  const flagShopify = document.getElementById('shopifyConnectedFlag'); // "true" si ya estabas conectado (server-side render)
  const flagGoogle  = document.getElementById('googleConnectedFlag');  // legado/UI antigua; no se usa para lógica principal

  // Paso alterno para empatar una tienda existente
  const domainStep  = document.getElementById('shopify-domain-step');
  const domainInput = document.getElementById('shop-domain-input');
  const domainSend  = document.getElementById('shop-domain-send');

  // Panel de prueba GA (opcional)
  const gaPanel = document.getElementById('ga-edit-test');
  const gaBtn   = document.getElementById('ga-create-demo-btn');
  const gaIn    = document.getElementById('ga-property-id');
  const gaOut   = document.getElementById('ga-demo-output');

  /* -----------------------------
   * Bloques de objetivo Meta/Google
   * ----------------------------- */
  // META — backend nuevo
  const metaObjectiveStep  = document.getElementById('meta-objective-step');
  const saveMetaObjective  = document.getElementById('save-meta-objective-btn');
  const META_STATUS_URL    = '/api/meta/accounts/status';
  const META_OBJECTIVE_URL = '/api/meta/accounts/objective';

  // GOOGLE — backend nuevo
  const googleObjectiveStep  = document.getElementById('google-objective-step');
  const saveGoogleObjective  = document.getElementById('save-google-objective-btn');
  const GOOGLE_STATUS_URL    = '/auth/google/status';
  const GOOGLE_OBJECTIVE_URL = '/auth/google/objective';

  /* /////////////////////////////////////////////////////////////////////////
   * Helpers UI
   * /////////////////////////////////////////////////////////////////////// */
  const show  = (el) => el && (el.style.display = 'block');
  const hide  = (el) => el && (el.style.display = 'none');

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

  // Abrir un objetivo cierra el otro (para no saturar la UI)
  const openGoogleCloseMeta = () => { show(googleObjectiveStep); hide(metaObjectiveStep); };
  const openMetaCloseGoogle = () => { show(metaObjectiveStep);  hide(googleObjectiveStep); };

  /* /////////////////////////////////////////////////////////////////////////
   * Estado global / botón "Continuar"
   * /////////////////////////////////////////////////////////////////////// */
  function getConnectivityState() {
    const shopConnected =
      flagShopify?.textContent.trim() === 'true' ||
      sessionStorage.getItem('shopifyConnected') === 'true' ||
      (!!sessionStorage.getItem('shop') && !!sessionStorage.getItem('accessToken'));

    // Consideramos Google o Meta "conectados" SÓLO cuando ya guardaron objetivo
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

  /* /////////////////////////////////////////////////////////////////////////
   * Shopify
   * /////////////////////////////////////////////////////////////////////// */
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

  // Si el server nos pintó que ya estaba conectado, marcamos UI
  if (flagShopify?.textContent.trim() === 'true') await pintarShopifyConectado();

  // Botón conectar Shopify
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

  // Empatar tienda existente mediante dominio
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

  /* /////////////////////////////////////////////////////////////////////////
   * Meta: estado, objetivo y flujo
   * /////////////////////////////////////////////////////////////////////// */
  const markMetaConnected = (objective = null) => {
    setBtnConnected(connectMetaBtn);
    sessionStorage.setItem('metaConnected', 'true');
    if (objective) sessionStorage.setItem('metaObjective', objective);
    habilitarContinue();
  };

  async function fetchMetaStatus() {
    try {
      const r = await apiFetch(META_STATUS_URL);
      if (r && r.ok !== false) {
        return { connected: !!r.connected, objective: r.objective ?? null };
      }
      return { connected: false, objective: null };
    } catch {
      // Fallback suave a /api/session
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
    const st = await fetchMetaStatus(); // {connected, objective}
    if (st.connected && !st.objective) {
      openMetaCloseGoogle();
    } else if (st.connected && st.objective) {
      hide(metaObjectiveStep);
      markMetaConnected(st.objective);
    }
    return st;
  }

  // Click conectar Meta
  connectMetaBtn?.addEventListener('click', () => {
    localStorage.setItem('meta_connecting', '1');
    disableBtnWhileConnecting(connectMetaBtn);
    if (connectMetaBtn.tagName !== 'A') {
      window.location.href = '/auth/meta/login';
    }
  });

  // Guardar objetivo Meta
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

  // Poll Meta (si veníamos conectando en otra ventana)
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

  /* /////////////////////////////////////////////////////////////////////////
   * Google: estado, objetivo y flujo
   * /////////////////////////////////////////////////////////////////////// */
  const markGoogleConnected = (objective = null) => {
    setBtnConnected(connectGoogleBtn);
    sessionStorage.setItem('googleConnected', 'true');
    if (objective) sessionStorage.setItem('googleObjective', objective);
    habilitarContinue();
  };

  async function fetchGoogleStatus() {
    try {
      const st = await apiFetch(GOOGLE_STATUS_URL);
      // Esperamos { connected: boolean, objective?: string|null }
      if (st && typeof st.connected === 'boolean') {
        return { connected: !!st.connected, objective: st.objective ?? null };
      }
      return { connected: false, objective: null };
    } catch {
      // Fallback a /api/session
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
    return st;
  }

  // Click conectar Google
  connectGoogleBtn?.addEventListener('click', () => {
    localStorage.setItem('google_connecting', '1');
    disableBtnWhileConnecting(connectGoogleBtn);
    window.location.href = '/auth/google/connect';
  });

  // Guardar objetivo Google
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
    } catch (e) {
      console.error(e);
      alert('No se pudo guardar el objetivo. Inténtalo nuevamente.');
    }
  });

  // Poll Google (si veníamos conectando en otra ventana)
  async function pollGoogleUntilConnected(maxTries = 30, delayMs = 2000) {
    for (let i = 0; i < maxTries; i++) {
      const st = await fetchGoogleStatus();
      if (st.connected) {
        localStorage.removeItem('google_connecting');
        if (!st.objective) openGoogleCloseMeta();
        else { hide(googleObjectiveStep); markGoogleConnected(st.objective); }
        return;
      }
      await new Promise((r) => setTimeout(r, delayMs));
    }
    localStorage.removeItem('google_connecting');
    enableBtn(connectGoogleBtn);
  }

  /* /////////////////////////////////////////////////////////////////////////
   * Carga de sesión + ping
   * /////////////////////////////////////////////////////////////////////// */
  try {
    const sess = await apiFetch('/api/session');
    if (sess?.authenticated && sess?.user) {
      sessionStorage.setItem('userId',  sess.user._id);
      sessionStorage.setItem('email',   sess.user.email);

      // Muestra/oculta el panel de demo GA (no afecta "Continuar")
      if (sess.user.googleConnected) {
        gaPanel?.classList.remove('hidden');
        sessionStorage.setItem('googleOAuth', 'true');
      } else {
        gaPanel?.classList.add('hidden');
      }
    }
  } catch (err) {
    console.warn('No se pudo obtener /api/session:', err);
  }

  try { await apiFetch('/api/saas/ping'); } catch {}

  // Mostrar paso de dominio si viene en query o guardado
  const savedShop = sessionStorage.getItem('shopDomain');
  if (shopFromQuery || savedShop) {
    domainStep?.classList.remove('step--hidden');
    if (domainInput) {
      domainInput.value = shopFromQuery || savedShop;
      domainInput.focus();
    }
    if (savedShop) sessionStorage.removeItem('shopDomain');
  }

  /* /////////////////////////////////////////////////////////////////////////
   * Sincronización inicial GLOBAL
   * /////////////////////////////////////////////////////////////////////// */
  await Promise.allSettled([ refreshGoogleUI(), refreshMetaUI() ]);
  habilitarContinue();

  // Manejo de query params (ok/error/connected) + limpiar estado de "connecting"
  const metaParam   = (qs.get('meta')   || '').toLowerCase();
  const googleParam = (qs.get('google') || '').toLowerCase();

  // --- META ---
  if (metaParam === 'error' || metaParam === 'fail') {
    localStorage.removeItem('meta_connecting');
    enableBtn(connectMetaBtn);
  } else if (metaParam === 'connected' || metaParam === 'ok') {
    localStorage.removeItem('meta_connecting');
    await refreshMetaUI();
  }

  // --- GOOGLE ---
  if (googleParam === 'error' || googleParam === 'fail') {
    localStorage.removeItem('google_connecting');
    enableBtn(connectGoogleBtn);
  } else if (googleParam === 'connected' || googleParam === 'ok') {
    localStorage.removeItem('google_connecting');
    await refreshGoogleUI();
  }

  // Polls si el usuario dejó abierta la ventana de conexión
  if (localStorage.getItem('meta_connecting') === '1' &&
      sessionStorage.getItem('metaConnected') !== 'true') {
    pollMetaUntilConnected();
  }
  if (localStorage.getItem('google_connecting') === '1' &&
      sessionStorage.getItem('googleConnected') !== 'true') {
    pollGoogleUntilConnected();
  }

  /* /////////////////////////////////////////////////////////////////////////
   * Continuar
   * /////////////////////////////////////////////////////////////////////// */
  continueBtn?.addEventListener('click', () => {
    const { anyConnected } = getConnectivityState();
    if (!anyConnected) {
      alert('⚠️ Conecta al menos una plataforma (Shopify, Google o Meta) para continuar.');
      return;
    }
    window.location.href = '/onboarding2.html#step=2';
  });

  /* /////////////////////////////////////////////////////////////////////////
   * Demo GA (opcional)
   * /////////////////////////////////////////////////////////////////////// */
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
