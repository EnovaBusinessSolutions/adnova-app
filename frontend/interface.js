import createApp from '@shopify/app-bridge';
import { getSessionToken } from '@shopify/app-bridge-utils';

document.addEventListener('DOMContentLoaded', async () => {
  const apiKeyMeta = document.querySelector('meta[name="shopify-api-key"]');
  const apiKey = apiKeyMeta ? apiKeyMeta.content : null;

  const params = new URLSearchParams(window.location.search);
  const host = params.get('host');
  const shop = params.get('shop');

  const shopDom = document.getElementById('shopDom');
  if (shop && shopDom) shopDom.textContent = shop;
  if (!apiKey || !host) {
    document.body.innerHTML =
      `<h2>Error: faltan parámetros <code>apiKey</code> u <code>host</code>.<br>
        Abre la app desde el panel de Shopify.</h2>`;
    throw new Error('Faltan apiKey/host en la URL');
  }

  let sessionToken = null;
  let tries = 20;
  let btn = document.getElementById('goToAdnova');

  async function getTokenWithRetry() {
    try {
      const app = createApp({ apiKey, host });
      sessionToken = await getSessionToken(app);
      if (!sessionToken) throw new Error('Token vacío');

      sessionStorage.setItem('sessionToken', sessionToken);
      localStorage.setItem('sessionToken', sessionToken); 

      fetch('https://ai.adnova.digital/api/secure/ping', {
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

  if (btn) {
    btn.addEventListener('click', () => {
      window.open('https://ai.adnova.digital/', '_blank');
    });
  }

  getTokenWithRetry(); 
});
