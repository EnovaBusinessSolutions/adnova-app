// public/js/onboarding.js
import { apiFetch } from './apiFetch.saas.js';

document.addEventListener('DOMContentLoaded', async () => {
  const qs = new URLSearchParams(location.search);
  const sessionToken = qs.get('sessionToken');
  if (sessionToken) sessionStorage.setItem('sessionToken', sessionToken);

  const shopFromQuery = qs.get('shop');
  const hostFromQuery = qs.get('host');

  /* -----------------------------
   * Selectores
   * ----------------------------- */
  const connectShopifyBtn = document.getElementById('connect-shopify-btn');
  const connectGoogleBtn  = document.getElementById('connect-google-btn');
  const connectMetaBtn    = document.getElementById('connect-meta-btn');
  const continueBtn       = document.getElementById('continue-btn');

  const flagShopify = document.getElementById('shopifyConnectedFlag'); // sólo UI Shopify
  const flagGoogle  = document.getElementById('googleConnectedFlag');  // sólo UI GA (NO se usa para "Continuar")

  const domainStep  = document.getElementById('shopify-domain-step');
  const domainInput = document.getElementById('shop-domain-input');
  const domainSend  = document.getElementById('shop-domain-send');

  const gaPanel = document.getElementById('ga-edit-test');
  const gaBtn   = document.getElementById('ga-create-demo-btn');
  const gaIn    = document.getElementById('ga-property-id');
  const gaOut   = document.getElementById('ga-demo-output');

  /* -----------------------------
   * Bloques de objetivo (Meta/Google)
   * ----------------------------- */
  // META
  const metaObjectiveStep  = document.getElementById('meta-objective-step');
  const saveMetaObjective  = document.getElementById('save-meta-objective-btn');
  const META_STATUS_URL    = '/auth/meta/status';
  const META_OBJECTIVE_URL = '/auth/meta/objective';

  // GOOGLE
  const googleObjectiveStep  = document.getElementById('google-objective-step');
  const saveGoogleObjective  = document.getElementById('save-google-objective-btn');
  const GOOGLE_STATUS_URL    = '/auth/google/status';
  const GOOGLE_OBJECTIVE_URL = '/auth/google/objective';

  /* -----------------------------
   * Helpers
   * ----------------------------- */
  const show = el => el && (el.style.display = 'block');
  const hide = el => el && (el.style.display = 'none');

  function habilitarContinue() {
    if (!continueBtn) return;
    const { anyConnected } = getConnectivityState();
    continueBtn.disabled = !anyConnected;
    continueBtn.classList.toggle('btn-continue--disabled', !anyConnected);
    continueBtn.classList.toggle('btn-continue--enabled',  anyConnected);
    continueBtn.style.pointerEvents = anyConnected ? 'auto' : 'none';
    continueBtn.style.opacity       = anyConnected ? '1'    : '0.6';
  }

  function getConnectivityState() {
    // Shopify: se permite continuar sólo con Shopify conectado,
    // o con Meta/Google conectados + objetivo guardado
    const shopConnected =
      flagShopify?.textContent.trim() === 'true' ||
      sessionStorage.getItem('shopifyConnected') === 'true' ||
      (!!sessionStorage.getItem('shop') && !!sessionStorage.getItem('accessToken'));

    // Google/Meta cuentan como conectados SOLO cuando ya guardaron objetivo
    const googleConnected = sessionStorage.getItem('googleConnected') === 'true';
    const metaConnected   = sessionStorage.getItem('metaConnected')   === 'true';

    return { shopConnected, googleConnected, metaConnected, anyConnected: !!(shopConnected || googleConnected || metaConnected) };
  }

  /* -----------------------------
   * META: estado + UI
   * ----------------------------- */
  const markMetaConnected = (objective = null) => {
    if (!connectMetaBtn) return;
    connectMetaBtn.textContent = 'Conectado';
    connectMetaBtn.classList.add('connected');
    connectMetaBtn.style.pointerEvents = 'none';
    if ('disabled' in connectMetaBtn) connectMetaBtn.disabled = true;
    sessionStorage.setItem('metaConnected', 'true');
    if (objective) sessionStorage.setItem('metaObjective', objective);
    habilitarContinue();
  };

  const showMetaObjectiveStep = () => show(metaObjectiveStep);
  const hideMetaObjectiveStep = () => hide(metaObjectiveStep);

  async function fetchMetaStatus() {
    try {
      const st = await apiFetch(META_STATUS_URL);
      return st || { connected: false, objective: null };
    } catch {
      // fallback suave a /api/session si el endpoint no existiera
      try {
        const s = await apiFetch('/api/session');
        return {
          connected: !!(s?.authenticated && s?.user?.metaConnected),
          objective: s?.user?.metaObjective || null
        };
      } catch {
        return { connected: false, objective: null };
      }
    }
  }

  async function refreshMetaUI() {
    const st = await fetchMetaStatus(); // { connected, objective }
    if (st.connected && !st.objective) {
      showMetaObjectiveStep();
    } else if (st.connected && st.objective) {
      hideMetaObjectiveStep();
      markMetaConnected(st.objective);
    }
    return st;
  }

  /* -----------------------------
   * GOOGLE: estado + UI
   * ----------------------------- */
  const markGoogleConnected = (objective = null) => {
    if (!connectGoogleBtn) return;
    connectGoogleBtn.textContent = 'Conectado';
    connectGoogleBtn.classList.add('connected');
    connectGoogleBtn.disabled = true;
    connectGoogleBtn.style.pointerEvents = 'none';
    // Sólo cuenta cuando ya tiene objetivo
    sessionStorage.setItem('googleConnected', 'true');
    if (objective) sessionStorage.setItem('googleObjective', objective);
    habilitarContinue();
  };

  const showGoogleObjectiveStep = () => show(googleObjectiveStep);
  const hideGoogleObjectiveStep = () => hide(googleObjectiveStep);

  async function fetchGoogleStatus() {
    try {
      const st = await apiFetch(GOOGLE_STATUS_URL);
      return st || { connected: false, objective: null };
    } catch {
      // fallback suave a /api/session (sólo para UI, no para habilitar continuar)
      try {
        const s = await apiFetch('/api/session');
        return {
          connected: !!(s?.authenticated && s?.user?.googleConnected),
          objective: s?.user?.googleObjective || null
        };
      } catch {
        return { connected: false, objective: null };
      }
    }
  }

  async function refreshGoogleUI() {
    const st = await fetchGoogleStatus(); // { connected, objective }
    if (st.connected && !st.objective) {
      showGoogleObjectiveStep();
    } else if (st.connected && st.objective) {
      hideGoogleObjectiveStep();
      markGoogleConnected(st.objective);
    }
    return st;
  }

  /* -----------------------------
   * Sesión (sólo para UI secundaria)
   * ----------------------------- */
  try {
    const sess = await apiFetch('/api/session');
    if (sess?.authenticated && sess?.user) {
      sessionStorage.setItem('userId',  sess.user._id);
      sessionStorage.setItem('email',   sess.user.email);

      // Mostrar u ocultar el panel "GA demo" si el OAuth de Google ya existe
      if (sess.user.googleConnected) {
        gaPanel?.classList.remove('hidden');
        sessionStorage.setItem('googleOAuth', 'true'); // informativo
      } else {
        gaPanel?.classList.add('hidden');
      }
    }
  } catch (err) {
    console.warn('No se pudo obtener /api/session:', err);
  }

  try { await apiFetch('/api/saas/ping'); } catch {}

  /* -----------------------------
   * Shopify: paso dominio si aplica
   * ----------------------------- */
  const savedShop = sessionStorage.getItem('shopDomain');
  if (shopFromQuery || savedShop) {
    domainStep?.classList.remove('step--hidden');
    if (domainInput) {
      domainInput.value = shopFromQuery || savedShop;
      domainInput.focus();
    }
    if (savedShop) sessionStorage.removeItem('shopDomain');
  }

  /* -----------------------------
   * Shopify conectado (UI + credenciales)
   * ----------------------------- */
  const pintarShopifyConectado = async () => {
    if (connectShopifyBtn) {
      connectShopifyBtn.textContent = 'Conectado';
      connectShopifyBtn.classList.add('connected');
      connectShopifyBtn.disabled = true;
    }

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

  // Estados iniciales (Shopify) desde flags
  if (flagShopify?.textContent.trim() === 'true') await pintarShopifyConectado();
  habilitarContinue();

  /* -----------------------------
   * Acciones Shopify
   * ----------------------------- */
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

  /* -----------------------------
   * META: login, estado y objetivo
   * ----------------------------- */
  connectMetaBtn?.addEventListener('click', () => {
    localStorage.setItem('meta_connecting', '1');
    connectMetaBtn.style.pointerEvents = 'none';
    if ('disabled' in connectMetaBtn) connectMetaBtn.disabled = true;
    if (connectMetaBtn.tagName !== 'A') window.location.href = '/auth/meta/login';
  });

  const metaParam = (qs.get('meta') || '').toLowerCase();
  if (metaParam === 'error' || metaParam === 'fail') {
    localStorage.removeItem('meta_connecting');
    if (connectMetaBtn) {
      connectMetaBtn.style.pointerEvents = 'auto';
      if ('disabled' in connectMetaBtn) connectMetaBtn.disabled = false;
    }
  }
  if (metaParam === 'ok') await refreshMetaUI();

  async function pollMetaUntilConnected(maxTries = 30, delayMs = 2000) {
    for (let i = 0; i < maxTries; i++) {
      const st = await fetchMetaStatus();
      if (st.connected) {
        localStorage.removeItem('meta_connecting');
        if (!st.objective) showMetaObjectiveStep();
        else { hideMetaObjectiveStep(); markMetaConnected(st.objective); }
        return;
      }
      await new Promise(r => setTimeout(r, delayMs));
    }
    localStorage.removeItem('meta_connecting');
    if (connectMetaBtn) {
      connectMetaBtn.style.pointerEvents = 'auto';
      if ('disabled' in connectMetaBtn) connectMetaBtn.disabled = false;
    }
  }

  if (localStorage.getItem('meta_connecting') === '1' &&
      sessionStorage.getItem('metaConnected') !== 'true') {
    pollMetaUntilConnected();
  }

  saveMetaObjective?.addEventListener('click', async () => {
    const selected = (document.querySelector('input[name="metaObjective"]:checked') || {}).value;
    if (!selected) return alert('Selecciona un objetivo');
    try {
      await apiFetch(META_OBJECTIVE_URL, {
        method: 'POST',
        body: JSON.stringify({ objective: selected })
      });
      hideMetaObjectiveStep();
      markMetaConnected(selected);
    } catch (e) {
      console.error(e);
      alert('No se pudo guardar el objetivo. Inténtalo nuevamente.');
    }
  });

  /* -----------------------------
   * GOOGLE: login, estado y objetivo
   * ----------------------------- */
  connectGoogleBtn?.addEventListener('click', () => {
    localStorage.setItem('google_connecting', '1');
    connectGoogleBtn.style.pointerEvents = 'none';
    if ('disabled' in connectGoogleBtn) connectGoogleBtn.disabled = true;
    window.location.href = '/auth/google/connect';
  });

  const googleParam = (qs.get('google') || '').toLowerCase();
  if (googleParam === 'error' || googleParam === 'fail') {
    localStorage.removeItem('google_connecting');
    if (connectGoogleBtn) {
      connectGoogleBtn.style.pointerEvents = 'auto';
      if ('disabled' in connectGoogleBtn) connectGoogleBtn.disabled = false;
    }
  }
  if (googleParam === 'ok') await refreshGoogleUI();

  async function pollGoogleUntilConnected(maxTries = 30, delayMs = 2000) {
    for (let i = 0; i < maxTries; i++) {
      const st = await fetchGoogleStatus();
      if (st.connected) {
        localStorage.removeItem('google_connecting');
        if (!st.objective) showGoogleObjectiveStep();
        else { hideGoogleObjectiveStep(); markGoogleConnected(st.objective); }
        return;
      }
      await new Promise(r => setTimeout(r, delayMs));
    }
    localStorage.removeItem('google_connecting');
    if (connectGoogleBtn) {
      connectGoogleBtn.style.pointerEvents = 'auto';
      if ('disabled' in connectGoogleBtn) connectGoogleBtn.disabled = false;
    }
  }

  if (localStorage.getItem('google_connecting') === '1' &&
      sessionStorage.getItem('googleConnected') !== 'true') {
    pollGoogleUntilConnected();
  }

  saveGoogleObjective?.addEventListener('click', async () => {
    const selected = (document.querySelector('input[name="googleObjective"]:checked') || {}).value;
    if (!selected) return alert('Selecciona un objetivo');
    try {
      await apiFetch(GOOGLE_OBJECTIVE_URL, {
        method: 'POST',
        body: JSON.stringify({ objective: selected })
      });
      hideGoogleObjectiveStep();
      markGoogleConnected(selected);
    } catch (e) {
      console.error(e);
      alert('No se pudo guardar el objetivo. Inténtalo nuevamente.');
    }
  });

  /* -----------------------------
   * Inicialización adicional:
   * si el usuario recarga o vuelve sin query params,
   * reflejar estado real de Meta/Google.
   * ----------------------------- */
  await refreshMetaUI();
  await refreshGoogleUI();
  habilitarContinue();

  /* -----------------------------
   * Continuar
   * ----------------------------- */
  continueBtn?.addEventListener('click', () => {
    const { anyConnected } = getConnectivityState();
    if (!anyConnected) {
      alert('⚠️ Conecta al menos una plataforma (Shopify, Google o Meta) para continuar.');
      return;
    }
    window.location.href = '/onboarding2.html#step=2';
  });

  /* -----------------------------
   * GA demo (opcional)
   * ----------------------------- */
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
        body: JSON.stringify({ propertyId })
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
