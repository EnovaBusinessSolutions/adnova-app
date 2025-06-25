// public/connector/interfaceLogic.js
// --------------------------------------------------------
// 1) Parámetros de la URL
// --------------------------------------------------------
const apiKey = document
  .querySelector('meta[name="shopify-api-key"]')
  .content;
const params = new URLSearchParams(window.location.search);
const host   = params.get('host');
const shop   = params.get('shop');

// Muestra la tienda en pantalla
if (shop) document.getElementById('shopDom').textContent = shop;

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
  // Shopify inyectará window['app-bridge'] cuando el script termine
  if (window['app-bridge'] && window['app-bridge'].default) {
    try {
      const { default: createApp, getSessionToken } = window['app-bridge'];

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
      document.getElementById('goToAdnova').disabled = false;
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
  document.getElementById('goToAdnova').disabled = true;
}

// --------------------------------------------------------
// 3) Redirigir al SaaS una vez que hay token
// --------------------------------------------------------
document
  .getElementById('goToAdnova')
  .addEventListener('click', () => {
    if (!sessionToken) {
      alert('El token de sesión aún no está listo. Intenta de nuevo en unos segundos.');
      return;
    }
    // Normalmente basta con shop; el backend del SaaS pedirá el token vía API
    window.open(
      `https://adnova-app.onrender.com/onboarding?shop=${encodeURIComponent(shop)}`,
      '_blank'
    );
  });
