async function getShopifySessionToken() {
  try {
    if (window.shopify && typeof window.shopify.idToken === 'function') {
      return await window.shopify.idToken();
    }
  } catch (_) {}
  return '';
}

export async function apiFetch(url, opts = {}) {
  const token = await getShopifySessionToken();

  const baseHeaders = {
    'Content-Type': 'application/json',
    ...(token ? { Authorization: `Bearer ${token}` } : {})
  };

  const res = await fetch(url, {
    credentials: 'include',
    ...opts,
    headers: {
      ...baseHeaders,
      ...(opts.headers || {})
    }
  });

  const text = await res.text();
  try { return JSON.parse(text); } catch { return { ok:false, raw:text }; }
}
