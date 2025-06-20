/**
 * Espera hasta que App Bridge esté disponible en la página.
 * @param {number} timeout Tiempo máximo (ms) para esperar.
 * @returns {Promise<object>} El objeto AppBridge.
 */
function waitForAppBridge(timeout = 3000) {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    (function check() {
      const AB = window['app-bridge'] || window.AppBridge;
      if (AB?.default && AB.utilities) {
        return resolve(AB);
      }
      if (Date.now() - start > timeout) {
        return reject(new Error("App Bridge not loaded"));
      }
      requestAnimationFrame(check);
    })();
  });
}

let app;
let getSessionToken;
let authenticatedFetch;

// Inicializa App Bridge en cuanto esté disponible
(async () => {
  try {
    const AB = await waitForAppBridge();
    const createApp = AB.default;
    ({ getSessionToken, authenticatedFetch } = AB.utilities);

    // Obtener apiKey y host del script / query
    const scriptEl = document.querySelector("script[data-api-key]");
    if (!scriptEl) throw new Error("No se encontró el script con data-api-key");
    const apiKey = scriptEl.dataset.apiKey;
    const host   = new URLSearchParams(location.search).get("host");

    app = createApp({
      apiKey,
      host,
      forceRedirect: false,
    });
  } catch (err) {
    console.error("❌ Error iniciando App Bridge:", err);
  }
})();

export { app, getSessionToken, authenticatedFetch };
