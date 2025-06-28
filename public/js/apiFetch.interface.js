// public/js/apiFetch.interface.js
export async function apiFetch(path, options = {}) {
  const token = sessionStorage.getItem('sessionToken');

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
