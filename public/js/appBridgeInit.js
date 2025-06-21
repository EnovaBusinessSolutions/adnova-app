function waitForAppBridge(timeout = 3000) {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    (function check() {
      const AB = window['app-bridge'] || window.AppBridge;
      if (AB?.default && AB.utilities) {
        return resolve(AB);
      }
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

  const apiKey = document.querySelector("script[data-api-key]").dataset.apiKey;
  const host = new URLSearchParams(location.search).get("host");

  const app = createApp({
    apiKey,
    host,
    forceRedirect: false,
  });

  return { app, getSessionToken };
};
