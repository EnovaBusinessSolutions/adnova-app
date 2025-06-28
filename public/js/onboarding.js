import { apiFetch } from './apiFetch.saas.js';

document.addEventListener('DOMContentLoaded', async () => {

  const qs = new URLSearchParams(location.search);
  const sessionToken = qs.get('sessionToken');
  if (sessionToken) {
    sessionStorage.setItem('sessionToken', sessionToken);
  }

  const shopFromQuery = qs.get('shop');
  const hostFromQuery = qs.get('host');

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
    const listo =
      flagShopify.textContent.trim() === 'true' ||
      sessionStorage.getItem('shopifyConnected') === 'true';
    if (listo) {
      continueBtn.disabled = false;
      continueBtn.classList.replace(
        'btn-continue--disabled',
        'btn-continue--enabled'
      );
      sessionStorage.removeItem('shopifyConnected');
    }
  }

  const pintarShopifyConectado = () => {
    connectBtn.textContent = 'Connected';
    connectBtn.classList.add('connected');
    connectBtn.disabled = true;
    habilitarContinue();
    sessionStorage.removeItem('shopifyConnected'); 
  };

  const pintarGoogleConectado = () => {
    connectGoogleBtn.textContent = 'Connected';
    connectGoogleBtn.classList.add('connected');
    connectGoogleBtn.disabled = true;
  };

  if (flagShopify.textContent.trim() === 'true') pintarShopifyConectado();
  if (flagGoogle.textContent.trim() === 'true') pintarGoogleConectado();
  habilitarContinue();

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
    const shop = domainInput.value.trim().toLowerCase();
    if (!shop.endsWith('.myshopify.com')) return alert('Dominio inválido');

    try {
      const data = await apiFetch('/api/saas/shopify/match', {
      method: 'POST',
      body: JSON.stringify({ shop }),
  });
      if (data.ok) {
        pintarShopifyConectado();
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
  // Oculta Step 1
  const step1Panel = document.getElementById('step1-content');
  const step2Panel = document.getElementById('step2-content');
  step1Panel.classList.add('hidden');
  step2Panel.classList.remove('hidden');

  // Actualiza el sidebar visual
  document.querySelector('.step[data-step="1"]').classList.remove('active');
  document.querySelector('.step[data-step="2"]').classList.add('active');
});
const backBtn2 = document.getElementById('back-btn-2');

backBtn2?.addEventListener('click', () => {
  // Oculta Step 2 y muestra Step 1
  document.getElementById('step2-content').classList.add('hidden');
  document.getElementById('step1-content').classList.remove('hidden');

  // Actualiza el sidebar visual
  document.querySelector('.step[data-step="2"]').classList.remove('active');
  document.querySelector('.step[data-step="1"]').classList.add('active');
});


});
