// public/js/appBridgeInit.js

function waitForAppBridge(timeout = 3000) {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    (function check() {
      const AB = window['app-bridge'] || window.AppBridge;
      if (AB?.default && AB.utilities) return resolve(AB);
      if (Date.now() - start > timeout) return reject(new Error("App Bridge not loaded"));
      requestAnimationFrame(check);
    })();
  });
}

// IIFE que expone todo a window
(async () => {
  try {
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

    // ✅ Exportar todo al scope global
    window.app = app;
    window.getSessionToken = getSessionToken;
    window.authenticatedFetch = authenticatedFetch;
  } catch (err) {
    console.error("❌ Error iniciando App Bridge:", err);
  }
})();
