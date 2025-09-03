// public/js/onboarding.js
import { apiFetch } from './apiFetch.saas.js';

document.addEventListener('DOMContentLoaded', async () => {
  const qs = new URLSearchParams(location.search);
  const sessionToken = qs.get('sessionToken');
  if (sessionToken) sessionStorage.setItem('sessionToken', sessionToken);

  const shopFromQuery = qs.get('shop');
  const hostFromQuery = qs.get('host');

  // Selectores
  const connectShopifyBtn = document.getElementById('connect-shopify-btn');
  const connectGoogleBtn  = document.getElementById('connect-google-btn');
  const connectMetaBtn    = document.getElementById('connect-meta-btn');
  const continueBtn       = document.getElementById('continue-btn');

  const flagShopify = document.getElementById('shopifyConnectedFlag');
  const flagGoogle  = document.getElementById('googleConnectedFlag');

  const domainStep  = document.getElementById('shopify-domain-step');
  const domainInput = document.getElementById('shop-domain-input');
  const domainSend  = document.getElementById('shop-domain-send');

  // (Opcional) chip "Requerido" de Shopify (si le pones este id en el HTML)
  const shopifyRequiredBadge = document.getElementById('shopify-required-badge');

  // Panel demo GA opcional
  const gaPanel = document.getElementById('ga-edit-test');
  const gaBtn   = document.getElementById('ga-create-demo-btn');
  const gaIn    = document.getElementById('ga-property-id');
  const gaOut   = document.getElementById('ga-demo-output');

  // Paso de OBJETIVO Meta
  const metaObjectiveStep = document.getElementById('meta-objective-step');
  const saveMetaObjective = document.getElementById('save-meta-objective-btn');

  // Endpoints Meta
  const META_STATUS_URL    = '/auth/meta/status';
  const META_OBJECTIVE_URL = '/auth/meta/objective';

  // ---------- helpers de visibilidad (a prueba de CSS) ----------
  function showEl(el) {
    if (!el) return;
    el.classList.remove('hidden');
    el.removeAttribute('aria-hidden');
    // Si es un panel, mantenemos flex; si no, block
    el.style.display = el.classList.contains('content-panel') ? 'flex' : 'block';
    el.style.visibility = 'visible';
    el.style.opacity = 1;
  }
  function hideEl(el) {
    if (!el) return;
    el.classList.add('hidden');
    el.setAttribute('aria-hidden', 'true');
    el.style.display = 'none';
    el.style.visibility = 'hidden';
    el.style.opacity = 0;
  }

  // ---------- router de pasos (determinista por hash) ----------
  function setActiveStep(stepNum) {
    const s1 = document.getElementById('step1-content');
    const s2 = document.getElementById('step2-content');

    if (stepNum === 2) {
      hideEl(s1);
      showEl(s2);
      document.querySelector('.step[data-step="1"]')?.classList.remove('active');
      document.querySelector('.step[data-step="2"]')?.classList.add('active');
    } else {
      showEl(s1);
      hideEl(s2);
      document.querySelector('.step[data-step="2"]')?.classList.remove('active');
      document.querySelector('.step[data-step="1"]')?.classList.add('active');
    }
  }
  function goToStep(stepNum, updateHash = true) {
    setActiveStep(stepNum);
    if (!updateHash) return;
    const nextHash = stepNum === 2 ? '#step=2' : '#step=1';
    if (location.hash !== nextHash) history.replaceState(null, '', nextHash);
  }

  // ---------- utils meta ----------
  const showMetaObjectiveStep = () => { if (metaObjectiveStep) showEl(metaObjectiveStep); };
  const hideMetaObjectiveStep = () => { if (metaObjectiveStep) hideEl(metaObjectiveStep); };

  const markMetaConnected = (objective = null) => {
    if (!connectMetaBtn) return;
    connectMetaBtn.textContent = 'Conectado';
    connectMetaBtn.classList.add('connected');
    connectMetaBtn.style.pointerEvents = 'none';
    if ('disabled' in connectMetaBtn) connectMetaBtn.disabled = true;
    if (objective) sessionStorage.setItem('metaObjective', objective);
    sessionStorage.setItem('metaConnected', 'true');
    localStorage.removeItem('meta_connecting');
    habilitarContinue();
  };

  async function fetchMetaStatus() {
    try {
      const st = await apiFetch(META_STATUS_URL);
      return st || { connected: false, objective: null };
    } catch {
      // Fallback a /api/session
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
    const st = await fetchMetaStatus();
    if (st.connected) {
      sessionStorage.setItem('metaConnected', 'true');
      if (!st.objective) {
        showMetaObjectiveStep();
      } else {
        hideMetaObjectiveStep();
        markMetaConnected(st.objective);
      }
      habilitarContinue();
    }
    return st;
  }

  // ---------- sesión saas ----------
  try {
    const sess = await apiFetch('/api/session');
    if (sess?.authenticated && sess?.user) {
      sessionStorage.setItem('userId',  sess.user._id);
      sessionStorage.setItem('email',   sess.user.email);
      if (sess.user.googleConnected) {
        gaPanel?.classList.remove('hidden');
        sessionStorage.setItem('googleConnected', 'true');
        habilitarContinue();
      } else {
        gaPanel?.classList.add('hidden');
      }
    }
  } catch (err) {
    console.warn('No se pudo obtener /api/session:', err);
  }

  // Ping
  try { await apiFetch('/api/saas/ping'); } catch {}

  // Shopify: mostrar paso dominio si viene en query o guardado
  const savedShop = sessionStorage.getItem('shopDomain');
  if (shopFromQuery || savedShop) {
    domainStep?.classList.remove('step--hidden');
    if (domainInput) {
      domainInput.value = shopFromQuery || savedShop;
      domainInput.focus();
    }
    if (savedShop) sessionStorage.removeItem('shopDomain');
  }

  // ---------- estado de conectividad (mínimo 1 conexión) ----------
  function getConnectivityState() {
    const shopConnected =
      flagShopify?.textContent.trim() === 'true' ||
      sessionStorage.getItem('shopifyConnected') === 'true' ||
      (!!sessionStorage.getItem('shop') && !!sessionStorage.getItem('accessToken'));

    const googleConnected =
      flagGoogle?.textContent.trim() === 'true' ||
      sessionStorage.getItem('googleConnected') === 'true';

    const metaConnected =
      sessionStorage.getItem('metaConnected') === 'true';

    const anyConnected = !!(shopConnected || googleConnected || metaConnected);
    return { shopConnected, googleConnected, metaConnected, anyConnected };
  }

  function habilitarContinue() {
    if (!continueBtn) return;
    const { anyConnected } = getConnectivityState();

    if (anyConnected) {
      continueBtn.disabled = false;
      continueBtn.classList.remove('btn-continue--disabled');
      continueBtn.classList.add('btn-continue--enabled');
      continueBtn.style.pointerEvents = 'auto';
      continueBtn.style.opacity = 1;
    } else {
      continueBtn.disabled = true;
      continueBtn.classList.add('btn-continue--disabled');
      continueBtn.classList.remove('btn-continue--enabled');
      continueBtn.style.pointerEvents = 'none';
      continueBtn.style.opacity = 0.6;
    }
  }

  // ---------- pintar estados ----------
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
      habilitarContinue();
      return;
    }

    try {
      const resp = await apiFetch(`/api/shopConnection/me?shop=${encodeURIComponent(shop)}`);
      if (resp?.shop && resp?.accessToken) {
        sessionStorage.setItem('shop', resp.shop);
        sessionStorage.setItem('accessToken', resp.accessToken);
        sessionStorage.setItem('shopifyConnected', 'true');
        habilitarContinue();
      } else {
        sessionStorage.setItem('shopifyConnected', 'true');
        habilitarContinue();
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
    sessionStorage.setItem('googleConnected', 'true');
    habilitarContinue();
  };

  // Estados iniciales Shopify/Google
  if (flagShopify?.textContent.trim() === 'true') await pintarShopifyConectado();
  if (flagGoogle?.textContent.trim() === 'true') pintarGoogleConectado();
  habilitarContinue();

  // ---------- acciones ----------
  // Conectar Shopify
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

  // Vincular Shopify por dominio
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

  // Conectar Google
  connectGoogleBtn?.addEventListener('click', () => {
    location.href = '/auth/google/connect';
  });

  // Paso 1 → Paso 2 (usar router + hash)
  continueBtn?.addEventListener('click', () => {
    const { anyConnected } = getConnectivityState();
    if (!anyConnected) return;
    goToStep(2, true);
  });

  // Volver a paso 1
  document.getElementById('back-btn-2')?.addEventListener('click', () => {
    goToStep(1, true);
  });

  // Continuar paso 2 (mínimo 1 conexión)
  document.getElementById('continue-btn-2')?.addEventListener('click', () => {
    const { anyConnected } = getConnectivityState();
    if (!anyConnected) {
      alert('⚠️ Conecta al menos una plataforma (Shopify, Google o Meta) para continuar.');
      return;
    }
    window.location.href = '/onboarding3.html';
  });

  // ---------- meta: estado inicial + callback ----------
  let initialMetaConnected = false;
  try {
    const st0 = await refreshMetaUI();
    initialMetaConnected = !!st0.connected;
  } catch {}

  const metaStatus = qs.get('meta');
  if (metaStatus === 'fail' || metaStatus === 'error') {
    localStorage.removeItem('meta_connecting');
    if (connectMetaBtn) {
      connectMetaBtn.style.pointerEvents = 'auto';
      if ('disabled' in connectMetaBtn) connectMetaBtn.disabled = false;
    }
  }
  if (metaStatus === 'ok') {
    await refreshMetaUI();
    habilitarContinue();
    // Si viene de conectar Meta con éxito, muéstrale directamente el Paso 2
    goToStep(2, true);
  }

  // Conectar Meta
  connectMetaBtn?.addEventListener('click', () => {
    localStorage.setItem('meta_connecting', '1');
    connectMetaBtn.style.pointerEvents = 'none';
    if ('disabled' in connectMetaBtn) connectMetaBtn.disabled = true;
    window.location.href = '/auth/meta/login';
  });

  // Poll hasta reflejar conexión de Meta
  async function pollMetaUntilConnected(maxTries = 30, delayMs = 2000) {
    for (let i = 0; i < maxTries; i++) {
      const st = await fetchMetaStatus();
      if (st.connected) {
        sessionStorage.setItem('metaConnected', 'true');
        localStorage.removeItem('meta_connecting');
        if (!st.objective) showMetaObjectiveStep();
        else markMetaConnected(st.objective);
        habilitarContinue();
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

  // Demo GA (igual que lo tenías)
  gaBtn?.addEventListener('click', async () => {
    const raw = gaIn?.value?.trim();
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
      if (data.ok) alert('✅ Conversión creada: ' + (data.created?.name || ''));
      else alert('❌ ' + (data.error?.message || data.error || 'Error'));
    } catch (e) {
      if (gaOut) gaOut.textContent = e.message;
      alert('❌ Error: ' + e.message);
    } finally {
      gaBtn.disabled = false;
    }
  });

  // Ocultar el chip "Requerido" (si existe el id en el HTML)
  if (shopifyRequiredBadge) shopifyRequiredBadge.style.display = 'none';

  // ---------- aplicar paso inicial y escuchar cambios de hash ----------
  const stepFromHash = (location.hash || '').replace('#', '').split('=')[1];
  if (stepFromHash === '2') setActiveStep(2);
  else setActiveStep(1);

  window.addEventListener('hashchange', () => {
    const step = (location.hash || '').replace('#', '').split('=')[1];
    setActiveStep(step === '2' ? 2 : 1);
  });
});
