import createApp from "@shopify/app-bridge";
import { getSessionToken, authenticatedFetch } from "@shopify/app-bridge/utilities";

export const app = createApp({
  apiKey: document.querySelector("script[data-api-key]").dataset.apiKey,
  host: new URLSearchParams(location.search).get("host"),
});

export { getSessionToken, authenticatedFetch };
