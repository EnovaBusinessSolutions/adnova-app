import { app, getSessionToken } from "./appBridgeInit.js";

export async function apiFetch(path, options = {}) {
  const token = await getSessionToken(app);      // obtiene JWT
  const res = await fetch(path, {
    ...options,
    headers: {
      ...(options.headers || {}),
      Authorization: `Bearer ${token}`,          // adjunta JWT
      "Content-Type": "application/json",
    },
  });
  return res.json();
}
