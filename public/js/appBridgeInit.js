function waitForAppBridge(timeout = 7000) {
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

  const apiKey = document.querySelector("meta[name='shopify-api-key']").content;
  const host = new URLSearchParams(window.location.search).get("host");

  if (!apiKey || !host) {
    throw new Error("Faltan apiKey o host para iniciar App Bridge");
  }

  const app = createApp({
    apiKey,
    host,
    forceRedirect: false,
  });

  return { app, getSessionToken };
};
