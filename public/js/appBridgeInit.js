// appBridgeInit.js (versión sin imports)
const AppBridge = window['app-bridge'] || window.AppBridge;
const createApp = AppBridge.default;
const { getSessionToken, authenticatedFetch } = AppBridge.utilities;

export const app = createApp({
  apiKey: document.querySelector("script[data-api-key]").dataset.apiKey,
  host: new URLSearchParams(location.search).get("host"),
});

export { getSessionToken, authenticatedFetch };
