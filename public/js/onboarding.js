// public/js/onboarding.js
import { apiFetch } from './apiFetch.saas.js';

document.addEventListener('DOMContentLoaded', async () => {
  const qs = new URLSearchParams(location.search);
  const sessionToken = qs.get('sessionToken');
  if (sessionToken) sessionStorage.setItem('sessionToken', sessionToken);

  const shopFromQuery = qs.get('shop');
  const hostFromQuery = qs.get('host');

  // ─────────────────────────────────────────────────────────
  // Selectores existentes
  // ─────────────────────────────────────────────────────────
  const connectBtn        = document.getElementById('connect-shopify-btn');
  const connectGoogleBtn  = document.getElementById('connect-google-btn');
  const connectMetaBtn    = document.getElementById('connect-meta-btn');
  const continueBtn       = document.getElementById('continue-btn');
  const flagShopify       = document.getElementById('shopifyConnectedFlag');
  const flagGoogle        = document.getElementById('googleConnectedFlag');
  const domainStep        = document.getElementById('shopify-domain-step');
  const domainInput       = document.getElementById('shop-domain-input');
  const domainSend        = document.getElementById('shop-domain-send');

  const gaPanel = document.getElementById('ga-edit-test');
  const gaBtn   = document.getElementById('ga-create-demo-btn');
  const gaIn    = document.getElementById('ga-property-id');
  const gaOut   = document.getElementById('ga-demo-output');

  // ─────────────────────────────────────────────────────────
  // NUEVO: elementos del paso de objetivo Meta
  // ─────────────────────────────────────────────────────────
  const metaObjectiveStep = document.getElementById('meta-objective-step');   // contenedor del paso
  const saveMetaObjective = document.getElementById('save-meta-objective-btn'); // botón guardar

  // ─────────────────────────────────────────────────────────
  // Helpers Meta
  // ─────────────────────────────────────────────────────────
  const META_STATUS_URL    = '/auth/meta/status';
  const META_OBJECTIVE_URL = '/auth/meta/objective';

  const markMetaConnected = (objective = null) => {
    if (!connectMetaBtn) return;
    connectMetaBtn.textContent = 'Conectado';
    connectMetaBtn.classList.add('connected');
    connectMetaBtn.style.pointerEvents = 'none';
    if ('disabled' in connectMetaBtn) connectMetaBtn.disabled = true;
    if (objective) sessionStorage.setItem('metaObjective', objective);
  };

  const showMetaObjectiveStep = () => {
    if (metaObjectiveStep) metaObjectiveStep.style.display = 'block';
  };

  const hideMetaObjectiveStep = () => {
    if (metaObjectiveStep) metaObjectiveStep.style.display = 'none';
  };

  async function fetchMetaStatus() {
    try {
      const st = await apiFetch(META_STATUS_URL);
      // st: { connected: boolean, objective: 'ventas'|'alcance'|'leads'|null }
      return st || { connected: false, objective: null };
    } catch (e) {
      // fallback a /api/session si algo falla (compatibilidad previa)
      try {
        const s = await apiFetch('/api/session');
        return {
          connected: !!(s?.authenticated && s?.user?.metaConnected),
          objective: s?.user?.metaObjective || null
        };
      } catch (_) {
        return { connected: false, objective: null };
      }
    }
  }

  async function refreshMetaUI() {
    const st = await fetchMetaStatus();
    if (st.connected && !st.objective) {
      // Recién conectó y aún no eligió objetivo → mostrar paso
      showMetaObjectiveStep();
    }
    if (st.connected && st.objective) {
      // Ya conectado y con objetivo → pintar en verde y guardar en sesión para el dashboard
      hideMetaObjectiveStep();
      markMetaConnected(st.objective);
    }
    return st;
  }

  // ─────────────────────────────────────────────────────────
  // Carga de sesión SaaS
  // ─────────────────────────────────────────────────────────
  let sess;
  try {
    sess = await apiFetch('/api/session');
    if (sess?.authenticated && sess?.user) {
      sessionStorage.setItem('userId',  sess.user._id);
      sessionStorage.setItem('email',   sess.user.email);
      console.log('✅ Sesión cargada:', sess.user.email);

      if (sess.user.googleConnected) {
        gaPanel?.classList.remove('hidden');
      } else {
        gaPanel?.classList.add('hidden');
      }
    }
  } catch (err) {
    console.warn('No se pudo obtener /api/session:', err);
  }

  // PING test
  try {
    const ping = await apiFetch('/api/saas/ping');
    console.log('✅ PING OK', ping);
  } catch (err) {
    console.error('❌ PING FAIL', err);
  }

  // Shopify: mostrar paso de dominio si aplica
  const savedShop = sessionStorage.getItem('shopDomain');
  if (shopFromQuery || savedShop) {
    domainStep?.classList.remove('step--hidden');
    if (domainInput) {
      domainInput.value = shopFromQuery || savedShop;
      domainInput.focus();
    }
    if (savedShop) sessionStorage.removeItem('shopDomain');
  }

  function habilitarContinue() {
    if (!continueBtn) return;
    const shop = sessionStorage.getItem('shop');
    const accessToken = sessionStorage.getItem('accessToken');
    const listo =
      (shop && accessToken) ||
      flagShopify?.textContent.trim() === 'true' ||
      sessionStorage.getItem('shopifyConnected') === 'true';

    if (listo) {
      continueBtn.disabled = false;
      continueBtn.classList.remove('btn-continue--disabled');
      continueBtn.classList.add('btn-continue--enabled');
      continueBtn.style.pointerEvents = 'auto';
      continueBtn.style.opacity = 1;
      sessionStorage.removeItem('shopifyConnected');
    }
  }

  const pintarShopifyConectado = async () => {
    if (connectBtn) {
      connectBtn.textContent = 'Conectado';
      connectBtn.classList.add('connected');
      connectBtn.disabled = true;
    }

    const shop =
      shopFromQuery ||
      domainInput?.value.trim().toLowerCase() ||
      sessionStorage.getItem('shop');

    if (!shop) {
      console.warn('No se encontró el dominio de la tienda para obtener credenciales.');
      return;
    }

    try {
      const resp = await apiFetch(`/api/shopConnection/me?shop=${encodeURIComponent(shop)}`);
      if (resp && resp.shop && resp.accessToken) {
        sessionStorage.setItem('shop', resp.shop);
        sessionStorage.setItem('accessToken', resp.accessToken);
        console.log('✅ Guardado en sessionStorage:', resp.shop, resp.accessToken);
        habilitarContinue();
      } else {
        console.warn('No se encontraron credenciales para la tienda.');
      }
    } catch (err) {
      console.error('Error obteniendo shop/accessToken:', err);
    }
  };

  const pintarGoogleConectado = () => {
    if (!connectGoogleBtn) return;
    connectGoogleBtn.textContent = 'Conectado';
    connectGoogleBtn.classList.add('connected');
    connectGoogleBtn.disabled = true;
  };

  // Pinta estados iniciales Shopify/Google
  if (flagShopify?.textContent.trim() === 'true') await pintarShopifyConectado();
  if (flagGoogle?.textContent.trim() === 'true') pintarGoogleConectado();
  habilitarContinue();

  // Conectar Shopify (manual o por prompt)
  connectBtn?.addEventListener('click', () => {
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
    const shop = domainInput?.value.trim().toLowerCase();
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

  // Conectar Google
  connectGoogleBtn?.addEventListener('click', () => {
    location.href = '/auth/google/connect';
  });

  // Paso 1 → Paso 2
  continueBtn?.addEventListener('click', () => {
    const step1Panel = document.getElementById('step1-content');
    const step2Panel = document.getElementById('step2-content');
    step1Panel?.classList.add('hidden');
    step2Panel?.classList.remove('hidden');
    document.querySelector('.step[data-step="1"]')?.classList.remove('active');
    document.querySelector('.step[data-step="2"]')?.classList.add('active');
  });

  const backBtn2 = document.getElementById('back-btn-2');
  backBtn2?.addEventListener('click', () => {
    document.getElementById('step2-content')?.classList.add('hidden');
    document.getElementById('step1-content')?.classList.remove('hidden');
    document.querySelector('.step[data-step="2"]')?.classList.remove('active');
    document.querySelector('.step[data-step="1"]')?.classList.add('active');
  });

  const continueBtn2 = document.getElementById('continue-btn-2');
  continueBtn2?.addEventListener('click', () => {
    const shop = sessionStorage.getItem('shop');
    const accessToken = sessionStorage.getItem('accessToken');
    if (!shop || !accessToken) {
      alert('⚠️ Debes conectar tu tienda Shopify antes de continuar.');
      return;
    }
    window.location.href = '/onboarding3.html';
  });

  // ─────────────────────────────────────────────────────────
  // META: estado inicial y callback (?meta=ok)
  // ─────────────────────────────────────────────────────────
  let initialMetaConnected = false;
  try {
    const st0 = await refreshMetaUI();
    initialMetaConnected = !!st0.connected;
  } catch {}

  const metaStatus = qs.get('meta');
  if (metaStatus === 'fail' || metaStatus === 'error') {
    localStorage.removeItem('meta_connecting');
    // re-habilita el botón por si quedó bloqueado
    if (connectMetaBtn) {
      connectMetaBtn.style.pointerEvents = 'auto';
      if ('disabled' in connectMetaBtn) connectMetaBtn.disabled = false;
    }
  }
  if (metaStatus === 'ok') {
    await refreshMetaUI(); // puede mostrar el paso si falta objetivo
  }

  // Al hacer clic en conectar Meta, bloquear mientras regresa
  connectMetaBtn?.addEventListener('click', () => {
    localStorage.setItem('meta_connecting', '1');
    connectMetaBtn.style.pointerEvents = 'none';
    if ('disabled' in connectMetaBtn) connectMetaBtn.disabled = true;
  });

  // Poll de compatibilidad: si veníamos conectando y aún no se refleja, preguntar a /auth/meta/status
  async function pollMetaUntilConnected(maxTries = 30, delayMs = 2000) {
    for (let i = 0; i < maxTries; i++) {
      const st = await fetchMetaStatus();
      if (st.connected) {
        localStorage.removeItem('meta_connecting');
        // Si falta objetivo, mostrar paso; si ya hay, marcar conectado
        if (!st.objective) showMetaObjectiveStep();
        else markMetaConnected(st.objective);
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

  if (localStorage.getItem('meta_connecting') && !initialMetaConnected) {
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

  // ─────────────────────────────────────────────────────────
  // Google demo (igual que lo tenías)
  // ─────────────────────────────────────────────────────────
  gaBtn?.addEventListener('click', async () => {
    const raw = gaIn?.value.trim();
    if (!raw) {
      alert('Ingresa el GA4 Property ID.');
      return;
    }
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

      if (data.ok) {
        alert('✅ Conversión creada: ' + (data.created?.name || ''));
      } else {
        alert('❌ ' + (data.error?.message || data.error || 'Error'));
      }
    } catch (e) {
      if (gaOut) gaOut.textContent = e.message;
      alert('❌ Error: ' + e.message);
    } finally {
      gaBtn.disabled = false;
    }
  });
});
