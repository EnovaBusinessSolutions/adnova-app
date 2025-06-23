// public/js/appBridgeInit.js

window.initAppBridge = async function () {
  return new Promise((resolve, reject) => {
    const started = Date.now();

    const timer = setInterval(() => {
      // Compatibilidad con cualquiera de los dos globals
      const ABglobal = window.appBridge || window['app-bridge'];
      const AppBridge = ABglobal?.default;

      if (AppBridge) {
        clearInterval(timer);

        const apiKey = document
          .querySelector('meta[name="shopify-api-key"]')
          ?.content;
        const host = new URLSearchParams(location.search).get('host');

        if (!apiKey || !host) {
          return reject(new Error('No se encontraron apiKey u host'));
        }

        const app = AppBridge({ apiKey, host, forceRedirect: false });
        const getSessionToken = window.appBridgeUtils?.getSessionToken;

        if (!getSessionToken) {
          return reject(
            new Error('appBridgeUtils.getSessionToken no está disponible')
          );
        }

        return resolve({ app, getSessionToken });
      }

      if (Date.now() - started > 3000) {
        clearInterval(timer);
        reject(new Error('App Bridge no cargó'));
      }
    }, 50);
  });
};
