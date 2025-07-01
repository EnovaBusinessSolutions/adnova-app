import { apiFetch } from './apiFetch.saas.js';

document.addEventListener('DOMContentLoaded', async () => {
  const qs = new URLSearchParams(location.search);
  const sessionToken = qs.get('sessionToken');
  if (sessionToken) sessionStorage.setItem('sessionToken', sessionToken);

  const shopFromQuery = qs.get('shop');
  const hostFromQuery = qs.get('host');
  const userId = sessionStorage.getItem('userId');


  const connectBtn        = document.getElementById('connect-shopify-btn');
  const connectGoogleBtn  = document.getElementById('connect-google-btn');
  const continueBtn       = document.getElementById('continue-btn');
  const flagShopify       = document.getElementById('shopifyConnectedFlag');
  const flagGoogle        = document.getElementById('googleConnectedFlag');
  const domainStep        = document.getElementById('shopify-domain-step');
  const domainInput       = document.getElementById('shop-domain-input');
  const domainSend        = document.getElementById('shop-domain-send');


  try {
    const ping = await apiFetch('/api/saas/ping');
    console.log('✅ PING OK', ping);
  } catch (err) {
    console.error('❌ PING FAIL', err);
  }

  const savedShop = sessionStorage.getItem('shopDomain');
  if (shopFromQuery || savedShop) {
    domainStep.classList.remove('step--hidden');
    domainInput.value = shopFromQuery || savedShop;
    domainInput.focus();

    if (savedShop) sessionStorage.removeItem('shopDomain');
  }

  function habilitarContinue() {
    if (!continueBtn) return;
    const shop = sessionStorage.getItem('shop');
    const accessToken = sessionStorage.getItem('accessToken');
    const listo =
      (shop && accessToken) ||
      flagShopify.textContent.trim() === 'true' ||
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

  // SOLO busca y guarda credenciales cuando hay tienda conectada
  const pintarShopifyConectado = async () => {
    connectBtn.textContent = 'Connected';
    connectBtn.classList.add('connected');
    connectBtn.disabled = true;

    // Busca shop en los posibles lugares
    const shop = shopFromQuery || domainInput.value.trim().toLowerCase() || sessionStorage.getItem('shop');
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
        habilitarContinue(); // <-- Aquí SIEMPRE
      } else {
        console.warn('No se encontraron credenciales para la tienda.');
      }
    } catch (err) {
      console.error('Error obteniendo shop/accessToken:', err);
    }
  };

  const pintarGoogleConectado = () => {
    connectGoogleBtn.textContent = 'Connected';
    connectGoogleBtn.classList.add('connected');
    connectGoogleBtn.disabled = true;
  };

  // 1. Si YA estaba conectado, busca y guarda credenciales
  if (flagShopify.textContent.trim() === 'true') await pintarShopifyConectado();
  if (flagGoogle.textContent.trim() === 'true') pintarGoogleConectado();
  habilitarContinue();

  // Botón para conectar Shopify
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

  // Cuando el usuario pone el dominio y da click en "Enviar"
  domainSend?.addEventListener('click', async () => {
    const shop = domainInput.value.trim().toLowerCase();
    if (!shop.endsWith('.myshopify.com')) return alert('Dominio inválido');

    try {
      const data = await apiFetch('/api/saas/shopify/match', {
        method: 'POST',
        body: JSON.stringify({ shop }),
      });
      if (data.ok) {
        await pintarShopifyConectado();
        domainStep.classList.add('step--hidden');
      } else {
        alert(data.error || 'No se pudo vincular la tienda.');
      }
    } catch (err) {
      console.error(err);
      alert('Error al conectar con el servidor.');
    }
  });

  connectGoogleBtn?.addEventListener('click', () =>
    (location.href = '/auth/google/connect')
  );

  continueBtn?.addEventListener('click', () => {
    const step1Panel = document.getElementById('step1-content');
    const step2Panel = document.getElementById('step2-content');
    step1Panel.classList.add('hidden');
    step2Panel.classList.remove('hidden');
    document.querySelector('.step[data-step="1"]').classList.remove('active');
    document.querySelector('.step[data-step="2"]').classList.add('active');
  });

  const backBtn2 = document.getElementById('back-btn-2');
  backBtn2?.addEventListener('click', () => {
    document.getElementById('step2-content').classList.add('hidden');
    document.getElementById('step1-content').classList.remove('hidden');
    document.querySelector('.step[data-step="2"]').classList.remove('active');
    document.querySelector('.step[data-step="1"]').classList.add('active');
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

});
