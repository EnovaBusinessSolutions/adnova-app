// public/js/appBridgeInit.js

window.initAppBridge = async function () {
  return new Promise((resolve, reject) => {
    const t0 = Date.now();
    const tick = setInterval(() => {
      // Intentamos detectar el global correcto
      const ABglobal = window.appBridge || window['app-bridge'];
      const AB = ABglobal?.default;

      if (AB) {
        clearInterval(tick);

        // Leemos apiKey y host
        const apiKeyMeta = document.querySelector('meta[name="shopify-api-key"]');
        const apiKey = apiKeyMeta?.content || '';
        const host = new URLSearchParams(location.search).get('host');

        if (!apiKey || !host) {
          return reject(new Error('Faltan apiKey u host'));
        }

        // Inicializamos App Bridge
        const app = AB({
          apiKey,
          host,
          forceRedirect: false
        });

        // Usamos la utilidad oficial
        const getSessionToken = window.appBridgeUtils?.getSessionToken;

        if (!getSessionToken) {
          return reject(new Error('No se encontró appBridgeUtils.getSessionToken'));
        }

        return resolve({ app, getSessionToken });
      }

      // Timeout tras 3 segundos
      if (Date.now() - t0 > 3000) {
        clearInterval(tick);
        return reject(new Error('App Bridge no cargó'));
      }
    }, 50);
  });
};
