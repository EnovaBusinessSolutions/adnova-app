import createApp from '@shopify/app-bridge';
import { getSessionToken } from '@shopify/app-bridge-utils';

document.addEventListener('DOMContentLoaded', async () => {
  // Obtiene API Key desde el <meta>
  const apiKeyMeta = document.querySelector('meta[name="shopify-api-key"]');
  const apiKey = apiKeyMeta ? apiKeyMeta.content : null;

  const params = new URLSearchParams(window.location.search);
  const host = params.get('host');
  const shop = params.get('shop');

  // Muestra la tienda en pantalla
  const shopDom = document.getElementById('shopDom');
  if (shop && shopDom) shopDom.textContent = shop;

  // Verifica parámetros obligatorios
  if (!apiKey || !host) {
    document.body.innerHTML =
      `<h2>Error: faltan parámetros <code>apiKey</code> u <code>host</code>.<br>
        Abre la app desde el panel de Shopify.</h2>`;
    throw new Error('Faltan apiKey/host en la URL');
  }

  // Inicializa App Bridge
  let sessionToken = null;
  let tries = 20;
  let btn = document.getElementById('goToAdnova');

  async function getTokenWithRetry() {
    try {
      const app = createApp({ apiKey, host });
      sessionToken = await getSessionToken(app);
      if (!sessionToken) throw new Error('Token vacío');

      sessionStorage.setItem('sessionToken', sessionToken);

      // Puedes hacer un fetch para forzar el registro
      fetch('https://adnova-app.onrender.com/api/secure/ping', {
        headers: { Authorization: `Bearer ${sessionToken}` },
        credentials: 'include'
      });

      if (btn) btn.disabled = false;
      console.log('✅ App Bridge cargado y token obtenido');
    } catch (err) {
      if (--tries > 0) {
        setTimeout(getTokenWithRetry, 300);
      } else {
        showError('App Bridge nunca se cargó', err);
      }
    }
  }

  function showError(msg, err) {
    console.error(msg, err);
    document.body.insertAdjacentHTML(
      'beforeend',
      `<p style="color:#ff6666"><b>${msg}:</b> ${err?.message || ''}</p>`
    );
    if (btn) btn.disabled = true;
  }

  // Botón: solo redirige, ya no pide magic link
  if (btn) {
    btn.addEventListener('click', () => {
      if (!sessionToken) {
        alert('El token de sesión aún no está listo. Intenta de nuevo en unos segundos.');
        return;
      }
      // Redirige a Adnova AI pasando el dominio de la tienda (puedes agregar host si lo necesitas)
      window.location.href = `https://adnova-app.onrender.com/`;
    });
  }

  getTokenWithRetry(); // ¡Arranca!
});
