import { apiFetch } from './apiFetch.saas.js';


document.addEventListener('DOMContentLoaded', async () => {

  const qs = new URLSearchParams(location.search);
  const sessionToken = qs.get('sessionToken');
  if (sessionToken) {
    sessionStorage.setItem('sessionToken', sessionToken);
  }

  const shopFromQuery = qs.get('shop');
  const hostFromQuery = qs.get('host');
  const magicToken = qs.get('token'); // <--- AGREGADO AQUÍ

   // ------ NUEVO BLOQUE: Validación Magic Link ------
   if (magicToken) {
    // Mostrar mensaje temporal...
    document.body.insertAdjacentHTML('beforeend', '<div id="ml-loader" style="position:fixed;top:0;left:0;width:100vw;height:100vh;background:rgba(20,0,40,0.7);display:flex;align-items:center;justify-content:center;z-index:10000;color:white;font-size:1.5rem;">Validando acceso seguro...</div>');
    try {
      const resp = await fetch('/api/auth/validate-magic-link', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: magicToken }),
        credentials: 'include'
      });
      const data = await resp.json();
      document.getElementById('ml-loader').remove(); // Siempre borra el loader
      if (data.ok) {
        console.log('Magic link OK, usuario autenticado automáticamente');
        // Limpia el token de la URL
        qs.delete('token');
        window.history.replaceState({}, '', `${location.pathname}?${qs.toString()}`);
      } else {
        alert('El magic link expiró o no es válido. Inicia sesión manualmente.');
      }
    } catch (e) {
      document.getElementById('ml-loader').remove();
      alert('Error validando magic link.');
    }
  }

  /* ------ Elementos del DOM ------ */
  const connectBtn        = document.getElementById('connect-shopify-btn');
  const connectGoogleBtn  = document.getElementById('connect-google-btn');
  const continueBtn       = document.getElementById('continue-btn');
  const flagShopify       = document.getElementById('shopifyConnectedFlag');
  const flagGoogle        = document.getElementById('googleConnectedFlag');
  const domainStep        = document.getElementById('shopify-domain-step');
  const domainInput       = document.getElementById('shop-domain-input');
  const domainSend        = document.getElementById('shop-domain-send');

  /* ------ Llamada de prueba ------ */
  try {
    const ping = await apiFetch('/api/secure/ping');
    console.log('✅ PING OK', ping);
  } catch (err) {
    console.error('❌ PING FAIL', err);
  }

  /* ------ Si venimos de /connector/interface ------- */
 const savedShop = sessionStorage.getItem('shopDomain');
  if (shopFromQuery || savedShop) {
  domainStep.classList.remove('step--hidden');
  domainInput.value = shopFromQuery || savedShop;
  domainInput.focus();

  // si vino de sessionStorage, lo limpiamos para no reutilizarlo
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
     sessionStorage.removeItem('shopifyConnected'); // opcional

  };

  const pintarGoogleConectado = () => {
    connectGoogleBtn.textContent = 'Connected';
    connectGoogleBtn.classList.add('connected');
    connectGoogleBtn.disabled = true;

  };

  /* ------ Estado inicial ------ */
  if (flagShopify.textContent.trim() === 'true') pintarShopifyConectado();
  if (flagGoogle.textContent.trim() === 'true') pintarGoogleConectado();
  habilitarContinue();

  /* ------ Botón Connect Shopify ------ */
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

  /* ------ Botón Enviar Dominio ------ */
  domainSend?.addEventListener('click', async () => {
    const shop = domainInput.value.trim().toLowerCase();
    if (!shop.endsWith('.myshopify.com')) return alert('Dominio inválido');

    try {
      const data = await apiFetch('/api/secure/shopify/match', {
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

  /* ------ Botones Google y Continuar ------ */
  connectGoogleBtn?.addEventListener('click', () =>
    (location.href = '/auth/google/connect')
  );
  continueBtn?.addEventListener('click', () => (location.href = '/'));
});
