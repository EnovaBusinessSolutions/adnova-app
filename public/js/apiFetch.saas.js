export async function apiFetch(url, options = {}) {
  const token = sessionStorage.getItem('sessionToken');
  if (!options.headers) options.headers = {};
  if (token) {
    options.headers.Authorization = `Bearer ${token}`;
  }

  const res = await fetch(url, {
    credentials: 'include',
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...options.headers,
    },
  });

  const json = await res.json();
  return json;
}
