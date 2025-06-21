// public/js/appBridgeInit.js

/**
 * Inicializa App Bridge manualmente cuando se invoque.
 * No se ejecuta automáticamente para evitar errores de carga.
 */
export async function initAppBridge() {
  function waitForAppBridge(timeout = 3000) {
    return new Promise((resolve, reject) => {
      const start = Date.now();
      (function check() {
        const AB = window['app-bridge'] || window.AppBridge;
        if (AB?.default && AB.utilities) return resolve(AB);
        if (Date.now() - start > timeout)
          return reject(new Error("App Bridge not loaded"));
        requestAnimationFrame(check);
      })();
    });
  }

  const AB = await waitForAppBridge();
  const createApp = AB.default;
  const { getSessionToken, authenticatedFetch } = AB.utilities;

  const scriptEl = document.querySelector("script[data-api-key]");
  if (!scriptEl) throw new Error("No se encontró el script con data-api-key");

  const apiKey = scriptEl.dataset.apiKey;
  const host = new URLSearchParams(location.search).get("host");

  const app = createApp({
    apiKey,
    host,
    forceRedirect: false,
  });

  return { app, getSessionToken, authenticatedFetch };
}
