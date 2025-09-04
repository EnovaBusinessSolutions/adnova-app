// public/js/onboarding.js
import { apiFetch } from './apiFetch.saas.js';

document.addEventListener('DOMContentLoaded', async () => {
  const qs = new URLSearchParams(location.search);
  const sessionToken = qs.get('sessionToken');
  if (sessionToken) sessionStorage.setItem('sessionToken', sessionToken);

  const shopFromQuery = qs.get('shop');
  const hostFromQuery = qs.get('host');

  /* -----------------------------
   * Selectores existentes
   * ----------------------------- */
  const connectShopifyBtn = document.getElementById('connect-shopify-btn');
  const connectGoogleBtn  = document.getElementById('connect-google-btn');
  const connectMetaBtn    = document.getElementById('connect-meta-btn');
  const continueBtn       = document.getElementById('continue-btn');

  const flagShopify = document.getElementById('shopifyConnectedFlag');
  const flagGoogle  = document.getElementById('googleConnectedFlag');

  const domainStep  = document.getElementById('shopify-domain-step');
  const domainInput = document.getElementById('shop-domain-input');
  const domainSend  = document.getElementById('shop-domain-send');

  const gaPanel = document.getElementById('ga-edit-test');
  const gaBtn   = document.getElementById('ga-create-demo-btn');
  const gaIn    = document.getElementById('ga-property-id');
  const gaOut   = document.getElementById('ga-demo-output');

  /* -----------------------------
   * NUEVO: Meta objective (UI)
   * ----------------------------- */
  const metaObjectiveStep = document.getElementById('meta-objective-step');   // contenedor del paso
  const saveMetaObjective = document.getElementById('save-meta-objective-btn'); // botón guardar

  const META_STATUS_URL    = '/auth/meta/status';
  const META_OBJECTIVE_URL = '/auth/meta/objective';

  /* -----------------------------
   * Helpers generales
   * ----------------------------- */
  const show = el => el && (el.style.display = 'block');
  const hide = el => el && (el.style.display = 'none');

  const markMetaConnected = (objective = null) => {
    if (!connectMetaBtn) return;
    connectMetaBtn.textContent = 'Conectado';
    connectMetaBtn.classList.add('connected');
    connectMetaBtn.style.pointerEvents = 'none';
    if ('disabled' in connectMetaBtn) connectMetaBtn.disabled = true;

    // guardamos estado para habilitar "Continuar" y para el dashboard
    sessionStorage.setItem('metaConnected', 'true');
    if (objective) sessionStorage.setItem('metaObjective', objective);
    habilitarContinue();
  };

  const showMetaObjectiveStep = () => show(metaObjectiveStep);
  const hideMetaObjectiveStep = () => hide(metaObjectiveStep);

  async function fetchMetaStatus() {
    // Devuelve { connected:boolean, objective: string|null }
    try {
      const st = await apiFetch(META_STATUS_URL);
      return st || { connected: false, objective: null };
    } catch (_) {
      // fallback a /api/session por si algo falla
      try {
        const s = await apiFetch('/api/session');
        return {
          connected: !!(s?.authenticated && s?.user?.metaConnected),
          objective: s?.user?.metaObjective || null
        };
      } catch (e) {
        return { connected: false, objective: null };
      }
    }
  }

  async function refreshMetaUI() {
    const st = await fetchMetaStatus(); // {connected, objective}
    if (st.connected && !st.objective) {
      // conectado pero no tiene objetivo → mostrar paso
      showMetaObjectiveStep();
      // No marcamos conectado aún (esperamos a guardar objetivo)
    } else if (st.connected && st.objective) {
      hideMetaObjectiveStep();
      markMetaConnected(st.objective);
    }
    return st;
  }

  /* -----------------------------
   * Carga de sesión / GA panel
   * ----------------------------- */
  try {
    const sess = await apiFetch('/api/session');
    if (sess?.authenticated && sess?.user) {
      sessionStorage.setItem('userId',  sess.user._id);
      sessionStorage.setItem('email',   sess.user.email);

      if (sess.user.googleConnected) {
        gaPanel?.classList.remove('hidden');
        sessionStorage.setItem('googleConnected', 'true');
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
   * Habilitar "Continuar"
   * (cualquier plataforma conectada)
   * ----------------------------- */
  function getConnectivityState() {
    const shopConnected =
      flagShopify?.textContent.trim() === 'true' ||
      sessionStorage.getItem('shopifyConnected') === 'true' ||
      (!!sessionStorage.getItem('shop') && !!sessionStorage.getItem('accessToken'));

    const googleConnected =
      flagGoogle?.textContent.trim() === 'true' ||
      sessionStorage.getItem('googleConnected') === 'true';

    // Meta se marca SOLO cuando tiene objetivo guardado
    const metaConnected =
      sessionStorage.getItem('metaConnected') === 'true';

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

  /* -----------------------------
   * Pintar conectados Shopify/Google
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

  const pintarGoogleConectado = () => {
    if (!connectGoogleBtn) return;
    connectGoogleBtn.textContent = 'Conectado';
    connectGoogleBtn.classList.add('connected');
    connectGoogleBtn.disabled = true;
    sessionStorage.setItem('googleConnected', 'true');
    habilitarContinue();
  };

  // Estados iniciales de Shopify/Google
  if (flagShopify?.textContent.trim() === 'true') await pintarShopifyConectado();
  if (flagGoogle?.textContent.trim() === 'true') pintarGoogleConectado();
  habilitarContinue();

  /* -----------------------------
   * Acciones Shopify/Google
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

  connectGoogleBtn?.addEventListener('click', () => {
    location.href = '/auth/google/connect';
  });

  /* -----------------------------
   * META: login, estado y objetivo
   * ----------------------------- */

  // Al hacer clic: NO marques conectado todavía;
  // solo bloquea el botón y recuerda que estás conectando.
  connectMetaBtn?.addEventListener('click', () => {
    localStorage.setItem('meta_connecting', '1');
    connectMetaBtn.style.pointerEvents = 'none';
    if ('disabled' in connectMetaBtn) connectMetaBtn.disabled = true;
    // Si el botón es <a href="/auth/meta/login">…</a>, dejar que navegue;
    // si es <button>, forzamos la navegación:
    if (connectMetaBtn.tagName !== 'A') {
      window.location.href = '/auth/meta/login';
    }
  });

  // Si volvemos con ?meta=ok|error, actuar
  const metaParam = (qs.get('meta') || '').toLowerCase();
  if (metaParam === 'error' || metaParam === 'fail') {
    localStorage.removeItem('meta_connecting');
    // re-habilita el botón
    if (connectMetaBtn) {
      connectMetaBtn.style.pointerEvents = 'auto';
      if ('disabled' in connectMetaBtn) connectMetaBtn.disabled = false;
    }
  }
  if (metaParam === 'ok') {
    // Consultar estado real: si conectado pero sin objetivo → mostrar paso
    await refreshMetaUI();
  }

  // Si estábamos "conectando", hacer polling hasta reflejar estado
  async function pollMetaUntilConnected(maxTries = 30, delayMs = 2000) {
    for (let i = 0; i < maxTries; i++) {
      const st = await fetchMetaStatus();
      if (st.connected) {
        localStorage.removeItem('meta_connecting');
        if (!st.objective) {
          showMetaObjectiveStep();
        } else {
          hideMetaObjectiveStep();
          markMetaConnected(st.objective);
        }
        return;
      }
      await new Promise(r => setTimeout(r, delayMs));
    }
    // timeout → re-habilitar
    localStorage.removeItem('meta_connecting');
    if (connectMetaBtn) {
      connectMetaBtn.style.pointerEvents = 'auto';
      if ('disabled' in connectMetaBtn) connectMetaBtn.disabled = false;
    }
  }

  // Solo si veníamos con la bandera y aún no se pintó conectado
  if (localStorage.getItem('meta_connecting') === '1' &&
      sessionStorage.getItem('metaConnected') !== 'true') {
    pollMetaUntilConnected();
  }

  // Guardar objetivo Meta
  saveMetaObjective?.addEventListener('click', async () => {
    const selected = (document.querySelector('input[name="metaObjective"]:checked') || {}).value;
    if (!selected) {
      alert('Selecciona un objetivo');
      return;
    }
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
   * Continuar paso 2
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
   * Demo GA (igual que lo tenías)
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
