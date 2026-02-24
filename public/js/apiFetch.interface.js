// public/js/apiFetch.interface.js
async function getShopifySessionToken() {
  try {
    if (window.shopify && typeof window.shopify.idToken === 'function') {
      return await window.shopify.idToken();
    }
  } catch (_) {}
  return '';
}

export async function apiFetch(path, options = {}) {
  const token = await getShopifySessionToken();

  options.headers = {
    ...(options.headers || {}),
    'Content-Type': 'application/json',
  };
  if (token) options.headers.Authorization = `Bearer ${token}`;

  const res  = await fetch(path, {
    credentials: 'include',  
    ...options,
  });

  const text = await res.text();
  try { return JSON.parse(text); }
  catch { return { ok:false, status:res.status, raw:text }; }
}
