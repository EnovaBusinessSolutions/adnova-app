// public/connector/interfaceLogic.js
// --------------------------------------------------------
// Ejecuta la lógica sólo después de que todo el DOM esté listo
// --------------------------------------------------------

// Helper universal para detectar App Bridge, sin importar alias
function getAppBridgeGlobal() {
  return (
    window['app-bridge'] ||
    window['appBridge'] ||
    window['ShopifyAppBridge'] ||
    window['AppBridge'] // por si acaso
  );
}

document.addEventListener('DOMContentLoaded', () => {
  // --------------------------------------------------------
  // 1) Parámetros de la URL
  // --------------------------------------------------------
  const apiKeyMeta = document.querySelector('meta[name="shopify-api-key"]');
  const apiKey     = apiKeyMeta ? apiKeyMeta.content : null;

  const params = new URLSearchParams(window.location.search);
  const host   = params.get('host');
  const shop   = params.get('shop');

  // Muestra la tienda en pantalla
  const shopDom = document.getElementById('shopDom');
  if (shop && shopDom) shopDom.textContent = shop;

  // Verificación rápida (por si alguien abre el HTML suelto)
  if (!apiKey || !host) {
    document.body.innerHTML =
      `<h2>Error: faltan parámetros <code>apiKey</code> u <code>host</code>.<br>
        Abre la app desde el panel de Shopify.</h2>`;
    throw new Error('Faltan apiKey/host en la URL');
  }

  // --------------------------------------------------------
  // 2) Esperar a que App Bridge cargue y pedir sessionToken
  // --------------------------------------------------------
  let sessionToken = null;
  waitForAppBridge();          // ⬅️ arranque

  async function waitForAppBridge(tries = 20) {
    const AB = getAppBridgeGlobal(); // <--- Aquí se usa el helper

    if (AB && AB.default) {
      try {
        const { default: createApp, getSessionToken } = AB;

        const app = createApp({ apiKey, host });
        sessionToken = await getSessionToken(app);
        if (!sessionToken) throw new Error('Token vacío');

        // Guarda temporalmente para otros JS que corran en la misma pestaña
        sessionStorage.setItem('sessionToken', sessionToken);

        // Ejemplo: golpea tu endpoint protegido para forzar que quede registrado
        fetch('/api/ping', {
          headers: { Authorization: `Bearer ${sessionToken}` },
        });

        // Habilita el botón cuando todo está ok
        const btn = document.getElementById('goToAdnova');
        if (btn) btn.disabled = false;
        console.log('✅ App Bridge cargado y token obtenido');
      } catch (err) {
        showError('Error al pedir token', err);
      }
    } else if (tries > 0) {
      // Vuelve a intentarlo en 300 ms (aprox. 6 s en total)
      setTimeout(() => waitForAppBridge(tries - 1), 300);
    } else {
      showError('App Bridge nunca se cargó');
    }
  }

  function showError(msg, err) {
    console.error(msg, err);
    document.body.insertAdjacentHTML(
      'beforeend',
      `<p style="color:#ff6666"><b>${msg}:</b> ${err?.message || ''}</p>`
    );
    const btn = document.getElementById('goToAdnova');
    if (btn) btn.disabled = true;
  }

  // --------------------------------------------------------
  // 3) Redirigir al SaaS una vez que hay token
  // --------------------------------------------------------
  const btnGo = document.getElementById('goToAdnova');
  if (btnGo) {
    btnGo.addEventListener('click', () => {
      if (!sessionToken) {
        alert('El token de sesión aún no está listo. Intenta de nuevo en unos segundos.');
        return;
      }
      // Normalmente basta con shop; el backend del SaaS pedirá el token vía APi
      window.open(
        `https://adnova-app.onrender.com/onboarding?shop=${encodeURIComponent(shop)}`,
        '_blank'
      );
    });
  }
});
