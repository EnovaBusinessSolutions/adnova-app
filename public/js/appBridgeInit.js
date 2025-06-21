// public/js/appBridgeInit.js

/**
 * Espera a que App Bridge esté disponible globalmente en window
 */
function waitForAppBridge(timeout = 5000) {
  return new Promise((resolve, reject) => {
    const start = Date.now();

    (function check() {
      const AB = window["app-bridge"] || window.AppBridge;
      if (AB?.default && AB.utilities) return resolve(AB);

      if (Date.now() - start > timeout) {
        return reject(new Error("❌ App Bridge no se cargó en el tiempo esperado"));
      }
      requestAnimationFrame(check);
    })();
  });
}

export async function initAppBridge() {
  const AB = await waitForAppBridge();
  const createApp = AB.default;
  const { getSessionToken, authenticatedFetch } = AB.utilities;

  const scriptEl = document.querySelector("script[data-api-key]");
  if (!scriptEl) throw new Error("No se encontró el script con data-api-key");
  const apiKey = scriptEl.dataset.apiKey;
  const host = new URLSearchParams(location.search).get("host");

  const app = createApp({ apiKey, host, forceRedirect: false });
  return { app, getSessionToken, authenticatedFetch };
}