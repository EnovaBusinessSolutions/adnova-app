// public/js/apiFetch.saas.js
// Función genérica para llamar a rutas protegidas del SAAS

export async function apiFetch(url, options = {}) {
  // ① Intentamos leer primero de sessionStorage; si no hay, de localStorage
  const token =
    sessionStorage.getItem('sessionToken') ||
    localStorage.getItem('sessionToken');

  // ② Creamos / extendemos los headers
  if (!options.headers) options.headers = {};
  if (token) options.headers.Authorization = `Bearer ${token}`;

  // ③ Hacemos el fetch con credenciales (cookies de sesión) + JSON por defecto
  const res = await fetch(url, {
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      ...options.headers,
    },
    ...options,
  });

  // ④ Intentamos parsear JSON (puedes manejar .text() si tu backend no devuelve JSON)
  return res.json();
}
