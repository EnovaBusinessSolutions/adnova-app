// public/js/appBridgeInit.js

function waitForAppBridge(timeout = 3000) {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    (function check() {
      const AppBridge = window['app-bridge'] || window.AppBridge;
      if (AppBridge?.default && AppBridge.utilities) return resolve(AppBridge);
      if (Date.now() - start > timeout) return reject(new Error("App Bridge not loaded"));
      requestAnimationFrame(check);
    })();
  });
}

const AppBridge = await waitForAppBridge();
const createApp = AppBridge.default;
const { getSessionToken, authenticatedFetch } = AppBridge.utilities;

export const app = createApp({
  apiKey: document.querySelector("script[data-api-key]").dataset.apiKey,
  host: new URLSearchParams(location.search).get("host"),
});

export { getSessionToken, authenticatedFetch };
