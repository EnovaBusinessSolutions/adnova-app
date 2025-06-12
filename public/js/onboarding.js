// public/js/onboarding.js

document.addEventListener('DOMContentLoaded', async () => {
  //
  // 1) Primero recuperamos los nodos del DOM que vamos a usar:
  //
  const connectShopifyBtn = document.getElementById('connect-shopify');
  const connectGoogleBtn  = document.getElementById('connect-google-btn');
  const continueBtn       = document.getElementById('continue-btn');
  const flagElem          = document.getElementById('shopifyConnectedFlag');
  const flagGoogleElem    = document.getElementById('googleConnectedFlag');

  console.log('🕵️ onboarding.js cargado');
  console.log('   connectShopifyBtn =', connectShopifyBtn);
  console.log('   continueBtn       =', continueBtn);
  console.log('   flagElem          =', flagElem);
  console.log('   flagGoogleElem    =', flagGoogleElem);

  // Helper: sólo habilita el botón Continue si Shopify está conectado
  function habilitarContinueSiShopify() {
    if (!continueBtn) return;
    const shopifyYaConectado =
      flagElem?.textContent.trim() === 'true' ||
      sessionStorage.getItem('shopifyConnected') === 'true';

    if (shopifyYaConectado) {
      continueBtn.disabled = false;
      continueBtn.classList.remove('btn-continue--disabled');
      continueBtn.classList.add('btn-continue--enabled');
      sessionStorage.removeItem('shopifyConnected');
    }
  }

  habilitarContinueSiShopify();

  // 2) Funciones de UI para marcar conectado
  function marcarShopifyConectadoUI() {
    console.log('🕹️ Pintando Shopify como conectado');
    if (connectShopifyBtn) {
      connectShopifyBtn.textContent = 'Connected';
      connectShopifyBtn.classList.add('connected');
      connectShopifyBtn.disabled = true;
    }
    habilitarContinueSiShopify();
  }

  function marcarGoogleConectadoUI() {
    console.log('🕹️ Pintando Google como conectado');
    if (connectGoogleBtn) {
      connectGoogleBtn.textContent = 'Connected';
      connectGoogleBtn.classList.add('connected');
      connectGoogleBtn.disabled = true;
    }
  }

  // Si los flags iniciales vienen en el HTML, pintamos
  if (flagElem && flagElem.textContent.trim() === 'true') {
    marcarShopifyConectadoUI();
  }
  if (flagGoogleElem && flagGoogleElem.textContent.trim() === 'true') {
    marcarGoogleConectadoUI();
  }

  //
  // 4) Luego hacemos el fetch a /api/session para sincronizar estado
  //
  let sessionResponse;
  try {
    sessionResponse = await fetch('/api/session', {
      credentials: 'include',
    });
  } catch (err) {
    console.error('❌ Error al llamar a /api/session:', err);
  }

  if (sessionResponse && sessionResponse.ok) {
    const sessionData = await sessionResponse.json();
    if (!sessionData.authenticated) {
      // Si no está autenticado, redirigimos a login
      window.location.href = '/';
      return;
    }
    // Si ya conectó, pintamos UI
    if (sessionData.user.shopifyConnected) {
      marcarShopifyConectadoUI();
      habilitarContinueSiShopify();
    }
    if (sessionData.user.googleConnected) {
      marcarGoogleConectadoUI();
    }
  } else {
    // 401 o error → redirigir
    window.location.href = '/';
    return;
  }

  //
  // 5) Si existe ?shopifyToken en la URL (callback de Shopify),
  //    guardamos el JWT y volvemos a recargar /api/session
  //
  const params     = new URLSearchParams(window.location.search);
  const jwtShopify = params.get('shopifyToken');
  if (jwtShopify) {
    localStorage.setItem('shopifyToken', jwtShopify);
    try {
      const newSession = await fetch('/api/session', {
        credentials: 'include',
      });
      if (newSession.ok) {
        const newSessionData = await newSession.json();
        if (newSessionData.authenticated && newSessionData.user.shopifyConnected) {
          marcarShopifyConectadoUI();
          habilitarContinueSiShopify();
        }
        if (newSessionData.authenticated && newSessionData.user.googleConnected) {
          marcarGoogleConectadoUI();
        }
      }
    } catch (err) {
      console.error('❌ Error al recargar /api/session tras callback:', err);
    }
  }

  //
  // 6) Listener para “Connect Shopify” — arranca OAuth embebido
  //
  if (connectShopifyBtn) {
    connectShopifyBtn.addEventListener('click', () => {
      // Leemos shop y host que Shopify inyecta en la URL
      const params = new URLSearchParams(window.location.search);
      const shop  = params.get('shop');
      const host  = params.get('host');

      if (!shop || !host) {
        console.error('❌ Faltan parámetros shop o host en la URL');
        return;
      }

      // Redirigimos al endpoint que inicia OAuth de Shopify
      window.location.href =
        `/connector?shop=${encodeURIComponent(shop)}` +
        `&host=${encodeURIComponent(host)}`;
    });
  }

  //
  // 7) Listener para “Connect Google”
  //
  if (connectGoogleBtn) {
    connectGoogleBtn.addEventListener('click', () => {
      window.location.href = '/auth/google/connect';
    });
  }

  //
  // 8) Listener para “Continue” (solo redirige al dashboard)
  //
  if (continueBtn) {
    continueBtn.addEventListener('click', () => {
      window.location.href = '/';
    });
  }
});
