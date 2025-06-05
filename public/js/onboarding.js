// public/js/onboarding.js

document.addEventListener('DOMContentLoaded', async () => {
  // 1) Al cargar la página, hacemos un fetch a /api/session
  //    para ver si el usuario ya está autenticado y si ya conectó Shopify.
  let sessionResponse;
  try {
    sessionResponse = await fetch('/api/session', {
      credentials: 'include', // enviamos cookie de sesión si existe
    });
  } catch (err) {
    console.error('❌ Error al llamar a /api/session:', err);
  }

  if (sessionResponse && sessionResponse.ok) {
    const sessionData = await sessionResponse.json();
    // sessionData = { authenticated: true, user: { _id, email, onboardingComplete, googleConnected, metaConnected, shopifyConnected } }
    if (sessionData.authenticated) {
      // Si ya conectó Shopify, pintamos botón verde y habilitamos Continue
      if (sessionData.user.shopifyConnected) {
        marcarShopifyConectadoUI();
      }
    } else {
      // No está autenticado → redirigimos a login (index.html)
      window.location.href = '/';
      return;
    }
  } else {
    // Si no hay sesión válida (401), enviamos al login
    window.location.href = '/';
    return;
  }

  // 2) Revisamos si llegamos a esta URL con el parámetro shopifyToken en querystring
  //    Ejemplo: /onboarding?shopifyToken=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
  const params = new URLSearchParams(window.location.search);
  const jwtShopify = params.get('shopifyToken');
  if (jwtShopify) {
    // Guardamos el JWT en localStorage (para usarlo en fetch a /api/test-shopify-token, si lo necesitas)
    localStorage.setItem('shopifyToken', jwtShopify);

    // Después de guardar el token, volvemos a llamar a /api/session para "refrescar" el estado
    try {
      const newSession = await fetch('/api/session', {
        credentials: 'include',
      });
      if (newSession.ok) {
        const newSessionData = await newSession.json();
        if (newSessionData.authenticated && newSessionData.user.shopifyConnected) {
          // Ahora que MongoDB ya marcó al user como conectado, pintamos el UI
          marcarShopifyConectadoUI();
        }
      }
    } catch (err) {
      console.error('❌ Error al recargar /api/session tras callback:', err);
    }
  }

  // 3) Capturamos los botones y elementos del DOM
  const connectShopifyBtn = document.getElementById('connect-shopify');
  const continueBtn = document.getElementById('continue-btn');

  // 4) Si el usuario ya está conectado, la función marcarShopifyConectadoUI()
  //    habrá deshabilitado el botón Connect y habilitado Continue. Así que cualquiera
  //    de estos listeners no hará nada en ese caso.
  if (connectShopifyBtn) {
    connectShopifyBtn.addEventListener('click', () => {
      // 4.1) Si aún no está conectado (la UI no está en “verde”), pedimos dominio
      const userId = document.body.getAttribute('data-user-id');
      if (!userId) {
        console.error('⚠️ No encontramos "data-user-id" en el body');
        return;
      }
      const shop = prompt('Ingresa tu dominio (por ejemplo: ejemplo.myshopify.com):');
      if (!shop) return;

      // 4.2) Redirigimos al endpoint de tu backend que arranca OAuth con Shopify
      //      `/api/shopify/connect?userId=...&shop=ejemplo.myshopify.com`
      window.location.href = `/api/shopify/connect?userId=${userId}&shop=${shop}`;
    });
  }

  // 5) Listener para el botón "Continue" (solo habilitado cuando shopifyConnected===true)
  if (continueBtn) {
    continueBtn.addEventListener('click', () => {
      window.location.href = '/dashboard';
    });
  }

  // 6) Función auxiliar que pinta el botón Connect en verde y habilita Continue
  function marcarShopifyConectadoUI() {
    // 6.1) Deshabilitamos el botón Connect
    if (connectShopifyBtn) {
      connectShopifyBtn.textContent = 'Connected';
      connectShopifyBtn.classList.add('connected'); // CSS deberías definir .connected { background: green; }
      connectShopifyBtn.disabled = true;
    }
    // 6.2) Habilitar el botón Continue
    if (continueBtn) {
      continueBtn.disabled = false;
      continueBtn.classList.remove('btn-continue--disabled');
      continueBtn.classList.add('btn-continue--enabled');
    }
  }
});
