// public/js/appBridgeInit.js
window.initAppBridge = async function () {
  const AB = window['app-bridge'] || window.AppBridge;
  const ABU = window['app-bridge-utils'];
  if (!AB?.default) throw new Error('App Bridge aún no cargó');
  if (!ABU) throw new Error('App Bridge Utils aún no cargó');

  const apiKey = document
                 .querySelector('meta[name="shopify-api-key"]').content;
  const host   = new URLSearchParams(location.search).get('host');
  if (!apiKey || !host) throw new Error('Faltan apiKey u host');

   const app = AB({ apiKey, host, forceRedirect: false });

  // 👉  NUEVO: función propia para pedir el token
  function fetchSessionToken() {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(
        () => reject(new Error('Token timeout')),
        7000
      );

      const unsubscribe = app.subscribe(
        'APP::AUTH_TOKEN_FETCH::RESPONSE',
        (payload) => {
          clearTimeout(timeout);
          unsubscribe();
          const token = payload?.data?.token;
          if (token) resolve(token);
          else reject(new Error('Respuesta sin token'));
        }
      );

      app.dispatch('APP::AUTH_TOKEN_FETCH::REQUEST');
    });
  }

  return { app, getSessionToken: (app) => ABU.getSessionToken(app) };
};