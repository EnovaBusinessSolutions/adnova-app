// public/js/onboarding.js
document.addEventListener('DOMContentLoaded', async () => {
  // (Opcional) Leer el flag oculto que inyecta el servidor:
  const flagElem = document.getElementById('shopifyConnectedFlag');
  if (flagElem && flagElem.textContent.trim() === 'true') {
    // Si el servidor ya nos devolvió “true” en el HTML, pintamos desde el inicio:
    marcarShopifyConectadoUI();
    // Nota: igual haremos el fetch a /api/session para sincronizar estado.
  }

  // 1) Fetch a /api/session:
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
    if (sessionData.authenticated) {
      if (sessionData.user.shopifyConnected) {
        marcarShopifyConectadoUI();
      }
    } else {
      // No autenticado → redirigir a login
      window.location.href = '/';
      return;
    }
  } else {
    // 401 u otro → redirigir a login
    window.location.href = '/';
    return;
  }

  // 2) Revisar si llegó shopifyToken en querystring:
  const params = new URLSearchParams(window.location.search);
  const jwtShopify = params.get('shopifyToken');
  if (jwtShopify) {
    // Guardar JWT localmente si lo necesitas más adelante
    localStorage.setItem('shopifyToken', jwtShopify);

    // Vuelvo a pedir /api/session para “refrescar” estado
    try {
      const newSession = await fetch('/api/session', {
        credentials: 'include',
      });
      if (newSession.ok) {
        const newSessionData = await newSession.json();
        if (
          newSessionData.authenticated &&
          newSessionData.user.shopifyConnected
        ) {
          marcarShopifyConectadoUI();
        }
      }
    } catch (err) {
      console.error(
        '❌ Error al recargar /api/session tras callback:',
        err
      );
    }
  }

  // 3) Selectores del DOM (ahora coincide con el HTML modificado)
  const connectShopifyBtn = document.getElementById('connect-shopify');
  const continueBtn       = document.getElementById('continue-btn');

  // 4) Listener para “Connect” (inicia OAuth con Shopify)
  if (connectShopifyBtn) {
    connectShopifyBtn.addEventListener('click', () => {
      const userId = document.body.getAttribute('data-user-id');
      if (!userId) {
        console.error('⚠️ No encontramos "data-user-id" en el body');
        return;
      }
      const shop = prompt(
        'Ingresa tu dominio (por ejemplo: ejemplo.myshopify.com):'
      );
      if (!shop) return;
      window.location.href = `/api/shopify/connect?userId=${userId}&shop=${shop}`;
    });
  }

  // 5) Listener para “Continue”
  if (continueBtn) {
    continueBtn.addEventListener('click', () => {
      window.location.href = '/dashboard';
    });
  }

  // 6) Función que pinta el botón Connect en verde y habilita Continue
  function marcarShopifyConectadoUI() {
    if (connectShopifyBtn) {
      connectShopifyBtn.textContent = 'Connected';
      connectShopifyBtn.classList.add('connected'); // .connected { background: green; }
      connectShopifyBtn.disabled = true;
    }
    if (continueBtn) {
      continueBtn.disabled = false;
      continueBtn.classList.remove('btn-continue--disabled');
      continueBtn.classList.add('btn-continue--enabled');
    }
  }
});
