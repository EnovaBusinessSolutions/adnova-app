// public/js/onboarding1.js
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

  const gaPanel = document.getElementById('ga-edit-test');
  const gaBtn   = document.getElementById('ga-create-demo-btn');
  const gaIn    = document.getElementById('ga-property-id');
  const gaOut   = document.getElementById('ga-demo-output');

  // --- Sesión: muestra panel GA si aplica
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

  // Ping (opcional)
  try { await apiFetch('/api/saas/ping'); } catch {}

  // Mostrar panel por dominio si viene en query o guardado
  const savedShop = sessionStorage.getItem('shopDomain');
  if (shopFromQuery || savedShop) {
    domainStep?.classList.remove('step--hidden');
    if (domainInput) {
      domainInput.value = shopFromQuery || savedShop;
      domainInput.focus();
    }
    if (savedShop) sessionStorage.removeItem('shopDomain');
  }

  // --- Estado de conectividad
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

    continueBtn.disabled = !anyConnected;
    continueBtn.classList.toggle('btn-continue--disabled', !anyConnected);
    continueBtn.classList.toggle('btn-continue--enabled',  anyConnected);
    continueBtn.style.pointerEvents = anyConnected ? 'auto' : 'none';
    continueBtn.style.opacity       = anyConnected ? '1'    : '0.6';
  }

  // --- Pintar conectados
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

  // --- Estados iniciales
  if (flagShopify?.textContent.trim() === 'true') await pintarShopifyConectado();
  if (flagGoogle?.textContent.trim() === 'true') pintarGoogleConectado();
  habilitarContinue();

  // --- Acciones
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

  connectMetaBtn?.addEventListener('click', () => {
    // Aquí solo marcamos mock hasta que vuelva del login
    sessionStorage.setItem('metaConnected', 'true');
    habilitarContinue();
    location.href = '/auth/meta/login';
  });

  // Continuar → ir a onboarding2
  continueBtn?.addEventListener('click', () => {
    const { anyConnected } = getConnectivityState();
    if (!anyConnected) {
      alert('⚠️ Conecta al menos una plataforma (Shopify, Google o Meta) para continuar.');
      return;
    }
    window.location.href = '/onboarding2.html#step=2';
  });

  // Demo GA (opcional)
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
