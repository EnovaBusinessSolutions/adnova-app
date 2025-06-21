function waitForAppBridge(timeout = 7000) {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    (function check() {
      const AB = window['app-bridge'] || window.AppBridge;
      const isReady = AB?.default && AB.utilities?.getSessionToken;

      if (isReady) return resolve(AB);

      if (Date.now() - start > timeout) {
        return reject(new Error("App Bridge no se cargó en el tiempo esperado"));
      }

      requestAnimationFrame(check);
    })();
  });
}

window.initAppBridge = async function () {
  const AB = await waitForAppBridge();

  const createApp = AB.default;
  const getSessionToken = AB.utilities.getSessionToken;

  const apiKey = document.querySelector("meta[name='shopify-api-key']").content;
  const host = new URLSearchParams(location.search).get("host");

  const app = createApp({
    apiKey,
    host,
    forceRedirect: false,
  });

  return { app, getSessionToken };
};
