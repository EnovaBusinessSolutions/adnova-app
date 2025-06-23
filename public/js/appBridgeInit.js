// public/js/appBridgeInit.js
window.initAppBridge = async () => {
  // 1) espera a que exista el core
  const tryCore = () =>
    new Promise((ok, fail) => {
      let tries = 0;
      (function poll () {
        if (window['app-bridge']?.default) return ok();
        if (++tries > 40) return fail(new Error('App Bridge no cargó'));
        setTimeout(poll, 250);
      })();
    });

  await tryCore();

  const AB   = window['app-bridge'].default;
  const ABU  = window['app-bridge-utils'];

  const apiKey = document.querySelector(
    'meta[name="shopify-api-key"]'
  ).content;
  const host   = new URLSearchParams(location.search).get('host');

  if (!apiKey || !host) throw new Error('Faltan apiKey u host');

  const app = AB.createApp({ apiKey, host, forceRedirect: false });

  return {
    app,
    getSessionToken: () => ABU.getSessionToken(app)
  };
};
