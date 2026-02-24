export async function apiFetch(url, opts = {}) {
  const token =
    sessionStorage.getItem('sessionToken') ||
    localStorage.getItem('sessionToken');

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
