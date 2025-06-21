function waitForAppBridge(timeout = 7000) {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    (function check() {
      const AB  = window['app-bridge'];
      const ABU = window['app-bridge-utils'];
      if (AB?.default && ABU?.getSessionToken) {
        return resolve({ AB, ABU });
      }
      if (Date.now() - start > timeout) {
        return reject(new Error("App Bridge o Utils no se cargaron a tiempo"));
      }
      requestAnimationFrame(check);
    })();
  });
}


window.initAppBridge = async function () {
  const { AB, ABU } = await waitForAppBridge();

  const apiKey = document.querySelector("meta[name='shopify-api-key']").content;
  const host   = new URLSearchParams(window.location.search).get("host");

  if (!apiKey || !host) throw new Error("Faltan apiKey u host");

  const app = AB.default({
    apiKey,
    host,
    forceRedirect: false,
  });

  return { app, getSessionToken: (app) => ABU.getSessionToken(app) };
};
