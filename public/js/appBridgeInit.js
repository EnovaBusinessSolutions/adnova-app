// public/js/appBridgeInit.js

/**
 * Inicializa Shopify App Bridge de forma segura, esperando a que
 * el core y los utils estén disponibles en window.
 */
window.initAppBridge = async function () {
  // 1) Espera activa hasta que el core de App Bridge esté definido
  while (!window['app-bridge']) {
    await new Promise(resolve => requestAnimationFrame(resolve));
  }

  // 2) Ya podemos sacar los objetos oficiales
  const AB  = window['app-bridge'];         // core
  const ABU = window['app-bridge-utils'];   // utils

  // 3) Extrae apiKey del meta tag y host de la URL
  const metaApiKey = document.querySelector('meta[name="shopify-api-key"]');
  if (!metaApiKey) {
    throw new Error("No se encontró <meta name=\"shopify-api-key\">");
  }
  const apiKey = metaApiKey.content;

  const searchParams = new URLSearchParams(window.location.search);
  const host = searchParams.get('host');
  if (!host) {
    throw new Error("Falta el parámetro 'host' en la URL");
  }

  // 4) Crea la app de App Bridge
  const app = AB.default({
    apiKey,
    host,
    forceRedirect: false,
  });

  // 5) Devuelve app y la función getSessionToken
  return {
    app,
    getSessionToken: (appInstance) => ABU.getSessionToken(appInstance),
  };
};
